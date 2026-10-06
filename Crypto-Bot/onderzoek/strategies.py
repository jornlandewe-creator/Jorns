"""Strategie-families. Elke functie geeft (long, short, exit_long, exit_short) boolean arrays.

nnfx  = template uit de video: 1 trend-indicator, 2 niet-gecorreleerde confirmaties,
        1 volatiliteits/volumefilter, stop op ATR-band, TP via risk:reward.
"""
import numpy as np
from engine import ema, atr, adx, macd_hist, rsi, supertrend_dir, rolling_max, rolling_min


def _trigger(cond):
    prev = np.r_[False, cond[:-1]]
    return cond & ~prev


def nnfx(d, p, shorts=True):
    o, h, l, c, v = d
    t = ema(c, p['trend'])
    slope = t > np.r_[t[0], t[:-1]]
    trend_up = (c > t) & slope
    trend_dn = (c < t) & ~slope
    mh = macd_hist(c, p['mf'], p['mf'] * 2 + 2, 9)                 # confirmatie 1: momentum
    ax, pdi, mdi = adx(h, l, c, 14)                                  # confirmatie 2: trendsterkte
    a = atr(h, l, c, 14)
    vol_ok = (a / ema(a, 50) > p['volf'])                            # volatiliteitsfilter
    if p.get('volume', 0):
        vol_ok &= v > ema(v, 20)                                     # optioneel volumefilter
    L = trend_up & (mh > 0) & (ax > p['adx']) & (pdi > mdi) & vol_ok
    S = trend_dn & (mh < 0) & (ax > p['adx']) & (mdi > pdi) & vol_ok
    xl = c < t
    xs = c > t
    return _trigger(L), (_trigger(S) if shorts else np.zeros_like(S)), xl, xs


def supertrend(d, p, shorts=True):
    o, h, l, c, v = d
    st = supertrend_dir(h, l, c, p['st_n'], p['st_m'])
    t = ema(c, p['trend'])
    L = (st == 1) & (np.r_[0, st[:-1]] == -1) & (c > t)
    S = (st == -1) & (np.r_[0, st[:-1]] == 1) & (c < t)
    return L, (S if shorts else np.zeros_like(S)), st == -1, st == 1


def donchian(d, p, shorts=True):
    o, h, l, c, v = d
    t = ema(c, p['trend'])
    up = rolling_max(h, p['dc']); dn = rolling_min(l, p['dc'])
    ex_up = rolling_max(h, p['dc'] // 2); ex_dn = rolling_min(l, p['dc'] // 2)
    L = (c > up) & (c > t)
    S = (c < dn) & (c < t)
    return L, (S if shorts else np.zeros_like(S)), c < ex_dn, c > ex_up


def emacross(d, p, shorts=True):
    o, h, l, c, v = d
    f = ema(c, p['fast']); s = ema(c, p['slow'])
    r = rsi(c, 14)
    up = f > s
    L = _trigger(up) & (r > 50)
    S = _trigger(~up) & (r < 50)
    return L, (S if shorts else np.zeros_like(S)), ~up, up


FAMILIES = {'nnfx': nnfx, 'supertrend': supertrend, 'donchian': donchian, 'emacross': emacross}
