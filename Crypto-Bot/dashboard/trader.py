"""Handelsmotor voor het dashboard.

Portfolio van 7 strategieen op BTC, elk 1/7 van het account, maandelijks herverdeeld,
met trendfilter (hefboom en open posities halveren onder de SMA200 daily, terug bij erboven).
Dezelfde logica als bot_portfolio.py, die met een replay over 2024-2026 de backtest volgde.

Bronnen (feed) en uitvoering (broker) zijn los te kiezen:
  LiveFeed   : publieke koersen van een exchange via ccxt (geen API key nodig)
  ReplayFeed : historische 4h-data afspelen (demo / test)
  PaperBroker: alles virtueel, met 0.1% fee en 0.05% slippage
  LiveBroker : echte orders via ccxt met jouw API key
"""
import json, os, time, threading, collections
from datetime import datetime, timezone
import numpy as np, pandas as pd
from engine import atr
from strategies import nnfx
from library import LIB

FEE, SLIP, FIN_DAY = 0.001, 0.0005, 0.0003
AGG = {'open': 'first', 'high': 'max', 'low': 'min', 'close': 'last', 'volume': 'sum'}

SLEEVES = {
    'trend4h':  dict(naam='Trend 4h', tf='4h', size='risk', sl=2.0, tp1=0, frac=0, shorts=False,
                     fn=lambda d: nnfx(d, dict(trend=200, mf=12, adx=20, volf=0.8, volume=1), False)),
    'bb':       dict(naam='Bollinger breakout', tf='1d', size='full', sl=3.0, tp1=0, frac=0, shorts=False,
                     fn=lambda d: LIB['Bollinger breakout'][0](d, dict(n=50, k=2.5))),
    'kc':       dict(naam='Keltner breakout', tf='1d', size='full', sl=1.5, tp1=0, frac=0, shorts=False,
                     fn=lambda d: LIB['Keltner breakout'][0](d, dict(n=50, k=1.5))),
    'mom':      dict(naam='Momentum', tf='1d', size='risk', sl=1.5, tp1=1.0, frac=0.33, shorts=False,
                     fn=lambda d: LIB['Momentum (ROC)'][0](d, dict(n=60))),
    'sonic':    dict(naam='Sonic R', tf='1d', size='risk', sl=1.5, tp1=1.5, frac=0.33, shorts=True,
                     fn=lambda d: LIB['Sonic R (dragon)'][0](d, dict(f=1, lb=3, x='e89'))),
    'red3':     dict(naam='Rode candles', tf='1d', size='full', sl=0, tp1=0, frac=0, shorts=False,
                     fn=lambda d: LIB['Rode candles op rij'][0](d, dict(k=3, tf=100))),
    'st4h':     dict(naam='Supertrend 4h', tf='4h', size='risk', sl=3.0, tp1=3.0, frac=0.33, shorts=False,
                     fn=lambda d: LIB['Supertrend'][0](d, dict(n=10, m=3.0))),
}


# ------------------------------------------------------------------ feeds

class LiveFeed:
    def __init__(self, exchange_id, symbol):
        import ccxt
        self.ex = getattr(ccxt, exchange_id)({'enableRateLimit': True})
        self.ex.load_markets(); self.symbol = symbol
    def now(self): return datetime.now(timezone.utc)
    def price(self): return float(self.ex.fetch_ticker(self.symbol)['last'])
    def candles(self, tf):
        raw = self.ex.fetch_ohlcv(self.symbol, tf, limit=400)
        df = pd.DataFrame(raw, columns=['t', 'open', 'high', 'low', 'close', 'volume'])
        df['t'] = pd.to_datetime(df.t, unit='ms', utc=True)
        return df.set_index('t').iloc[:-1]          # laatste candle loopt nog
    def advance(self): return True
    def intrabar(self): return None


