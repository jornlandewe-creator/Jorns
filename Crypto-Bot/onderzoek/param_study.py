"""Parameteronderzoek op systeemniveau, beoordeeld op de eisen van de gebruiker:
1) beter dan BTC vasthouden, 2) beperkte daling, 3) vaak winst (positieve maanden), 4) zo veel mogelijk rendement.
Kiezen op de ene helft, controleren op de andere (en andersom)."""
import itertools, numpy as np, pandas as pd
from numba import njit
FIN = 0.0003 * 0.6

e = pd.read_csv('results/replay_fut_1.0x.csv', index_col=0, parse_dates=True)
R = {}
for k, c in [('btc', 'btc.1'), ('ls', 'ls'), ('vol', 'vol')]:
    x = e[c].resample('1D').last(); r = x.pct_change(); r[r.index.day == 1] = np.nan; R[k] = r
R = pd.DataFrame(R).dropna(how='all').fillna(0)
btcp = e['btc'].resample('1D').last().reindex(R.index)
sma = pd.read_csv('data/btc_1D.csv', index_col=0, parse_dates=True).close
up = (sma > sma.rolling(200).mean()).shift(1).reindex(R.index).fillna(True).astype(bool).values
iv = 1 / R.rolling(60).std().shift(1); RPW = iv.div(iv.sum(axis=1), axis=0).fillna(1 / 3).values

@njit(cache=True)
def sim(r1, upv, L, filt, t1, rec):
    n = len(r1); eq = np.ones(n); v = 1.0; s = 1.0; sp = 1.0; half = False
    for i in range(n):
        sdd = s / sp - 1
        if t1 > 0:
            if sdd <= -t1: half = True
            elif sdd > -t1 * rec: half = False
        lev = L * (0.5 if half else 1.0) * (0.5 if (filt and not upv[i]) else 1.0)
        g = lev * r1[i] - max(lev - 1.0, 0.0) * 0.00018
        v *= 1 + g; v = max(v, 1e-9); eq[i] = v
        s *= 1 + r1[i]; sp = max(sp, s)
    return eq

def metrics(eqs, idx, b):
    x = pd.Series(eqs, idx); y = (idx[-1] - idx[0]).days / 365.25
    cagr = (x.iloc[-1] / x.iloc[0]) ** (1 / y) - 1; dd = (x / x.cummax() - 1).min()
    m = x.resample('ME').last().pct_change().dropna()
    bb = b / b.iloc[0]; bc = bb.iloc[-1] ** (1 / y) - 1
    r90 = (x.shift(-90) / x - 1).dropna()
    return cagr, dd, (m > 0).mean(), cagr - bc, r90.min(), x.pct_change().mean()

def _study():
    weights = [w for w in itertools.product(range(0, 11), repeat=3) if sum(w) == 10]
    halves = {'A': ('2024-03-01', '2025-07-01'), 'B': ('2025-07-01', '2026-10-01')}
    rows = []
    for wi, w in enumerate(weights + ['RP']):
        if w == 'RP': r1 = (R.values * RPW).sum(axis=1); wname = 'risico'
        else: r1 = R.values @ (np.array(w) / 10); wname = '/'.join(str(10 * a) for a in w)
        for L in np.arange(1, 6.01, 0.5):
            for filt in (False, True):
                for t1, rec in [(0.0, 0.5), (0.04, 0.5), (0.06, 0.5), (0.08, 0.5)]:
                    eq = sim(r1, up, L, filt, t1, rec)
                    row = dict(verdeling=wname, L=L, filter=filt, rem=t1)
                    for h, (a, b) in halves.items():
                        msk = (R.index >= a) & (R.index < b)
                        c, d, pm, ex, w90, dag = metrics(eq[msk] / eq[msk][0], R.index[msk], btcp[msk])
                        row.update({f'{h}_cagr': c, f'{h}_dd': d, f'{h}_posm': pm, f'{h}_vsbtc': ex, f'{h}_w90': w90, f'{h}_dag': dag})
                    c, d, pm, ex, w90, dag = metrics(eq, R.index, btcp)
                    row.update(full_cagr=c, full_dd=d, full_posm=pm, full_vsbtc=ex, full_dag=dag)
                    rows.append(row)
    res = pd.DataFrame(rows); res.to_csv('results/param_study.csv', index=False)
    print(len(res), 'combinaties')


if __name__ == "__main__":
    _study()
