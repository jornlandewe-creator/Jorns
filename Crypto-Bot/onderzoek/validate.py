"""Validatie van de gekozen strategie: per-jaar, walk-forward, kosten-stresstest, Monte Carlo."""
import itertools, json
import numpy as np, pandas as pd
import optimize as O
from engine import metrics

BEST = dict(trend=200, mf=12, adx=20, volf=0.8, volume=1)
BEST_EXIT = dict(sl_mult=2.0, rr=0, trail=0)
df = O.load('4h')
out = {}

# 1) gekozen strategie, volle 6 jaar
eq, tp, tb = O.run(df, 'nnfx', BEST, BEST_EXIT, False, '4h')
m = metrics(eq.values, eq.index, tp, O.BPY['4h'])
m['avg_bars'] = float(tb.mean()); m['avg_trade'] = float(tp.mean())
m['best_trade'] = float(tp.max()); m['worst_trade'] = float(tp.min())
out['best'] = m
c = df.close[df.index >= O.T0]
bh = c / c.iloc[0]
out['bh'] = metrics(bh.values, bh.index, np.array([0.0]), O.BPY['4h'])
eq.to_csv('results/equity_best.csv'); bh.to_csv('results/equity_bh.csv')

yr = pd.DataFrame({'bot': eq.resample('YE').last().pct_change(), 'bh': bh.resample('YE').last().pct_change()})
yr.iloc[0] = [eq.resample('YE').last().iloc[0] - 1, bh.resample('YE').last().iloc[0] - 1]
dd = lambda s: s.groupby(s.index.year).apply(lambda x: (x / x.cummax() - 1).min())
yr['bot_dd'] = dd(eq).values; yr['bh_dd'] = dd(bh).values
yr.index = yr.index.year
out['years'] = yr.round(4).to_dict('index')
print(yr.round(3))

# 2) kosten-stresstest
stress = {}
for fee, slip in [(0.0004, 0.0002), (0.001, 0.0005), (0.0015, 0.001), (0.002, 0.002)]:
    O.FEE, O.SLIP = fee, slip
    e, t, _ = O.run(df, 'nnfx', BEST, BEST_EXIT, False, '4h')
    mm = metrics(e.values, e.index, t, O.BPY['4h'])
    stress[f'fee {fee*100:.2f}% / slip {slip*100:.2f}%'] = {k: mm[k] for k in ['cagr', 'maxdd', 'total']}
O.FEE, O.SLIP = 0.001, 0.0005
out['stress'] = stress
print(pd.DataFrame(stress).T.round(3))

# 3) walk-forward: elk jaar beste set kiezen op de 2 jaar ervoor, dan blind draaien
grid = O.GRIDS['nnfx']; ex = O.EXITS
curves = {}
for vals in itertools.product(*grid.values()):
    p = dict(zip(grid, vals))
    for ev in itertools.product(*ex.values()):
        e = dict(zip(ex, ev))
        O_T0 = O.T0; O.T0 = '2019-10-01'
        s, _, _ = O.run(df, 'nnfx', p, e, False, '4h')
        O.T0 = O_T0
        curves[(vals, ev)] = s.pct_change().fillna(0)
R = pd.DataFrame(curves)
wf, picks = [], []
for y in range(2021, 2027):
    train = R[(R.index >= f'{y-2}-01-01') & (R.index < f'{y}-01-01')]
    test = R[(R.index >= f'{y}-01-01') & (R.index < '2026-10-01')]
    test = test[test.index < f'{y+1}-01-01']
    eqt = (1 + train).cumprod()
    cal = ((eqt.iloc[-1]) ** (1 / 2) - 1) / -(eqt / eqt.cummax() - 1).min()
    k = cal.idxmax(); picks.append((y, str(k)))
    wf.append(test[k])
wf = pd.concat(wf); wfe = (1 + wf).cumprod()
wfe = wfe[wfe.index >= '2021-01-01']
out['walkforward'] = metrics(wfe.values, wfe.index, np.array([0.0]), O.BPY['4h'])
out['wf_picks'] = picks
wfe.to_csv('results/equity_wf.csv')
bh21 = c[c.index >= '2021-01-01']; bh21 = bh21 / bh21.iloc[0]
out['bh_2021'] = metrics(bh21.values, bh21.index, np.array([0.0]), O.BPY['4h'])
print('WF', {k: round(v, 3) for k, v in out['walkforward'].items()})
print('BH21', {k: round(v, 3) for k, v in out['bh_2021'].items()})

# 4) Monte Carlo: trades husselen -> verdeling van max drawdown
rng = np.random.default_rng(1)
mdds = []
for _ in range(5000):
    path = np.cumprod(1 + rng.permutation(tp))
    path = np.r_[1, path]
    mdds.append((path / np.maximum.accumulate(path) - 1).min())
out['mc_dd'] = {'median': float(np.median(mdds)), 'p95': float(np.percentile(mdds, 5)), 'p99': float(np.percentile(mdds, 1))}
print('best', {k: round(v, 3) for k, v in out['best'].items()})
print('bh', {k: round(v, 3) for k, v in out['bh'].items()})
print('MC', out['mc_dd'])
json.dump(out, open('results/validation.json', 'w'), indent=1, default=float)