class ReplayFeed:
    """Speelt historische 4h-candles af. Daily candles worden uit 4h opgebouwd (sluiten om 24:00 UTC)."""
    def __init__(self, path, start='2024-01-01'):
        self.h4 = pd.read_csv(path, index_col=0, parse_dates=True)
        self.i = self.h4.index.searchsorted(pd.Timestamp(start, tz='UTC'))
        self._daily = None; self._day_i = None
    def now(self): return self.h4.index[self.i] + pd.Timedelta(hours=4)   # moment na sluiten candle
    def price(self): return float(self.h4.close.iloc[self.i])
    def candles(self, tf):
        if tf == '4h':
            return self.h4.iloc[max(0, self.i - 399):self.i + 1]
        if self._day_i != self.i:
            d = self.h4.iloc[max(0, self.i - 6 * 420):self.i + 1]
            daily = d.resample('1D').agg(AGG).dropna()
            if self.h4.index[self.i].hour != 20:      # dag nog niet af
                daily = daily.iloc[:-1]
            self._daily = daily.iloc[-400:]; self._day_i = self.i
        return self._daily
    def intrabar(self):
        r = self.h4.iloc[self.i]
        return float(r.open), float(r.high), float(r.low)
    def advance(self):
        self.i += 1
        return self.i < len(self.h4)
    def progress(self):
        return self.h4.index[min(self.i, len(self.h4) - 1)].isoformat()


# ------------------------------------------------------------------ brokers

class PaperBroker:
    live = False
    def amt(self, q): return round(max(q, 0.0), 6)
    def trade(self, sl, side, qty, price):
        fill = price * (1 + SLIP * side)
        sl['cash'] -= FEE * qty * fill
        return fill


class LiveBroker:
    live = True
    def __init__(self, exchange_id, symbol, key, secret, lev):
        import ccxt
        self.ex = getattr(ccxt, exchange_id)({'enableRateLimit': True, 'apiKey': key, 'secret': secret})
        self.ex.load_markets(); self.symbol = symbol
        if lev > 1:
            try: self.ex.set_leverage(int(np.ceil(lev)), symbol)
            except Exception as e: print('Hefboom instellen lukte niet:', e)
    def amt(self, q): return float(self.ex.amount_to_precision(self.symbol, q)) if q > 0 else 0.0
    def trade(self, sl, side, qty, price):
        o = self.ex.create_market_order(self.symbol, 'buy' if side > 0 else 'sell', qty)
        fill = float(o.get('average') or price)
        fee = o.get('fee') or {}
        sl['cash'] -= float(fee.get('cost') or FEE * qty * fill)
        return fill


# ------------------------------------------------------------------ motor

