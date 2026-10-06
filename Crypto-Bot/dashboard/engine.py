"""Backtest-engine: indicatoren, signalen en een realistische trade-simulator.

Kosten: 0.1% fee per kant, slippage op market fills, funding op open posities.
Uitvoering: signaal op candle-close, instap op open van volgende candle.
Stop loss / take profit intrabar; als beide in dezelfde candle geraakt worden telt de stop (conservatief).
"""
import numpy as np
import pandas as pd
from numba import njit

# ---------------------------------------------------------------- indicatoren

def ema(x, n):
    return pd.Series(x).ewm(span=n, adjust=False).mean().values

def rma(x, n):
    return pd.Series(x).ewm(alpha=1 / n, adjust=False).mean().values

def atr(h, l, c, n=14):
    pc = np.r_[c[0], c[:-1]]
    tr = np.maximum(h - l, np.maximum(np.abs(h - pc), np.abs(l - pc)))
    return rma(tr, n)

def adx(h, l, c, n=14):
    up = np.r_[0, np.diff(h)]
    dn = np.r_[0, -np.diff(l)]
    pdm = np.where((up > dn) & (up > 0), up, 0.0)
    mdm = np.where((dn > up) & (dn > 0), dn, 0.0)
    a = atr(h, l, c, n)
    pdi = 100 * rma(pdm, n) / a
    mdi = 100 * rma(mdm, n) / a
    dx = 100 * np.abs(pdi - mdi) / np.maximum(pdi + mdi, 1e-9)
    return rma(dx, n), pdi, mdi

def macd_hist(c, f=12, s=26, sig=9):
    m = ema(c, f) - ema(c, s)
    return m - ema(m, sig)

def rsi(c, n=14):
    d = np.r_[0, np.diff(c)]
    g = rma(np.maximum(d, 0), n)
    ls = rma(np.maximum(-d, 0), n)
    return 100 - 100 / (1 + g / np.maximum(ls, 1e-12))

def supertrend_dir(h, l, c, n=10, mult=3.0):
    a = atr(h, l, c, n)
    hl2 = (h + l) / 2
    return _st(hl2 + mult * a, hl2 - mult * a, c)

@njit(cache=True)
def _st(ub, lb, c):
    n = len(c)
    fu = ub.copy(); fl = lb.copy(); d = np.ones(n)
    for i in range(1, n):
        fu[i] = ub[i] if (ub[i] < fu[i-1] or c[i-1] > fu[i-1]) else fu[i-1]
        fl[i] = lb[i] if (lb[i] > fl[i-1] or c[i-1] < fl[i-1]) else fl[i-1]
        if d[i-1] == 1 and c[i] < fl[i]:
            d[i] = -1
        elif d[i-1] == -1 and c[i] > fu[i]:
            d[i] = 1
        else:
            d[i] = d[i-1]
    return d

def rolling_max(x, n):
    return pd.Series(x).rolling(n).max().shift(1).values

def rolling_min(x, n):
    return pd.Series(x).rolling(n).min().shift(1).values

# ---------------------------------------------------------------- simulator

