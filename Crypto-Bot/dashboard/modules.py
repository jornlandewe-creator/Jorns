"""Multi-module handelssysteem: BTC-portfolio + long/short-rotatie + volume-piek + trend-long.

Feeds leveren per munt candles (alleen afgesloten), prijs en de laatste stap (o, h, l) voor stops.
Brokers boeken trades op een 'sleeve' (virtueel deelaccount met cash + posities, margin-boekhouding).
"""
import os, itertools
from datetime import datetime, timezone
import numpy as np, pandas as pd
from engine import atr, ema
from library import sma, rsi_mr, supertrend
from library2 import trades_surge, vol_breakout
import rotation as RT
from trader import Trader, FEE, SLIP, FIN_DAY, AGG
from agent_strategy import AGENT_COINS, AGENT_PARAMS, target_weight, explain, realised_vol

COINS = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'AVAX', 'LINK', 'DOT']
TF_MIN = {'30m': 30, '1h': 60, '4h': 240, '1d': 1440}


# ------------------------------------------------------------------ nieuwsblokkades (gevuld door de nieuwswacht)

def can_trade(mod, coin):
    """Live: alleen munten waarvoor de exchange een contract heeft."""
    t = getattr(mod, 'tradable', None)
    return t is None or coin in t


def news_blocked(news, side, coin, now):
    """True als nieuws een nieuwe positie in deze richting op deze munt (of de hele markt, '*') tijdelijk tegenhoudt."""
    if not news: return False
    blk = news.get('blok_long' if side == 'long' else 'blok_short', {})
    t = pd.Timestamp(now)
    for k in (coin, '*'):
        u = blk.get(k)
        if u and t < pd.Timestamp(u): return True
    return False


# ------------------------------------------------------------------ feeds

class ReplayFeedMulti:
    """Speelt historie af in stappen van 30 minuten (vanaf 2024, zo ver gaat de 30m-data terug)."""
    def __init__(self, root, start='2024-03-01', end=None):
        self.d = {}
        for c in COINS:
            for tf, f in [('30m', '30m'), ('4h', '4h'), ('1d', '1d')]:
                df = pd.read_csv(os.path.join(root, f'{c}_{f}.csv.gz'), index_col=0, parse_dates=True)
                self.d[(c, tf)] = df
            m30 = self.d[(c, '30m')]                      # 1h uit 30m (zelfde als de exchange levert)
            self.d[(c, '1h')] = m30.resample('1h', label='left', closed='left').agg(dict(
                open='first', high='max', low='min', close='last', volume='sum', qvol='sum', ntrades='sum', taker_buy='sum')).dropna(subset=['close'])
        self.clock = self.d[('BTC', '30m')].index
        self.i = self.clock.searchsorted(pd.Timestamp(start, tz='UTC'))
        self.end = self.clock.searchsorted(pd.Timestamp(end, tz='UTC')) if end else len(self.clock)
        self.start_i = self.i
        self._cache = {}
    def step_hours(self): return 0.5
    def now(self): return self.clock[self.i] + pd.Timedelta(minutes=30)
    def _bar(self, c):
        df = self.d[(c, '30m')]; t = self.clock[self.i]
        if t in df.index: return df.loc[t]
        return None
    def price(self, c='BTC'):
        b = self._bar(c); return float(b.close) if b is not None else float(self.candles(c, '30m').close.iloc[-1])
    def intrabar(self, c='BTC'):
        b = self._bar(c); return (float(b.open), float(b.high), float(b.low)) if b is not None else None
    def candles(self, c, tf, n=400):
        key = (c, tf, self.i)
        hit = self._cache.get(key)
        if hit is not None and hit[0] >= n: return hit[1].iloc[-n:]          # buffer kent het gevraagde aantal candles
        df = self.d[(c, tf)]; close_cut = self.now() - pd.Timedelta(minutes=TF_MIN[tf])
        j = df.index.searchsorted(close_cut, side='right')
        out = df.iloc[max(0, j - n):j]
        if len(self._cache) > 200: self._cache.clear()
        self._cache[key] = (n, out)
        return out
    def advance(self):
        self.i += 1; return self.i < min(self.end, len(self.clock))
    def progress(self): return self.clock[min(self.i, len(self.clock) - 1)].isoformat()


class LiveFeedMulti:
    """Publieke koersen via ccxt (geen key). Standaard Binance: die levert ook het aantal trades per candle."""
    def __init__(self, exchange_id='binance', quote='USDT'):
        import ccxt
        self.ex = getattr(ccxt, exchange_id)({'enableRateLimit': True}); self.ex.load_markets()
        self.quote = quote; self.cache = {}; self.pcache = {}
    def sym(self, c): return f'{c}/{self.quote}'
    def step_hours(self): return 1 / 60
    def now(self): return datetime.now(timezone.utc)
    def price(self, c='BTC'):
        t = self.now()
        if c in self.pcache and (t - self.pcache[c][0]).total_seconds() < 20: return self.pcache[c][1]
        p = float(self.ex.fetch_ticker(self.sym(c))['last']); self.pcache[c] = (t, p); return p
    def intrabar(self, c='BTC'): return None
    def candles(self, c, tf, n=400):
        key = (c, tf); now = self.now()
        if key in self.cache and now < self.cache[key][0] and self.cache[key][2] >= n: return self.cache[key][1].iloc[-n:]
        if self.ex.id == 'binance':
            raw = self.ex.publicGetKlines({'symbol': c + self.quote, 'interval': tf, 'limit': min(n + 1, 1000)})
            df = pd.DataFrame([[int(r[0]), *map(float, r[1:6]), float(r[7]), float(r[8]), float(r[9])] for r in raw],
                              columns=['t', 'open', 'high', 'low', 'close', 'volume', 'qvol', 'ntrades', 'taker_buy'])
        else:
            raw = self.ex.fetch_ohlcv(self.sym(c), tf, limit=n + 1)
            df = pd.DataFrame(raw, columns=['t', 'open', 'high', 'low', 'close', 'volume'])
            df['qvol'] = df.volume * df.close; df['ntrades'] = np.nan; df['taker_buy'] = df.volume / 2
        df.index = pd.to_datetime(df.t, unit='ms', utc=True); df = df.drop(columns='t').iloc[:-1]
        nxt = df.index[-1] + pd.Timedelta(minutes=2 * TF_MIN[tf]) + pd.Timedelta(seconds=20)
        self.cache[key] = (nxt, df, n); return df
    def advance(self): return True


class SymView:
    """Laat een multi-feed eruitzien als de single-BTC feed die Trader verwacht."""
    def __init__(self, feed, c='BTC'): self.f = feed; self.c = c
    def now(self): return self.f.now()
    def price(self): return self.f.price(self.c)
    def intrabar(self): return self.f.intrabar(self.c)
    def candles(self, tf): return self.f.candles(self.c, tf)
    def step_hours(self): return self.f.step_hours()


class PaperBrokerMulti:
    """Virtuele uitvoering. Standaard futures-kosten: 0.05% fee + 0.03% slippage per kant."""
    live = False
    def __init__(self, fee=0.0005, slip=0.0003): self.fee = fee; self.slip = slip
    def amt(self, c, q): return round(max(q, 0.0), 6)
    def trade(self, sl, c, side, qty, price):
        fill = price * (1 + self.slip * side); sl['cash'] -= self.fee * qty * fill; return fill


class LiveBrokerMulti:
    """Echte orders op een futures-account (perpetuals of lang lopende futures, zoals OKX X-Perps in Europa).
    - zoekt per munt zelf het juiste contract als de markt-notatie niet bestaat
    - rekent munten om naar contracten (OKX handelt in contracten) en rondt af op wat de exchange toestaat
    - OKX: netto positiemodus (one-way) en cross margin, hefboom per contract met ruimte voor marge
    Munten zonder contract worden overgeslagen (de modules openen daar dan geen posities)."""
    live = True
    def __init__(self, exchange_id, key, secret, symbol_tpl, lev, password='', log=print, ex=None, setup=True):
        if ex is None:
            import ccxt
            ex = getattr(ccxt, exchange_id)({'enableRateLimit': True, 'apiKey': key, 'secret': secret, 'password': password or None})
        self.ex = ex; self.log = log; self.tpl = symbol_tpl; self.lev = lev; self.lev_set = set()
        self.okx = 'okx' in str(getattr(ex, 'id', exchange_id))
        self.ex.load_markets()
        self.syms = {c: self.resolve(c) for c in COINS}
        self.tradable = {c for c, v in self.syms.items() if v}
        b = self.syms.get('BTC')
        self.spot = bool(b) and not self.ex.markets[b].get('contract')     # spot: alleen kopen, geen hefboom
        if setup and self.okx and not self.spot:
            try: self.ex.set_position_mode(False)                    # netto (one-way) modus
            except Exception as e: self.log(f'Positiemodus niet aangepast ({type(e).__name__}: {str(e)[:80]}); zet in OKX zelf "one-way / net mode"')
    def resolve(self, c):
        s = self.tpl.format(c=c)
        if s in self.ex.markets: return s
        cands = [m for m in self.ex.markets.values() if m.get('base') == c and m.get('contract') and m.get('linear')
                 and m.get('settle') in ('USDT', 'USDC') and m.get('active', True) is not False]
        swaps = [m for m in cands if m.get('swap')]
        if swaps: return sorted(swaps, key=lambda m: m.get('settle') != 'USDT')[0]['symbol']
        futs = [m for m in cands if m.get('future')]
        if futs: return max(futs, key=lambda m: m.get('expiry') or 0)['symbol']
        if ':' not in self.tpl:                                          # spot-notatie: probeer gangbare quotes
            for q in ('EUR', 'USDC', 'USDT'):
                mk = self.ex.markets.get(f'{c}/{q}')
                if mk and not mk.get('contract') and mk.get('active', True) is not False: return mk['symbol']
        return None
    def s(self, c): return self.syms.get(c)
    def _cs(self, sym):
        m = self.ex.markets[sym]; return float(m.get('contractSize') or 1) if m.get('contract') else 1.0
    def max_lev(self, sym):
        return ((self.ex.markets[sym].get('limits') or {}).get('leverage') or {}).get('max')
    def _contracts(self, sym, q):
        try: n = float(self.ex.amount_to_precision(sym, q / self._cs(sym)))
        except Exception: return 0.0
        mn = ((self.ex.markets[sym].get('limits') or {}).get('amount') or {}).get('min') or 0
        return n if n > 0 and n >= mn else 0.0
    def amt(self, c, q):
        sym = self.s(c)
        if not sym or q <= 0: return 0.0
        return self._contracts(sym, q) * self._cs(sym)
    def _set_lev(self, sym):
        if sym in self.lev_set or not self.ex.markets[sym].get('contract'): return
        want = max(1, int(np.ceil(self.lev * 2)))                      # ruimte voor marge, positiegrootte bepaalt het risico
        mx = self.max_lev(sym)
        if mx: want = int(min(want, mx))
        try: self.ex.set_leverage(want, sym, {'marginMode': 'cross'} if self.okx else {})
        except Exception as e: self.log(f'Hefboom {sym} niet gezet: {type(e).__name__}: {str(e)[:80]}')
        self.lev_set.add(sym)
    def trade(self, sl, c, side, qty, price):
        sym = self.s(c)
        if not sym: raise RuntimeError(f'order: {c} is niet verhandelbaar op {self.ex.id}')
        self._set_lev(sym)
        n = self._contracts(sym, qty)
        if n <= 0: raise RuntimeError(f'order: {c} hoeveelheid {qty:g} is kleiner dan het minimum van de exchange')
        try: ref = float(self.ex.fetch_ticker(sym).get('last') or 0)       # koers op de exchange zelf (kan in EUR zijn)
        except Exception: ref = 0.0
        contract = self.ex.markets[sym].get('contract')
        o = self.ex.create_order(sym, 'market', 'buy' if side > 0 else 'sell', n, None, {'tdMode': 'cross'} if (self.okx and contract) else {})
        if not o.get('average') and o.get('id'):
            try: o = {**o, **{k: v for k, v in self.ex.fetch_order(o['id'], sym).items() if v}}
            except Exception: pass
        fx = price / ref if ref > 0 else 1.0                                 # omrekenen naar de koersbron van de bot
        fill_ex = float(o.get('average') or o.get('price') or ref or price)
        fill = fill_ex * fx if ref > 0 else fill_ex
        fee = o.get('fee') or {}; cost = fee.get('cost'); quote = self.ex.markets[sym].get('quote')
        if cost is not None and fee.get('currency') in (None, quote, 'USDT', 'USDC', 'USD', 'EUR'): sl['cash'] -= abs(float(cost)) * fx
        else: sl['cash'] -= FEE * n * self._cs(sym) * fill
        return fill


