"""Simulator v3: risk-based sizing + gedeeltelijke winstname.
Bij TP1 (x ATR) wordt 'frac' van de positie verkocht en de stop naar break-even (+fees) gezet.
De rest loopt tot het trend-exit signaal of de stop. Win rate telt per complete trade (TP1-deel + rest).
"""
import numpy as np
from numba import njit


@njit(cache=True)
def simulate3(o, h, l, c, a, long_sig, short_sig, exit_long, exit_short,
              sl_atr, tp1_atr, frac, fee, slip, funding_bar, risk, lev, start):
    n = len(c)
    eq = np.ones(n); cash = 1.0
    pos = 0; qty = 0.0; entry = 0.0; sl = 0.0; tp1 = 0.0; hit = False
    pend = 0; trade_start_eq = 0.0
    t_ret = np.zeros(n); t_exit = np.zeros(n, np.int64); nt = 0
    for i in range(start, n):
        if pend != 0:
            if pos != 0 and pend == 2:
                px = o[i] * (1 - slip) if pos == 1 else o[i] * (1 + slip)
                cash += pos * qty * (px - entry) - fee * qty * px
                t_ret[nt] = cash / trade_start_eq - 1; t_exit[nt] = i; nt += 1
                pos = 0
            elif pos == 0 and (pend == 1 or pend == -1):
                d = pend
                px = o[i] * (1 + slip) if d == 1 else o[i] * (1 - slip)
                dist = sl_atr * a[i-1]
                notional = min(cash * risk / (dist / px), cash * lev)
                qty = notional / px
                trade_start_eq = cash
                cash -= fee * notional
                entry = px; pos = d; hit = False
                sl = px - d * dist
                tp1 = px + d * tp1_atr * a[i-1] if tp1_atr > 0 else 0.0
            pend = 0
        if pos != 0:
            xp = 0.0
            if pos == 1:
                if l[i] <= sl:
                    xp = min(o[i], sl) * (1 - slip)
                elif tp1_atr > 0 and not hit and h[i] >= tp1:
                    q = qty * frac
                    cash += q * (tp1 - entry) - fee * q * tp1
                    qty -= q; hit = True; sl = max(sl, entry * (1 + 2 * fee + slip))
            else:
                if h[i] >= sl:
                    xp = max(o[i], sl) * (1 + slip)
                elif tp1_atr > 0 and not hit and l[i] <= tp1:
                    q = qty * frac
                    cash += -q * (tp1 - entry) - fee * q * tp1
                    qty -= q; hit = True; sl = min(sl, entry * (1 - 2 * fee - slip))
            if xp > 0:
                cash += pos * qty * (xp - entry) - fee * qty * xp
                t_ret[nt] = cash / trade_start_eq - 1; t_exit[nt] = i; nt += 1
                pos = 0
            else:
                cash -= funding_bar * qty * c[i]
        eq[i] = cash + (pos * qty * (c[i] - entry) if pos != 0 else 0.0)
        if eq[i] <= 0:
            for j in range(i, n): eq[j] = 1e-9
            break
        if pos == 1 and exit_long[i]:
            pend = 2
        elif pos == -1 and exit_short[i]:
            pend = 2
        elif pos == 0:
            if long_sig[i]: pend = 1
            elif short_sig[i]: pend = -1
    for j in range(start): eq[j] = 1.0
    return eq, t_ret[:nt], t_exit[:nt]
