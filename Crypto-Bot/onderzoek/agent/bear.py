from stable import *
def build2(short_mult=0.25, fall_n=20, short_gate_n=200, short_looks=(20,50,100)):
    sma_s = C.rolling(short_gate_n).mean(); fall = bcast(sma_s['BTC'] < sma_s['BTC'].shift(fall_n)) if fall_n else True
    down = (C < sma_s) & bcast(C['BTC'] < sma_s['BTC']) & fall
    st = {}
    for n in short_looks:
        ma = C.rolling(n).mean(); s = pd.DataFrame(np.nan, index=C.index, columns=C.columns); s[C < ma * 0.98] = 1.0; s[C > ma * 1.02] = 0.0; st[n] = s.ffill().fillna(0.0)
    fdn = sum(st.values()) / len(st)
    sc = vol_scale(R, 30, 0.6, 1.5)
    long_sig = (0.5 * trend_ensemble(C, (20, 50, 100), 0.02) + 0.5 * don()) * GATE * tilt_sig() * pyr_sig()
    W = (long_sig * sc).clip(upper=1.5) - short_mult * fdn.where(down, 0.0) * sc
    m = el & C.columns.isin(COINS3); n = m.sum(axis=1).replace(0, np.nan); return W.where(m, 0.0).div(n, axis=0).fillna(0.0)
def line3(name, W):
    e = run_ls(W); f = stats(e); o = stats(e, SPLIT, END); b1 = stats(e, '2025-10-01', '2026-07-02'); b2 = stats(e, '2026-02-01', '2026-07-02')
    print(f"{name:44s} {f['cagr']*100:6.1f}%/jr dd {f['mdd']*100:6.1f}% CALMAR {f['calmar']:.2f} | OOS {o['cagr']*100:5.1f}% {o['mdd']*100:5.1f}% | bear okt25-jul26 {(np.prod([1]) and (e.loc['2026-07-01']/e.loc['2025-10-01']-1))*100:+.0f}% | feb-jul26 {(e.loc['2026-07-01']/e.loc['2026-02-01']-1)*100:+.0f}% | 2022 {f['jaren'].get(2022)} 2018 {f['jaren'].get(2018)}")
print('=== short-grootte, bevestiging (SMA200 daalt over N dagen) en short-poort (SMA150/200)')
for sm in (0.25, 0.5, 1.0):
    for fall_n in (0, 10, 20):
        line3(f'short x{sm} bevestiging {fall_n}d', build2(sm, fall_n))
for gn in (150, 100):
    for sm in (0.25, 0.5):
        line3(f'short x{sm} poort SMA{gn} bevestiging 20d', build2(sm, 20, gn))
line3('short x0.5 trage gemiddelden 50/100/200', build2(0.5, 20, 200, (50, 100, 200)))