class BrokerView:
    """Single-symbol broker voor Trader (BTC)."""
    def __init__(self, b, c='BTC'): self.b = b; self.c = c; self.live = b.live
    def amt(self, q): return self.b.amt(self.c, q)
    def trade(self, sl, side, qty, price): return self.b.trade(sl, self.c, side, qty, price)


# ------------------------------------------------------------------ module 1: BTC-portfolio

class BTCModule:
    name = 'BTC-portfolio'
    def __init__(self, capital, lev, use_filter, log, state=None):
        self.t = Trader(lev=lev, use_filter=use_filter, start_capital=capital, state=state, log=lambda m: log('[BTC] ' + m))
    @property
    def state(self): return self.t.st
    def step(self, feed, b):
        return self.t.step(SymView(feed), BrokerView(b))
    def equity(self, feed): return self.t.total(feed.price('BTC'))
    def add_cash(self, d): self.t.add_cash(d)
    def positions(self, feed):
        p = feed.price('BTC'); out = []
        from trader import SLEEVES
        for k, s in self.t.st['sleeves'].items():
            if s['pos']:
                out.append(dict(module=self.name, strat=SLEEVES[k]['naam'], coin='BTC', side='long' if s['pos'] > 0 else 'short',
                                entry=s['entry'], stop=s['stop'] or None, pnl=s['pos'] * s['qty'] * (p - s['entry'])))
        return out
    def trades(self): return [dict(t, module=self.name, coin='BTC') for t in self.t.st['trades']]
    def lev_now(self): return self.t.cur_lev()
    def set_lev(self, lev): self.t.lev = lev
    def scale(self, feed, b, f, now, reason):
        """Alle open posities x f (0 = sluiten)."""
        price = feed.price('BTC'); bv = BrokerView(b)
        for k, sl in self.t.st['sleeves'].items():
            if not sl['pos']: continue
            if f == 0: self.t._close(bv, k, price, reason, now); continue
            q = bv.amt(sl['qty'] * abs(f - 1))
            if q <= 0: continue
            fill = bv.trade(sl, sl['pos'] * (1 if f > 1 else -1), q, price)
            pnl = sl['pos'] * sl['qty'] * (fill - sl['entry']); sl['cash'] += pnl; sl['realized'] += pnl; sl['entry'] = fill
            sl['qty'] = sl['qty'] + q if f > 1 else sl['qty'] - q


# ------------------------------------------------------------------ module 2: long/short-rotatie

LS_GRID = dict(n=[7, 14, 21, 30, 60, 90], score=['mom', 'sharpe'], k=[2, 3], reb=[1, 3, 7])
SHORT_STOP = 0.5


def select_ls_params(Cd, Vd):
    """Kies instellingen op de laatste 2 jaar dagdata (hoogste rendement/daling), zoals de walk-forward test."""
    R = Cd.pct_change(fill_method=None).fillna(0); idx = Cd.index; n = len(idx)
    s0 = idx.searchsorted(idx[-1] - pd.Timedelta(days=730))
    best = None
    for n_, sc, k, reb in itertools.product(*LS_GRID.values()):
        p = dict(n=n_, score=sc, k=k, reb=reb, abs='sma', mkt=50, wt='eq', side='ls')
        W = RT.weights(Cd, Vd, R, p, 1).values.astype(float)
        rb = np.zeros(n, np.bool_); rb[s0::reb] = True
        e = RT.sim_stop(R.values.astype(float), W, rb, RT.COST, s0, SHORT_STOP)[s0:]
        y = 2.0; cagr = e[-1] ** (1 / y) - 1; dd = (e / np.maximum.accumulate(e) - 1).min()
        cal = cagr / max(-dd, 0.05)
        if best is None or cal > best[0]: best = (cal, p, cagr, dd)
    return best[1], best[2], best[3]


class LSModule:
    name = 'L/S-rotatie'
    def __init__(self, capital, lev, log, state=None):
        self.lev = lev; self.log = lambda m: log('[L/S] ' + m)
        self.st = state or dict(cash=capital, pos={}, params=None, sel_year=None, last_day=None, days=0, trades=[])
    @property
    def state(self): return self.st
    def _daily(self, feed):
        cl = {}; qv = {}
        for c in COINS:
            df = feed.candles(c, '1d', n=900); cl[c] = df.close; qv[c] = df.qvol
        return pd.DataFrame(cl), pd.DataFrame(qv)
    def equity(self, feed):
        return self.st['cash'] + sum(p['side'] * p['qty'] * (feed.price(c) - p['entry']) for c, p in self.st['pos'].items())
    def add_cash(self, d): self.st['cash'] += d
    def _close(self, b, c, price, reason, now):
        p = self.st['pos'][c]
        fill = b.trade(self.st, c, -p['side'], p['qty'], price)
        pnl = p['side'] * p['qty'] * (fill - p['entry']); self.st['cash'] += pnl
        self.st['trades'].append(dict(t=str(now), strat='L/S-rotatie', side='long' if p['side'] > 0 else 'short', entry=round(p['entry'], 6),
                                      exit=round(fill, 6), pnl=round(pnl + p.get('real', 0.0), 2), pct=None, reason=reason, coin=c))
        del self.st['pos'][c]
        self.log(f'{c} {"short" if p["side"] < 0 else "long"} gesloten ({reason}) @ {fill:,.4g}')
    def step(self, feed, b):
        now = feed.now()
        # stops op shorts (binnen de stap)
        for c in list(self.st['pos']):
            p = self.st['pos'][c]
            if p['side'] < 0 and p['stop']:
                ib = feed.intrabar(c); hi = ib[1] if ib else feed.price(c)
                if hi >= p['stop']:
                    px = max(ib[0], p['stop']) if ib else feed.price(c)
                    self._close(b, c, px, 'stop +50%', now)
        btc_d = feed.candles('BTC', '1d', n=5)
        if not len(btc_d): return self.equity(feed)
        day = str(btc_d.index[-1])
        if day == self.st['last_day']: return self.equity(feed)
        first = self.st['last_day'] is None
        self.st['last_day'] = day; self.st['days'] += 1
        Cd, Vd = self._daily(feed)
        yr = pd.Timestamp(day).year
        if self.st['params'] is None or self.st['sel_year'] != yr:
            p, cg, dd = select_ls_params(Cd, Vd)
            self.st['params'] = p; self.st['sel_year'] = yr; self.st['days'] = 0
            self.log(f'Instellingen gekozen op laatste 2 jaar: {p["score"]} {p["n"]} dagen, {p["k"]} munten per kant, '
                     f'elke {p["reb"]} dag(en) (toen {cg*100:.0f}%/jr, daling {dd*100:.0f}%)')
        p = self.st['params']
        if not first and self.st['days'] % p['reb'] != 0: return self.equity(feed)
        R = Cd.pct_change(fill_method=None).fillna(0)
        w = RT.weights(Cd, Vd, R, p, 1).iloc[-1]
        eq = self.equity(feed)
        for c in COINS:
            price = feed.price(c); target = float(w.get(c, 0.0)) * eq * self.lev / price
            if not can_trade(self, c) or (target < 0 and not getattr(self, 'allow_short', True)): target = 0.0
            if (target < 0 and news_blocked(getattr(self, 'news', None), 'short', c, now)) or \
               (target > 0 and news_blocked(getattr(self, 'news', None), 'long', c, now)): target = 0.0
            cur = self.st['pos'].get(c); cur_q = cur['side'] * cur['qty'] if cur else 0.0
            if abs(target - cur_q) * price < eq * 0.002: continue
            if cur and np.sign(target) != cur['side']:
                self._close(b, c, price, 'rotatie', now); cur = None; cur_q = 0.0
            if target == 0: continue
            if cur:   # bijstellen: resultaat vastzetten, nieuwe basis
                pnl = cur['side'] * cur['qty'] * (price - cur['entry']); self.st['cash'] += pnl; cur['real'] = cur.get('real', 0.0) + pnl
                dq = b.amt(c, abs(target - cur_q))
                if dq <= 0: continue
                b.trade(self.st, c, 1 if target > cur_q else -1, dq, price)
                cur['qty'] = abs(cur_q + (dq if target > cur_q else -dq)); cur['entry'] = price
                cur['stop'] = price * (1 + SHORT_STOP) if cur['side'] < 0 else 0.0
            else:
                q = b.amt(c, abs(target))
                if q <= 0: continue
                side = 1 if target > 0 else -1
                fill = b.trade(self.st, c, side, q, price)
                self.st['pos'][c] = dict(side=side, qty=q, entry=fill, stop=fill * (1 + SHORT_STOP) if side < 0 else 0.0, real=0.0)
                self.log(f'{c} {"long" if side > 0 else "short"} geopend @ {fill:,.4g}')
        return self.equity(feed)
    def finance(self, feed, hrs):
        if self.lev > 1:
            for c, p in self.st['pos'].items(): self.st['cash'] -= FIN_DAY * hrs / 24 * p['qty'] * feed.price(c) * (1 - 1 / self.lev)
    def positions(self, feed):
        return [dict(module=self.name, strat='L/S-rotatie', coin=c, side='long' if p['side'] > 0 else 'short', entry=p['entry'],
                     stop=p['stop'] or None, pnl=p['side'] * p['qty'] * (feed.price(c) - p['entry'])) for c, p in self.st['pos'].items()]
    def trades(self): return [dict(t, module=self.name) for t in self.st['trades']]
    def set_lev(self, lev): self.lev = lev
    def scale(self, feed, b, f, now, reason):
        for c in list(self.st['pos']):
            p = self.st['pos'][c]; price = feed.price(c)
            if f == 0: self._close(b, c, price, reason, now); continue
            q = b.amt(c, p['qty'] * abs(f - 1))
            if q <= 0: continue
            pnl = p['side'] * p['qty'] * (price - p['entry']); self.st['cash'] += pnl; p['real'] = p.get('real', 0.0) + pnl
            b.trade(self.st, c, p['side'] * (1 if f > 1 else -1), q, price)
            p['qty'] = p['qty'] + q if f > 1 else p['qty'] - q; p['entry'] = price


