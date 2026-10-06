"""Simulator v2: vaste positiegrootte (100% van account, geen hefboom), zodat alle strategieën eerlijk vergelijkbaar zijn.
Exits: signaal, stop loss (x ATR), take profit (x ATR), tijdstop (max candles). 0 = uit.
Signaal op close, uitvoering op volgende open. SL en TP in dezelfde candle -> SL telt.
"""
import numpy as np
from numba import njit


@njit(cache=True)
def simulate2(o, h, l, c, a, long_sig, short_sig, exit_long, exit_short,
              sl_atr, tp_atr, max_bars, fee, slip, funding_bar, start, lev=1.0):
    n = len(c)
    eq = np.ones(n)
    cash = 1.0
    pos = 0; qty = 0.0; entry = 0.0; sl = 0.0; tp = 0.0; ei = 0
    pend = 0
    t_ret = np.zeros(n); t_exit = np.zeros(n, np.int64); nt = 0
    for i in range(start, n):
        if pend != 0:
            if pos != 0 and pend == 2:
                px = o[i] * (1 - slip) if pos == 1 else o[i] * (1 + slip)
                pnl = pos * qty * (px - entry) - fee * qty * px
                cash += pnl
                t_ret[nt] = pos * (px / entry - 1) - 2 * fee; t_exit[nt] = i; nt += 1
                pos = 0
            elif pos == 0 and (pend == 1 or pend == -1):
                d = pend
                px = o[i] * (1 + slip) if d == 1 else o[i] * (1 - slip)
                qty = cash * lev * 0.999 / px
                cash -= fee * qty * px
                entry = px; pos = d; ei = i
                sl = px - d * sl_atr * a[i-1] if sl_atr > 0 else 0.0
                tp = px + d * tp_atr * a[i-1] if tp_atr > 0 else 0.0
            pend = 0
        if pos != 0:
            xp = 0.0
            if pos == 1:
                if sl_atr > 0 and l[i] <= sl:
                    xp = min(o[i], sl) * (1 - slip)
                elif tp_atr > 0 and h[i] >= tp:
                    xp = max(o[i], tp)
            else:
                if sl_atr > 0 and h[i] >= sl:
                    xp = max(o[i], sl) * (1 + slip)
                elif tp_atr > 0 and l[i] <= tp:
                    xp = min(o[i], tp)
            if xp > 0:
                cash += pos * qty * (xp - entry) - fee * qty * xp
                t_ret[nt] = pos * (xp / entry - 1) - 2 * fee; t_exit[nt] = i; nt += 1
                pos = 0
            else:
                cash -= funding_bar * qty * c[i]
        eq[i] = cash + (pos * qty * (c[i] - entry) if pos != 0 else 0.0)
        if eq[i] <= 0:
            eq[i:] = 1e-9
            break
        if pos == 1 and (exit_long[i] or (max_bars > 0 and i - ei + 1 >= max_bars)):
            pend = 2
        elif pos == -1 and (exit_short[i] or (max_bars > 0 and i - ei + 1 >= max_bars)):
            pend = 2
        elif pos == 0:
            if long_sig[i]:
                pend = 1
            elif short_sig[i]:
                pend = -1
    for j in range(start):
        eq[j] = 1.0
    return eq, t_ret[:nt], t_exit[:nt]
