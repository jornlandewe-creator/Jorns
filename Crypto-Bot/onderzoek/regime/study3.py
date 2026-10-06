"""Bull-module als 4e onderdeel naast BTC-portfolio en L/S. Gelijk-risico vergelijking."""
import sys, json; sys.argv=['x']
src=open('regime/study.py').read()
exec(src.split("rows = []; curves = {}")[0].replace("T0, SPLIT, T1 = '2022-01-01'","T0, SPLIT, T1 = '2022-03-01'"))
exec("def at_risk" + src.split("def at_risk")[1].split("rows = []")[0])
B = pd.read_csv('regime/bullsweep.csv'); D = np.load('regime/bullsweep_daily.npy')
didx = pd.date_range('2022-03-01', '2026-09-30', freq='1D', tz='UTC')
def pick(fam, p, tf, gate, sl):
    m = (B.fam == fam) & (B.p == json.dumps(p)) & (B.tf == tf) & (B.gate == gate) & (B.sl == sl)
    return pd.Series(D[np.where(m)[0][0]], didx)
CAND = {
 'Supertrend 4h': pick('Supertrend', dict(n=10, m=4.0), '4h', 1, 2.5),
 'Volume-uitbraak 4h': pick('Volume-breakout', dict(n=100, k=3.0), '4h', 0, 2.5),
 'RSI-dip 1h': pick('RSI mean reversion', dict(n=7, lo=25, exit=70, tf=200), '1h', 1, 0.0),
}
CAND['Mix (3)'] = pd.concat(CAND.values(), axis=1).mean(axis=1)
ls_eq = RT.sim_stop(Rv, W_ls, reb_ls, RT.COST, s0, 0.5)
ls_r = pd.Series(np.r_[0, ls_eq[1:] / ls_eq[:-1] - 1], idx).reindex(didx).fillna(0)
bp_s = pd.Series(bp_r, idx).reindex(didx).fillna(0)

def mix(cols, mode):
    S = pd.concat(cols, axis=1); S.columns = range(S.shape[1]); out = []; val = 1.0; k = S.shape[1]
    for _, g in S.groupby([S.index.year, S.index.month]):
        hist = S.loc[:g.index[0]].iloc[-61:-1]
        if mode == 'gelijk' or len(hist) < 20: w = np.ones(k) / k
        else:
            iv = 1 / hist.std().clip(lower=0.005); w = (iv / iv.sum()).values
            w = np.minimum(w, 0.5); w = w / w.sum()
        sub = val * w * (1 + g).cumprod(); out.append(sub.sum(axis=1)); val = sub.iloc[-1].sum()
    return pd.concat(out)

def report(name, e):
    L, cr, co = at_risk(e); c1, d1 = stats(e, None, SPLIT); c2, d2 = stats(e, SPLIT); u, dn, beat = months(e)
    print(f'{name:45s} bij -20%: {L:.2f}x {cr*100:5.1f}%/jr (OOS {co*100:5.1f}) | 1x IS {c1*100:5.1f}/{d1*100:5.1f} OOS {c2*100:5.1f}/{d2*100:5.1f} | stijg {u*100:4.1f} daal {dn*100:4.1f}')
    return e

for k, v in CAND.items(): report('alleen ' + k, (1 + v).cumprod())
print('corr', pd.concat([bp_s, ls_r] + list(CAND.values()), axis=1).corr().round(2).values)
report('HUIDIG: BTC-portfolio + L/S (risico)', mix([bp_s, ls_r], 'risico'))
for k, v in CAND.items():
    for mode in ('gelijk', 'risico'):
        report(f'+ {k} ({mode})', mix([bp_s, ls_r, v], mode))
bt = btc[(btc.index >= '2022-03-01')]; report('BTC vasthouden', bt)