# ------------------------------------------------------------------ module 3: volume-piek 30m

class VolModule:
    name = 'Volume-piek 30m'
    P = dict(n=200, z=3.0, tf=200)
    def __init__(self, capital, lev, log, state=None):
        self.lev = lev; self.log = lambda m: log('[Volume] ' + m)
        self.st = state or dict(sleeves={c: dict(cash=capital / len(COINS), pos=0, qty=0.0, entry=0.0, last_bar=None) for c in COINS}, trades=[])
    @property
    def state(self): return self.st
    def equity(self, feed):
        return sum(s['cash'] + (s['qty'] * (feed.price(c) - s['entry']) if s['pos'] else 0.0) for c, s in self.st['sleeves'].items())
    def add_cash(self, d):
        for s in self.st['sleeves'].values(): s['cash'] += d / len(COINS)
    def step(self, feed, b):
        now = feed.now()
        for c, s in self.st['sleeves'].items():   # noodstop: ruim voor liquidatie (60% van de afstand)
            if s['pos'] and self.lev > 1:
                stop = s['entry'] * (1 - 0.6 / self.lev); ib = feed.intrabar(c); lo = ib[2] if ib else feed.price(c)
                if lo <= stop: self._exit(b, c, s, min(ib[0], stop) if ib else feed.price(c), 'noodstop (liquidatie-bescherming)', now)
        for c, s in self.st['sleeves'].items():
            df = feed.candles(c, '30m', n=260)
            if len(df) < 210: continue
            bar = str(df.index[-1])
            if bar == s['last_bar']: continue
            first = s['last_bar'] is None; s['last_bar'] = bar
            if first: continue
            nt = df.ntrades.values.astype(float)
            if np.isnan(nt).all(): continue
            d = tuple(df[k].values.astype(float) for k in ['open', 'high', 'low', 'close', 'volume', 'taker_buy', 'ntrades'])
            L, _, XL, _ = trades_surge(d, self.P)
            price = feed.price(c)
            if s['pos'] and XL[-1]:
                self._exit(b, c, s, price, 'exit-signaal', now)
            elif not s['pos'] and L[-1] and can_trade(self, c) and not news_blocked(getattr(self, 'news', None), 'long', c, now):
                q = b.amt(c, s['cash'] * self.lev * 0.995 / price)
                if q > 0:
                    fill = b.trade(s, c, 1, q, price); s.update(pos=1, qty=q, entry=fill)
                    self.log(f'{c} long @ {fill:,.4g} (piek in aantal trades)')
        return self.equity(feed)
    def finance(self, feed, hrs):
        if self.lev > 1:
            for c, s in self.st['sleeves'].items():
                if s['pos']: s['cash'] -= FIN_DAY * hrs / 24 * s['qty'] * feed.price(c) * (1 - 1 / self.lev)
    def positions(self, feed):
        return [dict(module=self.name, strat='Volume-piek', coin=c, side='long', entry=s['entry'], stop=None,
                     pnl=s['qty'] * (feed.price(c) - s['entry'])) for c, s in self.st['sleeves'].items() if s['pos']]
    def trades(self): return [dict(t, module=self.name) for t in self.st['trades']]
    def set_lev(self, lev): self.lev = lev
    def _exit(self, b, c, s, price, reason, now):
        fill = b.trade(s, c, -1, s['qty'], price); pnl = s['qty'] * (fill - s['entry']); s['cash'] += pnl
        self.st['trades'].append(dict(t=str(now), strat='Volume-piek', coin=c, side='long', entry=round(s['entry'], 6), exit=round(fill, 6),
                                      pnl=round(pnl + s.get('real', 0.0), 2), pct=None, reason=reason))
        s.update(pos=0, qty=0.0, entry=0.0, real=0.0)
    def scale(self, feed, b, f, now, reason):
        for c, s in self.st['sleeves'].items():
            if not s['pos']: continue
            price = feed.price(c)
            if f == 0: self._exit(b, c, s, price, reason, now); continue
            q = b.amt(c, s['qty'] * abs(f - 1))
            if q <= 0: continue
            pnl = s['qty'] * (price - s['entry']); s['cash'] += pnl; s['real'] = s.get('real', 0.0) + pnl
            b.trade(s, c, 1 if f > 1 else -1, q, price)
            s['qty'] = s['qty'] + q if f > 1 else s['qty'] - q; s['entry'] = price


# ------------------------------------------------------------------ module 4: trend-long (verdient in stijgende markten)

class TrendModule:
    """Drie long-strategieen op 10 munten, elk een eigen deelaccount (30 in totaal):
    - Supertrend 4h (10, 4): instap bij omslag naar boven, alleen als BTC boven zijn 100-daags gemiddelde staat;
      stop 2,5x ATR; uit bij omslag naar beneden of als BTC onder het gemiddelde zakt.
    - Volume-uitbraak 4h (100, 3x): nieuwe hoogste koers van 100 candles op 3x normaal volume; stop 2,5x ATR.
    - RSI-dip 1h (7, <25, uit >70): koop een dip binnen een stijgende munt (boven 200-uurs gemiddelde),
      alleen als BTC boven zijn 100-daags gemiddelde staat.
    Gekozen op 2022-2023 uit 3080 varianten, gecontroleerd op 2024-2026 (zie regime/bullsweep.py)."""
    name = 'Trend-long'
    STRATS = {
        'st': dict(tf='4h', fn=supertrend, p=dict(n=10, m=4.0), sl=2.5, gate=True, vol=False, label='Supertrend 4h', tp1=1.0, frac=0.33),
        'vb': dict(tf='4h', fn=vol_breakout, p=dict(n=100, k=3.0), sl=2.5, gate=False, vol=True, label='Volume-uitbraak 4h', tp1=1.0, frac=0.33),
        'rd': dict(tf='1h', fn=rsi_mr, p=dict(n=7, lo=25, exit=70, tf=200), sl=0.0, gate=True, vol=False, label='RSI-dip 1h'),
    }
    def __init__(self, capital, lev, log, state=None, scaleout=False):
        self.lev = lev; self.log = lambda m: log('[Trend] ' + m)
        self.scaleout = scaleout          # hoge-winrate stand: bij +1 ATR 1/3 winst nemen, stop naar break-even
        n = len(self.STRATS) * len(COINS)
        self.st = state or dict(sleeves={f'{k}:{c}': dict(cash=capital / n, pos=0, qty=0.0, entry=0.0, stop=0.0, last_bar=None)
                                         for k in self.STRATS for c in COINS}, trades=[], gate_day=None, gate=False)
    @property
    def state(self): return self.st
    def equity(self, feed):
        return sum(s['cash'] + (s['qty'] * (feed.price(k.split(':')[1]) - s['entry']) if s['pos'] else 0.0) for k, s in self.st['sleeves'].items())
    def add_cash(self, d):
        n = len(self.st['sleeves'])
        for s in self.st['sleeves'].values(): s['cash'] += d / n
    def _gate(self, feed):
        d = feed.candles('BTC', '1d', n=120)
        if len(d) < 100: return False
        day = str(d.index[-1])
        if day != self.st['gate_day']:
            g = bool(d.close.iloc[-1] > d.close.iloc[-100:].mean())
            if g != self.st['gate'] and self.st['gate_day'] is not None:
                self.log('BTC boven 100-daags gemiddelde: trend-strategieen mogen kopen' if g else 'BTC onder 100-daags gemiddelde: trend-strategieen sluiten')
            self.st['gate_day'] = day; self.st['gate'] = g
        return self.st['gate']
    def step(self, feed, b):
        now = feed.now(); gate = self._gate(feed)
        for key, s in self.st['sleeves'].items():            # stops binnen de stap + liquidatie-bescherming
            if not s['pos']: continue
            c = key.split(':')[1]; ib = feed.intrabar(c); lo = ib[2] if ib else feed.price(c)
            stop = max(s['stop'], s['entry'] * (1 - 0.6 / self.lev) if self.lev > 1 else 0.0)
            if stop > 0 and lo <= stop:
                self._exit(b, key, s, min(ib[0], stop) if ib else feed.price(c), 'break-even stop' if s.get('hit') else 'stop', now)
                continue
            tp = s.get('tp1') or 0.0
            if self.scaleout and tp > 0 and not s.get('hit'):
                hi = ib[1] if ib else feed.price(c)
                if hi >= tp:
                    cfg = self.STRATS[key.split(':')[0]]
                    q = b.amt(c, s['qty'] * cfg.get('frac', 0.33))
                    if q > 0 and q < s['qty']:
                        fill = b.trade(s, c, -1, q, max(ib[0], tp) if ib else feed.price(c))
                        gain = q * (fill - s['entry']); s['cash'] += gain; s['real'] = s.get('real', 0.0) + gain
                        s['qty'] -= q; s['hit'] = True; s['stop'] = max(s['stop'], s['entry'] * 1.0016)
                        self.log(f'{c} {cfg["label"]}: 1/3 winst genomen @ {fill:,.4g}, stop naar break-even')
        for k, cfg in self.STRATS.items():
            for c in COINS:
                key = f'{k}:{c}'; s = self.st['sleeves'][key]
                df = feed.candles(c, cfg['tf'], n=400)
                if len(df) < 210: continue
                bar = str(df.index[-1])
                if bar == s['last_bar']: continue
                first = s['last_bar'] is None; s['last_bar'] = bar
                if first: continue
                cols = ['open', 'high', 'low', 'close', 'volume'] + (['taker_buy', 'ntrades'] if cfg['vol'] else [])
                d = tuple(df[x].values.astype(float) for x in cols)
                L, _, XL, _ = [np.nan_to_num(np.asarray(x, dtype=float)).astype(bool) for x in cfg['fn'](d, cfg['p'])]
                price = feed.price(c)
                if s['pos'] and (XL[-1] or (cfg['gate'] and not gate)):
                    self._exit(b, key, s, price, 'exit-signaal' if XL[-1] else 'BTC onder 100-daags gemiddelde', now)
                elif not s['pos'] and L[-1] and (gate or not cfg['gate']) and can_trade(self, c) and not news_blocked(getattr(self, 'news', None), 'long', c, now):
                    q = b.amt(c, s['cash'] * self.lev * 0.995 / price)
                    if q > 0:
                        a = atr(d[1], d[2], d[3], 14)[-1]
                        fill = b.trade(s, c, 1, q, price)
                        s.update(pos=1, qty=q, entry=fill, stop=fill - cfg['sl'] * a if cfg['sl'] and np.isfinite(a) else 0.0, real=0.0, hit=False,
                                 tp1=fill + cfg.get('tp1', 0) * a if cfg.get('tp1') and np.isfinite(a) else 0.0)
                        self.log(f'{c} long @ {fill:,.4g} ({cfg["label"]})')
        return self.equity(feed)
    def finance(self, feed, hrs):
        if self.lev > 1:
            for key, s in self.st['sleeves'].items():
                if s['pos']: s['cash'] -= FIN_DAY * hrs / 24 * s['qty'] * feed.price(key.split(':')[1]) * (1 - 1 / self.lev)
    def positions(self, feed):
        return [dict(module=self.name, strat=self.STRATS[key.split(':')[0]]['label'], coin=key.split(':')[1], side='long', entry=s['entry'],
                     stop=s['stop'] or None, pnl=s['qty'] * (feed.price(key.split(':')[1]) - s['entry']))
                for key, s in self.st['sleeves'].items() if s['pos']]
    def trades(self): return [dict(t, module=self.name) for t in self.st['trades']]
    def set_lev(self, lev): self.lev = lev
    def _exit(self, b, key, s, price, reason, now):
        k, c = key.split(':')
        fill = b.trade(s, c, -1, s['qty'], price); pnl = s['qty'] * (fill - s['entry']); s['cash'] += pnl
        self.st['trades'].append(dict(t=str(now), strat=self.STRATS[k]['label'], coin=c, side='long', entry=round(s['entry'], 6),
                                      exit=round(fill, 6), pnl=round(pnl + s.get('real', 0.0), 2), pct=None, reason=reason))
        s.update(pos=0, qty=0.0, entry=0.0, stop=0.0, real=0.0, hit=False, tp1=0.0)
    def scale(self, feed, b, f, now, reason):
        for key, s in self.st['sleeves'].items():
            if not s['pos']: continue
            c = key.split(':')[1]; price = feed.price(c)
            if f == 0: self._exit(b, key, s, price, reason, now); continue
            q = b.amt(c, s['qty'] * abs(f - 1))
            if q <= 0: continue
            pnl = s['qty'] * (price - s['entry']); s['cash'] += pnl; s['real'] = s.get('real', 0.0) + pnl
            b.trade(s, c, 1 if f > 1 else -1, q, price)
            s['qty'] = s['qty'] + q if f > 1 else s['qty'] - q; s['entry'] = price


