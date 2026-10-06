"""Andere strategie-families, eerlijk vergeleken met de Agent (zelfde data, kosten, volatiliteitsdoel 60%, plafond 1,5x, 3 of 10 munten)."""
from lab import *
from ls import sim_ls, SHORT_FUND
C, H, L = load(); R = C.pct_change(fill_method=None).fillna(0.0); el = eligible(C)
V = pd.DataFrame({c: pd.read_csv(f'{DATA}/{c}_1d.csv.gz', index_col=0, parse_dates=True).qvol for c in COINS}).reindex(C.index)
COINS3 = ['BTC', 'ETH', 'SOL']
sma200 = C.rolling(200).mean()
def bcast(s): return pd.DataFrame(np.repeat(s.values[:, None], len(C.columns), 1), index=C.index, columns=C.columns)
GATE = ((C > sma200) & bcast(C['BTC'] > sma200['BTC'])).astype(float)
SC = vol_scale(R, 30, 0.6, 1.5)
def coins_w(sig, coins, scale=SC):
    m = el & C.columns.isin(coins); n = m.sum(axis=1).replace(0, np.nan)
    return (sig.where(m, 0.0).div(n, axis=0) * scale.where(m, 0.0)).fillna(0.0)
def run_ls(W, cost=COST):
    s0 = C.index.searchsorted(pd.Timestamp(START, tz='UTC'))
    return pd.Series(sim_ls(np.nan_to_num(R.values), np.nan_to_num(W.values), cost, FUND_DAY, SHORT_FUND, s0, 0.02), C.index)
def line(name, W, R_=R):
    e = run_ls(W); f = stats(e); i = stats(e, START, SPLIT); o = stats(e, SPLIT, END)
    t = trades_from_weights(W, R)
    print(f"{name:54s} {f['cagr']*100:6.1f}%/jr dd {f['mdd']*100:6.1f}% sh {f['sharpe']:.2f} | IS {i['cagr']*100:5.1f}% | OOS {o['cagr']*100:5.1f}% {o['mdd']*100:5.1f}% | trades {t.get('n',0):4d} win {t.get('winrate',0):.0%} | {f['jaren']}")

def state(up_cond, dn_cond):
    st = pd.DataFrame(np.nan, index=C.index, columns=C.columns); st[up_cond] = 1.0; st[dn_cond] = 0.0
    return st.ffill().fillna(0.0)

AGENT = trend_ensemble(C, (20, 50, 100), 0.02) * GATE
print('=== referentie'); line('Agent (ensemble 20/50/100 x poort)', coins_w(AGENT, COINS3))
print('=== 1. Uitbraak (Donchian / Turtle): in op hoogste slot van N dagen, uit op laagste van M dagen, met poort')
for n, m in ((20, 10), (55, 20), (100, 50), (20, 20)):
    hh = C.rolling(n).max().shift(1); ll = C.rolling(m).min().shift(1)
    line(f'Donchian {n}/{m}', coins_w(state(C > hh, C < ll) * GATE, COINS3))
    line(f'Donchian {n}/{m} zonder poort', coins_w(state(C > hh, C < ll), COINS3))
print('=== 2. Uitbraak met ATR-trailing exit (Turtle-stijl 3 ATR)')
pc = C.shift(1); tr = pd.concat([H - L, (H - pc).abs(), (L - pc).abs()]).groupby(level=0).max(); ATR = tr.ewm(alpha=1 / 14, adjust=False).mean()
for n in (20, 55):
    hh = C.rolling(n).max().shift(1); W = pd.DataFrame(0.0, index=C.index, columns=C.columns)
    for c in C.columns:
        pos = 0; ext = 0.0; w = np.zeros(len(C)); cv = C[c].values; hv = hh[c].values; av = ATR[c].values; gv = GATE[c].values
        for t in range(len(cv)):
            if pos and (cv[t] < ext - 3 * av[t] or gv[t] == 0): pos = 0
            if not pos and gv[t] == 1 and cv[t] > hv[t]: pos = 1; ext = cv[t]
            if pos: ext = max(ext, cv[t])
            w[t] = pos
        W[c] = w
    line(f'Donchian {n} + 3 ATR trailing', coins_w(W, COINS3))
