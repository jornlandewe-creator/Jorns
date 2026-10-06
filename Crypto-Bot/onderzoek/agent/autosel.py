"""Automatisch het 'beste' profiel kiezen op recente prestatie: helpt dat? Elke maand het profiel met de hoogste Calmar/rendement over de laatste N maanden."""
from bear import *
cands = {'stabiel (short x0.25)': build2(0.25, 20), 'long/short x0.5': build2(0.5, 20), 'bear x1.0': build2(1.0, 20), 'long-only': build2(0.0, 20)}
eqs = {k: run_ls(W) for k, W in cands.items()}
rets = pd.DataFrame({k: e.pct_change().fillna(0) for k, e in eqs.items()})
def autosel(look_m, metric='calmar'):
    idx = C.index; months = pd.Series(idx.to_period('M'), index=idx); out = pd.Series(0.0, index=idx); pick = {}
    cur = 'stabiel (short x0.25)'
    for m, grp in months.groupby(months):
        start = grp.index[0]; hist = rets.loc[:start].iloc[:-1].tail(look_m * 30)
        if len(hist) >= look_m * 25:
            best = None
            for k in cands:
                e = (1 + hist[k]).cumprod(); r = e.iloc[-1] - 1; dd = (e / e.cummax() - 1).min()
                sc = r / max(-dd, 0.05) if metric == 'calmar' else r
                if best is None or sc > best[0]: best = (sc, k)
            cur = best[1]
        pick[str(m)] = cur; out.loc[grp.index] = rets.loc[grp.index, cur]
    e = (1 + out).cumprod(); return e, pick
for k, e in eqs.items():
    f = stats(e); o = stats(e, SPLIT, END); print(f"vast: {k:24s} {f['cagr']*100:6.1f}%/jr dd {f['mdd']*100:6.1f}% calmar {f['calmar']:.2f} | OOS {o['cagr']*100:5.1f}% {o['mdd']*100:5.1f}%")
for look in (3, 6, 12):
    for metric in ('calmar', 'rendement'):
        e, pick = autosel(look, metric); f = stats(e); o = stats(e, SPLIT, END)
        sw = sum(1 for a, b in zip(list(pick.values())[:-1], list(pick.values())[1:]) if a != b)
        print(f"AUTO kies op {metric} laatste {look:2d} mnd:   {f['cagr']*100:6.1f}%/jr dd {f['mdd']*100:6.1f}% calmar {f['calmar']:.2f} | OOS {o['cagr']*100:5.1f}% {o['mdd']*100:5.1f}% | wissels {sw}")