# ------------------------------------------------------------------ module 5: trend-vasthouden (BTC + ETH)

class HoldModule:
    """Trend-vasthouden: de helft van de pot voor BTC en de helft voor ETH. Een munt wordt gehouden zolang hij boven zijn
    n-daags gemiddelde staat (met een band tegen heen-en-weer: erin boven gemiddelde x (1+band), eruit onder x (1-band)),
    anders staat die helft in cash. Beslissen op het dagslot ('dag') of op elk 2-uursslot ('2u') tegen het gemiddelde van de
    afgesloten dagen. Elke maand worden de twee helften weer gelijk getrokken. Geen hefboom, geen shorts.
    Vooraf vastgelegde regels: robust/REGELS_VOORAF.md (aanvulling 2, 3 en 4), getest 2018-2026."""
    name = 'Trend-vasthouden'
    COINS2 = ('BTC', 'ETH')
    def __init__(self, capital, lev, log, state=None, n=200, band=0.0, check='dag', naam=None):
        if naam: self.name = naam
        self.lev = lev; self.log = lambda m: log('[Vasthouden] ' + m)
        self.n = int(n); self.band = float(band); self.check = check
        self.st = state or dict(sleeves={c: dict(cash=capital / 2, pos=0, qty=0.0, entry=0.0) for c in self.COINS2},
                                trades=[], last_week=None, last_month=None)
        self.st.setdefault('last_month', None)
    @property
    def state(self): return self.st
    def equity(self, feed):
        return sum(s['cash'] + (s['qty'] * (feed.price(c) - s['entry']) if s['pos'] else 0.0) for c, s in self.st['sleeves'].items())
    def add_cash(self, d):
        for s in self.st['sleeves'].values(): s['cash'] += d / len(self.st['sleeves'])
    def _sleeve_eq(self, c, s, p): return s['cash'] + (s['qty'] * (p - s['entry']) if s['pos'] else 0.0)
    def step(self, feed, b):
        now = feed.now()
        d = feed.candles('BTC', '1d', n=self.n + 60)
        if len(d) < self.n + 1: return self.equity(feed)
        if self.check == '2u':
            slot = pd.Timestamp(now).floor('2h')
            tag = str(slot)
        else:
            tag = str(d.index[-1])
        if tag == self.st['last_week']: return self.equity(feed)          # elk nieuw slot één keer beslissen
        self.st['last_week'] = tag
        mth = pd.Timestamp(now).strftime('%Y-%m')
        new_month = self.st['last_month'] != mth; self.st['last_month'] = mth
        # 1) per munt: boven of onder het gemiddelde (met band)
        want = {}
        for c, s in self.st['sleeves'].items():
            dc = feed.candles(c, '1d', n=self.n + 60)
            if len(dc) < self.n or not can_trade(self, c): want[c] = False; continue
            ma = float(dc.close.iloc[-self.n:].mean())
            p = float(dc.close.iloc[-1]) if self.check == 'dag' else feed.price(c)
            if s['pos']: want[c] = p >= ma * (1 - self.band)
            else: want[c] = p > ma * (1 + self.band)
        # 2) uitstappen
        for c, s in self.st['sleeves'].items():
            if s['pos'] and not want[c]: self._exit(b, c, s, feed.price(c), f'onder {self.n}-daags gemiddelde', now)
        # 3) maandelijks: beide helften weer even groot (winst blijft volledig in de pot)
        if new_month:
            tot = self.equity(feed)
            for c, s in self.st['sleeves'].items():
                if s['pos']:
                    p = feed.price(c); pnl = s['qty'] * (p - s['entry'])
                    s['cash'] += pnl; s['real'] = s.get('real', 0.0) + pnl; s['entry'] = p
            for s in self.st['sleeves'].values(): s['cash'] = tot / len(self.st['sleeves'])
            for c, s in self.st['sleeves'].items():
                if not s['pos']: continue
                price = feed.price(c); tq = s['cash'] * min(self.lev, 1.0) * 0.995 / price
                if abs(tq - s['qty']) > 0.05 * tq:
                    q = b.amt(c, abs(tq - s['qty']))
                    if q > 0:
                        side = 1 if tq > s['qty'] else -1
                        fill = b.trade(s, c, side, q, price); s['cash'] -= side * q * (fill - price); s['qty'] += side * q
                        self.log(f'{c} bijgesteld naar de helft van het totaal ({"+" if side > 0 else "-"}{q:g})')
        # 4) instappen met het geld van die helft
        for c, s in self.st['sleeves'].items():
            if not want[c] or s['pos']: continue
            if news_blocked(getattr(self, 'news', None), 'long', c, now): continue
            price = feed.price(c); q = b.amt(c, s['cash'] * min(self.lev, 1.0) * 0.995 / price)
            if q > 0:
                fill = b.trade(s, c, 1, q, price); s.update(pos=1, qty=q, entry=fill, real=0.0)
                self.log(f'{c} gekocht @ {fill:,.2f}: boven het {self.n}-daags gemiddelde')
        return self.equity(feed)
    def finance(self, feed, hrs): pass
    def positions(self, feed):
        return [dict(module=self.name, strat=self.name, coin=c, side='long', entry=s['entry'], stop=None,
                     pnl=s['qty'] * (feed.price(c) - s['entry'])) for c, s in self.st['sleeves'].items() if s['pos']]
    def trades(self): return [dict(t, module=self.name) for t in self.st['trades']]
    def set_lev(self, lev): self.lev = lev
    def _exit(self, b, c, s, price, reason, now):
        fill = b.trade(s, c, -1, s['qty'], price); pnl = s['qty'] * (fill - s['entry']); s['cash'] += pnl
        self.st['trades'].append(dict(t=str(now), strat=self.name, coin=c, side='long', entry=round(s['entry'], 6),
                                      exit=round(fill, 6), pnl=round(pnl + s.get('real', 0.0), 2), pct=None, reason=reason))
        s.update(pos=0, qty=0.0, entry=0.0, real=0.0)
        self.log(f'{c} verkocht @ {fill:,.2f} ({reason})')
    def scale(self, feed, b, f, now, reason):
        for c, s in self.st['sleeves'].items():
            if not s['pos']: continue
            price = feed.price(c)
            if f == 0: self._exit(b, c, s, price, reason, now); continue
            q = b.amt(c, s['qty'] * abs(f - 1))
            if q <= 0: continue
            pnl = s['qty'] * (price - s['entry']); s['cash'] += pnl; s['real'] = s.get('real', 0.0) + pnl
            b.trade(s, c, 1 if f > 1 else -1, q, price)
            s['qty'] = s['qty'] + q if f > 1 else s['qty'] - q; s['entry'] = price



# ------------------------------------------------------------------ module 6: agent (trend-ensemble x marktfilter x volatiliteitsdoel)

