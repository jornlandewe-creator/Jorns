"""Nieuwe strategie-families op basis van volume, orderflow en volatiliteit.
Signatuur: f(d, p) met d = (open, high, low, close, volume, taker_buy, ntrades).
"""
import numpy as np, pandas as pd
from engine import ema, atr, rsi
from library import sma, std, shift, cross_up, cross_dn, trig, trend_ok, S

def obv_trend(d, p):
    o, h, l, c, v, tb, nt = d
    obv = np.cumsum(np.sign(np.r_[0, np.diff(c)]) * v)
    oe = ema(obv, p['n']); up, dn = trend_ok(c, p['tf'])
    return cross_up(obv, oe) & up, cross_dn(obv, oe) & dn, obv < oe, obv > oe

def vol_breakout(d, p):          # nieuwe hoogste koers met volume-piek
    o, h, l, c, v, tb, nt = d
    hh = S(h).rolling(p['n']).max().shift(1).values; ll = S(l).rolling(p['n']).min().shift(1).values
    vs = v > p['k'] * sma(v, p['n']); m = sma(c, max(p['n'] // 2, 5))
    return (c > hh) & vs, (c < ll) & vs, c < m, c > m

def taker_flow(d, p):            # agressieve kopers vs verkopers (taker buy ratio)
    o, h, l, c, v, tb, nt = d
    r = tb / np.maximum(v, 1e-12); f = ema(r, p['f'])
    z = (f - sma(r, p['n'])) / np.maximum(std(r, p['n']), 1e-9); up, dn = trend_ok(c, p['tf'])
    return cross_up(z, p['th']) & up, cross_dn(z, -p['th']) & dn, z < 0, z > 0

def mfi_mr(d, p):                # Money Flow Index: RSI met volume
    o, h, l, c, v, tb, nt = d
    tp = (h + l + c) / 3; mf = tp * v; dtp = np.r_[0, np.diff(tp)]
    pos = S(np.where(dtp > 0, mf, 0)).rolling(p['n']).sum().values
    neg = S(np.where(dtp < 0, mf, 0)).rolling(p['n']).sum().values
    mfi = 100 - 100 / (1 + pos / np.maximum(neg, 1e-9)); up, dn = trend_ok(c, p['tf'])
    return (mfi < p['lo']) & up, (mfi > 100 - p['lo']) & dn, mfi > 50, mfi < 50

def cmf_trend(d, p):             # Chaikin Money Flow
    o, h, l, c, v, tb, nt = d
    mfm = ((c - l) - (h - c)) / np.maximum(h - l, 1e-12)
    cmf = S(mfm * v).rolling(p['n']).sum().values / np.maximum(S(v).rolling(p['n']).sum().values, 1e-12)
    return cross_up(cmf, p['th']), cross_dn(cmf, -p['th']), cmf < 0, cmf > 0

def vwap_trend(d, p):            # rollende VWAP
    o, h, l, c, v, tb, nt = d
    vw = S(c * v).rolling(p['n']).sum().values / np.maximum(S(v).rolling(p['n']).sum().values, 1e-12)
    rising = vw > shift(vw, max(p['n'] // 4, 1))
    return cross_up(c, vw) & rising, cross_dn(c, vw) & ~rising, c < vw, c > vw

def vwap_mr(d, p):
    o, h, l, c, v, tb, nt = d
    vw = S(c * v).rolling(p['n']).sum().values / np.maximum(S(v).rolling(p['n']).sum().values, 1e-12)
    z = (c - vw) / np.maximum(std(c, p['n']), 1e-9); up, dn = trend_ok(c, p['tf'])
    return (z < -p['k']) & up, (z > p['k']) & dn, c > vw, c < vw

def squeeze(d, p):               # Bollinger binnen Keltner, dan uitbraak
    o, h, l, c, v, tb, nt = d
    m = sma(c, 20); s = std(c, 20); a = atr(h, l, c, 20); e = ema(c, 20)
    sq = (m + 2 * s < e + p['kk'] * a) & (m - 2 * s > e - p['kk'] * a)
    was = S(sq.astype(float)).rolling(p['lb']).max().shift(1).values > 0
    return cross_up(c, m + 2 * s) & was, cross_dn(c, m - 2 * s) & was, c < m, c > m

def vol_expansion(d, p):         # Larry Williams volatility breakout
    o, h, l, c, v, tb, nt = d
    rng = shift(h - l); up, dn = trend_ok(c, p['tf'])
    return (c > o + p['k'] * rng) & up, (c < o - p['k'] * rng) & dn, c < o, c > o

def capitulation(d, p):          # grote rode candle op hoog volume in opwaartse trend
    o, h, l, c, v, tb, nt = d
    a = atr(h, l, c, 14); big = (o - c) > p['m'] * a; vs = v > p['k'] * sma(v, 50)
    bigu = (c - o) > p['m'] * a; up, dn = trend_ok(c, p['tf'])
    return big & vs & up, bigu & vs & dn, c > shift(h), c < shift(l)

def atr_momentum(d, p):          # sterke uitbraak-candle (> k x ATR)
    o, h, l, c, v, tb, nt = d
    a = shift(atr(h, l, c, 14)); e = ema(c, 20)
    return (c - shift(c)) > p['k'] * a, (shift(c) - c) > p['k'] * a, c < e, c > e

def dual_mom(d, p):
    o, h, l, c, v, tb, nt = d
    r1 = c / shift(c, p['n']) - 1; r2 = c / shift(c, p['m']) - 1
    L = (r1 > 0) & (r2 > 0); Sh = (r1 < 0) & (r2 < 0)
    return trig(L), trig(Sh), (r1 < 0) | (r2 < 0), (r1 > 0) | (r2 > 0)

def rsi_mom(d, p):               # RSI als momentum (niet als dip-koop)
    o, h, l, c, v, tb, nt = d
    r = rsi(c, 14); up, dn = trend_ok(c, p['tf'])
    return cross_up(r, p['hi']) & up, cross_dn(r, 100 - p['hi']) & dn, r < 100 - p['hi'] + 10, r > p['hi'] - 10

def trades_surge(d, p):          # piek in aantal trades + groene candle (instroom)
    o, h, l, c, v, tb, nt = d
    z = (nt - sma(nt, p['n'])) / np.maximum(std(nt, p['n']), 1e-9); up, dn = trend_ok(c, p['tf'])
    return (z > p['z']) & (c > o) & up, (z > p['z']) & (c < o) & dn, c < ema(c, 20), c > ema(c, 20)

def linreg_trend(d, p):          # helling van lineaire regressie, met kwaliteit (R2)
    o, h, l, c, v, tb, nt = d
    n = p['n']; x = np.arange(n); xm = x.mean(); sxx = ((x - xm) ** 2).sum()
    lc = np.log(c)
    sl = S(lc).rolling(n).apply(lambda y: ((x - xm) * (y - y.mean())).sum() / sxx, raw=True).values
    r2 = S(lc).rolling(n).apply(lambda y: np.corrcoef(x, y)[0, 1] ** 2, raw=True).values
    good = r2 > p['r2']
    return trig((sl > 0) & good), trig((sl < 0) & good), sl < 0, sl > 0

LIB2 = {
    'OBV trend': (obv_trend, dict(n=[20, 50, 100], tf=[0, 200])),
    'Volume-breakout': (vol_breakout, dict(n=[20, 50, 100], k=[1.5, 2.0, 3.0])),
    'Taker-flow': (taker_flow, dict(f=[3, 6], n=[50, 200], th=[1.0, 1.5, 2.0], tf=[0, 200])),
    'MFI reversie': (mfi_mr, dict(n=[14], lo=[10, 20, 30], tf=[0, 200])),
    'CMF trend': (cmf_trend, dict(n=[20, 50], th=[0.0, 0.05, 0.1])),
    'VWAP trend': (vwap_trend, dict(n=[24, 72, 168])),
    'VWAP reversie': (vwap_mr, dict(n=[24, 72], k=[1.5, 2.0, 2.5], tf=[0, 200])),
    'Squeeze breakout': (squeeze, dict(kk=[1.5, 2.0], lb=[1, 6, 12])),
    'Volatility breakout': (vol_expansion, dict(k=[0.3, 0.5, 0.7, 1.0], tf=[0, 50, 200])),
    'Capitulatie-koop': (capitulation, dict(m=[1.5, 2.5], k=[2.0, 3.0], tf=[0, 200])),
    'ATR-momentum': (atr_momentum, dict(k=[1.0, 1.5, 2.0])),
    'Dual momentum': (dual_mom, dict(n=[24, 72], m=[168, 500])),
    'RSI momentum': (rsi_mom, dict(hi=[55, 60, 65], tf=[0, 200])),
    'Trades-piek': (trades_surge, dict(n=[50, 200], z=[2.0, 3.0], tf=[0, 200])),
    'Regressie-trend': (linreg_trend, dict(n=[24, 72, 168], r2=[0.3, 0.6])),
}
