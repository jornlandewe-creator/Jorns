"""Strategiebibliotheek: 20 families, trend-following en mean reversion.
Elke functie: f(d, p) -> (long, short, exit_long, exit_short). Short is het spiegelbeeld.
"""
import numpy as np, pandas as pd
from engine import ema, rma, atr, adx, macd_hist, rsi, supertrend_dir, rolling_max, rolling_min

S = lambda x: pd.Series(x)
def sma(x, n): return S(x).rolling(n).mean().values
def std(x, n): return S(x).rolling(n).std().values
def shift(x, k=1):
    if np.isscalar(x): return x
    return np.r_[np.full(k, np.nan), x[:-k]]
def cross_up(a, b): return (a > b) & (shift(a) <= shift(b))
def cross_dn(a, b): return (a < b) & (shift(a) >= shift(b))
def trig(x): return x & ~np.r_[False, x[:-1]]
def wma(x, n):
    w = np.arange(1, n + 1)
    return S(x).rolling(n).apply(lambda v: (v * w).sum() / w.sum(), raw=True).values
def hma(x, n): return wma(2 * wma(x, n // 2) - wma(x, n), int(np.sqrt(n)))
def stoch(h, l, c, n):
    hh = S(h).rolling(n).max().values; ll = S(l).rolling(n).min().values
    return 100 * (c - ll) / np.maximum(hh - ll, 1e-9)
def trend_ok(c, n):
    if n == 0: return np.ones(len(c), bool), np.ones(len(c), bool)
    t = sma(c, n); return c > t, c < t

# ------------------------------------------------------------ mean reversion

def rsi_mr(d, p):                 # RSI oversold in uptrend, exit bij herstel
    o, h, l, c, v = d; r = rsi(c, p['n']); up, dn = trend_ok(c, p['tf'])
    return (r < p['lo']) & up, (r > 100 - p['lo']) & dn, r > p['exit'], r < 100 - p['exit']

def connors_rsi2(d, p):           # Larry Connors: RSI(2) dip boven SMA200, exit boven SMA5
    o, h, l, c, v = d; r = rsi(c, 2); up, dn = trend_ok(c, p['tf']); m = sma(c, p['ex'])
    return (r < p['lo']) & up, (r > 100 - p['lo']) & dn, c > m, c < m

def bb_mr(d, p):                  # onder de onderste Bollinger band kopen, exit op middenlijn
    o, h, l, c, v = d; m = sma(c, p['n']); s = std(c, p['n']); up, dn = trend_ok(c, p['tf'])
    return (c < m - p['k'] * s) & up, (c > m + p['k'] * s) & dn, c > m, c < m

def stoch_mr(d, p):
    o, h, l, c, v = d; k = sma(stoch(h, l, c, p['n']), 3); up, dn = trend_ok(c, p['tf'])
    return cross_up(k, p['lo']) & up, cross_dn(k, 100 - p['lo']) & dn, k > 80, k < 20

def willr_mr(d, p):
    o, h, l, c, v = d; w = stoch(h, l, c, p['n']); up, dn = trend_ok(c, p['tf'])
    return (w < p['lo']) & up, (w > 100 - p['lo']) & dn, c > shift(h), c < shift(l)

def ibs_mr(d, p):                 # Internal Bar Strength: slot dicht bij de low
    o, h, l, c, v = d; ibs = (c - l) / np.maximum(h - l, 1e-9); up, dn = trend_ok(c, p['tf'])
    return (ibs < p['lo']) & up, (ibs > 1 - p['lo']) & dn, ibs > p['ex'], ibs < 1 - p['ex']

def zscore_mr(d, p):
    o, h, l, c, v = d; z = (c - sma(c, p['n'])) / std(c, p['n']); up, dn = trend_ok(c, p['tf'])
    return (z < -p['z']) & up, (z > p['z']) & dn, z > 0, z < 0

def red_streak(d, p):             # na N rode candles op rij kopen
    o, h, l, c, v = d; red = (c < o).astype(float); grn = (c > o).astype(float)
    rs = S(red).rolling(p['k']).sum().values == p['k']; gs = S(grn).rolling(p['k']).sum().values == p['k']
    up, dn = trend_ok(c, p['tf'])
    return rs & up, gs & dn, c > o, c < o

def nlow_pullback(d, p):          # laagste close in N candles, binnen opwaartse trend
    o, h, l, c, v = d; ll = S(c).rolling(p['n']).min().values; hh = S(c).rolling(p['n']).max().values
    up, dn = trend_ok(c, p['tf'])
    return (c <= ll) & up, (c >= hh) & dn, c > shift(h), c < shift(l)

def cci_mr(d, p):
    o, h, l, c, v = d; tp = (h + l + c) / 3; m = sma(tp, p['n'])
    md = S(tp).rolling(p['n']).apply(lambda x: np.abs(x - x.mean()).mean(), raw=True).values
    cci = (tp - m) / (0.015 * md); up, dn = trend_ok(c, p['tf'])
    return cross_up(cci, -p['lvl']) & up, cross_dn(cci, p['lvl']) & dn, cci > 0, cci < 0

def sonic_r(d, p):               # Sonic R: EMA34 dragon (high/low/close), EMA89 + EMA200 trend, pullback-instap
    o, h, l, c, v = d; dh = ema(h, 34); dl = ema(l, 34); e89 = ema(c, 89); e200 = ema(c, 200)
    up = (c > e89) & ((e89 > e200) if p['f'] else True); dn = (c < e89) & ((e89 < e200) if p['f'] else True)
    tl = S(l <= dh).rolling(p['lb']).max().values > 0; th = S(h >= dl).rolling(p['lb']).max().values > 0
    L = cross_up(c, dh) & tl & up; Sh = cross_dn(c, dl) & th & dn
    xl = c < (dl if p['x'] == 'dragon' else e89); xs = c > (dh if p['x'] == 'dragon' else e89)
    return L, Sh, xl, xs

# ------------------------------------------------------------ trend following

def ema_cross(d, p):
    o, h, l, c, v = d; f = ema(c, p['f']); s = ema(c, p['s'])
    return trig(f > s), trig(f < s), f < s, f > s

def macd_trend(d, p):
    o, h, l, c, v = d; mh = macd_hist(c, 12, 26, 9); up, dn = trend_ok(c, p['tf'])
    return cross_up(mh, 0) & up, cross_dn(mh, 0) & dn, mh < 0, mh > 0

def supertrend(d, p):
    o, h, l, c, v = d; st = supertrend_dir(h, l, c, p['n'], p['m'])
    return (st == 1) & (shift(st) == -1), (st == -1) & (shift(st) == 1), st == -1, st == 1

def donchian(d, p):
    o, h, l, c, v = d; up = rolling_max(h, p['n']); dn = rolling_min(l, p['n'])
    xu = rolling_max(h, max(p['n'] // 2, 2)); xd = rolling_min(l, max(p['n'] // 2, 2))
    return c > up, c < dn, c < xd, c > xu

def keltner_bo(d, p):
    o, h, l, c, v = d; m = ema(c, p['n']); a = atr(h, l, c, p['n'])
    return cross_up(c, m + p['k'] * a), cross_dn(c, m - p['k'] * a), c < m, c > m

def bb_breakout(d, p):
    o, h, l, c, v = d; m = sma(c, p['n']); s = std(c, p['n'])
    return cross_up(c, m + p['k'] * s), cross_dn(c, m - p['k'] * s), c < m, c > m

def ichimoku(d, p):
    o, h, l, c, v = d; f = p['f']
    mid = lambda n: (S(h).rolling(n).max().values + S(l).rolling(n).min().values) / 2
    tk = mid(9 * f); kj = mid(26 * f); sa = shift((tk + kj) / 2, 26 * f); sb = shift(mid(52 * f), 26 * f)
    top = np.fmax(sa, sb); bot = np.fmin(sa, sb)
    L = cross_up(tk, kj) & (c > top); Sh = cross_dn(tk, kj) & (c < bot)
    return L, Sh, c < kj, c > kj

def heikin_ashi(d, p):
    o, h, l, c, v = d; hc = (o + h + l + c) / 4; ho = np.empty_like(c); ho[0] = (o[0] + c[0]) / 2
    for i in range(1, len(c)): ho[i] = (ho[i-1] + hc[i-1]) / 2
    g = hc > ho; k = p['k']
    gs = S(g.astype(float)).rolling(k).sum().values == k; rs = S((~g).astype(float)).rolling(k).sum().values == k
    up, dn = trend_ok(c, p['tf'])
    return trig(gs) & up, trig(rs) & dn, ~g, g

def hma_trend(d, p):
    o, h, l, c, v = d; m = hma(c, p['n']); rising = m > shift(m)
    return trig(rising), trig(~rising), ~rising, rising

def roc_mom(d, p):                # time-series momentum
    o, h, l, c, v = d; r = c / shift(c, p['n']) - 1
    return cross_up(r, 0), cross_dn(r, 0), r < 0, r > 0

def adx_di(d, p):
    o, h, l, c, v = d; ax, pdi, mdi = adx(h, l, c, 14)
    return cross_up(pdi, mdi) & (ax > p['a']), cross_dn(pdi, mdi) & (ax > p['a']), pdi < mdi, pdi > mdi


LIB = {
    'RSI mean reversion': (rsi_mr, dict(n=[7, 14], lo=[20, 25, 30, 35], exit=[50, 60, 70], tf=[0, 200])),
    'Connors RSI(2)': (connors_rsi2, dict(lo=[5, 10, 15, 25], ex=[5, 10], tf=[0, 100, 200])),
    'Bollinger reversie': (bb_mr, dict(n=[20, 50], k=[1.5, 2.0, 2.5], tf=[0, 200])),
    'Stochastic reversie': (stoch_mr, dict(n=[9, 14, 21], lo=[10, 20, 30], tf=[0, 200])),
    'Williams %R': (willr_mr, dict(n=[2, 5, 10], lo=[5, 10, 20], tf=[0, 100, 200])),
    'IBS': (ibs_mr, dict(lo=[0.1, 0.2, 0.3], ex=[0.6, 0.8], tf=[0, 200])),
    'Z-score reversie': (zscore_mr, dict(n=[20, 50, 100], z=[1.5, 2.0, 2.5], tf=[0, 200])),
    'Rode candles op rij': (red_streak, dict(k=[3, 4, 5], tf=[0, 100, 200])),
    'N-candle low pullback': (nlow_pullback, dict(n=[3, 5, 7, 10], tf=[0, 100, 200])),
    'CCI reversie': (cci_mr, dict(n=[14, 20], lvl=[100, 150, 200], tf=[0, 200])),
    'Sonic R (dragon)': (sonic_r, dict(f=[0, 1], lb=[3, 6, 12], x=['dragon', 'e89'])),
    'EMA cross': (ema_cross, dict(f=[9, 12, 21, 50], s=[50, 100, 200])),
    'MACD trend': (macd_trend, dict(tf=[0, 50, 100, 200])),
    'Supertrend': (supertrend, dict(n=[7, 10, 14, 20], m=[2.0, 3.0, 4.0])),
    'Donchian breakout': (donchian, dict(n=[10, 20, 40, 55, 80, 120])),
    'Keltner breakout': (keltner_bo, dict(n=[20, 50], k=[1.0, 1.5, 2.0, 2.5])),
    'Bollinger breakout': (bb_breakout, dict(n=[20, 50], k=[1.5, 2.0, 2.5])),
    'Ichimoku': (ichimoku, dict(f=[1, 2])),
    'Heikin-Ashi trend': (heikin_ashi, dict(k=[1, 2, 3], tf=[0, 100, 200])),
    'Hull MA trend': (hma_trend, dict(n=[20, 50, 100, 200])),
    'Momentum (ROC)': (roc_mom, dict(n=[10, 30, 60, 90, 180])),
    'ADX / DI cross': (adx_di, dict(a=[15, 20, 25, 30])),
}
