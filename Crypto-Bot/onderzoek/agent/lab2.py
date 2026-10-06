from lab import *
C, H, L = load(); R = C.pct_change(fill_method=None).fillna(0.0); el = eligible(C)

def coins_w(sig, coins, scale=None):
    m = el & C.columns.isin(coins); n = m.sum(axis=1).replace(0, np.nan)
    W = sig.where(m, 0.0).div(n, axis=0)
    if scale is not None: W = W * scale.where(m, 0.0)
    return W.fillna(0.0)

def port_vol_scale(W, R, n=30, target=0.35, cap=1.5):
    """Scale total exposure so realised portfolio vol (of W applied to R, lagged) ~ target."""
    pr = (W.shift(1) * R).sum(axis=1)
    v = pr.rolling(n).std() * np.sqrt(365)
    return (target / v).clip(upper=cap).fillna(1.0)

def with_dd(W, R, levels, recover=0.05):
    e = run(W, R); f = dd_control(e, levels, recover)
    return W.mul(f, axis=0)

def dd_periods(e, k=4):
    dd = e / e.cummax() - 1
    out = []; inn = False
    for t, v in dd.items():
        if not inn and v < -0.1: inn = True; start = t; mn = v; tmn = t
        elif inn:
            if v < mn: mn = v; tmn = t
            if v == 0: inn = False; out.append((start.date(), tmn.date(), t.date(), round(mn*100)))
    if inn: out.append((start.date(), tmn.date(), None, round(mn*100)))
    return sorted(out, key=lambda x: x[3])[:k]

cands = {
 'A ens(20/50/100 b2%) BTC+ETH vt60 cap1': coins_w(trend_ensemble(C, (20,50,100), 0.02), ['BTC','ETH'], vol_scale(R,30,0.6,1.0)),
 'B ens(20/50/100/200) BTC+ETH+SOL vt60 cap1': coins_w(trend_ensemble(C), ['BTC','ETH','SOL'], vol_scale(R,30,0.6,1.0)),
 'C ens(20/50/100/200) BTC+ETH+SOL vt60 cap1.5': coins_w(trend_ensemble(C), ['BTC','ETH','SOL'], vol_scale(R,30,0.6,1.5)),
 'D ens(20/50/100 b2%) BTC+ETH+SOL vt60 cap1': coins_w(trend_ensemble(C, (20,50,100), 0.02), ['BTC','ETH','SOL'], vol_scale(R,30,0.6,1.0)),
 'E ens(20/50/100 b2%) BTC+ETH+SOL vt60 cap1.5': coins_w(trend_ensemble(C, (20,50,100), 0.02), ['BTC','ETH','SOL'], vol_scale(R,30,0.6,1.5)),
}
print('=== kandidaten + drawdown-perioden')
for nm, W in cands.items():
    e = run(W, R); fmt(nm, e, W, R); print('       diepste dalingen:', dd_periods(e))

print('\n=== DRAWDOWN-REM op kandidaten')
for nm, W in cands.items():
    for lv in [((0.10,0.5),(0.20,0.25)), ((0.15,0.5),(0.25,0.25)), ((0.15,0.5),(0.30,0.0)), ((0.20,0.5),)]:
        for rec in (0.05, 0.10):
            W2 = with_dd(W, R, lv, rec); fmt(f'{nm[:2]} ddrem {lv} rec {rec}', run(W2, R))

print('\n=== PORTFOLIO VOL TARGET')
for nm, W in list(cands.items())[1:3]:
    for tv in (0.30, 0.40, 0.50):
        for cap in (1.0, 1.5):
            W2 = W.mul(port_vol_scale(W, R, 30, tv, cap), axis=0); fmt(f'{nm[:2]} portvol {tv} cap {cap}', run(W2, R))
