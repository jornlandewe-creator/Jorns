"""Long/short onderzoek: zelfde poort/ensemble/volatiliteitsdoel, maar ook shorts in een dalende markt. Futures: geleend geld en shorts betalen financiering."""
from lab import *
from numba import njit
C, H, L = load(); R = C.pct_change(fill_method=None).fillna(0.0); el = eligible(C)
SHORT_FUND = 0.0003   # 0,03% per dag op short-notional (conservatief: geen funding-inkomsten)

@njit(cache=True)
def sim_ls(R, W, cost, fund, sfund, start, thresh):
    T, M = R.shape; eq = np.ones(T); w = np.zeros(M); val = 1.0
    for t in range(start, T):
        g = 0.0; gross = 0.0; short = 0.0
        for m in range(M):
            g += w[m] * R[t, m]; gross += abs(w[m])
            if w[m] < 0: short += -w[m]
        val *= (1 + g - fund * max(gross - 1.0, 0.0) - sfund * short)
        if 1 + g > 0:
            for m in range(M): w[m] = w[m] * (1 + R[t, m]) / (1 + g)
        to = 0.0
        for m in range(M): to += abs(W[t, m] - w[m])
        if to > thresh:
            val *= (1 - cost * to)
            for m in range(M): w[m] = W[t, m]
        eq[t] = val
        if val <= 0:
            for k in range(t, T): eq[k] = 1e-9
            break
    for k in range(start): eq[k] = 1.0
    return eq

def run_ls(W, cost=COST):
    s0 = C.index.searchsorted(pd.Timestamp(START, tz='UTC'))
    return pd.Series(sim_ls(np.nan_to_num(R.values), np.nan_to_num(W.values), cost, FUND_DAY, SHORT_FUND, s0, 0.02), C.index)

def bcast(s): return pd.DataFrame(np.repeat(s.values[:, None], len(C.columns), 1), index=C.index, columns=C.columns).astype(float)
def coins_w(sig, coins, scale):
    m = el & C.columns.isin(coins); n = m.sum(axis=1).replace(0, np.nan)
    return (sig.where(m, 0.0).div(n, axis=0) * scale.where(m, 0.0)).fillna(0.0)

def trend_sma_dn(C, n, band):   # 1 als onder SMA*(1-band), 0 als boven SMA*(1+band), anders vorige
    ma = C.rolling(n).mean(); st = pd.DataFrame(np.nan, index=C.index, columns=C.columns)
    st[C < ma * (1 - band)] = 1.0; st[C > ma * (1 + band)] = 0.0
    return st.ffill().fillna(0.0)

def build(coins=('BTC','ETH','SOL'), looks=(20,50,100), band=0.02, tv=0.6, cap=1.5, short_mult=1.0, short_gate='both', short_looks=None, falling=False):
    btc_up = bcast(trend_sma(C[['BTC']], 200, 0)['BTC']); coin_up = trend_sma(C, 200, 0)
    g_long = btc_up * coin_up
    fast_up = trend_ensemble(C, looks, band)
    sl = short_looks or looks
    fast_dn = sum(trend_sma_dn(C, n, band) for n in sl) / len(sl)
    btc_dn = 1 - btc_up; coin_dn = 1 - coin_up
    if falling:
        s200 = C['BTC'].rolling(200).mean(); btc_dn = btc_dn * bcast((s200 < s200.shift(20)).astype(float))
    g_short = {'both': btc_dn * coin_dn, 'btc': btc_dn, 'coin': coin_dn, 'none': 0 * btc_dn}[short_gate]
    sc = vol_scale(R, 30, tv, cap)
    W = coins_w(fast_up * g_long, list(coins), sc) - short_mult * coins_w(fast_dn * g_short, list(coins), sc)
    return W

def yr_line(name, e):
    f = stats(e); i = stats(e, START, SPLIT); o = stats(e, SPLIT, END)
    yrs = f['jaren']; full = {k: v for k, v in yrs.items() if 2018 <= k <= 2025}
    print(f"{name:46s} {f['cagr']*100:6.1f}%/jr dd {f['mdd']*100:6.1f}% sh {f['sharpe']:.2f} | IS {i['cagr']*100:5.1f}% | OOS {o['cagr']*100:5.1f}% {o['mdd']*100:5.1f}% | slechtste jaar {min(full.values()):+d}% | jaren>=50%: {sum(v >= 50 for v in full.values())}/8 | {yrs}")

print('=== LONG-ONLY referentie')
yr_line('long only (Agent)', run_ls(build(short_gate='none')))
print('=== LONG + SHORT (spiegelbeeld): short als BTC én munt onder SMA200 en onder de snelle gemiddelden')
for sm in (0.5, 1.0):
    for sg in ('both', 'btc'):
        for fall in (False, True):
            yr_line(f'L/S short x{sm} poort {sg}{" dalend SMA200" if fall else ""}', run_ls(build(short_mult=sm, short_gate=sg, falling=fall)))
print('=== shorts met langzamere gemiddelden (50/100/200) tegen bear-market-rally\'s')
for sm in (0.5, 1.0):
    yr_line(f'L/S short x{sm} short-looks 50/100/200', run_ls(build(short_mult=sm, short_looks=(50,100,200))))
print('=== 10 munten L/S')
yr_line('10 munten L/S x1', run_ls(build(coins=tuple(COINS), short_mult=1.0)))
yr_line('10 munten L/S x0.5', run_ls(build(coins=tuple(COINS), short_mult=0.5)))
print('=== hogere hefboom (plafond) op L/S both x1')
for cap in (1.5, 2.0, 3.0):
    for tv in (0.6, 0.8, 1.0):
        yr_line(f'L/S cap {cap} tv {tv}', run_ls(build(cap=cap, tv=tv, short_mult=1.0)))
print('=== dubbele kosten op L/S both x1')
yr_line('L/S kosten x2', run_ls(build(short_mult=1.0), cost=COST*2))
