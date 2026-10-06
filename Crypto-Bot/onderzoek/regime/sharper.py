"""Scherpere omschakeling voor de L/S-shorts: sneller sluiten als de markt draait.
Varianten: strakkere short-stop, breedte-signaal (aandeel munten boven SMA20), snelle BTC-stijging, BTC boven SMA20.
Beoordeeld als onderdeel van BTC-portfolio + L/S + Trend-long (risicoverdeling), kiezen op 2022-23, controle 2024-26."""
import sys, json; sys.argv = ['x']
exec(open('regime/study3.py').read().split("for k, v in CAND.items(): report")[0])
M = CAND['Mix (3)']
Cv = C.values; above20 = (C > C.rolling(20).mean()).where(C.notna())
breadth = (above20.sum(axis=1) / C.notna().sum(axis=1)).values
btc7 = (btc / btc.shift(7) - 1).values
btc_sma20 = (btc > btc.rolling(20).mean()).values


def ls_variant(noshort, stop=0.5):
    """noshort[t]=True: geen shorts (bestaande sluiten), longs blijven."""
    W = W_ls.copy(); rb = reb_ls.copy(); prev = None
    for t in range(s0, T):
        ns = bool(noshort[t])
        if ns: W[t] = np.clip(W_ls[t], 0, None)
        if prev is not None and ns != prev: rb[t] = True
        prev = ns
    return RT.sim_stop(Rv, W, rb, RT.COST, s0, stop)


def hold(sig, days):
    """Signaal vasthouden voor N dagen na laatste keer waar."""
    out = np.zeros(T, bool); last = -10**9
    for t in range(T):
        if sig[t]: last = t
        out[t] = t - last < days
    return out


def thrust(on, off):
    """Breedte: aan als breedte >= on, uit als breedte < off (hysterese)."""
    out = np.zeros(T, bool); st = False
    for t in range(T):
        b = breadth[t]
        if np.isnan(b): out[t] = st; continue
        if not st and b >= on: st = True
        elif st and b < off: st = False
        out[t] = st
    return out


V = {'Huidig (stop +50%)': (np.zeros(T, bool), 0.5)}
for s in (0.15, 0.2, 0.3): V[f'Short-stop +{int(s*100)}%'] = (np.zeros(T, bool), s)
for on, off in [(0.7, 0.5), (0.8, 0.5), (0.8, 0.6), (0.9, 0.6)]: V[f'Breedte {int(on*100)}/{int(off*100)}'] = (thrust(on, off), 0.5)
for x in (0.08, 0.12):
    for d in (7, 14): V[f'BTC +{int(x*100)}% in 7d, {d}d geen shorts'] = (hold(np.nan_to_num(btc7) > x, d), 0.5)
V['BTC boven SMA20'] = (btc_sma20, 0.5)
V['Breedte 80/50 + stop 30%'] = (thrust(0.8, 0.5), 0.3)

rows = []
for name, (ns, stop) in V.items():
    eq = ls_variant(ns, stop)
    lr = pd.Series(np.r_[0, eq[1:] / eq[:-1] - 1], idx).reindex(didx).fillna(0)
    e = mix([bp_s, lr, M], 'risico')
    L, cr, co = at_risk(e); c1, d1 = stats(e, None, SPLIT); c2, d2 = stats(e, SPLIT); u, dn, _ = months(e)
    se = (1 + lr).cumprod(); s1, sd1 = stats(se, None, SPLIT); s2, sd2 = stats(se, SPLIT)
    jul = e['2026-06-30':'2026-07-31']; jul = jul.iloc[-1] / jul.iloc[0] - 1
    off = float(np.mean(ns[s0:]))
    rows.append(dict(v=name, is_cal=c1 / -d1, oos_cal=c2 / -d2, at20=cr, at20_oos=co))
    print(f'{name:34s} geen-shorts {off:4.0%} | L/S IS {s1*100:5.1f}/{sd1*100:5.1f} OOS {s2*100:5.1f}/{sd2*100:5.1f} | systeem bij -20%: {cr*100:5.1f}% (OOS {co*100:5.1f}) IS cal {c1/-d1:.2f} OOS cal {c2/-d2:.2f} | stijg {u*100:4.1f} daal {dn*100:4.1f} | juli26 {jul*100:5.1f}%', flush=True)
pd.DataFrame(rows).to_csv('regime/sharper.csv', index=False)
