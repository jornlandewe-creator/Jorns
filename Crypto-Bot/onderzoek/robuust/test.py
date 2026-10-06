"""Test volgens REGELS_VOORAF.md. Niets in dit bestand mag de vastgelegde regels wijzigen."""
import os, sys, json
import numpy as np, pandas as pd
from numba import njit
os.chdir('/home/claude/bot')
COINS = ['BTC', 'ETH', 'BNB', 'XRP', 'ADA', 'LINK', 'DOGE', 'SOL', 'AVAX', 'DOT']
START, END = '2018-01-01', '2026-10-01'
FEE = 0.0005 + 0.0003


@njit(cache=True)
def sim(R, W, reb, cost, F, start):
    T, M = R.shape
    eq = np.ones(T); w = np.zeros(M); val = 1.0
    for t in range(start, T):
        g = 0.0
        for m in range(M): g += w[m] * R[t, m]
        fund = 0.0
        for m in range(M): fund += w[m] * F[t, m]
        val *= (1 + g - fund)
        if 1 + g > 0:
            for m in range(M): w[m] = w[m] * (1 + R[t, m]) / (1 + g)
        if reb[t]:
            to = 0.0
            for m in range(M): to += abs(W[t, m] - w[m])
            val *= (1 - cost * to)
            for m in range(M): w[m] = W[t, m]
        eq[t] = val
        if val <= 0:
            for k in range(t, T): eq[k] = 1e-9
            break
    for k in range(start): eq[k] = 1.0
    return eq


def load():
    C = pd.DataFrame({c: pd.read_csv(f'data/coins/{c}_1d.csv', index_col=0, parse_dates=True).close for c in COINS})
    C = C[C.index < END]
    R = C.pct_change(fill_method=None).fillna(0.0)
    elig = C.notna().cumsum() >= 150
    elig &= C.notna()
    def fr(f):
        d = pd.read_csv(f, index_col=0, parse_dates=['timestamp'], date_format='ISO8601')
        d.index = pd.to_datetime(d.index, utc=True, format='ISO8601'); return d.fundingRate.resample('1D').sum()
    b = fr('/home/claude/zwmjj/funding-rate-arb/data/raw/btc_funding_rate.csv').reindex(C.index)
    e = fr('/home/claude/zwmjj/funding-rate-arb/data/raw/eth_funding_rate.csv').reindex(C.index)
    F = pd.DataFrame(index=C.index, columns=COINS, dtype=float)
    for c in COINS: F[c] = b * 1.5
    F['BTC'] = b; F['ETH'] = e
    F = F.fillna(0.0003)
    return C, R, elig, F


def reb_mask(idx, every, start):
    s = idx.searchsorted(pd.Timestamp(start, tz='UTC')) - 1
    m = np.zeros(len(idx), bool); m[s::every] = True; return m


def weights_A(C, R, elig, looks=(20, 60, 120), tv=0.40):
    sig = sum(np.sign(C / C.shift(L) - 1).fillna(0) for L in looks) / len(looks)
    vol = R.rolling(30).std() * np.sqrt(365)
    n = elig.sum(axis=1).replace(0, np.nan)
    W = (sig * (tv / vol)).div(n, axis=0).where(elig, 0.0)
    return W.fillna(0.0)


def weights_B(C, elig, look=28, frac=1 / 3):
    mom = (C / C.shift(look) - 1).where(elig)
    n = mom.notna().sum(axis=1)
    k = np.maximum(1, np.floor(n * frac)).astype(int)
    rk = mom.rank(axis=1, ascending=False); rl = mom.rank(axis=1, ascending=True)
    L = rk.le(k, axis=0) & mom.notna(); S = rl.le(k, axis=0) & mom.notna()
    W = L.astype(float).div(k, axis=0) * 0.5 - S.astype(float).div(k, axis=0) * 0.5
    W[n < 2] = 0.0
    return W.fillna(0.0)


