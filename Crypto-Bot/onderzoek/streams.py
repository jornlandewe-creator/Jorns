"""Spoor D: stromen bouwen (dagelijkse equity, 1x) en combineren met hefboom.
Alle keuzes per stroom volgen een vaste regel op 2020-2023 (in-sample)."""
import numpy as np, pandas as pd, json
from engine import atr
from engine2 import simulate2
from library import LIB
import rotation as RT
from portfolio import curve, STRATS

T0, SPLIT, T1 = '2020-11-01', '2024-01-01', '2026-10-01'
COINS = RT.COINS


def rot_curve(p):
    C, V = RT.matrix('1d'); R = C.pct_change(fill_method=None).fillna(0)
    idx = C.index; n = len(idx); s0 = idx.searchsorted(pd.Timestamp(T0, tz='UTC'))
    W = RT.weights(C, V, R, p, 1).values.astype(float)
    reb = np.zeros(n, np.bool_); reb[s0::p['reb']] = True
    eq = RT.sim(R.values.astype(float), W, reb, RT.COST, s0)
    return pd.Series(eq, idx).iloc[s0:]


def coin_trend_curve(fam, p, sl, tp, mb, tf='4h', fee=0.0005, slip=0.0002):
    curves = []
    for c in COINS:
        df = pd.read_csv(f'data/coins/{c}_{tf}.csv', index_col=0, parse_dates=True)
        df = df[df.index < T1]
        d = tuple(df[k].values.astype(float) for k in ['open', 'high', 'low', 'close', 'volume'])
        a = atr(d[1], d[2], d[3], 14)
        L, S, XL, XS = [np.nan_to_num(np.asarray(x, dtype=float)).astype(bool) for x in LIB[fam][0](d, p)]
        s0 = df.index.searchsorted(pd.Timestamp(T0, tz='UTC'))
        eq, _, _ = simulate2(*d[:4], a, L, np.zeros_like(S), XL, XS, sl, tp, mb, fee, slip, 0.0001 * 4 / 8, s0)
        curves.append(pd.Series(eq, df.index).iloc[s0:].resample('1D').last().ffill())
    r = pd.concat([x.pct_change() for x in curves], axis=1).fillna(0)
    out = []; val = 1.0                                   # maandelijks herverdelen
    for _, g in r.groupby([r.index.year, r.index.month]):
        sub = val / r.shape[1] * (1 + g).cumprod(); out.append(sub.sum(axis=1)); val = sub.iloc[-1].sum()
    return pd.concat(out)


def btc_portfolio_curve():
    rs = [curve(n, 1.0)[0].pct_change().fillna(0) for n in STRATS]
    r = pd.concat(rs, axis=1); out = []; val = 1.0
    for _, g in r.groupby([r.index.year, r.index.month]):
        sub = val / r.shape[1] * (1 + g).cumprod(); out.append(sub.sum(axis=1)); val = sub.iloc[-1].sum()
    e = pd.concat(out); return e[e.index >= T0]


def seg(e, a, b=None):
    x = e[(e.index >= a) & ((e.index < b) if b else True)]
    y = (x.index[-1] - x.index[0]).days / 365.25
    return (x.iloc[-1] / x.iloc[0]) ** (1 / y) - 1, (x / x.cummax() - 1).min()


if __name__ == '__main__':
    rot = pd.read_csv('results/rotation_1d.csv'); rot['cal'] = rot.is_cagr / (-rot.is_mdd).clip(lower=0.05)
    long_pick = rot[rot.k >= 2].sort_values('cal', ascending=False).iloc[0]
    ls = pd.read_csv('results/rotation_1d_sides.csv'); ls['cal'] = ls.is_cagr / (-ls.is_mdd).clip(lower=0.05)
    ls_pick = ls[ls.side == 'ls'].sort_values('cal', ascending=False).iloc[0]
    rules = pd.read_csv('results/coins_rules.csv')
    tr_pick = rules[(rules.is_pos >= 0.8) & (rules.dir == 'l') & (rules.tf == '4h')].sort_values('is_med', ascending=False).iloc[0]
    keys = ['n', 'score', 'k', 'reb', 'abs', 'mkt', 'wt']
    lp = {k: (int(long_pick[k]) if k in ('n', 'k', 'reb', 'mkt') else long_pick[k]) for k in keys}
    sp = {k: (int(ls_pick[k]) if k in ('n', 'k', 'reb', 'mkt') else ls_pick[k]) for k in keys}; sp['side'] = 'ls'
    print('Long-rotatie:', lp); print('L/S-rotatie:', sp)
    print('Munt-trend:', tr_pick.fam, tr_pick.params, tr_pick.sl, tr_pick.tp, tr_pick.mb)
    S = {
        'BTC-portfolio (7)': btc_portfolio_curve(),
        'Long-rotatie': rot_curve(lp),
        'L/S-rotatie': rot_curve(sp),
        'Trend 10 munten': coin_trend_curve(tr_pick.fam, eval(tr_pick.params), tr_pick.sl, tr_pick.tp, int(tr_pick.mb)),
    }
    D = pd.concat({k: v.resample('1D').last() for k, v in S.items()}, axis=1).ffill().dropna()
    D.to_csv('results/streams.csv')
    json.dump(dict(long=lp, ls=sp, trend=[tr_pick.fam, tr_pick.params, float(tr_pick.sl), float(tr_pick.tp), int(tr_pick.mb)]),
              open('results/streams_cfg.json', 'w'), default=str)
    for k in D:
        print(f'{k:20s} IS {seg(D[k], T0, SPLIT)[0]*100:7.1f}%  blind {seg(D[k], SPLIT)[0]*100:6.1f}% dd {seg(D[k], SPLIT)[1]*100:6.1f}%  6j dd {seg(D[k], T0)[1]*100:6.1f}%')
    print(D.pct_change().corr().round(2))
