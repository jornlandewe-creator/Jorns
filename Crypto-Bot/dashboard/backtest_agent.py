"""Backtest van de Agent-profielen met precies dezelfde module-code als live (AgentModule + System), op dagdata 2018 - sep 2026.

    python backtest_agent.py                  # alle agent-profielen
    python backtest_agent.py agent 2023-01-01 # een profiel vanaf een datum

Beslist elke dag na het dagslot, voert uit tegen dat slot (plus slippage). Kosten 0,05% fee + 0,03% slippage per kant.
Bij hefboom betaalt de geleende helft 0,03% per dag financiering. Alleen data van voor elk beslismoment wordt gebruikt.
"""
import os, sys, json
import numpy as np, pandas as pd
from modules import System, PaperBrokerMulti, PROFILES, COINS

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, 'data', 'coins')


class DailyReplayFeed:
    """Speelt dagcandles af. now() = vlak na het dagslot. price() = slot van die dag. intrabar() = (open, high, low) van de dag."""
    def __init__(self, start='2018-01-01', end=None, coins=COINS):
        self.d = {}
        for c in coins:
            df = pd.read_csv(os.path.join(ROOT, f'{c}_1d.csv.gz'), index_col=0, parse_dates=True)
            self.d[c] = df
        self.clock = self.d['BTC'].index
        self.i = self.clock.searchsorted(pd.Timestamp(start, tz='UTC'))
        self.end = self.clock.searchsorted(pd.Timestamp(end, tz='UTC')) if end else len(self.clock)
        self.start_i = self.i; self._cache = {}
    def step_hours(self): return 24.0
    def now(self): return self.clock[self.i] + pd.Timedelta(days=1)
    def _row(self, c):
        df = self.d.get(c); t = self.clock[self.i]
        if df is None or t not in df.index: return None
        return df.loc[t]
    def price(self, c='BTC'):
        r = self._row(c)
        if r is not None: return float(r.close)
        df = self.candles(c, '1d', 5); return float(df.close.iloc[-1]) if len(df) else float('nan')
    def intrabar(self, c='BTC'):
        r = self._row(c); return (float(r.open), float(r.high), float(r.low)) if r is not None else None
    def candles(self, c, tf, n=400):
        assert tf == '1d', 'deze replay heeft alleen dagdata'
        key = (c, self.i)
        hit = self._cache.get(key)
        if hit is not None and hit[0] >= n: return hit[1].iloc[-n:]
        df = self.d.get(c)
        if df is None: return pd.DataFrame()
        j = df.index.searchsorted(self.clock[self.i], side='right')
        out = df.iloc[max(0, j - n):j]
        if len(self._cache) > 100: self._cache.clear()
        self._cache[key] = (n, out); return out
    def advance(self):
        self.i += 1; return self.i < min(self.end, len(self.clock))
    def progress(self): return self.clock[min(self.i, len(self.clock) - 1)].isoformat()


def run_profile(key, start='2018-01-01', end=None, capital=1000.0, log=lambda m: None, fee=0.0005, slip=0.0003):
    p = PROFILES[key]
    feed = DailyReplayFeed(start, end, coins=['BTC', 'ETH', 'SOL'])
    sysm = System(capital=capital, lev=p['lev'], use_filter=False, weights=p['weights'], agent=p.get('agent'), daystop=p.get('dagstop'),
                  log=log, brake=p['brake'], stop=p['stop'], sysfilter=p['sysfilter'], risk_parity=False)
    broker = PaperBrokerMulti(fee, slip)
    while True:
        sysm.step(feed, broker)
        if not feed.advance(): break
    eq = pd.Series([x[1] for x in sysm.meta['equity']], index=pd.to_datetime([x[0] for x in sysm.meta['equity']], utc=True))
    return sysm, eq


def report(eq, trades, capital=1000.0):
    e = pd.concat([pd.Series([capital], index=[eq.index[0] - pd.Timedelta(days=1)]), eq]) / capital
    y = (e.index[-1] - e.index[0]).days / 365.25
    r = e.pct_change().dropna(); m = e.resample('ME').last().pct_change().dropna()
    dd = e / e.cummax() - 1
    out = dict(per_jaar=e.iloc[-1] ** (1 / y) - 1, totaal=e.iloc[-1] - 1, daling=dd.min(), sharpe=r.mean() / r.std() * np.sqrt(365) if r.std() > 0 else 0,
               pos_maanden=(m > 0).mean(), actief_pos=(m[m.abs() > 1e-9] > 0).mean(), slechtste_maand=m.min(),
               jaren={int(k): round((g.iloc[-1] / g.iloc[0] - 1) * 100) for k, g in e.groupby(e.index.year)})
    pn = np.array([t['pnl'] for t in trades], dtype=float)
    if len(pn):
        out.update(trades=len(pn), winrate=(pn > 0).mean(), trades_per_jaar=len(pn) / y,
                   pf=pn[pn > 0].sum() / -pn[pn <= 0].sum() if (pn <= 0).any() else float('inf'))
    out['calmar'] = out['per_jaar'] / -out['daling'] if out['daling'] < 0 else 0
    return out


def main():
    keys = [sys.argv[1]] if len(sys.argv) > 1 else [k for k in PROFILES if k.startswith('agent')]
    start = sys.argv[2] if len(sys.argv) > 2 else '2018-01-01'
    end = sys.argv[3] if len(sys.argv) > 3 else None
    res = {}
    for k in keys:
        sysm, eq = run_profile(k, start, end)
        tr = sysm.trades(); st = report(eq, tr); res[k] = st
        print(f"{PROFILES[k]['naam']:14s} {st['per_jaar']*100:6.1f}%/jr  daling {st['daling']*100:6.1f}%  sharpe {st['sharpe']:.2f}  calmar {st['calmar']:.2f}  "
              f"trades {st.get('trades', 0)} ({st.get('trades_per_jaar', 0):.0f}/jr) winrate {st.get('winrate', 0)*100:.0f}% pf {st.get('pf', 0):.1f}  "
              f"maanden+ {st['pos_maanden']*100:.0f}% (actief {st['actief_pos']*100:.0f}%) slechtste mnd {st['slechtste_maand']*100:.0f}%  noodstops {len(sysm.meta['rem_log'])}")
        print('   per jaar:', st['jaren'])
    # vergelijking: BTC en BTC+ETH vasthouden
    f = DailyReplayFeed(start, end, coins=['BTC', 'ETH'])
    b = f.d['BTC'].close; e_ = f.d['ETH'].close
    sl = slice(pd.Timestamp(start, tz='UTC'), pd.Timestamp(end, tz='UTC') if end else None)
    for nm, s in [('BTC vasthouden', b[sl]), ('BTC+ETH 50/50 (dagelijks)', ((b.pct_change() + e_.pct_change()) / 2)[sl].fillna(0).add(1).cumprod())]:
        s = s / s.iloc[0]; y = (s.index[-1] - s.index[0]).days / 365.25
        print(f"{nm:28s} {(s.iloc[-1] ** (1 / y) - 1)*100:6.1f}%/jr  daling {(s / s.cummax() - 1).min()*100:6.1f}%")
    json.dump(res, open(os.path.join(HERE, 'results_agent.json'), 'w'), indent=1, default=float)


if __name__ == '__main__':
    main()
