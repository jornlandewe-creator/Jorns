"""Hoge winrate: dip kopen in een stijgende munt met vast winstdoel, ruimere stop en tijdstop.
Eén gedeelde pot geld, maximaal K posities tegelijk, elke positie 1/K van het account (1x, geen hefboom).
10 munten, 1h en 4h. Kosten 0.05% fee + 0.03% slippage per kant + funding. Uitvoering op de open van de volgende candle;
winstdoel als limietorder, stop als marktorder (stop eerst als beide in dezelfde candle vallen).
Kiezen op mrt 2022 - dec 2023, controleren op jan 2024 - sep 2026."""
import itertools, os, sys
import numpy as np, pandas as pd
from numba import njit
sys.path.insert(0, '/home/claude/bot'); os.chdir('/home/claude/bot')
from engine import atr as atr_f, rsi as rsi_f

COINS = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'AVAX', 'LINK', 'DOT']
IS0, SPLIT, END = '2022-03-01', '2024-01-01', '2026-10-01'


@njit(cache=True)
def sim(O, H, L, C, A, E, P, tp, sl, tmax, K, fee, slip, fund, s0):
    T, M = C.shape
    eq = np.ones(T); cash = 1.0
    qty = np.zeros(M); ent = np.zeros(M); tpx = np.zeros(M); spx = np.zeros(M); bars = np.zeros(M, np.int64)
    pend = np.zeros(M, np.bool_); nopen = 0
    tr_t = np.zeros(200000, np.int64); tr_r = np.zeros(200000); nt = 0
    last_eq = 1.0
    for t in range(s0, T):
        # 1) instap op de open
        for m in range(M):
            if pend[m]:
                pend[m] = False
                if qty[m] == 0 and nopen < K and not np.isnan(O[t, m]) and A[t - 1, m] > 0:
                    px = O[t, m] * (1 + slip); notional = last_eq / K
                    qty[m] = notional / px; ent[m] = px; cash -= fee * notional
                    tpx[m] = px + tp * A[t - 1, m] if tp > 0 else 1e18
                    spx[m] = px - sl * A[t - 1, m] if sl > 0 else 0.0
                    bars[m] = 0; nopen += 1
        # 2) uitstap: stop, winstdoel, tijdstop
        mtm = 0.0
        for m in range(M):
            if qty[m] > 0:
                if np.isnan(C[t, m]): continue
                xp = 0.0
                if sl > 0 and L[t, m] <= spx[m]: xp = min(O[t, m], spx[m]) * (1 - slip)
                elif H[t, m] >= tpx[m]: xp = max(O[t, m], tpx[m])
                else:
                    bars[m] += 1
                    if tmax > 0 and bars[m] >= tmax: xp = C[t, m] * (1 - slip)
                if xp > 0:
                    pnl = qty[m] * (xp - ent[m]) - fee * qty[m] * xp
                    cash += pnl
                    if nt < 200000: tr_t[nt] = t; tr_r[nt] = xp / ent[m] - 1 - 2 * fee; nt += 1
                    qty[m] = 0.0; nopen -= 1
                else:
                    cash -= fund * qty[m] * C[t, m]
                    mtm += qty[m] * (C[t, m] - ent[m])
        eq[t] = cash + mtm; last_eq = eq[t]
        if eq[t] <= 0:
            for k in range(t, T): eq[k] = 1e-9
            break
        # 3) nieuwe signalen op het slot, sterkste dip eerst
        free = K - nopen
        if free > 0:
            for _ in range(free):
                best = -1; bp = 1e18
                for m in range(M):
                    if E[t, m] and qty[m] == 0 and not pend[m] and P[t, m] < bp: bp = P[t, m]; best = m
                if best < 0: break
                pend[best] = True
    for k in range(s0): eq[k] = 1.0
    return eq, tr_t[:nt], tr_r[:nt]


def load(tf):
    d = {}
    for c in COINS:
        df = pd.read_csv(f'data/coins/{c}_{tf}.csv', index_col=0, parse_dates=True)
        d[c] = df[(df.index >= '2021-09-01') & (df.index < END)]
    idx = d['BTC'].index
    for c in COINS: idx = idx.union(d[c].index)
    F = {k: pd.DataFrame({c: d[c][k].reindex(idx) for c in COINS}) for k in ['open', 'high', 'low', 'close']}
    return idx, F


