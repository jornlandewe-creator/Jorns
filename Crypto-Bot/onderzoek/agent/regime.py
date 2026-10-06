"""Regime-agent: per dag per munt een regime (up / down / chop / crisis) en per regime een specialist.
up: trend-long (Agent). down: trend-short (Agent L/S). chop: dips kopen / pieken shorten (mean reversion). crisis: cash."""
from lab import *
from ls import sim_ls, SHORT_FUND
C, H, L = load(); R = C.pct_change(fill_method=None).fillna(0.0); el = eligible(C)
COINS3 = ['BTC', 'ETH', 'SOL']

def rsi(c, n):
    d = c.diff(); g = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean(); l = (-d).clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    return 100 - 100 / (1 + g / l.replace(0, 1e-12))
def atr(n=14):
    pc = C.shift(1); tr = pd.concat([H - L, (H - pc).abs(), (L - pc).abs()]).groupby(level=0).max()
    return tr.ewm(alpha=1 / n, adjust=False).mean()
def bcast(s): return pd.DataFrame(np.repeat(s.values[:, None], len(C.columns), 1), index=C.index, columns=C.columns)

def regimes(crisis_vol=1.2, chop_er=0.25, er_n=60):
    sma = C.rolling(200).mean(); btc_up = bcast(C['BTC'] > sma['BTC']); coin_up = C > sma
    btc_fall = bcast(sma['BTC'] < sma['BTC'].shift(20))
    vol = R.rolling(30).std() * np.sqrt(365)
    er = (C - C.shift(er_n)).abs() / C.diff().abs().rolling(er_n).sum()      # efficiency ratio: trend-kwaliteit 0..1
    up = btc_up & coin_up; down = (~btc_up) & (~coin_up) & btc_fall
    crisis = vol > crisis_vol
    chop = (~up & ~down) | (er < chop_er)
    return dict(up=up & ~crisis, down=down & ~crisis, chop=chop & ~crisis & ~(up & (er >= chop_er)) & ~(down & (er >= chop_er)), crisis=crisis, er=er, vol=vol)

def trend_weights(reg, tv=0.6, cap=1.5, short_mult=0.5):
    fast_up = trend_ensemble(C, (20, 50, 100), 0.02)
    ma = {n: C.rolling(n).mean() for n in (20, 50, 100)}
    st = {n: pd.DataFrame(np.nan, index=C.index, columns=C.columns) for n in ma}
    for n in ma: st[n][C < ma[n] * 0.98] = 1.0; st[n][C > ma[n] * 1.02] = 0.0
    fast_dn = sum(s.ffill().fillna(0.0) for s in st.values()) / 3
    sc = vol_scale(R, 30, tv, cap)
    WL = fast_up.where(reg['up'], 0.0) * sc; WS = -short_mult * fast_dn.where(reg['down'], 0.0) * sc
    return WL.fillna(0.0), WS.fillna(0.0)

def mr_weights(reg, lo=15, hi=85, k_atr=1.0, hold=7, size=0.5, cap=1.0, both=True):
    """Mean reversion in chop: long als RSI3 < lo en slot < SMA10 - k ATR; short als RSI3 > hi en slot > SMA10 + k ATR.
    Uit: slot terug over SMA10, of na 'hold' dagen. Grootte = size / vol (plafond cap). Trade-telling voor winrate."""
    r3 = rsi(C, 3); s10 = C.rolling(10).mean(); a = atr(14); vol = R.rolling(30).std() * np.sqrt(365)
    sc = (size / vol).clip(upper=cap).fillna(0.0)
    le = (r3 < lo) & (C < s10 - k_atr * a); se = (r3 > hi) & (C > s10 + k_atr * a) if both else (C != C)
    lx = C > s10; sx = C < s10
    W = pd.DataFrame(0.0, index=C.index, columns=C.columns); trades = []
    for c in C.columns:
        pos = 0; days = 0; ent = 0.0; w = np.zeros(len(C)); cv = C[c].values; ok = reg['chop'][c].values
        lev_ = le[c].values; sev = se[c].values; lxv = lx[c].values; sxv = sx[c].values; scv = sc[c].values; elv = el[c].values
        for t in range(len(cv)):
            if pos != 0:
                days += 1
                if (pos == 1 and lxv[t]) or (pos == -1 and sxv[t]) or days >= hold or not elv[t]:
                    trades.append(pos * (cv[t] / ent - 1) - 2 * COST); pos = 0
            if pos == 0 and ok[t] and elv[t]:
                if lev_[t]: pos = 1; ent = cv[t]; days = 0
                elif sev[t]: pos = -1; ent = cv[t]; days = 0
            w[t] = pos * scv[t] if pos else 0.0
        W[c] = w
    return W.fillna(0.0), np.array(trades)

