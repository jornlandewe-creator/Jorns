"""Trade-niveau onderzoek: hoe hoog kan de winrate met deelwinst op +k ATR + break-even stop, en wat kost dat?
Dagdata, per munt (BTC/ETH/SOL) een eigen deelaccount; portefeuille = gemiddelde van de drie curves.
Instap alleen als BTC en munt boven SMA200 (de Agent-poort). Kosten 0,08% per kant. Stops intrabar (conservatief: stop voor TP)."""
import sys, os, itertools
import numpy as np, pandas as pd
from numba import njit
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lab import load, stats, START, SPLIT, END, COST

C, H, L = load()
R = C.pct_change(fill_method=None).fillna(0.0)
COINS3 = ['BTC', 'ETH', 'SOL']


def atr(h, l, c, n=14):
    pc = np.r_[c[0], c[:-1]]; tr = np.maximum(h - l, np.maximum(np.abs(h - pc), np.abs(l - pc)))
    return pd.Series(tr).ewm(alpha=1 / n, adjust=False).mean().values


def rsi(c, n):
    d = np.r_[0, np.diff(c)]; g = pd.Series(np.maximum(d, 0)).ewm(alpha=1 / n, adjust=False).mean().values
    ls = pd.Series(np.maximum(-d, 0)).ewm(alpha=1 / n, adjust=False).mean().values
    return 100 - 100 / (1 + g / np.maximum(ls, 1e-12))


@njit(cache=True)
def sim(o, h, l, c, a, entry, exit_sig, gate, size, sl_atr, tp1_atr, tp1_frac, be_after_tp1, trail_atr, tp2_atr, max_bars, cost, start):
    """size: doelblootstelling (0..cap) per dag. Instap op close van signaaldag (zoals de agent: beslissen na dagslot, uitvoeren tegen slot).
    Exits: stop (intrabar), TP1 deel (intrabar), TP2 rest (intrabar), trailing (chandelier), exit-signaal (close), tijdstop.
    Retourneert equity en trade-resultaten (in % van de instapwaarde van de hele positie)."""
    n = len(c); eq = np.ones(n); cash = 1.0; pos = 0; qty = 0.0; q0 = 0.0; entry_px = 0.0; sl = 0.0; tp1 = 0.0; tp2 = 0.0
    hit1 = False; ext = 0.0; realized = 0.0; ei = 0
    tr = np.zeros(n); nt = 0
    for i in range(start, n):
        if pos == 1:
            # intrabar: stop eerst (conservatief), dan TP
            done = False
            if l[i] <= sl:
                px = min(o[i], sl); pnl = qty * (px - entry_px) - cost * qty * px; cash += pnl; realized += pnl
                tr[nt] = realized / (q0 * entry_px); nt += 1; pos = 0; qty = 0.0; done = True
            if not done and not hit1 and tp1_atr > 0 and h[i] >= tp1:
                px = max(o[i], tp1); q = qty * tp1_frac; pnl = q * (px - entry_px) - cost * q * px; cash += pnl; realized += pnl; qty -= q; hit1 = True
                if be_after_tp1: sl = max(sl, entry_px * 1.002)
                if qty <= 1e-12:
                    tr[nt] = realized / (q0 * entry_px); nt += 1; pos = 0; qty = 0.0; done = True
            if not done and tp2_atr > 0 and h[i] >= tp2:
                px = max(o[i], tp2); pnl = qty * (px - entry_px) - cost * qty * px; cash += pnl; realized += pnl
                tr[nt] = realized / (q0 * entry_px); nt += 1; pos = 0; qty = 0.0; done = True
            if not done:
                if trail_atr > 0:
                    ext = max(ext, h[i]); sl = max(sl, ext - trail_atr * a[i])
                if exit_sig[i] or gate[i] == 0 or (max_bars > 0 and i - ei >= max_bars):
                    px = c[i]; pnl = qty * (px - entry_px) - cost * qty * px; cash += pnl; realized += pnl
                    tr[nt] = realized / (q0 * entry_px); nt += 1; pos = 0; qty = 0.0
        if pos == 0 and entry[i] and gate[i] == 1 and size[i] > 0 and a[i] > 0:
            px = c[i]; notional = cash * size[i]; qty = notional / px; q0 = qty; cash -= cost * notional
            entry_px = px; pos = 1; sl = px - sl_atr * a[i] if sl_atr > 0 else 0.0
            tp1 = px + tp1_atr * a[i]; tp2 = px + tp2_atr * a[i] if tp2_atr > 0 else 1e18; hit1 = False; ext = px; realized = 0.0; ei = i
        eq[i] = cash + (qty * (c[i] - entry_px) if pos == 1 else 0.0)
    for k in range(start): eq[k] = 1.0
    return eq, tr[:nt]