def run_tf(tf):
    idx, F = load(tf)
    O, H, L, C = [F[k].values.astype(float) for k in ['open', 'high', 'low', 'close']]
    T, M = C.shape
    A = np.column_stack([atr_f(np.nan_to_num(H[:, m], nan=np.nanmean(H[:, m])), np.nan_to_num(L[:, m], nan=np.nanmean(L[:, m])),
                               np.nan_to_num(C[:, m], nan=np.nanmean(C[:, m])), 14) for m in range(M)])
    Cd = F['close']
    btc_d = pd.read_csv('data/coins/BTC_1d.csv', index_col=0, parse_dates=True).close
    gate = (btc_d > btc_d.rolling(100).mean()).shift(1).reindex(idx.floor('1D')).fillna(False).values.astype(bool)
    sma200 = (Cd > Cd.rolling(200).mean()).values
    RS = {n: np.column_stack([rsi_f(np.nan_to_num(C[:, m], nan=np.nanmean(C[:, m])), n) for m in range(M)]) for n in (2, 3, 5, 7, 14)}
    m20 = Cd.rolling(20).mean(); s20 = Cd.rolling(20).std(); Z = ((Cd - m20) / s20).values
    red = (F['close'] < F['open']).astype(float)
    ENT = {}
    for n in (2, 3, 5, 7, 14):
        for lo in (5, 10, 15, 20, 25, 30):
            if n >= 7 and lo < 15: continue
            ENT[f'RSI{n}<{lo}'] = (RS[n] < lo, RS[n])
    for z in (1.5, 2.0, 2.5): ENT[f'Z20<-{z}'] = (Z < -z, Z)
    for k in (3, 4, 5):
        rr = (red.rolling(k).sum() == k).values; ENT[f'{k} rood'] = (rr, -red.rolling(10).sum().values)
    valid = ~np.isnan(C)
    s0 = idx.searchsorted(pd.Timestamp('2022-01-15', tz='UTC'))
    i0 = idx.searchsorted(pd.Timestamp(IS0, tz='UTC')); i1 = idx.searchsorted(pd.Timestamp(SPLIT, tz='UTC')); i2 = len(idx) - 1
    bpd = 24 if tf == '1h' else 6
    fund = 0.0001 / (8 if tf == '1h' else 2)
    TP = (0.5, 0.75, 1.0, 1.5, 2.0); SL = (1.5, 2.0, 3.0, 5.0, 0.0); TM = (bpd // 4, bpd // 2, bpd, 2 * bpd); KK = (2, 3, 5)
    rows = []
    for (en, (sig, pri)), filt in itertools.product(ENT.items(), (0, 1, 2)):
        E = sig & valid
        if filt >= 1: E = E & sma200
        if filt == 2: E = E & gate[:, None]
        E = np.nan_to_num(E).astype(np.bool_); Pr = np.nan_to_num(pri.astype(float), nan=1e9)
        for tp, sl, tm, K in itertools.product(TP, SL, TM, KK):
            eq, tt, rr = sim(O, H, L, C, A, E, Pr, tp, sl, tm, K, 0.0005, 0.0003, fund, s0)
            def st(a, b):
                e = eq[a:b + 1]; y = (b - a) / bpd / 365.25
                if e[-1] <= 0 or y <= 0: return -1, -1
                return (e[-1] / e[0]) ** (1 / y) - 1, (e / np.maximum.accumulate(e) - 1).min()
            ci, di = st(i0, i1); co, do = st(i1, i2)
            wi = rr[(tt >= i0) & (tt < i1)]; wo = rr[tt >= i1]
            rows.append(dict(tf=tf, entry=en, filt=filt, tp=tp, sl=sl, tmax=tm, K=K, is_cagr=ci, is_dd=di, oos_cagr=co, oos_dd=do,
                             is_n=len(wi), is_win=(wi > 0).mean() if len(wi) else 0, oos_n=len(wo), oos_win=(wo > 0).mean() if len(wo) else 0,
                             avg_r=rr.mean() if len(rr) else 0))
        print(tf, en, filt, len(rows), flush=True)
    return pd.DataFrame(rows)


if __name__ == '__main__':
    tf = sys.argv[1]
    df = run_tf(tf); df.to_csv(f'regime/hiwin_{tf}.csv', index=False); print('klaar', len(df))
