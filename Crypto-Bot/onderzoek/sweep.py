"""Massale sweep: alle families x parameters x exits x richting x timeframe.
Kosten: 0.1% fee per kant, 0.05% slippage, 0.01% funding per 8 uur.
"""
import itertools, sys, time
import numpy as np, pandas as pd
from multiprocessing import Pool
from engine import atr
from engine2 import simulate2
from library import LIB

FEE, SLIP, FUND8 = 0.001, 0.0005, 0.0001
T0, SPLIT, T1 = '2020-10-01', '2024-01-01', '2026-10-01'
BPY = {'1h': 8766, '4h': 2191.5, '1D': 365.25}
HOURS = {'1h': 1, '4h': 4, '1D': 24}
EXITS = dict(sl=[0, 1.5, 3.0], tp=[0, 1.0, 2.0, 4.0], mb=[0, 10, 30])


def load(tf):
    df = pd.read_csv(f'data/btc_{tf}.csv', index_col=0, parse_dates=True)
    return df[df.index < T1]


def seg_stats(eq, t_ret, t_exit, a, b, bpy, yrs):
    e = eq[a:b]
    if len(e) < 3: return [np.nan] * 7
    cagr = (e[-1] / e[0]) ** (1 / yrs) - 1 if e[-1] > 0 else -1
    mdd = (e / np.maximum.accumulate(e) - 1).min()
    r = np.diff(e) / e[:-1]
    sh = r.mean() / r.std() * np.sqrt(bpy) if r.std() > 0 else 0
    m = (t_exit >= a) & (t_exit < b); t = t_ret[m]
    n = len(t); wr = (t > 0).mean() if n else np.nan
    pf = t[t > 0].sum() / -t[t <= 0].sum() if (t <= 0).any() else (np.inf if n else np.nan)
    return [cagr, mdd, sh, n, wr, pf, t.mean() if n else np.nan]


def run_tf(tf):
    df = load(tf)
    d = tuple(df[k].values.astype(float) for k in ['open', 'high', 'low', 'close', 'volume'])
    a = atr(d[1], d[2], d[3], 14)
    idx = df.index
    s0 = idx.searchsorted(pd.Timestamp(T0, tz='UTC')); s1 = idx.searchsorted(pd.Timestamp(SPLIT, tz='UTC')); n = len(idx)
    yrs = lambda i, j: (idx[j - 1] - idx[i]).total_seconds() / (365.25 * 86400)
    Y = (yrs(s0, s1), yrs(s1, n), yrs(s0, n))
    fb = FUND8 * HOURS[tf] / 8
    rows = []; t = time.time()
    no = np.zeros(n, bool)
    for fam, (fn, grid) in LIB.items():
        for vals in itertools.product(*grid.values()):
            p = dict(zip(grid, vals))
            L, S_, XL, XS = [np.nan_to_num(x).astype(bool) for x in fn(d, p)]
            for both in (False, True):
                for sl, tp, mb in itertools.product(*EXITS.values()):
                    eq, tr, te = simulate2(*d[:4], a, L, S_ if both else no, XL, XS,
                                           sl, tp, mb, FEE, SLIP, fb, s0)
                    st = []
                    for (i, j), y in zip([(s0, s1), (s1, n), (s0, n)], Y):
                        st += seg_stats(eq, tr, te, i, j, BPY[tf], y)
                    rows.append([tf, fam, str(p), 'long+short' if both else 'long', sl, tp, mb] + st)
        print(tf, fam, len(rows), round(time.time() - t), 's', flush=True)
    cols = ['tf', 'fam', 'params', 'dir', 'sl', 'tp', 'mb']
    for seg in ['is', 'oos', 'full']:
        cols += [f'{seg}_{k}' for k in ['cagr', 'mdd', 'sharpe', 'trades', 'wr', 'pf', 'avg']]
    out = pd.DataFrame(rows, columns=cols)
    out.to_parquet(f'results/sweep_{tf}.parquet') if False else out.to_csv(f'results/sweep_{tf}.csv', index=False)
    return len(out)


if __name__ == '__main__':
    tfs = sys.argv[1:] or ['1D', '4h', '1h']
    with Pool(2) as pool:
        print(pool.map(run_tf, tfs))
