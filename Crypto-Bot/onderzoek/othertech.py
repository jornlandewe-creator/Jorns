"""Andere technieken op dezelfde data: grid-bot (rollend) en DCA. Kosten 0.1% per fill."""
import numpy as np, pandas as pd
from numba import njit
from portfolio import stats, split

FEE = 0.001
h = pd.read_csv('data/btc_1h.csv', index_col=0, parse_dates=True)
h = h[(h.index >= '2020-10-01') & (h.index < '2026-10-01')]


@njit(cache=True)
def grid_sim(o, hi, lo, c, reset_idx, width, n_lv, fee):
    """Rollende grid: bij elke reset een nieuwe grid rond de prijs (+-width), helft cash helft BTC.
    Buiten de grid: niets doen tot de volgende reset. Elke grid-lijn = 1/n_lv van het kapitaal."""
    N = len(c); eq = np.ones(N); cash = 0.5; btc = 0.5 / o[0]
    levels = np.zeros(n_lv + 1); held = np.zeros(n_lv + 1, np.bool_); unit = 0.0
    r = 0
    for i in range(N):
        if r < len(reset_idx) and i == reset_idx[r]:
            tot = cash + btc * o[i]
            # herbalanceer naar 50/50 (kost fee over het verschil)
            tgt = tot / 2; diff = abs(btc * o[i] - tgt); tot -= diff * fee
            cash = tot / 2; btc = tot / 2 / o[i]
            for k in range(n_lv + 1):
                levels[k] = o[i] * (1 - width + 2 * width * k / n_lv)
                held[k] = levels[k] >= o[i]          # lijnen boven de prijs: BTC ligt klaar om te verkopen
            unit = tot / n_lv / o[i]
            r += 1
        # koop op lijnen die geraakt worden onder de prijs, verkoop erboven
        for k in range(n_lv):
            buy = levels[k]; sell = levels[k + 1]
            if not held[k] and lo[i] <= buy and cash >= unit * buy * (1 + fee):
                cash -= unit * buy * (1 + fee); btc += unit; held[k] = True
            elif held[k] and hi[i] >= sell and btc >= unit:
                cash += unit * sell * (1 - fee); btc -= unit; held[k] = False
        eq[i] = cash + btc * c[i]
    return eq


def grid(width, n_lv, every):
    idx = h.index
    resets = np.unique(idx.searchsorted(pd.date_range(idx[0], idx[-1], freq=every)))
    eq = grid_sim(*(h[k].values for k in ['open', 'high', 'low', 'close']), resets.astype(np.int64), width, n_lv, FEE)
    return pd.Series(eq, idx).resample('1D').last()


if __name__ == '__main__':
    rows = []
    for w in [0.05, 0.10, 0.20, 0.30]:
        for n in [10, 20, 40]:
            for ev in ['7D', '30D', '90D']:
                e = grid(w, n, ev)
                (ic, idd), (oc, odd), (fc, fdd) = split(e)
                rows.append(dict(techniek='Grid', instelling=f'+-{int(w*100)}%, {n} lijnen, reset {ev}',
                                 is_cagr=ic, oos_cagr=oc, oos_dd=odd, full_cagr=fc, full_dd=fdd))
    # DCA: elke week een vast bedrag kopen, rendement als IRR-benadering via eindwaarde/inleg
    c = h.close.resample('W').last()
    inleg = np.ones(len(c)); btc_bought = (inleg * (1 - FEE) / c.values).cumsum()
    val = btc_bought * c.values; paid = inleg.cumsum()
    rows.append(dict(techniek='DCA (wekelijks kopen)', instelling=f'eindwaarde {val[-1]/paid[-1]:.2f}x de inleg',
                     is_cagr=np.nan, oos_cagr=np.nan, oos_dd=(val / paid / np.maximum.accumulate(val / paid) - 1).min(),
                     full_cagr=np.nan, full_dd=np.nan))
    bh = h.close.resample('1D').last()
    (ic, idd), (oc, odd), (fc, fdd) = split(bh)
    rows.append(dict(techniek='Buy & hold', instelling='', is_cagr=ic, oos_cagr=oc, oos_dd=odd, full_cagr=fc, full_dd=fdd))
    res = pd.DataFrame(rows); res.to_csv('results/othertech.csv', index=False)
    pd.set_option('display.width', 200)
    g = res[res.techniek == 'Grid']
    print(g.sort_values('is_cagr', ascending=False).head(8).round(3).to_string())
    print('grid: aandeel varianten met blind winst', (g.oos_cagr > 0).mean().round(2), 'mediaan blind', g.oos_cagr.median().round(3))
    print(res[res.techniek != 'Grid'].round(3).to_string())