@njit(cache=True)
def simulate(o, h, l, c, a, long_sig, short_sig, exit_long, exit_short,
             sl_mult, rr, trail_mult, fee, slip, funding_bar, risk, max_lev, start):
    """Retourneert equity (mark-to-market per bar) en trade-log arrays.
    rr<=0: geen vaste TP.  trail_mult<=0: geen trailing stop."""
    n = len(c)
    eq = np.ones(n)
    cash = 1.0
    pos = 0          # 1 long, -1 short
    qty = 0.0        # in BTC (eenheden van equity/prijs)
    entry = 0.0; sl = 0.0; tp = 0.0; trail_ext = 0.0
    entry_eq = 0.0
    pend = 0         # wachtende order voor volgende open
    tr_pnl = np.zeros(n); tr_bars = np.zeros(n); nt = 0; entry_i = 0

    for i in range(start, n):
        # 1) uitvoeren van wachtende instap / exit op open
        if pend != 0:
            if pos != 0 and pend == 2:  # exit op signaal
                px = o[i] * (1 - slip) if pos == 1 else o[i] * (1 + slip)
                cash += pos * qty * (px - entry) - fee * qty * px
                tr_pnl[nt] = cash / entry_eq - 1; tr_bars[nt] = i - entry_i; nt += 1
                pos = 0; qty = 0.0
            elif pos == 0 and (pend == 1 or pend == -1):
                d = pend
                px = o[i] * (1 + slip) if d == 1 else o[i] * (1 - slip)
                stop_dist = sl_mult * a[i-1]
                if stop_dist > 0:
                    notional = min(cash * risk / (stop_dist / px), cash * max_lev)
                    qty = notional / px
                    cash -= fee * notional
                    entry = px; pos = d; entry_eq = cash + fee * notional; entry_i = i
                    sl = px - d * stop_dist
                    tp = px + d * rr * stop_dist if rr > 0 else 0.0
                    trail_ext = px
            pend = 0

        # 2) intrabar stop / take profit
        if pos != 0:
            exit_px = 0.0
            if pos == 1:
                if l[i] <= sl:
                    exit_px = min(o[i], sl) * (1 - slip)
                elif rr > 0 and h[i] >= tp:
                    exit_px = max(o[i], tp)
            else:
                if h[i] >= sl:
                    exit_px = max(o[i], sl) * (1 + slip)
                elif rr > 0 and l[i] <= tp:
                    exit_px = min(o[i], tp)
            if exit_px > 0:
                cash += pos * qty * (exit_px - entry) - fee * qty * exit_px
                tr_pnl[nt] = cash / entry_eq - 1; tr_bars[nt] = i - entry_i; nt += 1
                pos = 0; qty = 0.0
            else:
                cash -= funding_bar * qty * c[i]
                if trail_mult > 0:  # chandelier trailing stop
                    if pos == 1:
                        trail_ext = max(trail_ext, h[i])
                        sl = max(sl, trail_ext - trail_mult * a[i])
                    else:
                        trail_ext = min(trail_ext, l[i])
                        sl = min(sl, trail_ext + trail_mult * a[i])

        # 3) mark-to-market
        eq[i] = cash + (pos * qty * (c[i] - entry) if pos != 0 else 0.0)
        if eq[i] <= 0:
            eq[i:] = 0.0
            break

        # 4) signalen op close -> order voor volgende open
        if pos == 1 and exit_long[i]:
            pend = 2
        elif pos == -1 and exit_short[i]:
            pend = 2
        elif pos == 0:
            if long_sig[i]:
                pend = 1
            elif short_sig[i]:
                pend = -1
    eq[:start] = 1.0
    return eq, tr_pnl[:nt], tr_bars[:nt]


def metrics(eq, idx, trades, bars_per_year):
    eq = np.asarray(eq)
    tot = eq[-1] / eq[0] - 1
    yrs = (idx[-1] - idx[0]).total_seconds() / (365.25 * 86400)
    cagr = (eq[-1] / eq[0]) ** (1 / yrs) - 1 if eq[-1] > 0 else -1
    peak = np.maximum.accumulate(eq)
    mdd = (eq / peak - 1).min()
    r = np.diff(eq) / eq[:-1]
    sharpe = r.mean() / r.std() * np.sqrt(bars_per_year) if r.std() > 0 else 0
    wins = trades[trades > 0]; losses = trades[trades <= 0]
    pf = wins.sum() / -losses.sum() if losses.sum() < 0 else np.inf
    return dict(total=tot, cagr=cagr, maxdd=mdd, sharpe=sharpe,
                calmar=cagr / -mdd if mdd < 0 else 0, trades=len(trades),
                winrate=len(wins) / len(trades) if len(trades) else 0, pf=pf)