class Trader:
    def __init__(self, lev=3.0, use_filter=True, start_capital=1000.0, state=None, log=None):
        self.lev = float(lev); self.use_filter = use_filter
        self.log = log or (lambda m: None)
        self.st = state or self.fresh(start_capital)

    @staticmethod
    def fresh(capital):
        per = capital / len(SLEEVES)
        return dict(start_capital=capital, sleeves={k: dict(cash=per, pos=0, qty=0.0, qty0=0.0, entry=0.0,
                    stop=0.0, tp1=0.0, tp1_hit=False, realized=0.0, last_bar=None) for k in SLEEVES},
                    regime_up=True, last_rebalance=None, equity=[], trades=[], started=None)

    def cur_lev(self):
        return self.lev if (self.st['regime_up'] or not self.use_filter) else self.lev / 2

    def eq(self, sl, price):
        return sl['cash'] + (sl['pos'] * sl['qty'] * (price - sl['entry']) if sl['pos'] else 0.0)

    def add_cash(self, delta):
        """Geld toevoegen/onttrekken (herverdeling tussen modules), gelijk over de 7 strategieen."""
        for s in self.st['sleeves'].values(): s['cash'] += delta / len(self.st['sleeves'])

    def total(self, price):
        return sum(self.eq(s, price) for s in self.st['sleeves'].values())

    # -- orders
    def _close(self, b, k, price, reason, now):
        sl = self.st['sleeves'][k]
        fill = b.trade(sl, -sl['pos'], sl['qty'], price)
        pnl = sl['pos'] * sl['qty'] * (fill - sl['entry'])
        sl['cash'] += pnl
        total = sl['realized'] + pnl
        margin = sl['qty0'] * sl['entry'] / max(self.lev, 1)
        pct = total / margin * 100 if margin else 0.0
        self.st['trades'].append(dict(t=str(now), strat=SLEEVES[k]['naam'], side='long' if sl['pos'] > 0 else 'short',
                                      entry=round(sl['entry'], 2), exit=round(fill, 2), pnl=round(total, 2),
                                      pct=round(pct, 2), reason=reason))
        self.log(f'{SLEEVES[k]["naam"]}: gesloten ({reason}) @ {fill:,.0f}, resultaat {total:+.2f}')
        sl.update(pos=0, qty=0.0, qty0=0.0, entry=0.0, stop=0.0, tp1=0.0, tp1_hit=False, realized=0.0)

    def _open(self, b, k, side, price, a, now):
        sl = self.st['sleeves'][k]; cfg = SLEEVES[k]
        eq = self.eq(sl, price); L = self.cur_lev()
        dist = cfg['sl'] * a if cfg['sl'] else 0.0
        if cfg['size'] == 'risk' and dist > 0:
            notional = min(eq * 0.02 * L / (dist / price), eq * L)
        else:
            notional = eq * L * 0.995
        qty = b.amt(notional / price)
        if qty <= 0: return
        fill = b.trade(sl, side, qty, price)
        sl.update(pos=side, qty=qty, qty0=qty, entry=fill, realized=0.0, tp1_hit=False,
                  stop=fill - side * dist if dist else 0.0,
                  tp1=fill + side * cfg['tp1'] * a if cfg['tp1'] else 0.0)
        self.log(f'{cfg["naam"]}: {"long" if side > 0 else "short"} geopend @ {fill:,.0f}'
                 + (f', stop {sl["stop"]:,.0f}' if sl['stop'] else ''))

    # -- stappen
    def watch(self, b, k, price, now):
        sl = self.st['sleeves'][k]; cfg = SLEEVES[k]
        if not sl['pos']: return
        p = sl['pos']
        if sl['stop'] and (price - sl['stop']) * p <= 0:
            self._close(b, k, price, 'break-even stop' if sl['tp1_hit'] else 'stop loss', now)
        elif sl['tp1'] and not sl['tp1_hit'] and (price - sl['tp1']) * p >= 0:
            q = b.amt(sl['qty'] * cfg['frac'])
            if q <= 0: return
            fill = b.trade(sl, -p, q, price)
            gain = p * q * (fill - sl['entry']); sl['cash'] += gain; sl['realized'] += gain
            sl['qty'] -= q; sl['tp1_hit'] = True
            sl['stop'] = sl['entry'] * (1 + p * 0.0025)
            self.log(f'{cfg["naam"]}: 1/3 winst genomen @ {fill:,.0f}, stop naar break-even')

    def watch_intrabar(self, b, k, o, h, l, now):
        """Replay: stop/TP binnen een candle zoals minuut-bewaking zou doen."""
        sl = self.st['sleeves'][k]
        if sl['pos'] == 1:
            if sl['stop'] and l <= sl['stop']: self.watch(b, k, min(o, sl['stop']), now)
            elif sl['tp1'] and not sl['tp1_hit'] and h >= sl['tp1']:
                self.watch(b, k, max(o, sl['tp1']), now)
                if sl['pos'] and l <= sl['stop']: self.watch(b, k, sl['stop'], now)
        elif sl['pos'] == -1:
            if sl['stop'] and h >= sl['stop']: self.watch(b, k, max(o, sl['stop']), now)
            elif sl['tp1'] and not sl['tp1_hit'] and l <= sl['tp1']:
                self.watch(b, k, min(o, sl['tp1']), now)
                if sl['pos'] and h >= sl['stop']: self.watch(b, k, sl['stop'], now)

    def on_bar(self, b, k, df, price, now):
        sl = self.st['sleeves'][k]; cfg = SLEEVES[k]
        d = tuple(df[c].values.astype(float) for c in ['open', 'high', 'low', 'close', 'volume'])
        L, S, XL, XS = [np.nan_to_num(np.asarray(x)).astype(bool) for x in cfg['fn'](d)]
        a = atr(d[1], d[2], d[3], 14)[-1]
        if sl['pos'] == 1 and XL[-1]: self._close(b, k, price, 'exit-signaal', now)
        elif sl['pos'] == -1 and XS[-1]: self._close(b, k, price, 'exit-signaal', now)
        elif sl['pos'] == 0:
            if L[-1]: self._open(b, k, 1, price, a, now)
            elif cfg['shorts'] and S[-1] and getattr(self, 'allow_short', True): self._open(b, k, -1, price, a, now)

    def regime(self, b, daily, price, now):
        if not self.use_filter or len(daily) < 200: return
        up = bool(daily.close.iloc[-1] > daily.close.iloc[-200:].mean())
        if up == self.st['regime_up']: return
        self.st['regime_up'] = up
        self.log(f'Trendfilter: BTC {"boven" if up else "onder"} SMA200, hefboom nu {self.cur_lev():g}x')
        f = 2.0 if up else 0.5
        for k, sl in self.st['sleeves'].items():
            if not sl['pos']: continue
            q = b.amt(sl['qty'] * abs(f - 1))
            if q <= 0: continue
            fill = b.trade(sl, sl['pos'] * (1 if f > 1 else -1), q, price)
            pnl = sl['pos'] * sl['qty'] * (fill - sl['entry'])
            sl['cash'] += pnl; sl['realized'] += pnl; sl['entry'] = fill
            sl['qty'] = sl['qty'] + q if f > 1 else sl['qty'] - q

    def rebalance(self, b, price, now):
        m = now.strftime('%Y-%m')
        if self.st['last_rebalance'] == m: return
        first = self.st['last_rebalance'] is None
        self.st['last_rebalance'] = m
        if first: return
        sls = self.st['sleeves']; total = self.total(price); target = total / len(sls)
        for k, sl in sls.items():
            e = self.eq(sl, price)
            if sl['pos'] and e > 0:
                f = target / e
                pnl = sl['pos'] * sl['qty'] * (price - sl['entry'])
                sl['realized'] += pnl; sl['entry'] = price
                delta = b.amt(sl['qty'] * f) - sl['qty'] if f > 1 else -b.amt(sl['qty'] * (1 - f))
                if abs(delta) > 0:
                    b.trade(sl, sl['pos'] * (1 if delta > 0 else -1), abs(delta), price)
                sl['qty'] += delta; sl['qty0'] *= f
            sl['cash'] = target
        self.log(f'Maandelijkse herverdeling: totaal {total:,.2f}')

    def step(self, feed, b):
        """Een ronde: stops bewaken, trendfilter, herverdeling, nieuwe candles verwerken."""
        now = feed.now(); price = feed.price()
        if self.st['started'] is None: self.st['started'] = str(now)
        ib = feed.intrabar()
        for k in SLEEVES:
            if ib: self.watch_intrabar(b, k, *ib, now)
            else: self.watch(b, k, price, now)
        dfs = {tf: feed.candles(tf) for tf in ('4h', '1d')}
        self.regime(b, dfs['1d'], price, now)
        self.rebalance(b, price, now)
        for k, cfg in SLEEVES.items():
            sl = self.st['sleeves'][k]; df = dfs[cfg['tf']]
            if not len(df): continue
            bar = str(df.index[-1])
            if bar != sl['last_bar']:
                if sl['last_bar'] is not None: self.on_bar(b, k, df, price, now)
                sl['last_bar'] = bar
        # financiering over hefboom-posities (paper); bij live rekent de exchange zelf
        if not b.live:
            hrs = feed.step_hours() if hasattr(feed, 'step_hours') else (4 if ib else 1 / 60)
            for sl in self.st['sleeves'].values():
                if sl['pos'] and self.lev > 1: sl['cash'] -= FIN_DAY * hrs / 24 * sl['qty'] * price
        tot = self.total(price)
        eqs = self.st['equity']
        if not eqs or (pd.Timestamp(now) - pd.Timestamp(eqs[-1][0])) >= pd.Timedelta(minutes=15):
            eqs.append([str(now), round(tot, 4), round(price, 2)])
        return tot


