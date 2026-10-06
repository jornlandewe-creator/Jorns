"""Spoor A: alle families (oud + volume/orderflow) op 10 munten, 1h en 4h.
Kosten futures-niveau: 0.05% fee per kant, 0.02% slippage, 0.01% funding per 8u. Positie 100% (1x).
In-sample = tot 2024-01-01, blind = 2024-01-01 t/m 2026-09-30.
"""
import itertools, sys, time, os
import numpy as np, pandas as pd
from multiprocessing import Pool
from engine import atr
from engine2 import simulate2
from library import LIB
from library2 import LIB2
from sweep import seg_stats

FEE, SLIP, FUND8 = 0.0005, 0.0002, 0.0001
SPLIT, T1 = '2024-01-01', '2026-10-01'
SPLITS = {'30m': '2025-07-01', '15m': '2026-01-01'}
T0 = {'4h': '2020-11-01', '1h': '2022-02-01', '2h': '2020-11-01', '30m': '2024-01-20', '15m': '2025-01-10'}
BPY = {'1h': 8766, '2h': 4383, '4h': 2191.5, '30m': 17532, '15m': 35064}
HRS = {'1h': 1, '2h': 2, '4h': 4, '30m': 0.5, '15m': 0.25}
COINS = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'AVAX', 'LINK', 'DOT']
EXITS = dict(sl=[0, 1.5, 3.0], tp=[0, 2.0, 4.0], mb=[0, 24])


def load(coin, tf):
    df = pd.read_csv(f'data/coins/{coin}_{tf}.csv', index_col=0, parse_dates=True)
    return df[df.index < T1]


def job(args):
    coin, tf = args
    out = f'results/coins/{coin}_{tf}.csv'
    if os.path.exists(out): return out
    df = load(coin, tf)
    d7 = tuple(df[k].values.astype(float) for k in ['open', 'high', 'low', 'close', 'volume', 'taker_buy', 'ntrades'])
    d5 = d7[:5]
    a = atr(d7[1], d7[2], d7[3], 14); idx = df.index; n = len(idx)
    s0 = idx.searchsorted(pd.Timestamp(T0[tf], tz='UTC')); s1 = idx.searchsorted(pd.Timestamp(SPLITS.get(tf, SPLIT), tz='UTC'))
    yrs = lambda i, j: (idx[j - 1] - idx[i]).total_seconds() / (365.25 * 86400)
    Y = (yrs(s0, s1), yrs(s1, n), yrs(s0, n)); fb = FUND8 * HRS[tf] / 8
    no = np.zeros(n, bool); rows = []; t = time.time()
    c = d7[3]
    bh = [c[j - 1] / c[i] for i, j in [(s0, s1), (s1, n), (s0, n)]]
    fams = [(k, f, g, d5) for k, (f, g) in LIB.items()] + [(k, f, g, d7) for k, (f, g) in LIB2.items()]
    for fam, fn, grid, d in fams:
        for vals in itertools.product(*grid.values()):
            p = dict(zip(grid, vals))
            try:
                L, S_, XL, XS = [np.nan_to_num(np.asarray(x, dtype=float)).astype(bool) for x in fn(d, p)]
            except Exception as e:
                print(coin, tf, fam, p, e, flush=True); continue
            for both in (False, True):
                for sl, tp, mb in itertools.product(*EXITS.values()):
                    eq, tr, te = simulate2(*d7[:4], a, L, S_ if both else no, XL, XS, sl, tp, mb, FEE, SLIP, fb, s0)
                    st = []
                    for (i, j), y in zip([(s0, s1), (s1, n), (s0, n)], Y):
                        st += seg_stats(eq, tr, te, i, j, BPY[tf], y)
                    rows.append([coin, tf, fam, str(p), 'ls' if both else 'l', sl, tp, mb] + st)
    cols = ['coin', 'tf', 'fam', 'params', 'dir', 'sl', 'tp', 'mb']
    for seg in ['is', 'oos', 'full']:
        cols += [f'{seg}_{k}' for k in ['cagr', 'mdd', 'sharpe', 'trades', 'wr', 'pf', 'avg']]
    r = pd.DataFrame(rows, columns=cols)
    for seg, b, y in zip(['is', 'oos', 'full'], bh, Y):
        r[f'{seg}_bh'] = b ** (1 / y) - 1
    r.to_csv(out, index=False)
    print(coin, tf, len(r), 'runs', round(time.time() - t), 's', flush=True)
    return out


if __name__ == '__main__':
    os.makedirs('results/coins', exist_ok=True)
    tfs = sys.argv[1:] or ['4h', '1h']
    jobs = [(c, tf) for tf in tfs for c in COINS]
    with Pool(2) as pool:
        for r in pool.imap_unordered(job, jobs): pass
    print('klaar')
