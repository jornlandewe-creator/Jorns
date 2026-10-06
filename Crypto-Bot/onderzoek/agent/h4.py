"""Snellere agent op 4-uursdata: zelfde poort (dag-SMA200 BTC en munt), ensemble en volatiliteitsdoel op 4h-bars. Plus combinatie dag + 4h."""
from lab import *
from ls import sim_ls, SHORT_FUND
COINS3 = ['BTC', 'ETH', 'SOL']
C4, H4, L4 = load('4h'); C4 = C4[COINS3]; R4 = C4.pct_change(fill_method=None).fillna(0.0)
BPD = 6
def bcast(s, cols): return pd.DataFrame(np.repeat(s.values[:, None], len(cols), 1), index=s.index, columns=cols).astype(float)
# dagslot-reeks op 4h-index: SMA200 van dagsloten, alleen bekend na het dagslot (ffill)
D = C4.resample('1D').last(); D200 = D.rolling(200).mean(); Dhist = (D.notna().cumsum() >= 200)
gate_day = ((D > D200) & Dhist).astype(float)
gate_day = gate_day.shift(1)                      # dag t is pas bekend na het slot van dag t -> geldt vanaf dag t+1
g4 = gate_day.reindex(C4.index, method='ffill').fillna(0.0)
g4 = g4.mul(g4['BTC'], axis=0)                    # BTC én munt
el4 = (C4.notna().cumsum() >= 200 * BPD) & C4.notna()

def run4(W, cost=COST, thresh=0.02, fund=FUND_DAY / BPD):
    s0 = C4.index.searchsorted(pd.Timestamp(START, tz='UTC'))
    return pd.Series(sim_ls(np.nan_to_num(R4.values), np.nan_to_num(W.values), cost, fund, 0.0, s0, thresh), C4.index)

def stats4(e, a=START, b=END):
    e = e[(e.index >= a) & (e.index < b)]; e = e / e.iloc[0]; d = e.resample('1D').last().dropna()
    r = d.pct_change().dropna(); y = (d.index[-1] - d.index[0]).days / 365.25
    yrs = {int(k): round((g.iloc[-1] / g.iloc[0] - 1) * 100) for k, g in d.groupby(d.index.year)}
    return dict(cagr=d.iloc[-1] ** (1 / y) - 1, mdd=(d / d.cummax() - 1).min(), sharpe=r.mean() / r.std() * np.sqrt(365), jaren=yrs)

def line(name, e):
    f = stats4(e); i = stats4(e, START, SPLIT); o = stats4(e, SPLIT, END)
    print(f"{name:52s} {f['cagr']*100:6.1f}%/jr dd {f['mdd']*100:6.1f}% sh {f['sharpe']:.2f} | IS {i['cagr']*100:5.1f}% {i['mdd']*100:5.1f}% | OOS {o['cagr']*100:5.1f}% {o['mdd']*100:5.1f}% | {f['jaren']}")

def ens4(looks_days, band):
    return sum(trend_sma(C4, int(n * BPD), band) for n in looks_days) / len(looks_days)
def vol4(n_days, tv, cap):
    v = R4.rolling(int(n_days * BPD)).std() * np.sqrt(365 * BPD); return (tv / v).clip(upper=cap)
def W4(looks, band, tv=0.6, cap=1.5, voln=30):
    sig = ens4(looks, band) * g4; n = el4.sum(axis=1).replace(0, np.nan)
    return (sig.where(el4, 0.0).div(n, axis=0) * vol4(voln, tv, cap).where(el4, 0.0)).fillna(0.0)

print('=== 4h-agent (beslissen elke 4 uur), poort op dag-SMA200')
for looks in ((20, 50, 100), (10, 25, 50), (5, 10, 20), (3, 7, 14)):
    for band in (0.01, 0.02, 0.03):
        for thresh in (0.02, 0.05):
            line(f'4h looks {looks}d band {band} drempel {thresh}', run4(W4(looks, band), thresh=thresh))
print('=== dag-agent op 4h-grid (referentie, zelfde kostenmodel)')
# dag-agent: dezelfde gewichten als lab, maar herbemonsterd op 4h (beslissing na dagslot, vast tot volgende dagslot)
Cd = D[COINS3]; Rd = Cd.pct_change(fill_method=None).fillna(0.0)
sigd = trend_ensemble(Cd, (20, 50, 100), 0.02) * ((Cd > D200) & Dhist).astype(float).mul(((Cd['BTC'] > D200['BTC']) & Dhist['BTC']).astype(float), axis=0)
eld = (Cd.notna().cumsum() >= 200) & Cd.notna(); nd = eld.sum(axis=1).replace(0, np.nan)
vd = (0.6 / (Rd.rolling(30).std() * np.sqrt(365))).clip(upper=1.5)
Wd = (sigd.where(eld, 0.0).div(nd, axis=0) * vd.where(eld, 0.0)).fillna(0.0)
Wd4 = Wd.shift(1).reindex(C4.index, method='ffill').fillna(0.0)
ed = run4(Wd4); line('dag-agent (op 4h-grid)', ed)
print('=== combinatie: helft dag-agent + helft 4h-agent')
for looks in ((10, 25, 50), (5, 10, 20)):
    for band in (0.02, 0.03):
        Wc = 0.5 * Wd4 + 0.5 * W4(looks, band); line(f'combi dag + 4h {looks}d band {band}', run4(Wc, thresh=0.03))
