"""Spoor B: rotatie tussen munten (cross-sectional momentum) en relatieve sterkte.
Elke rebalance: score per munt -> top K kopen (gelijk of naar inverse volatiliteit), rest cash.
Filters: absolute momentum (score > 0 / koers > SMA), marktfilter (BTC > SMA -> anders cash).
Kosten 0.05% fee + 0.02% slippage over omzet. Universum: 10 munten van de dataset.
"""
import itertools, sys
import numpy as np, pandas as pd
from numba import njit
from multiprocessing import Pool

COINS = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'AVAX', 'LINK', 'DOT']
T0, SPLIT, T1 = '2020-11-01', '2024-01-01', '2026-10-01'
COST = 0.0007
import os
SIDES = os.getenv('SIDES') == '1'


def matrix(tf):
    cl = {}; vol = {}
    for c in COINS:
        df = pd.read_csv(f'data/coins/{c}_{tf}.csv', index_col=0, parse_dates=True)
        cl[c] = df.close; vol[c] = df.qvol
    C = pd.DataFrame(cl); V = pd.DataFrame(vol)
    C = C[(C.index >= '2019-06-01') & (C.index < T1)]; V = V.reindex(C.index)
    return C, V


@njit(cache=True)
def sim_stop(R, W, reb, cost, start, short_stop):
    """Als sim, plus: short-positie wordt gesloten als de munt sinds de rebalance > short_stop gestegen is
    (op dagslot, conservatief: verlies tot dat slot telt mee)."""
    T, M = R.shape
    eq = np.ones(T); w = np.zeros(M); val = 1.0; grow = np.ones(M)
    for t in range(start, T):
        g = 0.0
        for m in range(M): g += w[m] * R[t, m]
        val *= (1 + g)
        if 1 + g > 0:
            for m in range(M): w[m] = w[m] * (1 + R[t, m]) / (1 + g)
        for m in range(M):
            grow[m] *= (1 + R[t, m])
            if w[m] < 0 and grow[m] - 1 > short_stop:
                val *= (1 - cost * abs(w[m])); w[m] = 0.0
        if reb[t]:
            to = 0.0
            for m in range(M): to += abs(W[t, m] - w[m])
            val *= (1 - cost * to)
            for m in range(M):
                w[m] = W[t, m]; grow[m] = 1.0
        eq[t] = val
        if val <= 0:
            for k in range(t, T): eq[k] = 1e-9
            break
    for k in range(start): eq[k] = 1.0
    return eq


@njit(cache=True)
def sim(R, W, reb, cost, start):
    """R: rendement per bar (T x M, nan=0). W: doelgewichten (T x M) geldig op rebalance-bars.
    Gewichten drijven mee tussen rebalances. Rebalance op close van bar t, rendement vanaf t+1."""
    T, M = R.shape
    eq = np.ones(T); w = np.zeros(M); val = 1.0
    for t in range(start, T):
        # rendement van bar t op gewichten van t-1
        g = 0.0
        for m in range(M): g += w[m] * R[t, m]
        val *= (1 + g)
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


def weights(C, V, R, p, bars_day):
    N = p['n'] * bars_day
    logc = np.log(C)
    mom = logc - logc.shift(N)
    vol = R.rolling(max(N, 10)).std()
    if p['score'] == 'mom':
        sc = mom
    elif p['score'] == 'sharpe':
        sc = mom / (vol * np.sqrt(N))
    elif p['score'] == 'vs_btc':
        sc = mom.sub(mom['BTC'], axis=0); sc['BTC'] = mom['BTC'] * 0      # BTC zelf als referentie
    else:  # volume-gewogen momentum: momentum x stijging van omzet
        vchg = np.log(V.rolling(N).mean() / V.rolling(N * 3).mean())
        sc = mom + 0.5 * vchg
    elig = C.notna() & C.shift(N * 2).notna()
    if p['abs'] == 'pos':
        elig &= mom > 0
    elif p['abs'] == 'sma':
        elig &= C > C.rolling(50 * bars_day).mean()
    sc = sc.where(elig)
    side = p.get('side', 'long')
    sc_all = sc if side == 'long' else (mom / (vol * np.sqrt(N)) if p['score'] == 'sharpe' else mom).where(C.notna() & C.shift(N * 2).notna())
    rank = sc.rank(axis=1, ascending=False)
    pick = (rank <= p['k']) & sc.notna()
    if side != 'long':
        rlow = sc_all.rank(axis=1, ascending=True)
        short = (rlow <= p['k']) & sc_all.notna() & (sc_all < 0)
        btc_up = C['BTC'] > C['BTC'].rolling(max(p['mkt'], 100) * bars_day).mean()
        Wl = pick.astype(float).div(p['k']); Ws = short.astype(float).div(p['k'])
        if side == 'ls':
            W = (Wl - Ws) / 2
        else:   # regime
            W = Wl.mul(btc_up.astype(float), axis=0) - Ws.mul((~btc_up).astype(float), axis=0)
        return W.fillna(0)
    if p['wt'] == 'ivol':
        iv = (1 / vol).where(pick)
        W = iv.div(iv.sum(axis=1), axis=0)
    else:
        W = pick.astype(float).div(np.maximum(p['k'], 1))
    if p['mkt'] > 0:
        btc_up = C['BTC'] > C['BTC'].rolling(p['mkt'] * bars_day).mean()
        W = W.mul(btc_up.astype(float), axis=0)
    return W.fillna(0)


