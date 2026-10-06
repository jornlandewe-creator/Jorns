"""Stabiel: hoogste rendement per eenheid daling (Calmar). Combinaties van Agent plus, Donchian, shorts, volatiliteitsdoel, ATR-crash-exit."""
from other import *
from ls import sim_ls, SHORT_FUND
pc = C.shift(1); tr_ = pd.concat([H - L, (H - pc).abs(), (L - pc).abs()]).groupby(level=0).max(); ATR = tr_.ewm(alpha=1 / 14, adjust=False).mean()
sma = C.rolling(200).mean(); btc_fall = bcast(sma['BTC'] < sma['BTC'].shift(20))
DOWN = ((C < sma) & bcast(C['BTC'] < sma['BTC']) & btc_fall)
def fast_dn():
    st = {}
    for n in (20, 50, 100):
        ma = C.rolling(n).mean(); s = pd.DataFrame(np.nan, index=C.index, columns=C.columns); s[C < ma * 0.98] = 1.0; s[C > ma * 1.02] = 0.0; st[n] = s.ffill().fillna(0.0)
    return sum(st.values()) / 3
FDN = fast_dn()
def tilt_sig(look=56, hi=1.25, lo=0.75):
    rs = (C / C.shift(look) - 1); rk = rs[COINS3].rank(axis=1, ascending=False)
    t = pd.DataFrame(1.0, index=C.index, columns=C.columns); t[COINS3] = rk.map(lambda r: {1: hi, 2: 1.0, 3: lo}.get(r, 1.0)); return t
def pyr_sig(look=50, extra=0.25): return 1 + extra * (C >= C.rolling(look).max()).astype(float)
def don(n=55, m=20):
    hh = C.rolling(n).max().shift(1); ll = C.rolling(m).min().shift(1); return state(C > hh, C < ll)
def crash_exit(k=3.0, look=20):
    """1 zolang slot boven (hoogste slot van look dagen - k ATR), anders 0 (snelle uitstap bij een scherpe val)."""
    return (C > C.rolling(look).max() - k * ATR).astype(float)
def build(mix=0.5, tv=0.6, cap=1.5, shorts=True, short_mult=0.5, plus=True, crash=None, dd_brake=None):
    sc = vol_scale(R, 30, tv, cap)
    long_sig = (1 - mix) * trend_ensemble(C, (20, 50, 100), 0.02) + mix * don()
    long_sig = long_sig * GATE
    if plus: long_sig = long_sig * tilt_sig() * pyr_sig()
    if crash is not None: long_sig = long_sig * crash_exit(*crash)
    W = (long_sig * sc).clip(upper=cap)
    if shorts: W = W - short_mult * FDN.where(DOWN, 0.0) * sc
    m = el & C.columns.isin(COINS3); n = m.sum(axis=1).replace(0, np.nan); W = W.where(m, 0.0).div(n, axis=0).fillna(0.0)
    if dd_brake: W = W.mul(dd_control(run_ls(W), dd_brake), axis=0)
    return W
def line2(name, W):
    e = run_ls(W); f = stats(e); i = stats(e, START, SPLIT); o = stats(e, SPLIT, END); r = stats(e, '2024-03-01', END)
    print(f"{name:48s} {f['cagr']*100:6.1f}%/jr dd {f['mdd']*100:6.1f}% CALMAR {f['calmar']:.2f} sh {f['sharpe']:.2f} worst mnd {f['worst_m']*100:.0f}% | OOS {o['cagr']*100:5.1f}% {o['mdd']*100:5.1f}% | sinds 2024-03 {r['cagr']*100:5.1f}% {r['mdd']*100:5.1f}% | {f['jaren']}")
print('=== referenties')
line2('Agent plus (huidig standaard)', build(mix=0.0)); line2('Agent long/short', build(mix=0.0, plus=False)); line2('Agent long-only', build(mix=0.0, plus=False, shorts=False))
print('=== mix Agent/Donchian (long) + shorts + plus')
for mix in (0.3, 0.5, 0.7, 1.0):
    for plus in (True, False):
        line2(f'mix {mix:.0%} Donchian, plus {plus}', build(mix=mix, plus=plus))
print('=== volatiliteitsdoel lager (0.5 / 0.45) op mix 50%')
for tv in (0.5, 0.45, 0.4):
    line2(f'mix 50% tv {tv}', build(mix=0.5, tv=tv)); line2(f'mix 50% tv {tv} zonder shorts', build(mix=0.5, tv=tv, shorts=False))
print('=== crash-exit (uit als slot < hoogste slot van 20d - k ATR) op mix 50%')
for k in (2.0, 3.0, 4.0):
    for look in (10, 20):
        line2(f'mix 50% crash-exit {k} ATR / {look}d', build(mix=0.5, crash=(k, look)))
print('=== drawdown-rem op mix 50%')
for lv in [((0.12, 0.5),), ((0.15, 0.5),), ((0.15, 0.5), (0.25, 0.25))]:
    line2(f'mix 50% ddrem {lv}', build(mix=0.5, dd_brake=lv))
print('=== shorts kleiner/groter op mix 50%')
for sm in (0.25, 0.5, 0.75):
    line2(f'mix 50% short x{sm}', build(mix=0.5, short_mult=sm))
print('=== buurinstellingen Donchian in de mix (45/15, 55/20, 70/25, 100/30)')
for n, m_ in ((45, 15), (70, 25), (100, 30)):
    hh = C.rolling(n).max().shift(1); ll = C.rolling(m_).min().shift(1); D2 = state(C > hh, C < ll)
    sc = vol_scale(R, 30, 0.6, 1.5); ls_ = (0.5 * trend_ensemble(C, (20, 50, 100), 0.02) + 0.5 * D2) * GATE * tilt_sig() * pyr_sig()
    W = (ls_ * sc).clip(upper=1.5) - 0.5 * FDN.where(DOWN, 0.0) * sc; mm = el & C.columns.isin(COINS3); nn = mm.sum(axis=1).replace(0, np.nan)
    line2(f'mix 50% Donchian {n}/{m_}', W.where(mm, 0.0).div(nn, axis=0).fillna(0.0))
