"""6 jaar (okt 2020 - sep 2026), benadering van de bot op dagbasis met de onderdelen waarvoor data is:
BTC-portfolio (7 strategieen), L/S-rotatie (walk-forward, instellingen per jaar op de 2 jaar ervoor),
Trend-long (Supertrend 4h + Volume-uitbraak 4h; RSI-dip 1h vanaf 2022 toen 1h-data begint).
Zonder volume-module (30m-data pas vanaf 2024). Verdeling naar risico, maandelijks."""
import itertools, os, sys, json
import numpy as np, pandas as pd
sys.path.insert(0, '/home/claude/bot'); os.chdir('/home/claude/bot')
import rotation as RT
from engine import atr
from engine2 import simulate2
from library import supertrend, rsi_mr
from library2 import vol_breakout

T0, T1 = '2020-10-01', '2026-10-01'
COINS = RT.COINS
C, V = RT.matrix('1d'); R = C.pct_change(fill_method=None).fillna(0)
idx = C.index; T = len(idx); s0 = idx.searchsorted(pd.Timestamp(T0, tz='UTC')); Rv = R.values.astype(float)
LS_GRID = dict(n=[7, 14, 21, 30, 60, 90], score=['mom', 'sharpe'], k=[2, 3], reb=[1, 3, 7])


def select(t_end):
    s = max(0, t_end - 730); best = None
    Cs, Vs, Rs = C.iloc[:t_end + 1], V.iloc[:t_end + 1], R.iloc[:t_end + 1]
    for n_, sc, k, reb in itertools.product(*LS_GRID.values()):
        p = dict(n=n_, score=sc, k=k, reb=reb, abs='sma', mkt=50, wt='eq', side='ls')
        W = RT.weights(Cs, Vs, Rs, p, 1).values.astype(float)
        rb = np.zeros(len(Cs), np.bool_); rb[s::reb] = True
        e = RT.sim_stop(Rs.values.astype(float), W, rb, RT.COST, s, 0.5)[s:]
        y = (len(e)) / 365.0; cagr = e[-1] ** (1 / max(y, 0.5)) - 1; dd = (e / np.maximum.accumulate(e) - 1).min()
        cal = cagr / max(-dd, 0.05)
        if best is None or cal > best[0]: best = (cal, p)
    return best[1]


W_ls = np.zeros((T, 10)); reb_ls = np.zeros(T, bool)
for yr in range(2020, 2027):
    a = max(idx.searchsorted(pd.Timestamp(f'{yr}-01-01', tz='UTC')), s0); b = idx.searchsorted(pd.Timestamp(f'{yr+1}-01-01', tz='UTC'))
    if a >= b: continue
    p = select(a - 1); print(yr, p, flush=True)
    W_ls[a:b] = RT.weights(C, V, R, p, 1).values[a:b]; reb_ls[a:b][::p['reb']] = True
ls_eq = RT.sim_stop(Rv, W_ls, reb_ls, RT.COST, s0, 0.5)
didx = pd.date_range(T0, '2026-09-30', freq='1D', tz='UTC')
ls_r = pd.Series(np.r_[0, ls_eq[1:] / ls_eq[:-1] - 1], idx).reindex(didx).fillna(0)
bp = pd.read_csv('results/streams.csv', index_col=0, parse_dates=True)['BTC-portfolio (7)']
bp_r = bp.pct_change().reindex(didx).fillna(0)

btc_d = pd.read_csv('data/coins/BTC_1d.csv', index_col=0, parse_dates=True).close
gate_d = (btc_d > btc_d.rolling(100).mean()).shift(1)