def coins_w(W, coins):
    m = el & C.columns.isin(coins); n = m.sum(axis=1).replace(0, np.nan)
    return W.where(m, 0.0).div(n, axis=0).fillna(0.0)

def run_ls(W, cost=COST):
    s0 = C.index.searchsorted(pd.Timestamp(START, tz='UTC'))
    return pd.Series(sim_ls(np.nan_to_num(R.values), np.nan_to_num(W.values), cost, FUND_DAY, SHORT_FUND, s0, 0.02), C.index)

def line(name, e, tr=None):
    f = stats(e); i = stats(e, START, SPLIT); o = stats(e, SPLIT, END); yrs = f['jaren']
    s = f"{name:50s} {f['cagr']*100:6.1f}%/jr dd {f['mdd']*100:6.1f}% sh {f['sharpe']:.2f} | IS {i['cagr']*100:5.1f}% | OOS {o['cagr']*100:5.1f}% {o['mdd']*100:5.1f}% | mnd+ {f['pos_m']:.0%} | {yrs}"
    if tr is not None and len(tr): s += f" | MR-trades {len(tr)} win {(tr > 0).mean():.0%} gem {tr.mean()*100:+.2f}%"
    print(s)

if __name__ == '__main__':
    reg = regimes()
    for coins in (COINS3, COINS):
        tag = 'BTC+ETH+SOL' if len(coins) == 3 else '10 munten'
        m = el & C.columns.isin(coins)
        tot = m.sum().sum()
        print(f'=== {tag}: dagen per regime: ' + ', '.join(f'{k} {(reg[k] & m).sum().sum() / tot:.0%}' for k in ('up', 'down', 'chop', 'crisis')))
    WL, WS = trend_weights(reg)
    print('=== specialisten apart (BTC+ETH+SOL)')
    line('trend long (up)', run_ls(coins_w(WL, COINS3)))
    line('trend short (down)', run_ls(coins_w(WS, COINS3)))
    line('trend long + short', run_ls(coins_w(WL + WS, COINS3)))
    for lo, hi, k, hold, size in [(15, 85, 1.0, 7, 0.5), (10, 90, 1.0, 7, 0.5), (20, 80, 0.5, 5, 0.5), (15, 85, 1.0, 7, 0.3), (15, 85, 0.0, 10, 0.5), (25, 75, 0.0, 5, 0.5)]:
        for both in (True, False):
            WM, tr = mr_weights(reg, lo, hi, k, hold, size, both=both)
            line(f'MR chop lo{lo} hi{hi} k{k} hold{hold} size{size} {"L/S" if both else "long"}', run_ls(coins_w(WM, COINS3)), tr)
            if lo == 15 and hi == 85 and k == 1.0 and hold == 7 and size == 0.5:
                line(f'   REGIME-AGENT = trend L/S + MR {"L/S" if both else "long"}', run_ls(coins_w(WL + WS + WM, COINS3)), tr)
    print('=== MR op 10 munten (meer kansen in chop)')
    for both in (True, False):
        WM, tr = mr_weights(reg, 15, 85, 1.0, 7, 0.5, both=both)
        line(f'MR chop 10 munten {"L/S" if both else "long"}', run_ls(coins_w(WM, COINS)), tr)
        line(f'   REGIME-AGENT 3 munten trend + MR op 10 munten', run_ls(coins_w(WL + WS, COINS3) + coins_w(WM, COINS)), tr)
    print('=== crisis-drempel (beweeglijkheid > x -> cash)')
    for cv in (0.9, 1.2, 1.5, 9.9):
        reg2 = regimes(crisis_vol=cv); WL2, WS2 = trend_weights(reg2); WM2, tr2 = mr_weights(reg2)
        line(f'regime-agent crisis>{cv}', run_ls(coins_w(WL2 + WS2 + WM2, COINS3)), tr2)
