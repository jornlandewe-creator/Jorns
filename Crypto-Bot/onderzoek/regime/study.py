"""Regime-wissel: in een stijgende markt het L/S-slot vervangen door een long-strategie.
Walk-forward L/S (instellingen per jaar op de 2 jaar ervoor), dagdata, kosten 0.07% per omzet, short-stop +50%.
Kiezen op 2022-2023, controleren op 2024-2026."""
import itertools, sys, os
import numpy as np, pandas as pd
sys.path.insert(0, '/home/claude/bot'); os.chdir('/home/claude/bot')
import rotation as RT

LS_GRID = dict(n=[7, 14, 21, 30, 60, 90], score=['mom', 'sharpe'], k=[2, 3], reb=[1, 3, 7])
T0, SPLIT, T1 = '2022-01-01', '2024-01-01', '2026-10-01'

C, V = RT.matrix('1d'); R = C.pct_change(fill_method=None).fillna(0)
idx = C.index; T = len(idx); s0 = idx.searchsorted(pd.Timestamp(T0, tz='UTC'))
Rv = R.values.astype(float)


def select(t_end):
    s = max(0, t_end - 730); best = None
    sub = slice(0, t_end + 1)
    Cs, Vs, Rs = C.iloc[sub], V.iloc[sub], R.iloc[sub]
    for n_, sc, k, reb in itertools.product(*LS_GRID.values()):
        p = dict(n=n_, score=sc, k=k, reb=reb, abs='sma', mkt=50, wt='eq', side='ls')
        W = RT.weights(Cs, Vs, Rs, p, 1).values.astype(float)
        rb = np.zeros(len(Cs), np.bool_); rb[s::reb] = True
        e = RT.sim_stop(Rs.values.astype(float), W, rb, RT.COST, s, 0.5)[s:]
        cagr = e[-1] ** 0.5 - 1; dd = (e / np.maximum.accumulate(e) - 1).min()
        cal = cagr / max(-dd, 0.05)
        if best is None or cal > best[0]: best = (cal, p)
    return best[1]


# walk-forward L/S: doelgewichten + rebalance-dagen, plus long-been apart
W_ls = np.zeros((T, 10)); W_long = np.zeros((T, 10)); reb_ls = np.zeros(T, bool)
for yr in range(2022, 2027):
    a = idx.searchsorted(pd.Timestamp(f'{yr}-01-01', tz='UTC')); b = idx.searchsorted(pd.Timestamp(f'{yr+1}-01-01', tz='UTC'))
    p = select(a - 1); print(yr, p, flush=True)
    W = RT.weights(C, V, R, p, 1)
    W_ls[a:b] = W.values[a:b]
    W_long[a:b] = np.clip(W.values[a:b], 0, None) * 2      # long-been op volle grootte
    reb_ls[a:b][::p['reb']] = True

# alternatieven voor stijgende markt
cnt = C.notna().sum(axis=1).values[:, None]
ALT = {
    'BTC vasthouden': np.tile(np.eye(10)[0], (T, 1)),
    'BTC+ETH': np.tile(np.r_[0.5, 0.5, np.zeros(8)], (T, 1)),
    '10 munten gelijk': C.notna().values / np.maximum(cnt, 1),
    'Sterkste munten long': W_long,
}
btc = C['BTC']
REG = {}
for n in [50, 100, 150, 200]: REG[f'BTC>SMA{n}'] = (btc > btc.rolling(n).mean()).values
REG['SMA50>SMA200'] = (btc.rolling(50).mean() > btc.rolling(200).mean()).values
for n in [30, 60, 90]: REG[f'BTC {n}d mom>0'] = (btc / btc.shift(n) > 1).values
REG['SMA100 + 30d mom'] = REG['BTC>SMA100'] & REG['BTC 30d mom>0']


FR = 1.0
def slot(alt, reg):
    """reg[t]=True: stijgend, gebruik alt-gewichten. Wissel ook op dag van regimewissel."""
    W = np.zeros((T, 10)); rb = reb_ls.copy(); cur = np.zeros(10); prev = None
    for t in range(s0, T):
        up = bool(reg[t])
        target = (FR * ALT[alt][t] + (1 - FR) * W_ls[t]) if up else W_ls[t]
        if up and FR == 1.0 and alt in ('BTC vasthouden', 'BTC+ETH'):   # vasthouden: alleen bij wissel herverdelen
            if prev is not True: rb[t] = True
            else: rb[t] = False
        if prev is not None and up != prev: rb[t] = True
        W[t] = target; prev = up
    return RT.sim_stop(Rv, W, rb, RT.COST, s0, 0.5)