def stats(eq, idx, a, b):
    e = eq[a:b]; y = (idx[b - 1] - idx[a]).total_seconds() / (365.25 * 86400)
    cagr = (e[-1] / e[0]) ** (1 / y) - 1 if e[-1] > 0 else -1
    return cagr, (e / np.maximum.accumulate(e) - 1).min()


def run_tf(tf):
    bars_day = {'1d': 1, '4h': 6}[tf]
    C, V = matrix(tf); R = C.pct_change(fill_method=None).fillna(0)
    idx = C.index; n = len(idx)
    s0 = idx.searchsorted(pd.Timestamp(T0, tz='UTC')); s1 = idx.searchsorted(pd.Timestamp(SPLIT, tz='UTC'))
    grid = dict(n=[3, 7, 14, 21, 30, 60, 90], score=['mom', 'sharpe', 'vs_btc', 'volmom'], k=[1, 2, 3, 5],
                reb=[1, 3, 7], abs=['none', 'pos', 'sma'], mkt=[0, 50, 100, 200], wt=['eq', 'ivol'])
    if SIDES: grid = dict(n=[7, 14, 21, 30, 60, 90], score=['mom', 'sharpe'], k=[1, 2, 3], reb=[1, 3, 7], abs=['sma'], mkt=[50, 100, 200], wt=['eq'], side=['ls', 'regime'])
    rows = []
    Rv = R.values.astype(float)
    for vals in itertools.product(*grid.values()):
        p = dict(zip(grid, vals))
        W = weights(C, V, R, p, bars_day).values.astype(float)
        reb = np.zeros(n, np.bool_)
        reb[s0::p['reb'] * bars_day] = True
        eq = sim(Rv, W, reb, COST, s0)
        ic, idd = stats(eq, idx, s0, s1); oc, odd = stats(eq, idx, s1, n); fc, fdd = stats(eq, idx, s0, n)
        to = np.abs(np.diff(W[s0:][reb[s0:]], axis=0)).sum() / ((idx[-1] - idx[s0]).days / 365.25)
        rows.append(dict(tf=tf, **p, is_cagr=ic, is_mdd=idd, oos_cagr=oc, oos_mdd=odd, full_cagr=fc, full_mdd=fdd, omzet_jr=to))
    res = pd.DataFrame(rows); res.to_csv(f'results/rotation_{tf}{"_sides" if SIDES else ""}.csv', index=False)
    # buy & hold referenties
    bh = {}
    for c in COINS + ['MAND']:
        x = C[c] if c != 'MAND' else (1 + R[COINS].where(C[COINS].notna()).mean(axis=1)).cumprod()
        e = (x / x.iloc[s0]).values
        bh[c] = (stats(e, idx, s0, s1), stats(e, idx, s1, n), stats(e, idx, s0, n))
    pd.DataFrame({k: [v[0][0], v[1][0], v[2][0], v[2][1]] for k, v in bh.items()},
                 index=['is_cagr', 'oos_cagr', 'full_cagr', 'full_mdd']).T.to_csv(f'results/bh_{tf}.csv')
    return tf, len(res)


if __name__ == '__main__':
    with Pool(2) as pool:
        print(pool.map(run_tf, sys.argv[1:] or ['1d', '4h']))
