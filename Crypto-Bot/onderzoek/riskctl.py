"""Ronde 4: account-brede risicobeheersing op de portfolio (7 strategieën).
Hefboom per dag L_t wordt bepaald met alleen informatie tot en met gisteren:
  - drawdown-rem: L omlaag als account x% onder de piek staat
  - vol targeting: L = doel-vol / gerealiseerde vol (20 dagen)
  - trendfilter: L halveren als BTC onder SMA200 (daily) staat
Gekozen op 2020-2023, blind getest op 2024-sep 2026.
"""
import itertools
import numpy as np, pandas as pd
from portfolio import curve, portfolio, STRATS, split, stats

FIN_DAY = 0.0003
base = portfolio([curve(n, 1.0)[0] for n in STRATS])         # 1x portfolio
r1 = base.pct_change().fillna(0)
# blootstelling (fractie van de dag dat sleeves gemiddeld open staan) voor financiering bij hefboom
expo = pd.concat([(curve(n, 1.0)[0].pct_change().fillna(0) != 0).astype(float) for n in STRATS], axis=1).mean(axis=1)
btc = pd.read_csv('data/btc_1D.csv', index_col=0, parse_dates=True).close
trend_up = (btc > btc.rolling(200).mean()).shift(1).reindex(r1.index).fillna(True)
vol20 = (r1.rolling(20).std() * np.sqrt(365)).shift(1).bfill()


def run(L, dd1=None, dd2=None, f1=0.5, f2=0.25, tv=None, regime=False, lmax=4.0):
    eq = 1.0; peak = 1.0; out = np.empty(len(r1)); levs = np.empty(len(r1))
    for i, (t, r) in enumerate(r1.items()):
        l = L
        if tv is not None:
            l = min(lmax, L * tv / max(vol20.iloc[i], 1e-6))
        if regime and not trend_up.iloc[i]:
            l *= 0.5
        dd = eq / peak - 1
        if dd2 is not None and dd <= -dd2: l *= f2
        elif dd1 is not None and dd <= -dd1: l *= f1
        ret = l * r - max(l - 1, 0) * FIN_DAY * expo.iloc[i]
        eq *= (1 + ret); peak = max(peak, eq); out[i] = eq; levs[i] = l
    return pd.Series(out, r1.index), levs.mean()


if __name__ == '__main__':
    rows = []
    # controle: statische hefboom via schalen vs echte simulatie
    for L in [2.0, 3.0, 4.0]:
        e, _ = run(L)
        real = portfolio([curve(n, L)[0] for n in STRATS])
        print(f'controle {L}x: geschaald {stats(e)[0]*100:.1f}%/jr dd {stats(e)[1]*100:.1f}%  |  echte sim {stats(real)[0]*100:.1f}%/jr dd {stats(real)[1]*100:.1f}%')
    for L, dd1, dd2, f1, tv, reg in itertools.product(
            [2.0, 3.0, 4.0, 5.0], [None, 0.08, 0.12, 0.16, 0.20], [None, 0.20, 0.25, 0.30],
            [0.5, 0.33], [None, 0.4, 0.6, 0.8], [False, True]):
        if dd1 is None and dd2 is not None: continue
        if dd1 is not None and dd2 is not None and dd2 <= dd1: continue
        if dd1 is None and f1 != 0.5: continue
        e, lavg = run(L, dd1, dd2, f1, 0.25, tv, reg, lmax=L * 1.5 if tv else L)
        (ic, idd), (oc, odd), (fc, fdd) = split(e)
        rows.append(dict(L=L, dd1=dd1, dd2=dd2, f1=f1, tv=tv, regime=reg, gem_lev=lavg,
                         is_cagr=ic, is_dd=idd, oos_cagr=oc, oos_dd=odd, full_cagr=fc, full_dd=fdd))
    res = pd.DataFrame(rows); res.to_csv('results/riskctl.csv', index=False)
    print(len(res), 'varianten')
