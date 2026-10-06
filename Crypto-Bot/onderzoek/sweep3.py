"""Ronde 2: trend-strategieën met gedeeltelijke winstname (TP1 + break-even stop + runner)."""
import itertools, sys, time
import numpy as np, pandas as pd
from multiprocessing import Pool
from engine import atr
from engine3 import simulate3
from library import LIB
from strategies import nnfx
from sweep import load, seg_stats, BPY, HOURS, FEE, SLIP, FUND8, T0, SPLIT

TREND = ['EMA cross', 'MACD trend', 'Supertrend', 'Donchian breakout', 'Keltner breakout', 'Bollinger breakout',
         'Ichimoku', 'Heikin-Ashi trend', 'Hull MA trend', 'Momentum (ROC)', 'ADX / DI cross', 'Sonic R (dragon)']
FAMS = {k: LIB[k] for k in TREND}
FAMS['Video-template (NNFX)'] = (lambda d, p: nnfx(d, p, True),
                                 dict(trend=[100, 200], mf=[8, 12], adx=[15, 20, 25], volf=[0.8, 1.0], volume=[0, 1]))
EX = dict(sl=[1.5, 2.0, 3.0], tp1=[0, 1.0, 1.5, 2.0, 3.0], frac=[0.33, 0.5, 0.75])


def run_tf(tf):
    df = load(tf)
    d = tuple(df[k].values.astype(float) for k in ['open', 'high', 'low', 'close', 'volume'])
    a = atr(d[1], d[2], d[3], 14); idx = df.index; n = len(idx)
    s0 = idx.searchsorted(pd.Timestamp(T0, tz='UTC')); s1 = idx.searchsorted(pd.Timestamp(SPLIT, tz='UTC'))
    yrs = lambda i, j: (idx[j - 1] - idx[i]).total_seconds() / (365.25 * 86400)
    Y = (yrs(s0, s1), yrs(s1, n), yrs(s0, n)); fb = FUND8 * HOURS[tf] / 8
    no = np.zeros(n, bool); rows = []
    for fam, (fn, grid) in FAMS.items():
        for vals in itertools.product(*grid.values()):
            p = dict(zip(grid, vals))
            L, S_, XL, XS = [np.nan_to_num(x).astype(bool) for x in fn(d, p)]
            for both in (False, True):
                for sl, tp1, fr in itertools.product(*EX.values()):
                    if tp1 == 0 and fr != 0.5: continue
                    eq, tr, te = simulate3(*d[:4], a, L, S_ if both else no, XL, XS, sl, tp1, fr,
                                           FEE, SLIP, fb, 0.02, 1.0, s0)
                    st = []
                    for (i, j), y in zip([(s0, s1), (s1, n), (s0, n)], Y):
                        st += seg_stats(eq, tr, te, i, j, BPY[tf], y)
                    rows.append([tf, fam, str(p), 'long+short' if both else 'long', sl, tp1, fr] + st)
        print(tf, fam, len(rows), flush=True)
    cols = ['tf', 'fam', 'params', 'dir', 'sl', 'tp1', 'frac']
    for seg in ['is', 'oos', 'full']:
        cols += [f'{seg}_{k}' for k in ['cagr', 'mdd', 'sharpe', 'trades', 'wr', 'pf', 'avg']]
    pd.DataFrame(rows, columns=cols).to_csv(f'results/sweep3_{tf}.csv', index=False)
    return len(rows)


if __name__ == '__main__':
    with Pool(2) as pool:
        print(pool.map(run_tf, sys.argv[1:] or ['4h', '1D']))
