"""Noodrem: hefboom omlaag als het account x% onder zijn top staat. Getest op dagrendementen (1x-basis)."""
import itertools, numpy as np, pandas as pd
from numba import njit
FIN = 0.0003 * 0.6

@njit(cache=True)
def run(r, L, t1, t2, f1, f2, rec):
    """r: 1x-dagrendementen. Boven drempel t1 daling: hefboom x f1, boven t2: x f2.
    Terug naar vol pas als daling weer kleiner is dan rec x t1 (hysterese). Beslissing op slot van gisteren."""
    n = len(r); eq = np.ones(n); val = 1.0; peak = 1.0; state = 0
    for i in range(n):
        dd = val / peak - 1
        if t2 > 0 and dd <= -t2: state = 2
        elif dd <= -t1 and state < 1: state = 1
        elif dd > -t1 * rec: state = 0
        lev = L * (f2 if state == 2 else (f1 if state == 1 else 1.0))
        g = lev * r[i] - max(lev - 1, 0) * FIN
        val *= (1 + g)
        if val < 1e-9: val = 1e-9
        peak = max(peak, val); eq[i] = val
    return eq

def stats(eq, n):
    y = n / 365; cagr = eq[-1] ** (1 / y) - 1; dd = (eq / np.maximum.accumulate(eq) - 1).min()
    return cagr, dd

def boot(r, args, rng, n=2000, horizon=365):
    out = []; a = r
    for _ in range(n):
        idx = np.concatenate([np.arange(s, s + 10) for s in rng.integers(0, len(a) - 10, horizon // 10 + 1)])[:horizon]
        e = run(a[idx], *args); out.append(((e / np.maximum.accumulate(e) - 1).min(), e[-1]))
    o = np.array(out)
    return (o[:, 0] <= -0.5).mean(), (o[:, 0] <= -0.8).mean(), np.median(o[:, 1]) - 1, (o[:, 1] < 1).mean()

def series():
    e = pd.read_csv('results/replay_fut_1.0x.csv', index_col=0, parse_dates=True)
    M = {}
    for k, c in [('btc', 'btc.1'), ('ls', 'ls'), ('vol', 'vol')]:
        x = e[c].resample('1D').last(); r = x.pct_change(); r[r.index.day == 1] = np.nan; M[k] = r
    R = pd.DataFrame(M).dropna(how='all').fillna(0)
    iv = 1 / R.rolling(60).std().shift(1); w = iv.div(iv.sum(axis=1), axis=0).fillna(1 / 3)
    A = (R * w).sum(axis=1)
    D = pd.read_csv('results/streams.csv', index_col=0, parse_dates=True)
    ls = pd.read_csv('results/ls4h_wf_k23_s50.csv', index_col=0, parse_dates=True).iloc[:, 0]
    Q = pd.concat({'btc': D['BTC-portfolio (7)'].pct_change(), 'ls': ls}, axis=1).dropna(); Q = Q[Q.index >= '2022-01-01']
    iv = 1 / Q.rolling(60).std().shift(1); w2 = iv.div(iv.sum(axis=1), axis=0).fillna(.5)
    B = (Q * w2).sum(axis=1)
    return A, B

if __name__ == '__main__':
    A, B = series(); rng = np.random.default_rng(11)
    rows = []
    for L in [4.0, 6.0]:
        for t1, t2, f1, f2, rec in itertools.chain([(9.0, 0.0, 1.0, 1.0, 0.5)],
                itertools.product([0.10, 0.15, 0.20, 0.25], [0.0, 0.30, 0.40], [0.5, 0.25], [0.25, 0.0], [0.5, 0.0])):
            if t2 and t2 <= t1: continue
            if not t2 and f2 != 0.25: continue
            args = (L, t1, t2, f1, f2, rec)
            ca, da = stats(run(A.values, *args), len(A)); cb, db = stats(run(B.values, *args), len(B))
            p50, p80, med, neg = boot(A.values, args, rng)
            rows.append(dict(L=L, t1=t1, t2=t2, f1=f1, f2=f2, rec=rec, A_cagr=ca, A_dd=da, B_cagr=cb, B_dd=db, kans50=p50, kans80=p80, med_jaar=med, kans_verlies=neg))
    res = pd.DataFrame(rows); res.to_csv('results/breaker.csv', index=False)
    pd.set_option('display.width', 220)
    for L in [4.0, 6.0]:
        x = res[res.L == L].copy(); base = x[x.t1 == 9.0]
        print(f'\n== {L:g}x zonder noodrem:'); print(base.round(3).to_string())
        x['score'] = x.B_cagr / (-x.B_dd)        # kiezen op 2022-2026 (andere data dan de replay)
        print('beste 8 gekozen op 2022-2026 (rendement / daling):'); print(x.sort_values('score', ascending=False).head(8).round(3).to_string())