print('=== 3. Weekcandles: trend op weekbasis (SMA 10/20/40 weken), beslissen op vrijdagslot')
Cw = C.resample('W-FRI').last()
for looks in ((10, 20, 40), (4, 13, 26)):
    sw = sum(((Cw > Cw.rolling(n).mean()).astype(float)) for n in looks) / len(looks)
    sigw = sw.reindex(C.index, method='ffill').fillna(0.0)
    line(f'weektrend {looks} x poort', coins_w(sigw * GATE, COINS3)); line(f'weektrend {looks} zonder poort', coins_w(sigw, COINS3))
print('=== 4. Sterkste-munt-rotatie: koop de 2 of 3 sterkste van 10 (rendement 28/56/90 dagen), alleen boven SMA200 + BTC-poort')
for look in (28, 56, 90):
    for k in (2, 3):
        mom = (C / C.shift(look) - 1).where(el & (GATE > 0)); rk = mom.rank(axis=1, ascending=False)
        pick = ((rk <= k) & mom.notna()).astype(float)
        W = (pick.div(k) * SC.where(el, 0.0)).fillna(0.0); line(f'rotatie top{k} {look}d', W)
print('=== 5. Volume-bevestiging: Agent-signaal alleen als volume boven 20-daags gemiddelde (anders halve inzet)')
vconf = (V > V.rolling(20).mean()).astype(float)
line('Agent x (0.5 + 0.5 volume)', coins_w(AGENT * (0.5 + 0.5 * vconf), COINS3))
line('Agent alleen bij volume', coins_w(AGENT * vconf, COINS3))
print('=== 6. Kortetermijnmomentum (7/14 dagen) long/short, met en zonder poort')
for look in (7, 14):
    mom = (C > C.shift(look)).astype(float)
    line(f'mom {look}d long x poort', coins_w(mom * GATE, COINS3)); line(f'mom {look}d long/short zonder poort', coins_w(2 * mom - 1, COINS3, SC * 0.7))
print('=== 7. Relatieve sterkte binnen BTC/ETH/SOL: Agent-inzet gekanteld naar de sterkste munt (56 dagen)')
rs = (C / C.shift(56) - 1); rk = rs[COINS3].rank(axis=1, ascending=False)
tilt = pd.DataFrame(1.0, index=C.index, columns=C.columns); tilt[COINS3] = rk.map(lambda r: {1: 1.5, 2: 1.0, 3: 0.5}.get(r, 1.0))
line('Agent x kanteling 1.5/1.0/0.5', coins_w(AGENT * tilt, COINS3))
print('=== 8. Bijkopen (pyramide): Agent-inzet + 50% extra bij nieuwe 50-daagse top')
newhigh = (C >= C.rolling(50).max()).astype(float)
line('Agent + pyramide op nieuwe top', coins_w(AGENT * (1 + 0.5 * newhigh), COINS3))
print('=== 9. Combinaties: gemiddelde van Agent en Donchian 55/20, en Agent + weektrend')
hh = C.rolling(55).max().shift(1); ll = C.rolling(20).min().shift(1); DON = state(C > hh, C < ll) * GATE
sw = sum(((Cw > Cw.rolling(n).mean()).astype(float)) for n in (10, 20, 40)) / 3; WK = sw.reindex(C.index, method='ffill').fillna(0.0) * GATE
line('0.5 Agent + 0.5 Donchian 55/20', coins_w(0.5 * AGENT + 0.5 * DON, COINS3))
line('0.5 Agent + 0.5 weektrend', coins_w(0.5 * AGENT + 0.5 * WK, COINS3))
line('1/3 Agent + 1/3 Donchian + 1/3 weektrend', coins_w((AGENT + DON + WK) / 3, COINS3))
print('=== 10. Zelfde families op 10 munten')
line('Agent 10 munten', coins_w(AGENT, COINS)); line('Donchian 55/20 10 munten', coins_w(DON, COINS)); line('weektrend 10 munten', coins_w(WK, COINS))