class AgentModule:
    """Agent: BTC, ETH en SOL, elk een eigen deel van de pot. Per munt een doelgewicht (0 .. plafond) uit agent_strategy.target_weight:
    hard marktfilter (BTC en de munt boven hun 200-daags gemiddelde), trend-ensemble (20/50/100 dagen, band 2%) en
    volatiliteitsdoel (60% per jaar, 30 dagen). Een keer per dag na het dagslot herbalanceren naar het doel als het verschil
    groter is dan 2% van het deelaccount. Maandelijks worden de drie delen weer gelijk getrokken. Alleen long.
    Bij hefboom (plafond > 1): noodstop ruim voor liquidatie (60% van de afstand)."""
    name = 'Agent'
    def __init__(self, capital, lev, log, state=None, cap=1.5, naam=None, coins=AGENT_COINS, params=None, shorts=False):
        if naam: self.name = naam
        self.lev = lev; self.cap = float(cap); self.shorts = bool(shorts); self.log = lambda m: log('[Agent] ' + m)
        self.coins = tuple(coins); self.p = dict(AGENT_PARAMS, **(params or {}))
        self.st = state or dict(sleeves={c: dict(cash=capital / len(self.coins), pos=0, qty=0.0, entry=0.0, real=0.0, w=0.0) for c in self.coins},
                                trades=[], last_day=None, last_month=None, info={})
        for c in self.coins: self.st['sleeves'].setdefault(c, dict(cash=0.0, pos=0, qty=0.0, entry=0.0, real=0.0, w=0.0))
        self.st.setdefault('info', {}); self.st.setdefault('last_month', None)
    @property
    def state(self): return self.st
    def _cap(self):
        """Plafond voor het gewicht: profielplafond x stand van de noodrem (System geeft lev x factor door)."""
        return self.cap * max(min(self.lev / max(self.cap, 1e-9), 1.0), 0.0)
    def _eq(self, c, s, p): return s['cash'] + (s['pos'] * s['qty'] * (p - s['entry']) if s['pos'] else 0.0)
    def equity(self, feed): return sum(self._eq(c, s, feed.price(c)) for c, s in self.st['sleeves'].items())
    def add_cash(self, d):
        for s in self.st['sleeves'].values(): s['cash'] += d / len(self.st['sleeves'])
    def _mark(self, s, price):
        """Open resultaat boeken naar cash en de instap op de huidige koers zetten (voor bijstellen)."""
        if s['pos']:
            pnl = s['pos'] * s['qty'] * (price - s['entry']); s['cash'] += pnl; s['real'] = s.get('real', 0.0) + pnl; s['entry'] = price
    def _exit(self, b, c, s, price, reason, now):
        side = s['pos'] or 1
        fill = b.trade(s, c, -side, s['qty'], price); pnl = side * s['qty'] * (fill - s['entry']); s['cash'] += pnl
        self.st['trades'].append(dict(t=str(now), strat=self.name, coin=c, side='long' if side > 0 else 'short', entry=round(s.get('entry0') or s['entry'], 6), exit=round(fill, 6),
                                      pnl=round(pnl + s.get('real', 0.0), 2), pct=None, reason=reason))
        s.update(pos=0, qty=0.0, entry=0.0, entry0=0.0, real=0.0, w=0.0)
        self.log(f'{c} {"verkocht" if side > 0 else "short gesloten"} @ {fill:,.4g} ({reason})')
    def _set(self, b, c, s, target_notional, price, now, why):
        """Positie bijstellen naar een doelwaarde in geld (negatief = short). Kleine verschillen (< drempel) worden genegeerd."""
        eq = self._eq(c, s, price); cur = s['pos'] * s['qty'] * price if s['pos'] else 0.0
        if abs(target_notional - cur) < self.p['reb_thresh'] * max(eq, 1e-9): return
        if s['pos'] and (target_notional == 0.0 or np.sign(target_notional) != s['pos']):
            self._exit(b, c, s, price, why, now); cur = 0.0
            if target_notional == 0.0: return
        side = 1 if target_notional > 0 else -1
        dq = b.amt(c, abs(target_notional - cur) / price)
        if dq <= 0: return
        if abs(target_notional) > abs(cur):                       # vergroten (of openen) in de richting van de positie
            fill = b.trade(s, c, side, dq, price)
            if s['pos']: s['entry'] = (s['entry'] * s['qty'] + fill * dq) / (s['qty'] + dq); s['qty'] += dq
            else: s.update(pos=side, qty=dq, entry=fill, entry0=fill, real=0.0); self.log(f'{c} {"gekocht" if side > 0 else "short geopend"} @ {fill:,.4g} ({why})')
        else:                                                     # verkleinen
            if dq >= s['qty']: self._exit(b, c, s, price, why, now); return
            fill = b.trade(s, c, -side, dq, price); pnl = side * dq * (fill - s['entry']); s['cash'] += pnl; s['real'] = s.get('real', 0.0) + pnl
            s['qty'] -= dq; self.log(f'{c} verkleind naar {s["qty"] * price / max(eq, 1e-9) * 100:.0f}% ({why})')
    def step(self, feed, b):
        now = feed.now(); cap = self._cap()
        for c, s in self.st['sleeves'].items():            # liquidatie-bescherming (elke ronde): longs bij hefboom, shorts altijd
            if s['pos'] == 1 and cap > 1.0:
                stop = s['entry'] * (1 - 0.6 / cap); ib = feed.intrabar(c); lo = ib[2] if ib else feed.price(c)
                if lo <= stop: self._exit(b, c, s, min(ib[0], stop) if ib else feed.price(c), 'noodstop (liquidatie-bescherming)', now)
            elif s['pos'] == -1:
                stop = s['entry'] * (1 + 0.6 / max(cap, 1.0)); ib = feed.intrabar(c); hi = ib[1] if ib else feed.price(c)
                if hi >= stop: self._exit(b, c, s, max(ib[0], stop) if ib else feed.price(c), 'noodstop short (liquidatie-bescherming)', now)
        btc = feed.candles('BTC', '1d', n=self.p['gate_n'] + 30)
        if len(btc) < self.p['gate_n']: return self.equity(feed)
        day = str(btc.index[-1])
        if day == self.st['last_day']: return self.equity(feed)
        self.st['last_day'] = day
        mth = pd.Timestamp(now).strftime('%Y-%m'); new_month = self.st['last_month'] != mth; self.st['last_month'] = mth
        dcs = {c: feed.candles(c, '1d', n=self.p['min_hist'] + 30) for c in self.st['sleeves']}
        elig = [c for c, d in dcs.items() if len(d) >= self.p['min_hist'] and can_trade(self, c)]   # munten met genoeg historie
        if new_month or set(elig) != set(self.st.get('elig') or []):
            # delen weer gelijk trekken over de munten die meedoen (winst blijft in de pot); munten zonder historie krijgen niets
            self.st['elig'] = elig; tot = self.equity(feed)
            for c, s in self.st['sleeves'].items(): self._mark(s, feed.price(c))
            for c, s in self.st['sleeves'].items():
                if s['pos'] and c not in elig: self._exit(b, c, s, feed.price(c), 'munt doet niet meer mee', now)
            for c, s in self.st['sleeves'].items(): s['cash'] = tot / len(elig) if c in elig else 0.0
        for c, s in self.st['sleeves'].items():
            dc = dcs[c]
            allow_short = self.shorts and getattr(self, 'allow_short', True)
            w, info = target_weight(dc.close.values, btc.close.values, cap, self.p, shorts=allow_short) if len(dc) else (0.0, dict(reden='geen data'))
            if not can_trade(self, c): w, info = 0.0, dict(reden='niet verhandelbaar op deze exchange')
            if w != 0 and not s['pos'] and news_blocked(getattr(self, 'news', None), 'long' if w > 0 else 'short', c, now): w, info = 0.0, dict(reden='nieuwsblokkade')
            self.st['info'][c] = dict(info, w=round(w, 3), dag=day[:10])
            price = feed.price(c); eq = self._eq(c, s, price)
            if s['pos']: self._mark(s, price)
            self._set(b, c, s, w * eq * 0.995, price, now, explain(w, info) if w != 0 else info.get('reden', 'uit'))
            s['w'] = round(w, 3)
        return self.equity(feed)
    def finance(self, feed, hrs):
        """Financiering (paper): geleend deel van longs en de hele short-notional betalen 0,03% per dag."""
        for c, s in self.st['sleeves'].items():
            if s['pos']:
                p = feed.price(c); notional = s['qty'] * p
                borrowed = notional if s['pos'] < 0 else max(notional - self._eq(c, s, p), 0.0)
                if borrowed > 0: s['cash'] -= FIN_DAY * hrs / 24 * borrowed
    def positions(self, feed):
        cap = self._cap()
        return [dict(module=self.name, strat=self.name, coin=c, side='long' if s['pos'] > 0 else 'short', entry=s.get('entry0') or s['entry'],
                     stop=(s['entry'] * (1 - 0.6 / cap) if cap > 1 else None) if s['pos'] > 0 else s['entry'] * (1 + 0.6 / max(cap, 1.0)),
                     pnl=s['pos'] * s['qty'] * (feed.price(c) - s['entry']) + s.get('real', 0.0), gewicht=s.get('w')) for c, s in self.st['sleeves'].items() if s['pos']]
    def trades(self): return [dict(t, module=self.name) for t in self.st['trades']]
    def set_lev(self, lev): self.lev = lev
    def scale(self, feed, b, f, now, reason):
        for c, s in self.st['sleeves'].items():
            if not s['pos']: continue
            price = feed.price(c)
            if f == 0: self._exit(b, c, s, price, reason, now); continue
            q = b.amt(c, s['qty'] * abs(f - 1))
            if q <= 0: continue
            self._mark(s, price)
            b.trade(s, c, s['pos'] * (1 if f > 1 else -1), q, price)
            s['qty'] = s['qty'] + q if f > 1 else s['qty'] - q; s['entry'] = price



# ------------------------------------------------------------------ module 7: agent winrate (zelfde poort, trade-regels met deelwinst)

