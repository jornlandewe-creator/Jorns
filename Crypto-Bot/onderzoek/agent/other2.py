from other import *
print('=== 7b. kanteling: buurinstellingen (lookback, sterkte), met plafond op de inzet (clip op cap) en zonder')
def tilt_sig(look, hi, lo):
    rs = (C / C.shift(look) - 1); rk = rs[COINS3].rank(axis=1, ascending=False)
    t = pd.DataFrame(1.0, index=C.index, columns=C.columns); t[COINS3] = rk.map(lambda r: {1: hi, 2: 1.0, 3: lo}.get(r, 1.0)); return t
def pyr_sig(look, extra):
    return 1 + extra * (C >= C.rolling(look).max()).astype(float)
def W_of(mult, cap=1.5, clip=True):
    base = trend_ensemble(C, (20, 50, 100), 0.02) * GATE * SC * mult
    if clip: base = base.clip(upper=cap)
    m = el & C.columns.isin(COINS3); n = m.sum(axis=1).replace(0, np.nan)
    return base.where(m, 0.0).div(n, axis=0).fillna(0.0)
for look in (28, 56, 90):
    for hi, lo in ((1.5, 0.5), (1.25, 0.75), (1.5, 0.75)):
        for clip in (True, False):
            line(f'kanteling {look}d {hi}/{lo} {"clip" if clip else "vrij"}', W_of(tilt_sig(look, hi, lo), clip=clip))
print('=== 8b. pyramide: buurinstellingen')
for look in (20, 50, 100):
    for extra in (0.25, 0.5):
        for clip in (True, False):
            line(f'pyramide top{look} +{extra:.0%} {"clip" if clip else "vrij"}', W_of(pyr_sig(look, extra), clip=clip))
print('=== 7+8: samen')
for clip in (True, False):
    line(f'kanteling 56d 1.5/0.5 + pyramide 50 +50% {"clip" if clip else "vrij"}', W_of(tilt_sig(56, 1.5, 0.5) * pyr_sig(50, 0.5), clip=clip))
    line(f'kanteling 56d 1.25/0.75 + pyramide 50 +25% {"clip" if clip else "vrij"}', W_of(tilt_sig(56, 1.25, 0.75) * pyr_sig(50, 0.25), clip=clip))
print('=== spot (cap 1.0, clip)')
SC1 = vol_scale(R, 30, 0.6, 1.0)
def W1(mult):
    base = (trend_ensemble(C, (20, 50, 100), 0.02) * GATE * SC1 * mult).clip(upper=1.0)
    m = el & C.columns.isin(COINS3); n = m.sum(axis=1).replace(0, np.nan); return base.where(m, 0.0).div(n, axis=0).fillna(0.0)
line('spot Agent', W1(1.0)); line('spot kanteling 56d 1.5/0.5', W1(tilt_sig(56, 1.5, 0.5))); line('spot kanteling + pyramide', W1(tilt_sig(56, 1.5, 0.5) * pyr_sig(50, 0.5)))
print('=== kosten x2 en vanaf 2024-03 (replayperiode) voor de beste')
Wb = W_of(tilt_sig(56, 1.5, 0.5) * pyr_sig(50, 0.5), clip=True)
e = run_ls(Wb, cost=COST * 2); f = stats(e); print(f'kosten x2: {f["cagr"]*100:.1f}%/jr dd {f["mdd"]*100:.1f}%')
for nm, W in (('Agent', coins_w(AGENT, COINS3)), ('kanteling+pyramide clip', Wb)):
    e = run_ls(W); f = stats(e, '2024-03-01', END); print(f'{nm:28s} vanaf 2024-03: {f["cagr"]*100:.1f}%/jr dd {f["mdd"]*100:.1f}%')