def signals(coin, kind, p):
    c = C[coin].values; h = H[coin].values; l = L[coin].values; o = np.r_[c[0], c[:-1]]
    a = atr(h, l, c, 14)
    s = pd.Series(c); sma = lambda n: s.rolling(n).mean().values
    gate = ((c > sma(200)) & (C['BTC'].values > pd.Series(C['BTC'].values).rolling(200).mean().values) & (pd.Series(c).notna().cumsum().values >= 200)).astype(np.int8)
    band = 0.02
    above20 = c > sma(20) * (1 + band); above50 = c > sma(50) * (1 + band)
    below20 = c < sma(20) * (1 - band); below50 = c < sma(50) * (1 - band)
    r3 = rsi(c, 3); r14 = rsi(c, 14)
    if kind == 'trend':         # koers komt boven SMA20 (band) terwijl ook boven SMA50: trendinstap
        entry = above20 & above50 & ~np.r_[False, (above20 & above50)[:-1]]
        exit_sig = below50
    elif kind == 'trend_any':   # elke dag dat de trend aan is (herinstap na stop)
        entry = above20 & above50; exit_sig = below50
    elif kind == 'dip':         # dip in stijgende munt: RSI(3) < lo, koers onder SMA10
        entry = (r3 < p['lo']) & (c < sma(10)); exit_sig = r3 > 70
    elif kind == 'dip_atr':     # slot meer dan k ATR onder SMA10
        entry = (c < sma(10) - p['k'] * a); exit_sig = c > sma(10)
    elif kind == 'breakout':    # hoogste slot van 20 dagen
        hh = s.rolling(20).max().shift(1).values; entry = c > hh; exit_sig = below20
    else: raise ValueError(kind)
    vol = R[coin].rolling(30).std().values * np.sqrt(365)
    size = np.clip(p['tv'] / np.where(vol > 0, vol, np.nan), 0, p['cap']); size = np.nan_to_num(size)
    return o, h, l, c, a, np.nan_to_num(entry).astype(np.bool_), np.nan_to_num(exit_sig).astype(np.bool_), gate, size


def run(kind, p, sl=2.0, tp1=1.0, frac=0.5, be=True, trail=0.0, tp2=0.0, max_bars=0):
    idx = C.index; s0 = idx.searchsorted(pd.Timestamp(START, tz='UTC'))
    curves = []; trades = []
    for coin in COINS3:
        o, h, l, c, a, e, x, g, sz = signals(coin, kind, p)
        ok = ~np.isnan(c); c2 = np.where(ok, c, 1.0)
        eq, tr = sim(np.where(ok, o, 1.0), np.where(ok, h, 1.0), np.where(ok, l, 1.0), c2, np.nan_to_num(a), e, x, g, sz, sl, tp1, frac, be, trail, tp2, max_bars, COST, s0)
        curves.append(pd.Series(eq, idx)); trades.append(tr)
    # portefeuille: elke munt 1/3 zodra hij genoeg historie heeft (SOL vanaf 2021) -> dagelijks gemiddeld rendement van de munten die meedoen
    rets = pd.concat([cv.pct_change().fillna(0) for cv in curves], axis=1); rets.columns = COINS3
    elig = pd.concat([(C[c].notna().cumsum() >= 200) for c in COINS3], axis=1); elig.columns = COINS3
    pr = rets.where(elig, 0).sum(axis=1) / elig.sum(axis=1).replace(0, 1)
    port = (1 + pr).cumprod()
    tr = np.concatenate(trades)
    return port, tr