# ------------------------------------------------------------------ statistieken

def stats(st):
    e = st['equity']
    out = dict(equity=None, start=st['start_capital'], rendement=None, max_daling=None, weken=[], maanden=[],
               gem_week=None, gem_maand=None, pos_weken=None, pos_maanden=None, trades=len(st['trades']),
               winrate=None, dagen=0)
    if not e: return out
    s = pd.Series([x[1] for x in e], index=pd.to_datetime([x[0] for x in e], utc=True))
    s = s[~s.index.duplicated(keep='last')]
    full = pd.concat([pd.Series([st['start_capital']], index=[s.index[0] - pd.Timedelta(seconds=1)]), s])
    out.update(equity=float(s.iloc[-1]), rendement=float(s.iloc[-1] / st['start_capital'] - 1),
               max_daling=float((full / full.cummax() - 1).min()), dagen=float((s.index[-1] - s.index[0]).total_seconds() / 86400))
    for per, key in [('W-SUN', 'weken'), ('ME', 'maanden')]:
        r = full.resample(per).last().ffill().pct_change().dropna()
        out[key] = [dict(periode=str(i.date()), r=float(v)) for i, v in r.items()][-60:]
        if len(r):
            out['gem_' + ('week' if key == 'weken' else 'maand')] = float(r.mean())
            out['pos_' + key] = float((r > 0).mean())
    t = st['trades']
    if t: out['winrate'] = float(np.mean([x['pnl'] > 0 for x in t]))
    return out