class AgentWinModule(AgentModule):
    """Agent winrate: dezelfde markt-poort als de Agent (BTC en munt boven 200-daags gemiddelde) en hetzelfde volatiliteitsdoel,
    maar als losse trades met winstname, zodat de meeste trades winnen (in de test rond 67%):
    - instap (na het dagslot): koers meer dan 2% boven het 20- én het 50-daags gemiddelde, grootte = 60% / beweeglijkheid (plafond)
    - deelwinst: bij +1 ATR (14 dagen) wordt 1/3 verkocht en gaat de stop naar break-even (+0,2%)
    - stop: 2 ATR onder de instap, bewaakt elke ronde (intradag)
    - uit (na het dagslot): koers meer dan 2% onder het 50-daags gemiddelde, of de poort gaat dicht
    Onderzoek: onderzoek/agent/winrate.py (dagdata 2018 - sep 2026)."""
    name = 'Agent winrate'
    WIN = dict(fast=20, slow=50, band=0.02, sl_atr=2.0, tp1_atr=1.0, tp1_frac=0.33, be=0.002, atr_n=14)
    def __init__(self, capital, lev, log, state=None, cap=1.5, naam=None, coins=AGENT_COINS, params=None):
        super().__init__(capital, lev, log, state, cap=cap, naam=naam, coins=coins, params=None)
        self.p = dict(AGENT_PARAMS, **self.WIN, **(params or {}))
        for s in self.st['sleeves'].values():
            for k, v in dict(stop=0.0, tp1=0.0, hit=False, atr=0.0).items(): s.setdefault(k, v)
    def _reset(self, s): s.update(pos=0, qty=0.0, entry=0.0, entry0=0.0, real=0.0, w=0.0, stop=0.0, tp1=0.0, hit=False, atr=0.0)
    def _exit(self, b, c, s, price, reason, now):
        super()._exit(b, c, s, price, reason, now); self._reset(s)
    def _watch(self, feed, b, now):
        """Elke ronde: stop (eerst, conservatief) en deelwinst, op de laatste stap (replay) of de huidige koers (live)."""
        for c, s in self.st['sleeves'].items():
            if not s['pos']: continue
            ib = feed.intrabar(c); p = feed.price(c)
            o, hi, lo = ib if ib else (p, p, p)
            if s['stop'] > 0 and lo <= s['stop']:
                self._exit(b, c, s, min(o, s['stop']), 'break-even stop' if s['hit'] else 'stop 2 ATR', now); continue
            if not s['hit'] and s['tp1'] > 0 and hi >= s['tp1']:
                q = b.amt(c, s['qty'] * self.p['tp1_frac'])
                if q <= 0 or q >= s['qty']: s['hit'] = True; continue
                fill = b.trade(s, c, -1, q, max(o, s['tp1'])); gain = q * (fill - s['entry']); s['cash'] += gain; s['real'] = s.get('real', 0.0) + gain
                s['qty'] -= q; s['hit'] = True; s['stop'] = max(s['stop'], s['entry'] * (1 + self.p['be']))
                self.log(f'{c}: 1/3 winst genomen @ {fill:,.4g} (+1 ATR), stop naar break-even')
    def step(self, feed, b):
        now = feed.now(); cap = self._cap(); p = self.p
        self._watch(feed, b, now)
        btc = feed.candles('BTC', '1d', n=p['gate_n'] + 30)
        if len(btc) < p['gate_n']: return self.equity(feed)
        day = str(btc.index[-1])
        if day == self.st['last_day']: return self.equity(feed)
        self.st['last_day'] = day
        mth = pd.Timestamp(now).strftime('%Y-%m'); new_month = self.st['last_month'] != mth; self.st['last_month'] = mth
        dcs = {c: feed.candles(c, '1d', n=p['min_hist'] + 30) for c in self.st['sleeves']}
        elig = [c for c, d in dcs.items() if len(d) >= p['min_hist'] and can_trade(self, c)]
        if new_month or set(elig) != set(self.st.get('elig') or []):
            self.st['elig'] = elig; tot = self.equity(feed)
            for c, s in self.st['sleeves'].items(): self._mark(s, feed.price(c))
            for c, s in self.st['sleeves'].items():
                if s['pos'] and c not in elig: self._exit(b, c, s, feed.price(c), 'munt doet niet meer mee', now)
            for c, s in self.st['sleeves'].items(): s['cash'] = tot / len(elig) if c in elig else 0.0
        btc_up = float(btc.close.iloc[-1]) > float(btc.close.iloc[-p['gate_n']:].mean())
        for c, s in self.st['sleeves'].items():
            dc = dcs[c]; price = feed.price(c)
            if c not in elig:
                self.st['info'][c] = dict(reden='te weinig historie of niet verhandelbaar', w=0, dag=day[:10]); continue
            cl = dc.close.values.astype(float)
            coin_up = cl[-1] > cl[-p['gate_n']:].mean(); gate = btc_up and coin_up
            f = cl[-p['fast']:].mean(); sl_ = cl[-p['slow']:].mean()
            above = cl[-1] > f * (1 + p['band']) and cl[-1] > sl_ * (1 + p['band']); below = cl[-1] < sl_ * (1 - p['band'])
            v = realised_vol(cl, p['vol_n']); scale = min(cap, p['vol_target'] / v) if (v and np.isfinite(v) and v > 0) else 0.0
            if s['pos'] and (below or not gate):
                self._exit(b, c, s, price, 'onder 50-daags gemiddelde' if below else 'poort dicht (onder 200-daags gemiddelde)', now)
            elif not s['pos'] and gate and above and scale > 0 and not news_blocked(getattr(self, 'news', None), 'long', c, now):
                a = float(atr(dc.high.values.astype(float), dc.low.values.astype(float), cl, p['atr_n'])[-1])
                eq = self._eq(c, s, price); q = b.amt(c, eq * scale * 0.995 / price)
                if q > 0 and np.isfinite(a) and a > 0:
                    fill = b.trade(s, c, 1, q, price)
                    s.update(pos=1, qty=q, entry=fill, entry0=fill, real=0.0, w=round(scale, 3), atr=a, stop=fill - p['sl_atr'] * a, tp1=fill + p['tp1_atr'] * a, hit=False)
                    self.log(f'{c} gekocht @ {fill:,.4g}: boven 20- en 50-daags gemiddelde, inzet {scale*100:.0f}% (beweeglijkheid {v*100:.0f}%), stop {s["stop"]:,.4g}, deelwinst bij {s["tp1"]:,.4g}')
            self.st['info'][c] = dict(reden='trend' if gate else ('BTC onder 200-daags gemiddelde' if not btc_up else 'munt onder 200-daags gemiddelde'),
                                      gate=int(gate), boven=int(above), vol=round(v, 3) if v == v else None, schaal=round(scale, 3), w=s.get('w', 0), dag=day[:10])
        return self.equity(feed)
    def positions(self, feed):
        return [dict(module=self.name, strat=self.name, coin=c, side='long', entry=s.get('entry0') or s['entry'], stop=s['stop'] or None,
                     pnl=s['qty'] * (feed.price(c) - s['entry']) + s.get('real', 0.0), gewicht=s.get('w'), deelwinst=s.get('hit')) for c, s in self.st['sleeves'].items() if s['pos']]
    def scale(self, feed, b, f, now, reason):
        super().scale(feed, b, f, now, reason)
        for s in self.st['sleeves'].values():                    # na bijstellen blijven stop en deelwinstniveau op koersniveau staan
            if not s['pos']: self._reset(s)


# ------------------------------------------------------------------ systeem

PROFILES = {
    # Agent winrate (v13): zelfde poort en volatiliteitsdoel als Agent, maar losse trades met deelwinst op +1 ATR en break-even stop:
    # winrate rond 67% in plaats van 30%, tegen ongeveer 8 procentpunt minder rendement per jaar en een kleinere daling. Zie onderzoek/agent/winrate.py.
    'agent_winrate':  dict(naam='Agent winrate', lev=1.5, brake=None, stop=0.30, sysfilter=False, weights=(0, 0, 0, 0, 0, 0, 1), agent=dict(cap=1.5), dagstop=0.25,
                           verwacht=dict(dag='0,10%', maand='+3,2%', jaar='45% (2018-2026; 2023-2026: 33%)', daling='−24%', winrate='66%')),
    # Agent (v13): trend-ensemble x hard marktfilter x volatiliteitsdoel op BTC+ETH+SOL. Dagdata 2018 - sep 2026, kosten 0,05% + 0,03% per kant,
    # buiten de steekproef (2023-2026) gecontroleerd. Zie LEESMIJ.md "Agent" en backtest_agent.py (zelfde code als live).
    # Agent long/short (v13): als Agent, plus shorts (halve grootte) als BTC én de munt onder hun 200-daags gemiddelde staan en het 200-daags
    # gemiddelde van BTC daalt. Alleen futures. Shorts betalen 0,03% per dag. 2018: +18%, 2022: +22% (long-only: -3% en 0%). Zie onderzoek/agent/ls.py.
    'agent_ls':       dict(naam='Agent long/short', lev=1.5, brake=None, stop=0.35, sysfilter=False, weights=(0, 0, 0, 0, 0, 1), agent=dict(cap=1.5, shorts=True), dagstop=0.25,
                           verwacht=dict(dag='0,12%', maand='+3,8%', jaar='57% (2018-2026; 2023-2026: 39%)', daling='−30%', winrate='31%')),
    'agent':          dict(naam='Agent', lev=1.5, brake=None, stop=0.35, sysfilter=False, weights=(0, 0, 0, 0, 0, 1), agent=dict(cap=1.5), dagstop=0.25,
                           verwacht=dict(dag='0,12%', maand='+3,7%', jaar='54% (2018-2026; 2023-2026: 42%)', daling='−27%', winrate='35% (actieve maanden 49%)')),
    'agent_spot':     dict(naam='Agent spot', lev=1.0, brake=None, stop=0.30, sysfilter=False, weights=(0, 0, 0, 0, 0, 1), agent=dict(cap=1.0), dagstop=0.20,
                           verwacht=dict(dag='0,11%', maand='+3,3%', jaar='48% (2018-2026; 2023-2026: 36%)', daling='−24%', winrate='35% (actieve maanden 51%)')),
    'agent_rustig':   dict(naam='Agent rustig', lev=1.0, brake=(0.15, 0.5), stop=0.25, sysfilter=False, weights=(0, 0, 0, 0, 0, 1), agent=dict(cap=1.0, params=dict(vol_target=0.5)), dagstop=0.18,
                           verwacht=dict(dag='0,10%', maand='+2,9%', jaar='39% (2018-2026; 2023-2026: 30%)', daling='−23%', winrate='35% (actieve maanden 51%)')),
    # Echte bot-replays maart 2024 - sep 2026 met vier modules (incl. Trend-long), zie regime/ en results/pt_*_v5.
    #  - verdeling naar risico: aan, maximaal de helft per module
    #  - trendfilter op het hele systeem: uit (kostte in de echte bot veel rendement)
    #  - noodrem: alleen bij hoge hefboom
    # Trend-vasthouden: vooraf vastgelegde, eenvoudige regel; getest 2018-2026 (dagdata), niet afgestemd op deze data.
    'trend_vasthouden': dict(naam='Trend-vasthouden', lev=1.0, brake=None, stop=None, sysfilter=False, weights=(0, 0, 0, 0, 1),
                           verwacht=dict(dag='0,08%', maand='+2,4%', jaar='33% (2018-2026; sinds 2022: 25%)', daling='−62%', winrate='28%')),
    'trend_snel':     dict(naam='Trend snel (proef)', lev=1.0, brake=None, stop=None, sysfilter=False, weights=(0, 0, 0, 0, 1),
                           hold=dict(n=50, band=0.02, check='2u', naam='Trend snel'),
                           verwacht=dict(dag='0,13%', maand='+3,9%', jaar='58% (2018-2026; 2024-2026: 39%)', daling='−49%', winrate='34%')),
    'rustig':         dict(naam='Rustig', lev=1.0, brake=None, stop=0.30, sysfilter=False,
                           verwacht=dict(dag='0,05%', maand='+1,6%', jaar='21%', daling='−11%', winrate='43%')),
    'standaard':      dict(naam='Standaard', lev=2.0, brake=None, stop=0.40, sysfilter=False,
                           verwacht=dict(dag='0,09%', maand='+2,6%', jaar='36%', daling='−23%', winrate='44%')),
    'agressief':      dict(naam='Agressief', lev=4.0, brake=(0.06, 0.5), stop=0.50, sysfilter=False,
                           verwacht=dict(dag='0,18%', maand='+4,6%', jaar='72%', daling='−38%', winrate='44%')),
    # Hoge winrate (rond 70%): alleen Trend-long met gedeeltelijke winstname. Echte replay mrt 2024 - sep 2026.
    'hoge_winrate':   dict(naam='Hoge winrate', lev=4.0, brake=None, stop=0.45, sysfilter=False, weights=(0, 0, 0, 1), scaleout=True,
                           verwacht=dict(dag='0,10%', maand='+2,5%', jaar='35%', daling='−34%', winrate='71%')),
    # Winrate mix (rond 63%): L/S-rotatie + Trend-long met winstname. Echte replay mrt 2024 - sep 2026.
    'winrate_mix':    dict(naam='Winrate mix', lev=2.0, brake=None, stop=0.45, sysfilter=False, weights=(0, 0.5, 0, 0.5), scaleout=True,
                           verwacht=dict(dag='0,11%', maand='+2,8%', jaar='40%', daling='−38%', winrate='63%')),
    'winrate_mix_3x': dict(naam='Winrate mix 3x', lev=3.0, brake=None, stop=0.55, sysfilter=False, weights=(0, 0.5, 0, 0.5), scaleout=True,
                           verwacht=dict(dag='0,14%', maand='+3,5%', jaar='50%', daling='−48%', winrate='62%')),
    'zeer_agressief': dict(naam='Zeer agressief', lev=6.0, brake=(0.06, 0.5), stop=0.60, sysfilter=False,
                           verwacht=dict(dag='0,27%', maand='+6,4%', jaar='110%', daling='−54%', winrate='44%')),
}
PAUSE_DAYS = 14
# Gezondheidsgrens per module, op 1x-basis: ongeveer 1,5x de slechtste daling uit de tests.
MOD_LIMIT = {'btc': 0.20, 'ls': 0.45, 'vol': 0.25, 'trend': 0.25, 'hold': None, 'agent': None, 'agentwin': None}
MOD_PAUSE_DAYS = 30