def line(name, port, tr):
    f = stats(port); i = stats(port, START, SPLIT); oo = stats(port, SPLIT, END)
    w = (tr > 0).mean() if len(tr) else 0
    aw = tr[tr > 0].mean() * 100 if (tr > 0).any() else 0; al = tr[tr <= 0].mean() * 100 if (tr <= 0).any() else 0
    pf = tr[tr > 0].sum() / -tr[tr <= 0].sum() if (tr <= 0).any() else 99
    print(f"{name:52s} {f['cagr']*100:6.1f}%/jr dd {f['mdd']*100:6.1f}% sh {f['sharpe']:.2f} | IS {i['cagr']*100:5.1f}% {i['mdd']*100:5.1f}% | OOS {oo['cagr']*100:5.1f}% {oo['mdd']*100:5.1f}% | "
          f"trades {len(tr):4d} WIN {w*100:3.0f}% w/l {aw:+.1f}/{al:.1f} pf {pf:.1f} | {f['jaren']}")
    return dict(name=name, cagr=f['cagr'], mdd=f['mdd'], sharpe=f['sharpe'], oos=oo['cagr'], oosdd=oo['mdd'], n=len(tr), win=w, pf=pf, aw=aw, al=al)


if __name__ == '__main__':
    base = dict(tv=0.6, cap=1.5, lo=20, k=1.0)
    print('=== TREND-INSTAP met deelwinst op +k ATR en break-even (stop 2 ATR, uit onder SMA50)')
    port, tr = run('trend_any', base, sl=2.0, tp1=0, frac=0, be=False); line('trend: geen TP (referentie)', port, tr)
    for tp1 in (0.5, 1.0, 1.5, 2.0):
        for frac in (0.33, 0.5, 0.7):
            for trail in (0.0, 3.0):
                port, tr = run('trend_any', base, sl=2.0, tp1=tp1, frac=frac, be=True, trail=trail); line(f'trend: TP1 +{tp1}ATR {frac:.0%} BE trail {trail}', port, tr)
    print('\n=== TREND: alles eruit op +k ATR (geen deel)')
    for tp in (1.0, 2.0, 3.0):
        for sl in (1.0, 2.0, 3.0):
            port, tr = run('trend_any', base, sl=sl, tp1=tp, frac=1.0, be=False); line(f'trend: TP +{tp}ATR alles, stop {sl}ATR', port, tr)
    print('\n=== DIP-INSTAP in stijgende munt (RSI3 < lo), uit bij RSI3 > 70')
    for lo in (10, 20, 30):
        for sl in (2.0, 3.0, 0.0):
            for tp1 in (0.0, 1.0):
                p = dict(base, lo=lo); port, tr = run('dip', p, sl=sl, tp1=tp1, frac=0.5, be=tp1 > 0, max_bars=10); line(f'dip RSI3<{lo} stop {sl} TP1 {tp1} max 10d', port, tr)
    print('\n=== DIP-INSTAP k ATR onder SMA10, uit boven SMA10')
    for k in (0.5, 1.0, 1.5):
        for sl in (2.0, 3.0):
            p = dict(base, k=k); port, tr = run('dip_atr', p, sl=sl, tp1=0, frac=0, be=False, max_bars=10); line(f'dip {k}ATR<SMA10 stop {sl} max 10d', port, tr)
    print('\n=== UITBRAAK 20 dagen met deelwinst')
    for tp1 in (1.0, 2.0):
        port, tr = run('breakout', base, sl=2.0, tp1=tp1, frac=0.5, be=True, trail=3.0); line(f'breakout TP1 +{tp1} 50% BE trail 3', port, tr)