def trend_stream(fn, p, tf, gate, sl, vol, start):
    rets = []
    for c in COINS:
        df = pd.read_csv(f'data/coins/{c}_{tf}.csv', index_col=0, parse_dates=True)
        df = df[(df.index >= pd.Timestamp(start, tz='UTC') - pd.Timedelta(days=60)) & (df.index < T1)]
        if len(df) < 300: rets.append(pd.Series(0.0, didx)); continue
        cols = ['open', 'high', 'low', 'close', 'volume'] + (['taker_buy', 'ntrades'] if vol else [])
        d = tuple(df[k].values.astype(float) for k in cols)
        L, _, XL, _ = [np.nan_to_num(np.asarray(x, dtype=float)).astype(bool) for x in fn(d, p)]
        g = gate_d.reindex(df.index.floor('1D')).fillna(False).values.astype(bool)
        if gate: L = L & g; XL = XL | ~g
        a = atr(d[1], d[2], d[3], 14); st = max(df.index.searchsorted(pd.Timestamp(start, tz='UTC')), 1)
        eq, _, _ = simulate2(d[0], d[1], d[2], d[3], a, L, np.zeros_like(L), XL, np.zeros_like(L), sl, 0.0, 0, 0.0005, 0.0003,
                             0.0001 / 8 * (1 if tf == '1h' else 4), st)
        e = pd.Series(eq, df.index).resample('1D').last().reindex(didx).ffill().fillna(1.0)
        rets.append(e.pct_change().fillna(0))
    return pd.concat(rets, axis=1).mean(axis=1)            # 10 munten, elk 10% (dagelijks gelijk)


st4 = trend_stream(supertrend, dict(n=10, m=4.0), '4h', True, 2.5, False, T0)
vb4 = trend_stream(vol_breakout, dict(n=100, k=3.0), '4h', False, 2.5, True, T0)
rd1 = trend_stream(rsi_mr, dict(n=7, lo=25, exit=70, tf=200), '1h', True, 0.0, False, '2022-03-01')
has1h = didx >= pd.Timestamp('2022-03-01', tz='UTC')
trend = pd.Series(np.where(has1h, (st4 + vb4 + rd1) / 3, (st4 + vb4) / 2), didx)


def mix(cols):
    S = pd.concat(cols, axis=1); S.columns = range(S.shape[1]); out = []; val = 1.0; k = S.shape[1]
    for _, g in S.groupby([S.index.year, S.index.month]):
        hist = S.loc[:g.index[0]].iloc[-61:-1]
        if len(hist) < 20: w = np.ones(k) / k
        else:
            w = 1 / hist.std().clip(lower=0.005).values; w = w / w.sum()
            for _ in range(5): w = np.minimum(w, 0.5); w = w / w.sum()
        sub = val * w * (1 + g).cumprod(); out.append(sub.sum(axis=1)); val = sub.iloc[-1].sum()
    return pd.concat(out)


one = mix([bp_r, ls_r, trend])
r1 = one.pct_change().fillna(0)
FIN = 0.0003 * 0.5                                           # financiering/funding op de extra hefboom, gemiddeld half belegd
out = pd.DataFrame({'1x': (1 + r1).cumprod(), '2x': (1 + 2 * r1 - FIN).cumprod(), '4x': (1 + 4 * r1 - 3 * FIN).cumprod()})
bh = btc_d.reindex(didx).ffill(); out['BTC'] = bh / bh.iloc[0]
P = pd.DataFrame({c: pd.read_csv(f'data/coins/{c}_1d.csv', index_col=0, parse_dates=True).close for c in COINS}).reindex(didx).ffill()
rel = P / P.iloc[0]; out['10 munten'] = rel.mean(axis=1)
out.to_csv('regime/zesjaar.csv')
for k in out:
    x = out[k]; y = (x.index[-1] - x.index[0]).days / 365.25
    yrs = {str(yy): round((g.iloc[-1] / g.iloc[0] - 1) * 100, 1) for yy, g in x.groupby(x.index.year)}
    print(f'{k:10s} totaal {(x.iloc[-1] - 1) * 100:9.0f}%  per jaar {(x.iloc[-1] ** (1 / y) - 1) * 100:6.1f}%  daling {(x / x.cummax() - 1).min() * 100:6.1f}%  {yrs}')
