"""L/S-rotatie met stops binnen de dag, gesimuleerd op 4h-candles.
Gewichten worden op het dagslot (00:00 UTC) bepaald uit daily data. Short-stop: stop-order op entry*(1+s),
vult op max(open, stop) * (1+slip) zodra de 4h-high hem raakt. Long-stop analoog (optioneel).
"""
import itertools, numpy as np, pandas as pd
from numba import njit
import rotation as RT

COINS = RT.COINS; COST = RT.COST; SLIP = 0.0005


def mats():
    o = {}; h = {}; l = {}; c = {}
    for m in COINS:
        df = pd.read_csv(f'data/coins/{m}_4h.csv', index_col=0, parse_dates=True)
        o[m] = df.open; h[m] = df.high; l[m] = df.low; c[m] = df.close
    C = pd.DataFrame(c); C = C[(C.index >= '2019-06-01') & (C.index < RT.T1)]
    O = pd.DataFrame(o).reindex(C.index); H = pd.DataFrame(h).reindex(C.index); L = pd.DataFrame(l).reindex(C.index)
    return O, H, L, C


@njit(cache=True)
def sim4(O, H, L, C, W, reb, cost, slip, start, s_stop, l_stop):
    T, M = C.shape
    eq = np.ones(T); w = np.zeros(M); val = 1.0; ent = np.zeros(M)
    for t in range(start, T):
        g = 0.0; r = np.zeros(M)
        for m in range(M):
            if np.isnan(C[t, m]) or np.isnan(C[t - 1, m]) or w[m] == 0.0:
                r[m] = 0.0 if (np.isnan(C[t, m]) or np.isnan(C[t - 1, m])) else C[t, m] / C[t - 1, m] - 1
                continue
            r[m] = C[t, m] / C[t - 1, m] - 1
            if w[m] < 0 and s_stop > 0 and H[t, m] >= ent[m] * (1 + s_stop):
                fill = max(O[t, m], ent[m] * (1 + s_stop)) * (1 + slip)
                g += w[m] * (fill / C[t - 1, m] - 1); val_cost = cost * abs(w[m])
                g -= val_cost; w[m] = -0.0; r[m] = 0.0; w[m] = 0.0
                continue
            if w[m] > 0 and l_stop > 0 and L[t, m] <= ent[m] * (1 - l_stop):
                fill = min(O[t, m], ent[m] * (1 - l_stop)) * (1 - slip)
                g += w[m] * (fill / C[t - 1, m] - 1); g -= cost * abs(w[m]); w[m] = 0.0; r[m] = 0.0
                continue
            g += w[m] * r[m]
        val *= (1 + g)
        if 1 + g > 0:
            for m in range(M): w[m] = w[m] * (1 + r[m]) / (1 + g)
        if reb[t]:
            to = 0.0
            for m in range(M): to += abs(W[t, m] - w[m])
            val *= (1 - cost * to)
            for m in range(M):
                w[m] = W[t, m]; ent[m] = C[t, m]
        eq[t] = val
        if val <= 0:
            for k in range(t, T): eq[k] = 1e-9
            break
    for k in range(start): eq[k] = 1.0
    return eq


def wf(Q, start_year=2022):
    out = []; picks = []
    for y in range(start_year, 2027):
        tr = Q[(Q.index >= f'{y-2}-01-01') & (Q.index < f'{y}-01-01')]; te = Q[(Q.index >= f'{y}-01-01') & (Q.index < f'{y+1}-01-01')]
        e = (1 + tr).cumprod(); cal = (e.iloc[-1] ** 0.5 - 1) / -(e / e.cummax() - 1).min()
        k = cal.idxmax(); out.append(te[k]); picks.append((y, k, round(float((1 + te[k]).prod() - 1), 3)))
    return pd.concat(out), picks


def build(kset=(2, 3), s_stop=0.3, l_stop=0.0, grid_extra=None):
    Cd, Vd = RT.matrix('1d'); Rd = Cd.pct_change(fill_method=None).fillna(0)
    O, H, L, C = mats(); idx = C.index; n = len(idx)
    s0 = idx.searchsorted(pd.Timestamp('2020-01-01', tz='UTC'))
    day_end = (idx.hour == 20)                       # 4h-candle die om 24:00 sluit = dagslot
    grid = dict(n=[7, 14, 21, 30, 60, 90], score=['mom', 'sharpe'], k=list(kset), reb=[1, 3, 7], abs=['sma'], mkt=[50], wt=['eq'], side=['ls'])
    if grid_extra: grid.update(grid_extra)
    curves = {}
    for vals in itertools.product(*grid.values()):
        p = dict(zip(grid, vals))
        Wd = RT.weights(Cd, Vd, Rd, p, 1)
        Wd.index = Wd.index + pd.Timedelta(hours=20)  # gewicht van dag D geldt na slot van D (20:00-candle)
        W4 = Wd.reindex(idx).ffill().fillna(0).values.astype(float)
        day_ix = np.where(day_end)[0]; day_ix = day_ix[day_ix >= s0]
        reb = np.zeros(n, np.bool_); reb[day_ix[::p['reb']]] = True
        eq = sim4(O.values, H.values, L.values, C.values, W4, reb, COST, SLIP, s0, s_stop, l_stop)
        curves[vals] = pd.Series(eq, idx).resample('1D').last().pct_change().fillna(0)
    return pd.DataFrame(curves)


if __name__ == '__main__':
    for kset, ss in [((2, 3), 0.0), ((2, 3), 0.3), ((2, 3), 0.2), ((2, 3), 0.5), ((3,), 0.3)]:
        Q = build(kset, ss)
        w, picks = wf(Q); e = (1 + w).cumprod(); y = (e.index[-1] - e.index[0]).days / 365.25
        tag = f'k{"".join(map(str,kset))}_s{int(ss*100)}'
        w.to_csv(f'results/ls4h_wf_{tag}.csv')
        print(f'{tag}: WF {(e.iloc[-1]**(1/y)-1)*100:5.1f}%/jr  daling {(e/e.cummax()-1).min()*100:5.1f}%  slechtste dag {w.min()*100:5.1f}%  | slechtste dag van alle varianten {Q.min().min()*100:5.1f}%', [p[2] for p in picks], flush=True)
