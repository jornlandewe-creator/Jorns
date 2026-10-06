from lab import *
C, H, L = load(); R = C.pct_change(fill_method=None).fillna(0.0); el = eligible(C)
def coins_w(sig, coins, scale=None):
    m = el & C.columns.isin(coins); n = m.sum(axis=1).replace(0, np.nan)
    W = sig.where(m, 0.0).div(n, axis=0)
    if scale is not None: W = W * scale.where(m, 0.0)
    return W.fillna(0.0)
def bcast(s): return pd.DataFrame(np.repeat(s.values[:, None], len(C.columns), 1), index=C.index, columns=C.columns).astype(float)
def build(coins=('BTC','ETH','SOL'), looks=(20,50,100), band=0.02, gate_n=200, gate='btc', voln=30, tv=0.6, cap=1.5, gate_band=0.0):
    fast = trend_ensemble(C, looks, band)
    sma = C.rolling(gate_n).mean()
    if gate == 'btc': g = bcast(trend_sma(C[['BTC']], gate_n, gate_band)['BTC'])
    elif gate == 'coin': g = trend_sma(C, gate_n, gate_band)
    elif gate == 'both': g = bcast(trend_sma(C[['BTC']], gate_n, gate_band)['BTC']) * trend_sma(C, gate_n, gate_band)
    elif gate == 'either': g = np.maximum(bcast(trend_sma(C[['BTC']], gate_n, gate_band)['BTC']), trend_sma(C, gate_n, gate_band))
    else: g = 1.0
    return coins_w(fast * g, list(coins), vol_scale(R, voln, tv, cap))
def exposure_months(W, R):
    e = run(W, R); m = e.resample('ME').last().pct_change().dropna(); act = m[m.abs() > 1e-6]
    return (act > 0).mean(), len(act), len(m)

print('=== GATE-varianten (hard)')
for gate in ('btc', 'coin', 'both', 'either'):
    for gb in (0.0, 0.02):
        for cap in (1.0, 1.5):
            W = build(gate=gate, gate_band=gb, cap=cap); e = run(W, R); fmt(f'gate {gate} band {gb} cap {cap}', e, W, R)
            pm, na, nm = exposure_months(W, R); print(f'        actieve maanden positief {pm:.0%} ({na}/{nm})')
print('\n=== vol-lookback / target (gate btc hard, cap 1.5)')
for voln in (30, 60):
    for tv in (0.5, 0.6, 0.7):
        W = build(voln=voln, tv=tv); fmt(f'vol{voln} tv{tv}', run(W, R), W, R)
print('\n=== BUURINSTELLINGEN (gate btc, vol30 tv0.6 cap1.5)')
for looks in ((15,40,80), (20,50,100), (25,60,120), (30,75,150), (20,50,100,200), (10,30,60)):
    for band in (0.0, 0.01, 0.02, 0.03):
        W = build(looks=looks, band=band); fmt(f'looks {looks} band {band}', run(W, R), W, R)
for gn in (150, 175, 200, 250):
    W = build(gate_n=gn); fmt(f'gate_n {gn}', run(W, R), W, R)
print('\n=== KOSTEN x2 en x3 (gate btc, standaard)')
W = build()
for cm in (1, 2, 3):
    fmt(f'kosten x{cm}', run(W, R, cost=COST*cm), W, R)
print('\n=== munten')
for cs in (('BTC',), ('BTC','ETH'), ('BTC','ETH','SOL'), ('BTC','ETH','SOL','BNB'), ('BTC','ETH','SOL','XRP'), ('BTC','ETH','SOL','BNB','XRP','ADA','LINK','DOGE','AVAX','DOT')):
    for cap in (1.0, 1.5):
        W = build(coins=cs, cap=cap); fmt(f'{"+".join(cs) if len(cs)<6 else "10"} cap {cap}', run(W, R), W, R)
print('\n=== + ddrem 15%/half, 25%/kwart op standaard')
for cap in (1.0, 1.5):
    W = build(cap=cap); e = run(W, R)
    for lv in [((0.15,0.5),), ((0.20,0.5),), ((0.15,0.5),(0.25,0.25))]:
        W2 = W.mul(dd_control(e, lv), axis=0); fmt(f'cap {cap} ddrem {lv}', run(W2, R))
