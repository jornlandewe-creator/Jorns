"""Grid search op in-sample (okt 2020 - dec 2023), daarna ongezien out-of-sample (2024 - okt 2026)."""
import itertools, json, sys, time
import numpy as np, pandas as pd
from engine import simulate, metrics, atr
from strategies import FAMILIES

FEE, SLIP, FUND_8H = 0.001, 0.0005, 0.0001
RISK, MAX_LEV = 0.02, 1.0
T0, SPLIT, T1 = '2020-10-01', '2024-01-01', '2026-10-01'

def load(tf):
    df = pd.read_csv(f'data/btc_{tf}.csv', index_col=0, parse_dates=True)
    return df[df.index < T1]

GRIDS = {
    'nnfx': dict(trend=[100, 200], mf=[8, 12], adx=[15, 20, 25], volf=[0.8, 1.0], volume=[0, 1]),
    'supertrend': dict(st_n=[10, 14], st_m=[2.0, 3.0, 4.0], trend=[100, 200]),
    'donchian': dict(dc=[20, 40, 55, 80], trend=[100, 200]),
    'emacross': dict(fast=[12, 21, 50], slow=[50, 100, 200]),
}
EXITS = dict(sl_mult=[1.5, 2.0, 3.0], rr=[0, 2.0, 3.0], trail=[0, 3.0])
BPY = {'1h': 8766, '4h': 2191.5}

def run(df, fam, p, e, shorts, tf):
    d = tuple(df[k].values for k in ['open', 'high', 'low', 'close', 'volume'])
    L, S, XL, XS = FAMILIES[fam](d, p, shorts)
    a = atr(d[1], d[2], d[3], 14)
    start = df.index.searchsorted(pd.Timestamp(T0, tz='UTC'))
    fb = FUND_8H * (1 if tf == '1h' else 4) / 8
    eq, tp, tb = simulate(*d[:4], a, L, S, XL, XS, e['sl_mult'], e['rr'], e['trail'],
                          FEE, SLIP, fb, RISK, MAX_LEV, start)
    return pd.Series(eq, df.index).iloc[start:], tp, tb

def split_metrics(eq, tf):
    s = eq.index.searchsorted(pd.Timestamp(SPLIT, tz='UTC'))
    out = {}
    for name, part in [('is', eq.iloc[:s]), ('oos', eq.iloc[s:]), ('full', eq)]:
        r = np.diff(part.values) / part.values[:-1]
        # trades per deel benaderen via equity-stappen is onnodig; trades tellen we op full
        m = metrics(part.values, part.index, np.array([0.0]), BPY[tf])
        out[name] = {k: m[k] for k in ['total', 'cagr', 'maxdd', 'sharpe', 'calmar']}
    return out

if __name__ == '__main__':
    rows = []
    t = time.time()
    for tf in ['1h', '4h']:
        df = load(tf)
        for fam, grid in GRIDS.items():
            keys = list(grid)
            for vals in itertools.product(*grid.values()):
                p = dict(zip(keys, vals))
                for ev in itertools.product(*EXITS.values()):
                    e = dict(zip(EXITS, ev))
                    for shorts in [False, True]:
                        eq, tp, tb = run(df, fam, p, e, shorts, tf)
                        m = split_metrics(eq, tf)
                        rows.append(dict(tf=tf, fam=fam, shorts=shorts, **p, **e,
                                         trades=len(tp),
                                         **{f'{k}_{x}': v for k, mm in m.items() for x, v in mm.items()}))
        print(tf, 'klaar', round(time.time() - t), 's', flush=True)
    res = pd.DataFrame(rows)
    res.to_csv('results/grid.csv', index=False)
    print(len(res), 'runs')
