"""Hefboomknop op Agent stabiel: factor f schaalt volatiliteitsdoel en plafond samen (f = hefboom / 1,5)."""
from bear import *
print('=== hefboom (plafond) op Agent stabiel; inzet schaalt mee')
for lev in (5.0, 6.0):
    f = lev / 1.5
    sc = vol_scale(R, 30, 0.6 * f, lev)
    sma_s = C.rolling(200).mean(); fall = bcast(sma_s['BTC'] < sma_s['BTC'].shift(20)); down = (C < sma_s) & bcast(C['BTC'] < sma_s['BTC']) & fall
    st = {}
    for n in (20, 50, 100):
        ma = C.rolling(n).mean(); s = pd.DataFrame(np.nan, index=C.index, columns=C.columns); s[C < ma * 0.98] = 1.0; s[C > ma * 1.02] = 0.0; st[n] = s.ffill().fillna(0.0)
    fdn = sum(st.values()) / 3
    long_sig = (0.5 * trend_ensemble(C, (20, 50, 100), 0.02) + 0.5 * don()) * GATE * tilt_sig() * pyr_sig()
    W = (long_sig * sc).clip(upper=lev) - 0.25 * fdn.where(down, 0.0) * sc
    m = el & C.columns.isin(COINS3); n = m.sum(axis=1).replace(0, np.nan); W = W.where(m, 0.0).div(n, axis=0).fillna(0.0)
    e = run_ls(W); f_ = stats(e); o = stats(e, SPLIT, END); r = stats(e, '2024-03-01', END)
    print(f"hefboom {lev:.2f}x: {f_['cagr']*100:6.1f}%/jr dd {f_['mdd']*100:6.1f}% calmar {f_['calmar']:.2f} worst mnd {f_['worst_m']*100:.0f}% | OOS {o['cagr']*100:5.1f}% {o['mdd']*100:5.1f}% | sinds 2024-03 {r['cagr']*100:5.1f}% {r['mdd']*100:5.1f}% | {f_['jaren']}")
