"""Research lab: vectorised daily backtester for weight-based strategies on the 10-coin universe.
Costs: 0.05% fee + 0.03% slippage per side on turnover. Leverage>1 pays funding 0.03%/day on the borrowed part.
"""
import sys, itertools, json
import numpy as np, pandas as pd
from numba import njit

import os
DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'dashboard', 'data', 'coins')
COINS = ['BTC', 'ETH', 'BNB', 'XRP', 'ADA', 'LINK', 'DOGE', 'SOL', 'AVAX', 'DOT']
START, SPLIT, END = '2018-01-01', '2023-01-01', '2026-10-02'
COST = 0.0008
FUND_DAY = 0.0003


def load(tf='1d'):
    C = {}; H = {}; L = {}
    for c in COINS:
        df = pd.read_csv(f'{DATA}/{c}_{tf}.csv.gz', index_col=0, parse_dates=True)
        C[c] = df.close; H[c] = df.high; L[c] = df.low
    C = pd.DataFrame(C); H = pd.DataFrame(H).reindex(C.index); L = pd.DataFrame(L).reindex(C.index)
    C = C[C.index < END]; H = H[H.index < END]; L = L[L.index < END]
    return C, H, L


@njit(cache=True)
def sim(R, W, cost, fund, start, thresh):
    """R: returns T x M. W: target weights (decided on close t, applied from t+1). Rebalance when total |dW| > thresh."""
    T, M = R.shape
    eq = np.ones(T); w = np.zeros(M); val = 1.0
    for t in range(start, T):
        g = 0.0; gross = 0.0
        for m in range(M):
            g += w[m] * R[t, m]; gross += abs(w[m])
        borrowed = max(gross - 1.0, 0.0)
        val *= (1 + g - fund * borrowed)
        if 1 + g > 0:
            for m in range(M): w[m] = w[m] * (1 + R[t, m]) / (1 + g)
        to = 0.0
        for m in range(M): to += abs(W[t, m] - w[m])
        if to > thresh:
            val *= (1 - cost * to)
            for m in range(M): w[m] = W[t, m]
        eq[t] = val
        if val <= 0:
            for k in range(t, T): eq[k] = 1e-9
            break
    for k in range(start): eq[k] = 1.0
    return eq


def run(W, R, start=START, thresh=0.02, cost=COST):
    idx = R.index; s0 = idx.searchsorted(pd.Timestamp(start, tz='UTC'))
    Wv = np.nan_to_num(W.values.astype(float)); Rv = np.nan_to_num(R.values.astype(float))
    eq = sim(Rv, Wv, cost, FUND_DAY, s0, thresh)
    return pd.Series(eq, idx)


def stats(e, a=START, b=END):
    e = e[(e.index >= a) & (e.index < b)]; e = e / e.iloc[0]
    r = e.pct_change().dropna(); y = (e.index[-1] - e.index[0]).days / 365.25
    m = e.resample('ME').last().pct_change().dropna()
    sh = r.mean() / r.std() * np.sqrt(365) if r.std() > 0 else 0
    dd = (e / e.cummax() - 1)
    yrs = {int(yy): round((g.iloc[-1] / g.iloc[0] - 1) * 100) for yy, g in e.groupby(e.index.year)}
    cagr = e.iloc[-1] ** (1 / y) - 1
    return dict(cagr=cagr, mdd=dd.min(), sharpe=sh, calmar=cagr / -dd.min() if dd.min() < 0 else 0,
                pos_m=(m > 0).mean(), worst_m=m.min(), jaren=yrs, t=sh * np.sqrt(y))


def trades_from_weights(W, R, start=START):
    """Trade = per coin from weight>0 to weight==0. Return list of pct returns (gross of cost approx)."""
    idx = W.index; s0 = idx.searchsorted(pd.Timestamp(start, tz='UTC'))
    out = []
    for c in W.columns:
        w = W[c].values; r = R[c].values; inpos = False; g = 1.0
        for t in range(s0, len(w) - 1):
            if not inpos and w[t] > 0: inpos = True; g = 1.0
            elif inpos:
                g *= 1 + r[t]
                if w[t] <= 0: inpos = False; out.append(g - 1 - 2 * COST)
    a = np.array(out)
    if not len(a): return dict(n=0)
    return dict(n=len(a), winrate=(a > 0).mean(), avg_win=a[a > 0].mean() if (a > 0).any() else 0, avg_loss=a[a <= 0].mean() if (a <= 0).any() else 0,
                pf=a[a > 0].sum() / -a[a <= 0].sum() if (a <= 0).any() else np.inf)


def fmt(name, e, W=None, R=None):
    f = stats(e); i = stats(e, START, SPLIT); o = stats(e, SPLIT, END)
    s = f"{name:44s} full {f['cagr']*100:6.1f}%/jr dd {f['mdd']*100:6.1f}% sh {f['sharpe']:.2f} cal {f['calmar']:.2f} | IS {i['cagr']*100:6.1f}% dd {i['mdd']*100:5.1f}% | OOS {o['cagr']*100:6.1f}% dd {o['mdd']*100:5.1f}% | pos mnd {f['pos_m']:.0%} worst mnd {f['worst_m']*100:.0f}%"
    if W is not None:
        t = trades_from_weights(W, R)
        if t['n']: s += f" | trades {t['n']} win {t['winrate']:.0%} w/l {t['avg_win']*100:+.0f}/{t['avg_loss']*100:.0f} pf {t['pf']:.1f}"
    print(s); print('      ', f['jaren'])
    return f, i, o


# ------------------------------------------------------------- signal building blocks