class System:
    def __init__(self, capital=1000.0, lev=2.0, use_filter=True, weights=(0.30, 0.30, 0.20, 0.20), log=print, state=None, risk_parity=True, brake=None, stop=None, notify=None, sysfilter=False, spot=False, trend_scaleout=False, skim=0.0, hold=None, agent=None, daystop=None):
        tot_w = sum(max(w, 0) for w in weights) or 1.0
        weights = tuple(max(w, 0) / tot_w for w in weights)      # percentages of fracties: altijd naar som 1
        self.log = log; self.weights = weights; self.risk_parity = risk_parity
        st = state or {}
        self.mods = []
        names = ['btc', 'ls', 'vol', 'trend', 'hold', 'agent', 'agentwin']
        for nm, w in zip(names, weights):
            if w <= 0: continue
            s = st.get(nm)
            cap = 0.0 if (st.get('meta') and s is None) else capital * w     # nieuwe module in lopend account: krijgt geld bij herverdeling
            if nm == 'btc': m = BTCModule(cap, lev, use_filter, log, s)
            elif nm == 'ls': m = LSModule(cap, lev, log, s)
            elif nm == 'vol': m = VolModule(cap, lev, log, s)
            elif nm == 'trend': m = TrendModule(cap, lev, log, s, scaleout=trend_scaleout)
            elif nm == 'agent': m = AgentModule(cap, lev, log, s, **(agent or {}))
            elif nm == 'agentwin': m = AgentWinModule(cap, lev, log, s, **(agent or {}))
            else: m = HoldModule(cap, lev, log, s, **(hold or {}))
            m.key = nm; self.mods.append(m)
        self.retire = []                                          # modules uit een vorig profiel: posities sluiten, geld overdragen
        for nm in names:
            if st.get(nm) is not None and nm not in [m.key for m in self.mods]:
                s = st[nm]
                if nm == 'btc': m = BTCModule(0.0, lev, use_filter, log, s)
                elif nm == 'ls': m = LSModule(0.0, lev, log, s)
                elif nm == 'vol': m = VolModule(0.0, lev, log, s)
                elif nm == 'trend': m = TrendModule(0.0, lev, log, s, scaleout=trend_scaleout)
                elif nm == 'agent': m = AgentModule(0.0, lev, log, s)
                elif nm == 'agentwin': m = AgentWinModule(0.0, lev, log, s)
                else: m = HoldModule(0.0, lev, log, s)
                m.key = nm; self.retire.append(m)
        self.meta = st.get('meta') or dict(start_capital=capital, equity=[], last_rebalance=None, started=None)
        self.sysfilter = sysfilter
        self.lev = lev; self.brake = brake; self.stop = stop; self.daystop = daystop; self.notify = notify or (lambda kind, msg: None)
        m = self.meta
        m.setdefault('peak', capital); m.setdefault('rem', 'normaal'); m.setdefault('pauze_tot', None); m.setdefault('rem_log', [])
        m.setdefault('shadow', 1.0); m.setdefault('shadow_peak', 1.0); m.setdefault('last_eq', None); m.setdefault('last_lev', lev)
        m.setdefault('mod_pause', {}); m.setdefault('mod_shadow', {}); m.setdefault('trend_up', True)
        m.setdefault('news', dict(blok_long={}, blok_short={}, log=[]))
        m.setdefault('kluis', 0.0); m.setdefault('skim_hwm', capital); self.skim = float(skim or 0.0)
        for mod in self.mods: mod.news = m['news']
        self.spot = spot
        if spot:                                                  # spot-account: alleen kopen, geen hefboom
            lev = self.lev = 1.0
            for mod in self.mods:
                mod.allow_short = False
                if hasattr(mod, 't'): mod.t.allow_short = False
        self._apply_lev()

    FACT = {'normaal': 1.0, 'half': 0.5, 'pauze': 0.0, 'herstart': 0.5}

    def filt_fact(self):
        return 0.5 if (self.sysfilter and not self.meta.get('trend_up', True)) else 1.0

    def _apply_lev(self):
        f = self.FACT[self.meta['rem']] * self.filt_fact()
        for m in self.mods:
            paused = self.meta.get('mod_pause', {}).get(m.key)
            m.set_lev(1e-9 if paused else max(self.lev * f, 1e-9))

    def _set_rem(self, feed, b, new, now, why):
        old = self.meta['rem']
        if new == old: return
        fo, fn = self.FACT[old], self.FACT[new]
        self.meta['rem'] = new; self._apply_lev()
        f = 0.0 if fn == 0 else (fn / fo if fo > 0 else None)
        if f is not None and abs(f - 1) > 1e-9:
            for m in self.mods:
                if not self.meta['mod_pause'].get(m.key): m.scale(feed, b, f, now, 'noodstop' if new == 'pauze' else 'noodrem')
        self.meta['rem_log'].append([str(now), old, new, why]); self.meta['rem_log'] = self.meta['rem_log'][-50:]
        names = {'normaal': 'volle hefboom', 'half': 'halve hefboom', 'pauze': 'PAUZE, alles gesloten', 'herstart': 'hervat op halve hefboom'}
        self.log(f'NOODREM: {names[new]} ({why})'); self.notify('rem', f'Noodrem: {names[new]}. {why}')

    def track_shadow(self, eq):
        """1x-schaduw van de strategie: rendement van deze stap gedeeld door de hefboom die gold."""
        m = self.meta
        if m['last_eq'] and m['last_eq'] > 0 and m['last_lev'] > 0:
            r = eq / m['last_eq'] - 1
            m['shadow'] *= 1 + r / m['last_lev']
            m['shadow_peak'] = max(m['shadow_peak'], m['shadow'])

    def check_brake(self, feed, b, now):
        m = self.meta; eq = self.equity(feed)
        if m['rem'] == 'pauze':
            if m['pauze_tot'] and pd.Timestamp(now) >= pd.Timestamp(m['pauze_tot']):
                m['peak'] = eq; m['pauze_tot'] = None; m['shadow_peak'] = m['shadow']
                self._set_rem(feed, b, 'herstart', now, f'{PAUSE_DAYS} dagen pauze voorbij')
            return
        m['peak'] = max(m['peak'], eq); dd = eq / m['peak'] - 1
        if self.stop and dd <= -self.stop:
            m['pauze_tot'] = str(pd.Timestamp(now) + pd.Timedelta(days=PAUSE_DAYS))
            self._set_rem(feed, b, 'pauze', now, f'account {dd*100:.1f}% onder de top (grens {self.stop*100:.0f}%)')
            return
        if self.daystop:                                      # dagstop: te snel te veel verlies binnen 24 uur -> alles dicht, pauze
            t = pd.Timestamp(now); cut = t - pd.Timedelta(hours=24); hi = eq
            for x in reversed(m['equity'][-200:]):            # equity wordt elke 30 min vastgelegd: 24 uur = 48 punten
                if pd.Timestamp(x[0]) < cut: break
                hi = max(hi, x[1])
            if eq / max(hi, 1e-9) - 1 <= -self.daystop:
                m['pauze_tot'] = str(t + pd.Timedelta(days=PAUSE_DAYS))
                self._set_rem(feed, b, 'pauze', now, f'dagstop: {(eq / hi - 1)*100:.1f}% binnen 24 uur (grens {self.daystop*100:.0f}%)')
                return
        day = pd.Timestamp(now).strftime('%Y-%m-%d')
        if m.get('rem_dag') == day: return
        m['rem_dag'] = day
        sdd = m['shadow'] / m['shadow_peak'] - 1
        if m['rem'] == 'herstart':        # na pauze: terug naar normaal na nieuwe accounttop, minimaal 7 dagen later
            if eq >= m['peak'] * 0.999 and pd.Timestamp(now) > pd.Timestamp(m['rem_log'][-1][0]) + pd.Timedelta(days=7):
                self._set_rem(feed, b, 'normaal', now, 'herstel na pauze bevestigd')
            return
        if not self.brake: return
        t1, rec = self.brake
        if sdd <= -t1 and m['rem'] == 'normaal':
            self._set_rem(feed, b, 'half', now, f'strategie {sdd*100:.1f}% onder haar top')
        elif sdd > -t1 * rec and m['rem'] == 'half':
            self._set_rem(feed, b, 'normaal', now, f'strategie hersteld tot {sdd*100:.1f}%')

    def check_modules(self, feed, b, now, before):
        """Per module een 1x-schaduw bijhouden; zakt die dieper dan de grens, dan gaat de module op pauze."""
        ms = self.meta['mod_shadow']; lev = max(self.lev_now(), 1e-9)
        last = self.meta.get('mod_last') or {}
        for m, eb in zip(self.mods, before):
            e0 = last.get(m.key, eb)                             # stand aan het eind van de vorige stap: koersbeweging telt mee
            sh = ms.setdefault(m.key, [1.0, 1.0])
            p = self.meta['mod_pause'].get(m.key)
            if p:
                if pd.Timestamp(now) >= pd.Timestamp(p['t']) + pd.Timedelta(days=MOD_PAUSE_DAYS):
                    self.resume_module(m.key); ms[m.key] = [1.0, 1.0]
                    self.notify('module', f'{m.name} automatisch hervat na {MOD_PAUSE_DAYS} dagen pauze')
                continue
            e1 = m.equity(feed); tot = max(sum(before), 1e-9)
            if e0 > 0.01 * tot:                                  # module met (bijna) geen geld: niet meetellen
                r = min(max(e1 / e0 - 1, -0.95), 5.0); sh[0] *= 1 + r / lev
            sh[1] = max(sh[1], sh[0]); dd = sh[0] / sh[1] - 1
            lim = MOD_LIMIT.get(m.key)
            if lim and dd <= -lim:
                self.pause_module(feed, b, m.key, now, f'{dd*100:.0f}% onder zijn top op 1x-basis, grens {lim*100:.0f}%')
                ms[m.key] = [1.0, 1.0]

    def pause_module(self, feed, b, key, now, why):
        m = next((x for x in self.mods if x.key == key), None)
        if not m or self.meta['mod_pause'].get(key): return
        m.scale(feed, b, 0.0, now, 'module gepauzeerd')
        self.meta['mod_pause'][key] = dict(t=str(now), why=why); self._apply_lev()
        self.log(f'MODULE GEPAUZEERD: {m.name} ({why})'); self.notify('module', f'{m.name} gepauzeerd: {why}')

    def resume_module(self, key):
        if self.meta['mod_pause'].pop(key, None) is not None:
            self._apply_lev(); self.log(f'Module hervat: {key}')

    def emergency_stop(self, feed, b, now, why='handmatige noodstop'):
        """Alles sluiten en pauzeren tot iemand op Hervatten klikt (geen automatische hervatting)."""
        if self.meta['rem'] == 'pauze': return
        self.meta['pauze_tot'] = None
        self._set_rem(feed, b, 'pauze', now, why)

    def resume_all(self, feed, b, now):
        if self.meta['rem'] == 'pauze':
            self.meta['peak'] = self.equity(feed); self.meta['pauze_tot'] = None; self.meta['shadow_peak'] = self.meta['shadow']
            self._set_rem(feed, b, 'herstart', now, 'handmatig hervat')

    def lev_now(self):
        return self.lev * self.FACT[self.meta['rem']] * self.filt_fact()

    def check_filter(self, feed, b, now):
        """Trendfilter op het hele systeem: één keer per dag, op het slot van de vorige dag."""
        if not self.sysfilter or self.meta['rem'] == 'pauze': return
        d = feed.candles('BTC', '1d', n=210)
        if len(d) < 200: return
        day = str(d.index[-1])
        if self.meta.get('filt_dag') == day: return
        self.meta['filt_dag'] = day
        up = bool(d.close.iloc[-1] > d.close.iloc[-200:].mean())
        if up == self.meta['trend_up']: return
        f = 2.0 if up else 0.5
        self.meta['trend_up'] = up; self._apply_lev()
        for m in self.mods:
            if not self.meta['mod_pause'].get(m.key): m.scale(feed, b, f, now, 'trendfilter')
        msg = 'BTC boven zijn 200-daags gemiddelde: volle hefboom' if up else 'BTC onder zijn 200-daags gemiddelde: halve hefboom'
        self.log('TRENDFILTER: ' + msg); self.notify('filter', 'Trendfilter: ' + msg)

    def apply_news(self, feed, b, now, act):
        """Nieuwsactie uitvoeren: blokkades opslaan en betrokken posities sluiten."""
        nw = self.meta['news']
        for side in ('long', 'short'):
            blk = nw['blok_' + side]
            for k, u in act.get('blok_' + side, {}).items():
                if not blk.get(k) or pd.Timestamp(u) > pd.Timestamp(blk[k]): blk[k] = u
            for k in [k for k, u in blk.items() if pd.Timestamp(now) >= pd.Timestamp(u)]: del blk[k]
        ss, sl = set(act.get('sluit_short', [])), set(act.get('sluit_long', []))
        closed = []
        for m in self.mods:
            if m.key == 'ls':
                for c in list(m.st['pos']):
                    p = m.st['pos'][c]
                    if (p['side'] < 0 and (c in ss or '*' in ss)) or (p['side'] > 0 and c in sl):
                        m._close(b, c, feed.price(c), 'nieuws', now); closed.append(f'L/S {c}')
            elif m.key == 'vol':
                for c, s in m.st['sleeves'].items():
                    if s['pos'] and c in sl: m._exit(b, c, s, feed.price(c), 'nieuws', now); closed.append(f'Volume {c}')
            elif m.key == 'trend':
                for key, s in m.st['sleeves'].items():
                    c = key.split(':')[1]
                    if s['pos'] and c in sl: m._exit(b, key, s, feed.price(c), 'nieuws', now); closed.append(f'Trend {c}')
            elif m.key in ('agent', 'agentwin'):
                for c, s in m.st['sleeves'].items():
                    if s['pos'] and c in sl: m._exit(b, c, s, feed.price(c), 'nieuws', now); closed.append(f'Agent {c}')
        nw['log'] = (nw.get('log', []) + [[str(now), act.get('uitleg', []), closed]])[-50:]
        for u in act.get('uitleg', []): self.log('NIEUWS: ' + u)
        if closed: self.log('NIEUWS: gesloten ' + ', '.join(closed))
        return closed

    def state(self):
        out = {m.key: m.state for m in self.mods}; out['meta'] = self.meta; return out

    def equity(self, feed): return sum(m.equity(feed) for m in self.mods)

    def target_weights(self):
        """Risicopariteit: elke module krijgt geld omgekeerd evenredig met zijn beweeglijkheid (60 dagen).
        Zonder genoeg historie, of als risicopariteit uit staat: de vaste verdeling."""
        base = [w for w in self.weights if w > 0]
        if not self.risk_parity: return base
        eqs = self.meta['equity'][self.meta.get('eq_from', 0):]
        if len(eqs) < 2: return base
        df = pd.DataFrame([[x[0]] + x[3:3 + len(self.mods)] for x in eqs]).set_index(0)
        df.index = pd.to_datetime(df.index, utc=True)
        d = df.resample('1D').last().dropna()
        r = d.pct_change().replace([np.inf, -np.inf], np.nan)
        r = r[r.index.day != 1].tail(60)                        # herverdeeldagen tellen niet mee
        if r.dropna(how='all').shape[0] < 20: return base
        floor = 0.005 * max(self.lev, 1.0)                       # module die vooral in cash staat: niet overwegen
        sd = r.std().where(r.count() >= 20).replace(0, np.nan).clip(lower=floor).values
        if np.isnan(sd).all(): return base
        iv = 1 / sd; ok = ~np.isnan(iv)
        w = np.where(ok, iv / np.nansum(iv), 0.0)
        if (~ok).any():                                          # modules zonder bruikbare historie: vaste verdeling
            bw = np.array(base) / sum(base); w = np.where(ok, w * bw[ok].sum(), bw)
        w = w / w.sum()
        for _ in range(5):                                       # maximaal de helft per module
            w = np.minimum(w, 0.5); w = w / w.sum()
        return list(w)

    def skim_profit(self, feed, now):
        """Winst afromen: een deel van de winst boven de vorige top gaat naar de kluis; daar handelt de bot niet meer mee."""
        if self.skim <= 0: return
        eq = self.equity(feed); hwm = self.meta.get('skim_hwm') or eq
        if eq <= hwm or eq <= 0: return
        amt = self.skim * (eq - hwm)
        for m in self.mods: m.add_cash(-amt * m.equity(feed) / eq)
        self.meta['kluis'] = round(self.meta.get('kluis', 0.0) + amt, 6)
        f = (eq - amt) / eq; self.meta['peak'] *= f; self.meta['last_eq'] = eq - amt; self.meta['skim_hwm'] = eq - amt
        self.log(f'WINST AFGEROOMD: {amt:,.2f} naar de kluis (totaal in kluis {self.meta["kluis"]:,.2f})')
        self.notify('kluis', f'Winst afgeroomd: {amt:,.2f} naar de kluis, totaal {self.meta["kluis"]:,.2f}. Dit geld gebruikt de bot niet meer.')

    def rebalance(self, feed, now):
        mth = now.strftime('%Y-%m')
        if self.meta['last_rebalance'] == mth: return
        first = self.meta['last_rebalance'] is None; self.meta['last_rebalance'] = mth
        if not first: self.skim_profit(feed, now)
        if first or len(self.mods) < 2: return
        tot = self.equity(feed); ws = self.target_weights(); flows = []
        paused = [bool(self.meta['mod_pause'].get(m.key)) for m in self.mods]
        free = tot - sum(m.equity(feed) for m, p in zip(self.mods, paused) if p)     # gepauzeerde modules houden hun geld
        act = [0.0 if p else w for w, p in zip(ws, paused)]
        ws = [w / sum(act) for w in act] if sum(act) > 0 else act
        for m, w, p in zip(self.mods, ws, paused):
            d = 0.0 if p else free * w - m.equity(feed)
            if d: m.add_cash(d)
            flows.append(round(d, 6))
        self.meta.setdefault('flows', {})[str(now)] = flows
        self.meta['weights_now'] = [round(float(w), 3) for w in ws]
        self.log('Maandelijkse herverdeling: ' + ', '.join(f'{m.name} {w*100:.0f}%' for m, w in zip(self.mods, ws)) + f' (totaal {tot:,.2f})')

    def retire_old(self, feed, b, now):
        """Ander profiel gekozen in een lopend account: posities van modules die niet meer meedoen sluiten
        en hun geld verdelen over de modules van het nieuwe profiel."""
        for m in self.retire:
            m.news = self.meta['news']
            m.scale(feed, b, 0.0, now, 'profiel gewijzigd')
            cash = m.equity(feed); ws = [w for w in self.weights if w > 0]
            for mod, w in zip(self.mods, ws): mod.add_cash(cash * w / sum(ws))
            self.log(f'Profiel gewijzigd: {m.name} gesloten, {cash:,.2f} overgezet naar het nieuwe profiel')
        self.retire = []
        self.meta['eq_from'] = len(self.meta['equity'])         # verdeling naar risico: alleen historie van na de wissel
        self.meta['mod_shadow'] = {}; self.meta['mod_pause'] = {}; self.meta['mod_last'] = {}

    def step(self, feed, b):
        now = feed.now()
        if self.retire: self.retire_old(feed, b, now)
        if self.meta['started'] is None: self.meta['started'] = str(now)
        self.track_shadow(self.equity(feed))
        self.check_brake(feed, b, now)
        self.check_filter(feed, b, now)
        if self.meta['rem'] != 'pauze':
            before = [m.equity(feed) for m in self.mods]
            for m in self.mods:
                m.step(feed, b)
                if hasattr(m, 'finance') and not b.live: m.finance(feed, feed.step_hours())
            self.check_modules(feed, b, now, before)
            self.rebalance(feed, now)
            self.meta['mod_last'] = {m.key: m.equity(feed) for m in self.mods}
        else:
            self.meta['mod_last'] = {}                           # na een noodstop-pauze opnieuw beginnen met meten
        tot = self.equity(feed); eqs = self.meta['equity']; totk = tot + self.meta.get('kluis', 0.0)
        self.meta['last_eq'] = tot; self.meta['last_lev'] = max(self.lev_now(), 1e-9) if self.meta['rem'] != 'pauze' else 1.0
        if not eqs or (pd.Timestamp(now) - pd.Timestamp(eqs[-1][0])) >= pd.Timedelta(minutes=30):
            eqs.append([str(now), round(totk, 4), round(feed.price('BTC'), 2)] + [round(m.equity(feed), 4) for m in self.mods])
        return tot

    def module_returns(self):
        """Rendement per module over de hele looptijd, gecorrigeerd voor geld dat bij herverdeling verschuift."""
        eqs = self.meta['equity'][self.meta.get('eq_from', 0):]; flows = self.meta.get('flows', {})
        if len(eqs) < 2: return [0.0] * len(self.mods)
        out = []
        for j in range(len(self.mods)):
            g = 1.0; prev = eqs[0][3 + j]
            for row in eqs[1:]:
                cur = row[3 + j]; f = flows.get(row[0], [0.0] * len(self.mods))[j]
                if prev > 0: g *= (cur - f) / prev
                prev = cur
            out.append(g - 1)
        return out

    def positions(self, feed): return [p for m in self.mods for p in m.positions(feed)]

    def trades(self):
        t = [x for m in self.mods for x in m.trades()]
        return sorted(t, key=lambda x: x['t'])
