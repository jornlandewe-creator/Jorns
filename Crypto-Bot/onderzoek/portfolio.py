"""Ronde 3: portfolio van robuuste strategieën + hefboom + volatility targeting.
Alle instellingen zijn gekozen op 2020-2023 (in-sample). 2024-sep 2026 blijft blind.
Financiering hefboom/CFD: 0.03% per dag over de volle positie.
"""
import itertools, json
import numpy as np, pandas as pd
from engine import atr, simulate
from engine2 import simulate2
from engine3 import simulate3
from library import LIB
from strategies import nnfx
from sweep import load

FEE, SLIP = 0.001, 0.0005
FIN_DAY = 0.0003
T0, SPLIT = '2020-10-01', '2024-01-01'
D = {tf: load(tf) for tf in ['4h', '1D']}

def arrs(tf):
    df = D[tf]; d = tuple(df[k].values.astype(float) for k in ['open', 'high', 'low', 'close', 'volume'])
    return df, d, atr(d[1], d[2], d[3], 14), df.index.searchsorted(pd.Timestamp(T0, tz='UTC'))

def sig(fn, d, p, both):
    L, S, XL, XS = [np.nan_to_num(x).astype(bool) for x in fn(d, p)]
    return L, (S if both else np.zeros_like(S)), XL, XS

STRATS = {
    'Trend 4h (huidige bot)': dict(tf='4h', eng=1, fn=lambda d, p: nnfx(d, p, False),
        p=dict(trend=200, mf=12, adx=20, volf=0.8, volume=1), both=False, sl=2.0),
    'Bollinger breakout daily': dict(tf='1D', eng=2, fn=LIB['Bollinger breakout'][0], p=dict(n=50, k=2.5), both=False, sl=3.0, tp=0, mb=0),
    'Keltner breakout daily': dict(tf='1D', eng=2, fn=LIB['Keltner breakout'][0], p=dict(n=50, k=1.5), both=False, sl=1.5, tp=0, mb=0),
    'Momentum daily': dict(tf='1D', eng=3, fn=LIB['Momentum (ROC)'][0], p=dict(n=60), both=False, sl=1.5, tp1=1.0, frac=0.33),
    'Sonic R daily': dict(tf='1D', eng=3, fn=LIB['Sonic R (dragon)'][0], p=dict(f=1, lb=3, x='e89'), both=True, sl=1.5, tp1=1.5, frac=0.33),
    'Rode candles daily': dict(tf='1D', eng=2, fn=LIB['Rode candles op rij'][0], p=dict(k=3, tf=100), both=False, sl=0, tp=0, mb=0),
    'Supertrend 4h': dict(tf='4h', eng=3, fn=LIB['Supertrend'][0], p=dict(n=10, m=3.0), both=False, sl=3.0, tp1=3.0, frac=0.33),
}

def curve(name, lev=1.0):
    s = STRATS[name]; df, d, a, s0 = arrs(s['tf'])
    fb = FIN_DAY * (4 / 24 if s['tf'] == '4h' else 1)
    L, S, XL, XS = sig(s['fn'], d, s['p'], s['both'])
    if s['eng'] == 1:
        eq, tr, _ = simulate(*d[:4], a, L, S, XL, XS, s['sl'], 0, 0, FEE, SLIP, fb, 0.02 * lev, lev, s0)
    elif s['eng'] == 2:
        eq, tr, _ = simulate2(*d[:4], a, L, S, XL, XS, s['sl'], s['tp'], s['mb'], FEE, SLIP, fb, s0, lev)
    else:
        eq, tr, _ = simulate3(*d[:4], a, L, S, XL, XS, s['sl'], s['tp1'], s['frac'], FEE, SLIP, fb, 0.02 * lev, lev, s0)
    e = pd.Series(eq, df.index).iloc[s0:]
    return e.resample('1D').last().ffill(), tr

def stats(e):
    e = e / e.iloc[0]
    y = (e.index[-1] - e.index[0]).days / 365.25
    cagr = e.iloc[-1] ** (1 / y) - 1 if e.iloc[-1] > 0 else -1
    dd = (e / e.cummax() - 1).min()
    return cagr, dd

def split(e):
    s = e.index.searchsorted(pd.Timestamp(SPLIT, tz='UTC'))
    return stats(e.iloc[:s]), stats(e.iloc[s - 1:]), stats(e)

def portfolio(curves, w=None):
    r = pd.concat([c.pct_change() for c in curves], axis=1).fillna(0)
    w = np.ones(r.shape[1]) / r.shape[1] if w is None else np.asarray(w)
    # elke strategie eigen sub-account, maandelijks terug naar gelijke verdeling
    out = []; val = 1.0
    for _, g in r.groupby([r.index.year, r.index.month]):
        sub = val * w * (1 + g).cumprod()
        out.append(sub.sum(axis=1)); val = sub.iloc[-1].values.sum()
    return pd.concat(out)

if __name__ == '__main__':
    LEVS = [1.0, 1.5, 2.0, 2.5, 3.0, 4.0]
    C = {(n, L): curve(n, L)[0] for n in STRATS for L in LEVS}
    rows = []
    for n in STRATS:
        for L in LEVS:
            (ic, idd), (oc, odd), (fc, fdd) = split(C[(n, L)])
            rows.append(dict(combo=n, k=1, lev=L, is_cagr=ic, is_dd=idd, oos_cagr=oc, oos_dd=odd, full_cagr=fc, full_dd=fdd))
    names = list(STRATS)
    for k in range(2, len(names) + 1):
        for combo in itertools.combinations(names, k):
            for L in LEVS:
                e = portfolio([C[(n, L)] for n in combo])
                (ic, idd), (oc, odd), (fc, fdd) = split(e)
                rows.append(dict(combo=' + '.join(combo), k=k, lev=L, is_cagr=ic, is_dd=idd, oos_cagr=oc, oos_dd=odd, full_cagr=fc, full_dd=fdd))
    res = pd.DataFrame(rows)
    res.to_csv('results/portfolio.csv', index=False)
    print(len(res), 'portfolio-varianten')
    # correlatie tussen strategieën (1x)
    R = pd.concat({n: C[(n, 1.0)].pct_change() for n in names}, axis=1)
    print(R.corr().round(2))
