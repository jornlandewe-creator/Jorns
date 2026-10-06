"""Zoektocht naar een long-strategie die in stijgende maanden verdient.
Alle families uit library + library2, 1h en 4h, 10 munten (elk 10%), alleen long.
Marktpoort: geen, of BTC-dagslot > SMA100 (van gisteren); bij poort dicht wordt de positie gesloten.
Stop: geen of 2.5x ATR. Kosten 0.05% fee + 0.03% slippage + funding.
Kiezen op mrt 2022 - dec 2023, controleren op 2024 - sep 2026."""
import itertools, os, sys, json
import numpy as np, pandas as pd
from multiprocessing import Pool
sys.path.insert(0, '/home/claude/bot'); os.chdir('/home/claude/bot')
from engine import atr
from engine2 import simulate2
from library import LIB
from library2 import LIB2

COINS = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'AVAX', 'LINK', 'DOT']
T0, SPLIT, T1 = '2022-03-01', '2024-01-01', '2026-10-01'
FEE, SLIP = 0.0005, 0.0003
SKIP = {'Hull MA trend', 'Regressie-trend'}

btc_d = pd.read_csv('data/coins/BTC_1d.csv', index_col=0, parse_dates=True).close
gate_d = (btc_d > btc_d.rolling(100).mean()).shift(1)       # alleen gisteren bekend
DATA = {}
for tf in ['1h', '4h']:
    for c in COINS:
        df = pd.read_csv(f'data/coins/{c}_{tf}.csv', index_col=0, parse_dates=True)
        df = df[(df.index >= '2021-10-01') & (df.index < T1)]
        g = gate_d.reindex(df.index.floor('1D')).fillna(False).values.astype(bool)
        DATA[(tf, c)] = (df, g)
didx = pd.date_range(T0, '2026-09-30', freq='1D', tz='UTC')
bm = btc_d.resample('ME').last().pct_change()
bm = bm[(bm.index >= '2022-03-31')]
UP = bm > 0.05; DN = bm < -0.05


def task(args):
    fam, p, tf = args
    fn = LIB[fam][0] if fam in LIB else LIB2[fam][0]
    sig = {}
    for c in COINS:
        df, g = DATA[(tf, c)]
        cols = ['open', 'high', 'low', 'close', 'volume'] + (['taker_buy', 'ntrades'] if fam in LIB2 else [])
        d = tuple(df[k].values.astype(float) for k in cols)
        try:
            L, _, XL, _ = [np.nan_to_num(np.asarray(x, dtype=float)).astype(bool) for x in fn(d, p)]
        except Exception:
            return []
        sig[c] = (d, L, XL, g, atr(d[1], d[2], d[3], 14), df.index)
    fund = 0.0001 / 8 * (1 if tf == '1h' else 4)
    out = []
    for gate in (0, 1):
        for sl in (0.0, 2.5):
            rets = []; ntr = 0; wins = 0
            for c in COINS:
                d, L, XL, g, a, ix = sig[c]
                Lg = L & g if gate else L; XLg = XL | ~g if gate else XL
                s0 = ix.searchsorted(pd.Timestamp(T0, tz='UTC'))
                eq, tr, _ = simulate2(d[0], d[1], d[2], d[3], a, Lg, np.zeros_like(L), XLg, np.zeros_like(L),
                                      sl, 0.0, 0, FEE, SLIP, fund, s0)
                ntr += len(tr); wins += int((tr > 0).sum())
                e = pd.Series(eq, ix).iloc[s0:].resample('1D').last().reindex(didx).ffill().fillna(1.0)
                rets.append(e.pct_change().fillna(0).values)
            r = np.array(rets).T                               # dag x munt
            val = 1.0; port = np.empty(len(didx)); months = didx.to_period('M')
            for m in np.unique(months):                        # maandelijks gelijk verdelen
                k = np.where(months == m)[0]
                sub = val / 10 * np.cumprod(1 + r[k], axis=0); port[k] = sub.sum(axis=1); val = port[k[-1]]
            P = pd.Series(port, didx)
            def st(x):
                y = (x.index[-1] - x.index[0]).days / 365.25
                return (x.iloc[-1] / x.iloc[0]) ** (1 / y) - 1, (x / x.cummax() - 1).min()
            ci, di = st(P[P.index < SPLIT]); co, do = st(P[P.index >= SPLIT]); cf, df_ = st(P)
            mr = P.resample('ME').last().pct_change(); mr.iloc[0] = P.resample('ME').last().iloc[0] - 1
            mr = mr.reindex(bm.index)
            upi = UP & (bm.index < SPLIT); upo = UP & (bm.index >= SPLIT)
            out.append(dict(fam=fam, p=json.dumps(p), tf=tf, gate=gate, sl=sl, is_cagr=ci, is_dd=di, oos_cagr=co, oos_dd=do,
                            full_cagr=cf, full_dd=df_, up_is=mr[upi].mean(), up_oos=mr[upo].mean(), dn_all=mr[DN].mean(),
                            up_all=mr[UP].mean(), trades=ntr, win=wins / max(ntr, 1), daily=P.pct_change().fillna(0).values.astype(np.float32)))
    return out


if __name__ == '__main__':
    tasks = []
    for fam, (fn, grid) in list(LIB.items()) + list(LIB2.items()):
        if fam in SKIP: continue
        for vals in itertools.product(*grid.values()):
            p = dict(zip(grid.keys(), vals))
            for tf in ['1h', '4h']: tasks.append((fam, p, tf))
    print(len(tasks), 'taken', flush=True)
    rows = []; daily = []
    with Pool(2) as pool:
        for i, res in enumerate(pool.imap_unordered(task, tasks, chunksize=4)):
            for r in res:
                daily.append(r.pop('daily')); rows.append(r)
            if i % 100 == 0: print(i, flush=True)
    df = pd.DataFrame(rows); df.to_csv('regime/bullsweep.csv', index=False)
    np.save('regime/bullsweep_daily.npy', np.array(daily))
    print('klaar', len(df))