bp = pd.read_csv('results/streams.csv', index_col=0, parse_dates=True)['BTC-portfolio (7)']
bp_r = bp.pct_change().reindex(idx).fillna(0).values


def combo(slot_eq):
    """BTC-portfolio + slot, maandelijks naar risico (inverse 60d vol)."""
    sr = np.r_[0, slot_eq[1:] / slot_eq[:-1] - 1]
    S = pd.DataFrame({'a': bp_r, 'b': sr}, index=idx).iloc[s0:]
    out = []; val = 1.0
    for _, g in S.groupby([S.index.year, S.index.month]):
        hist = S.loc[:g.index[0]].iloc[-61:-1]
        iv = 1 / hist.std().clip(lower=1e-4); w = (iv / iv.sum()).values if len(hist) > 20 else np.array([0.5, 0.5])
        sub = val * w * (1 + g).cumprod(); out.append(sub.sum(axis=1)); val = sub.iloc[-1].sum()
    return pd.concat(out)


def stats(e, a=None, b=None):
    x = e[(e.index >= (a or e.index[0])) & (e.index < (b or '2100'))]
    y = (x.index[-1] - x.index[0]).days / 365.25
    cagr = (x.iloc[-1] / x.iloc[0]) ** (1 / y) - 1; dd = (x / x.cummax() - 1).min()
    return cagr, dd


bm = btc.resample('ME').last().pct_change()
def months(e):
    m = e.resample('ME').last().pct_change().reindex(bm.index)
    up = bm > 0.05; dn = bm < -0.05
    return m[up].mean(), m[dn].mean(), (m[up] > bm[up]).mean()


def at_risk(e, target=-0.20):
    r = e.pct_change().fillna(0)
    lo, hi = 0.1, 6.0
    for _ in range(40):
        L = (lo + hi) / 2; x = (1 + L * r).cumprod(); d = (x / x.cummax() - 1).min()
        if d < target: hi = L
        else: lo = L
    x = (1 + L * r).cumprod(); y = (x.index[-1] - x.index[0]).days / 365.25
    xi = x[x.index < SPLIT]; xo = x[x.index >= SPLIT]
    return L, x.iloc[-1] ** (1 / y) - 1, (xo.iloc[-1] / xo.iloc[0]) ** (1 / ((xo.index[-1] - xo.index[0]).days / 365.25)) - 1

rows = []; curves = {}
REGS = ['BTC>SMA50', 'BTC>SMA100', 'BTC>SMA200', 'SMA50>SMA200', 'SMA100 + 30d mom', 'BTC 30d mom>0']
variants = [('Huidig (L/S altijd)', None, None, 0)] + [(f'{a} {int(f*100)}% | {r}', a, r, f) for a in ['BTC vasthouden', 'Sterkste munten long', '10 munten gelijk'] for r in REGS for f in (0.25, 0.5, 1.0)]
for name, a, r, f in variants:
    FR = f
    eq = RT.sim_stop(Rv, W_ls, reb_ls, RT.COST, s0, 0.5) if a is None else slot(a, REG[r])
    se = pd.Series(eq, idx).iloc[s0:]; ce = combo(eq); curves[name] = ce
    row = dict(variant=name)
    for tag, e in [('slot', se), ('combo', ce)]:
        for per, (x, y) in [('is', (T0, SPLIT)), ('oos', (SPLIT, None)), ('full', (None, None))]:
            c, d = stats(e, x, y); row[f'{tag}_{per}_cagr'] = c; row[f'{tag}_{per}_dd'] = d
    u, dn, beat = months(ce); row.update(combo_up=u, combo_dn=dn, combo_beat_up=beat)
    L, cr, co = at_risk(ce); row.update(lev20=L, cagr20=cr, oos20=co)
    rows.append(row); print(name, f"| bij -20%: {L:.2f}x {cr*100:.1f}%/jr (OOS {co*100:.1f}) |", f"combo IS {row['combo_is_cagr']*100:.1f}/{row['combo_is_dd']*100:.1f}  OOS {row['combo_oos_cagr']*100:.1f}/{row['combo_oos_dd']*100:.1f}  stijgmnd {u*100:.1f} daalmnd {dn*100:.1f}", flush=True)
df = pd.DataFrame(rows); df.to_csv('regime/study.csv', index=False)
pd.DataFrame(curves).to_csv('regime/study_curves.csv')