def scaled(W, R, F, reb, s0, cost, target=0.25, cap=3.0):
    """Schaal een strategie naar 25% beweeglijkheid op basis van de 60 dagen ervoor (alleen verleden)."""
    raw = sim(R.values, W.values, reb, cost, F.values, s0)
    r = pd.Series(raw, R.index).pct_change().fillna(0)
    vol = r.rolling(60).std().shift(1) * np.sqrt(365)
    sc = (target / vol).clip(upper=cap).fillna(1.0)
    return W.mul(sc, axis=0)


def stats(eq, idx, a=START, b=END):
    e = pd.Series(eq, idx); e = e[(e.index >= a) & (e.index < b)]; e = e / e.iloc[0]
    r = e.pct_change().dropna(); y = (e.index[-1] - e.index[0]).days / 365.25
    m = e.resample('ME').last().pct_change(); m.iloc[0] = e.resample('ME').last().iloc[0] - 1
    sh = r.mean() / r.std() * np.sqrt(365) if r.std() > 0 else 0
    top3 = m.nlargest(3); ex3 = (1 + m.drop(top3.index)).prod() - 1
    yrs = {int(yy): round((g.iloc[-1] / g.iloc[0] - 1) * 100, 1) for yy, g in e.groupby(e.index.year)}
    return dict(totaal=e.iloc[-1] - 1, per_jaar=e.iloc[-1] ** (1 / y) - 1, daling=(e / e.cummax() - 1).min(), sharpe=sh, t=sh * np.sqrt(y),
                zonder_top3=ex3, pos_maanden=(m > 0).mean(), pos_weken=(e.resample('W').last().pct_change().dropna() > 0).mean(), jaren=yrs)


def run(cost_mult=1.0, A_looks=(20, 60, 120), B_look=28, B_frac=1 / 3, every=7):
    C, R, elig, F = load()
    idx = C.index; s0 = idx.searchsorted(pd.Timestamp(START, tz='UTC')) - 1
    reb = reb_mask(idx, every, START); cost = FEE * cost_mult; Fm = F * cost_mult
    WA = weights_A(C, R, elig, A_looks); WB = weights_B(C, elig, B_look, B_frac)
    sA = scaled(WA, R, Fm, reb, s0, cost); sB = scaled(WB, R, Fm, reb, s0, cost)
    out = {}
    for nm, W in [('A trend', sA), ('B sterkste/zwakste', sB), ('Combinatie', 0.5 * sA + 0.5 * sB)]:
        eq = sim(R.values, W.values, reb, cost, Fm.values, s0); out[nm] = (eq, W)
    return C, R, elig, F, reb, s0, out


if __name__ == '__main__':
    C, R, elig, F, reb, s0, out = run()
    res = {}
    for nm, (eq, W) in out.items():
        st = stats(eq, C.index); res[nm] = st
        print(f"{nm:20s} {st['per_jaar']*100:6.1f}%/jr daling {st['daling']*100:6.1f}% Sharpe {st['sharpe']:.2f} t {st['t']:.2f} "
              f"zonder top3 mnd {st['zonder_top3']*100:7.1f}% pos mnd {st['pos_maanden']:.0%} | {st['jaren']}")
    bh = C['BTC'] / C['BTC'].loc[START:].iloc[0]
    st = stats(bh.values, C.index); res['BTC vasthouden'] = st
    print(f"{'BTC vasthouden':20s} {st['per_jaar']*100:6.1f}%/jr daling {st['daling']*100:6.1f}% Sharpe {st['sharpe']:.2f} t {st['t']:.2f} zonder top3 {st['zonder_top3']*100:.1f}% | {st['jaren']}")
    pd.DataFrame({k: v[0] for k, v in out.items()}, index=C.index).to_csv('robust/curves.csv')
    json.dump({k: {kk: (vv if not isinstance(vv, (np.floating,)) else float(vv)) for kk, vv in v.items()} for k, v in res.items()}, open('robust/hoofd.json', 'w'), default=float, indent=1)
