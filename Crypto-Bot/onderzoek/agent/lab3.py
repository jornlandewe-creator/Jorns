from lab import *
C, H, L = load(); R = C.pct_change(fill_method=None).fillna(0.0); el = eligible(C)
def coins_w(sig, coins, scale=None):
    m = el & C.columns.isin(coins); n = m.sum(axis=1).replace(0, np.nan)
    W = sig.where(m, 0.0).div(n, axis=0)
    if scale is not None: W = W * scale.where(m, 0.0)
    return W.fillna(0.0)
def dd_ctl(W, levels):
    e = run(W, R); return W.mul(dd_control(e, levels), axis=0)

fast = trend_ensemble(C, (20, 50, 100), 0.02)
fast4 = trend_ensemble(C, (20, 50, 100, 200), 0.0)
s200 = trend_sma(C, 200); s200b = trend_sma(C, 200, 0.02)
sma200 = C.rolling(200).mean(); rising200 = (sma200 > sma200.shift(10)).astype(float)
btc_up = pd.DataFrame(np.repeat((C['BTC'] > sma200['BTC']).values[:, None], len(C.columns), 1), index=C.index, columns=C.columns).astype(float)
coins = ['BTC', 'ETH', 'SOL']
print('=== REGIME-GATE (langetermijntrend bepaalt maximale blootstelling)')
for gname, gate in [('per-coin SMA200', s200), ('per-coin SMA200 band', s200b), ('BTC SMA200', btc_up),
                    ('per-coin SMA200 & stijgend', s200 * rising200), ('BTC SMA200 | coin SMA200', np.maximum(btc_up, s200))]:
    for lo in (0.0, 0.33, 0.5):
        g = lo + (1 - lo) * gate
        for sname, sig in [('fast', fast), ('fast4', fast4)]:
            for cap in (1.0, 1.5):
                W = coins_w(sig * g, coins, vol_scale(R, 30, 0.6, cap)); fmt(f'{sname} x gate[{gname}] lo {lo} cap {cap}', run(W, R), W, R)

print('\n=== vol-lookback en target op beste structuur (fast x per-coin SMA200 lo 0.5)')
g = 0.5 + 0.5 * s200
for n in (20, 30, 60):
    for tv in (0.5, 0.6, 0.7):
        for cap in (1.0, 1.5):
            W = coins_w(fast * g, coins, vol_scale(R, n, tv, cap)); fmt(f'fast x gate lo0.5 vol{n} tv{tv} cap{cap}', run(W, R), W, R)
print('\n=== munten')
for cs in (['BTC', 'ETH'], ['BTC', 'ETH', 'SOL'], ['BTC', 'ETH', 'SOL', 'BNB'], ['BTC', 'ETH', 'SOL', 'BNB', 'XRP'], COINS):
    W = coins_w(fast * g, cs, vol_scale(R, 30, 0.6, 1.0)); fmt(f'{"+".join(cs) if len(cs)<6 else "10"} fast x gate lo0.5 cap1', run(W, R), W, R)
    W = coins_w(fast * g, cs, vol_scale(R, 30, 0.6, 1.5)); fmt(f'{"+".join(cs) if len(cs)<6 else "10"} fast x gate lo0.5 cap1.5', run(W, R), W, R)
print('\n=== + ddrem')
for cap in (1.0, 1.5):
    W = coins_w(fast * g, coins, vol_scale(R, 30, 0.6, cap))
    for lv in [((0.15, 0.5),), ((0.20, 0.5),), ((0.15, 0.5), (0.25, 0.25)), ((0.20, 0.5), (0.30, 0.25))]:
        fmt(f'fast x gate cap{cap} ddrem {lv}', run(dd_ctl(W, lv), R))