def trend_sma(C, n, band=0.0):
    """1 when close > SMA(n)*(1+band); 0 when < SMA*(1-band); hold previous state in between."""
    ma = C.rolling(n).mean()
    up = (C > ma * (1 + band)).astype(float); dn = (C < ma * (1 - band)).astype(float)
    st = pd.DataFrame(np.nan, index=C.index, columns=C.columns)
    st[up == 1] = 1.0; st[dn == 1] = 0.0
    return st.ffill().fillna(0.0)


def trend_ensemble(C, lookbacks=(20, 50, 100, 200), band=0.0):
    return sum(trend_sma(C, n, band) for n in lookbacks) / len(lookbacks)


def ema_cross_ens(C, pairs=((10, 50), (20, 100), (50, 200))):
    out = 0
    for f, s in pairs:
        out = out + (C.ewm(span=f, adjust=False).mean() > C.ewm(span=s, adjust=False).mean()).astype(float)
    return out / len(pairs)


def mom_ens(C, looks=(30, 90, 180)):
    return sum((C > C.shift(L)).astype(float) for L in looks) / len(looks)


def eligible(C, min_days=200):
    return (C.notna().cumsum() >= min_days) & C.notna()


def vol_scale(R, n=30, target=0.5, cap=1.0):
    v = R.rolling(n).std() * np.sqrt(365)
    return (target / v).clip(upper=cap)


def dd_control(e, levels=((0.15, 0.5), (0.25, 0.25)), recover=0.05):
    """Exposure multiplier from strategy's own (unlevered) equity drawdown. Applied with 1-day lag."""
    peak = e.cummax(); dd = e / peak - 1
    f = pd.Series(1.0, index=e.index)
    cur = 1.0
    out = np.ones(len(e)); ddv = dd.values
    for i in range(len(e)):
        d = ddv[i]
        lvl = 1.0
        for th, mult in levels:
            if d <= -th: lvl = mult
        if lvl < cur: cur = lvl
        elif d > -recover: cur = 1.0
        elif lvl > cur: cur = lvl
        out[i] = cur
    return pd.Series(out, e.index).shift(1).fillna(1.0)


if __name__ == '__main__':
    C, H, L = load()
    R = C.pct_change(fill_method=None).fillna(0.0)
    el = eligible(C)
    two = C.columns.isin(['BTC', 'ETH'])

    def coins_w(sig, coins, scale=None):
        """Equal split over selected coins (only eligible), times signal, times optional vol scale."""
        m = el & C.columns.isin(coins)
        n = m.sum(axis=1).replace(0, np.nan)
        W = sig.where(m, 0.0).div(n, axis=0)
        if scale is not None: W = W * scale.where(m, 0.0)
        return W.fillna(0.0)

    print('=== BASELINES')
    bh = coins_w(pd.DataFrame(1.0, index=C.index, columns=C.columns), ['BTC', 'ETH'])
    fmt('BTC+ETH buy&hold', run(bh, R))
    W0 = coins_w(trend_sma(C, 200), ['BTC', 'ETH']); fmt('C: BTC+ETH SMA200 daily (huidig profiel)', run(W0, R), W0, R)
    W1 = coins_w(trend_sma(C, 50, 0.02), ['BTC', 'ETH']); fmt('Trend snel: SMA50 band 2% daily', run(W1, R), W1, R)

    print('\n=== VOL TARGETING op C en Trend snel (cap 1 = spot)')
    for tv in (0.4, 0.5, 0.6, 0.8):
        for cap in (1.0, 1.5):
            sc = vol_scale(R, 30, tv, cap)
            W = coins_w(trend_sma(C, 200), ['BTC', 'ETH'], sc); fmt(f'C + voltarget {tv:.0%} cap {cap}', run(W, R), W, R)
            W = coins_w(trend_sma(C, 50, 0.02), ['BTC', 'ETH'], sc); fmt(f'Snel + voltarget {tv:.0%} cap {cap}', run(W, R), W, R)

    print('\n=== ENSEMBLE (fractionele blootstelling) BTC+ETH')
    for nm, sig in [('SMA 20/50/100/200', trend_ensemble(C)), ('SMA 50/100/200', trend_ensemble(C, (50, 100, 200))),
                    ('SMA 20/50/100 band2%', trend_ensemble(C, (20, 50, 100), 0.02)), ('EMA cross 3x', ema_cross_ens(C)), ('MOM 30/90/180', mom_ens(C))]:
        W = coins_w(sig, ['BTC', 'ETH']); fmt(f'ens {nm}', run(W, R), W, R)
        W = coins_w(sig, ['BTC', 'ETH'], vol_scale(R, 30, 0.6, 1.0)); fmt(f'ens {nm} + vt60 cap1', run(W, R), W, R)
        W = coins_w(sig, ['BTC', 'ETH'], vol_scale(R, 30, 0.6, 1.5)); fmt(f'ens {nm} + vt60 cap1.5', run(W, R), W, R)

    print('\n=== MEER MUNTEN')
    for coins in (['BTC', 'ETH', 'BNB'], ['BTC', 'ETH', 'BNB', 'SOL'], ['BTC', 'ETH', 'SOL'], COINS):
        nm = '+'.join(coins) if len(coins) < 5 else '10 munten'
        W = coins_w(trend_sma(C, 200), coins); fmt(f'{nm} SMA200', run(W, R), W, R)
        W = coins_w(trend_sma(C, 50, 0.02), coins); fmt(f'{nm} SMA50 band', run(W, R), W, R)
        W = coins_w(trend_ensemble(C), coins, vol_scale(R, 30, 0.6, 1.0)); fmt(f'{nm} ens + vt60 cap1', run(W, R), W, R)
        W = coins_w(trend_ensemble(C), coins, vol_scale(R, 30, 0.6, 1.5)); fmt(f'{nm} ens + vt60 cap1.5', run(W, R), W, R)
