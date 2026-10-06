"""Aanvulling 3 van REGELS_VOORAF.md. Regels niet aanpassen."""
import sys; sys.path.insert(0, 'robust')
from test import *
C, R, elig, F = load(); idx = C.index; s0 = idx.searchsorted(pd.Timestamp(START, tz='UTC')) - 1
sma = C.rolling(200).mean(); up = (C > sma) & sma.notna()
vol30 = R.rolling(30).std() * np.sqrt(365)
two = ['BTC', 'ETH']

def W_C(): W = pd.DataFrame(0.0, idx, COINS); W[two] = up[two].astype(float) * 0.5; return W
def W_E():
    mom = (C / C.shift(28) - 1).where(up & elig)
    rk = mom.rank(axis=1, ascending=False)
    return (rk <= 3).astype(float) / 3.0
def W_F():
    W = pd.DataFrame(0.0, idx, COINS); W[two] = up[two].astype(float) * 0.5 * (0.60 / vol30[two]).clip(upper=2.0).fillna(0); return W
def W_H(): return W_C() * 2.0

V = {'C Trend-vasthouden': (W_C, 7, False), 'E Sterkste in trend': (W_E, 7, False), 'F hefboom naar beweeglijkheid': (W_F, 7, True),
     'G dagelijkse controle': (W_C, 1, False), 'H vaste 2x': (W_H, 7, True)}

def trades(W, reb):
    out = []
    Wr = W[reb].loc[START:]
    for c in COINS:
        w = Wr[c]; inpos = False
        for t, x in w.items():
            if x > 0 and not inpos: inpos, t0, lev0 = True, t, x
            elif x <= 0 and inpos:
                inpos = False; r = C[c].loc[t] / C[c].loc[t0] - 1 - 2 * FEE; out.append((c, t0, t, r))
        if inpos: out.append((c, t0, w.index[-1], C[c].iloc[-1] / C[c].loc[t0] - 1 - 2 * FEE))
    return pd.DataFrame(out, columns=['munt', 'in', 'uit', 'r'])

res = {}
for nm, (fW, every, fut) in V.items():
    W = fW().fillna(0.0); reb = reb_mask(idx, every, START)
    row = {}
    for cm in (1, 2):
        Fm = (F * cm).values if fut else np.zeros_like(R.values)
        eq = sim(R.values, W.values, reb, FEE * cm, Fm, s0)
        for a in (START, '2022-01-01'):
            st = stats(eq, idx, a, END); row[(cm, a)] = st
    tr = trades(W, reb); w = tr[tr.r > 0]; l = tr[tr.r <= 0]
    res[nm] = row
    a, b = row[(1, START)], row[(1, '2022-01-01')]
    print(f"{nm:30s} 2018-26 {a['per_jaar']*100:5.1f}%/jr daling {a['daling']*100:5.1f}% t {a['t']:.2f} zonder top3 {a['zonder_top3']*100:6.0f}% | "
          f"2022-26 {b['per_jaar']*100:5.1f}%/jr daling {b['daling']*100:5.1f}% | 2x kosten {row[(2,START)]['per_jaar']*100:5.1f}% / {row[(2,'2022-01-01')]['per_jaar']*100:5.1f}% | "
          f"trades {len(tr)} ({len(tr)/8.75:.1f}/jr) winrate {len(w)/max(len(tr),1):.0%} gem winst {w.r.mean()*100:+.0f}% gem verlies {l.r.mean()*100:+.0f}%")
    print('   jaren', a['jaren'])
bh = C[two].loc[START:]; e = (0.5 * bh.BTC / bh.BTC.iloc[0] + 0.5 * bh.ETH / bh.ETH.iloc[0])
for a_ in (START, '2022-01-01'):
    st = stats(e.reindex(idx).bfill().values, idx, a_, END); print(f"BTC+ETH vasthouden {a_[:4]}: {st['per_jaar']*100:.1f}%/jr daling {st['daling']*100:.1f}%")
