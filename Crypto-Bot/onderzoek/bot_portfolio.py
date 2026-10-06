"""Portfolio-bot: 7 strategieën tegelijk op BTC, elk met een eigen deel (1/7) van het account.

Backtest okt 2020 - sep 2026 met trendfilter (fees 0.1%, slippage 0.05%, financiering 0.03%/dag):
  hefboom 1x : 31%/jr,  blind 2024-2026 14%/jr,  max daling -16%
  hefboom 2x : 55%/jr,  blind 28%/jr,  max daling -22%
  hefboom 3x : 77%/jr,  blind 40%/jr,  max daling -29%
  hefboom 4x : 98%/jr,  blind 51%/jr,  max daling -34%

Verliesbeperking:
  - elke trade heeft een stop loss (ATR) of een vaste exit-regel
  - 7 strategieen die niet tegelijk verliezen, elk 1/7 van het account
  - trendfilter: staat BTC (daily) onder zijn SMA200, dan halveert de hefboom en worden
    open posities gehalveerd. Dat halveerde het verlies in 2022.
Rendement uit het verleden is geen garantie. 2025 en 2026 waren veel zwakker dan 2020-2024.

Strategieën (instellingen gekozen op 2020-2023):
  1 Trend 4h          video-template, stop 2 ATR, exit onder EMA200, 2% risico x hefboom
  2 Bollinger daily   breakout boven BB(50, 2.5), stop 3 ATR, exit onder middenlijn
  3 Keltner daily     breakout boven Keltner(50, 1.5), stop 1.5 ATR, exit onder EMA50
  4 Momentum daily    ROC(60) kruist boven 0, stop 1.5 ATR, 1/3 winst bij +1 ATR, exit ROC < 0
  5 Sonic R daily     EMA34 dragon pullback + EMA89/200, long en short, stop 1.5 ATR, 1/3 winst bij +1.5 ATR
  6 Rode candles      3 rode dagen boven SMA100 kopen, verkopen op eerste groene dag
  7 Supertrend 4h     Supertrend(10, 3) flip naar long, stop 3 ATR, 1/3 winst bij +3 ATR

Gebruik:
  pip install ccxt pandas numpy numba
  LEV=3 python bot_portfolio.py                      # paper (standaard), niets echt
  MODE=live LEV=2 EXCHANGE=... SYMBOL=BTC/USDT:USDT API_KEY=... API_SECRET=... python bot_portfolio.py
Live met hefboom vraagt een futures/CFD-account. Gebruik alleen een partij met vergunning in NL/EU.
"""
import json, os, time, logging
from datetime import datetime, timezone
import numpy as np, pandas as pd
import ccxt
from engine import atr
from strategies import nnfx
from library import LIB

LEV = float(os.getenv('LEV', 2))
STATE = dict(regime_up=True)

def cur_lev():
    return LEV if STATE['regime_up'] else LEV / 2
CFG = dict(mode=os.getenv('MODE', 'paper'), exchange=os.getenv('EXCHANGE', 'bitvavo'),
           symbol=os.getenv('SYMBOL', 'BTC/EUR'), paper_start=float(os.getenv('PAPER_START', 1000)),
           poll_s=60, state_file='portfolio_state.json')

# type: 'risk' = 2% risico per trade (x hefboom), 'full' = hele sleeve x hefboom
SLEEVES = {
    'trend4h':   dict(tf='4h', fn=lambda d: nnfx(d, dict(trend=200, mf=12, adx=20, volf=0.8, volume=1), False),
                      size='risk', sl=2.0, tp1=0, frac=0, shorts=False),
    'bb_daily':  dict(tf='1d', fn=lambda d: LIB['Bollinger breakout'][0](d, dict(n=50, k=2.5)), size='full', sl=3.0, tp1=0, frac=0, shorts=False),
    'kc_daily':  dict(tf='1d', fn=lambda d: LIB['Keltner breakout'][0](d, dict(n=50, k=1.5)), size='full', sl=1.5, tp1=0, frac=0, shorts=False),
    'mom_daily': dict(tf='1d', fn=lambda d: LIB['Momentum (ROC)'][0](d, dict(n=60)), size='risk', sl=1.5, tp1=1.0, frac=0.33, shorts=False),
    'sonic':     dict(tf='1d', fn=lambda d: LIB['Sonic R (dragon)'][0](d, dict(f=1, lb=3, x='e89')), size='risk', sl=1.5, tp1=1.5, frac=0.33, shorts=True),
    'red3':      dict(tf='1d', fn=lambda d: LIB['Rode candles op rij'][0](d, dict(k=3, tf=100)), size='full', sl=0, tp1=0, frac=0, shorts=False),
    'st4h':      dict(tf='4h', fn=lambda d: LIB['Supertrend'][0](d, dict(n=10, m=3.0)), size='risk', sl=3.0, tp1=3.0, frac=0.33, shorts=False),
}
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s',
                    handlers=[logging.StreamHandler(), logging.FileHandler('portfolio.log')])
log = logging.getLogger()


def new_state():
    per = CFG['paper_start'] / len(SLEEVES)
    return dict(sleeves={k: dict(cash=per, pos=0, qty=0.0, qty0=0.0, entry=0.0, stop=0.0, tp1=0.0,
                                 tp1_hit=False, realized=0.0, last_bar=None, trades=[]) for k in SLEEVES},
                last_rebalance=None, regime_up=True)


class Broker:
    """Paper: houdt per sleeve cash bij. Live: stuurt market orders (netto positie = som van sleeves)."""
    def __init__(self):
        cls = getattr(ccxt, CFG['exchange']); kw = {'enableRateLimit': True}
        if CFG['mode'] == 'live':
            kw.update(apiKey=os.environ['API_KEY'], secret=os.environ['API_SECRET'])
        self.ex = cls(kw); self.ex.load_markets()
        if CFG['mode'] == 'live' and LEV > 1:
            try: self.ex.set_leverage(int(np.ceil(LEV)), CFG['symbol'])
            except Exception as e: log.warning(f'Hefboom instellen lukte niet: {e}')

    def price(self): return self.ex.fetch_ticker(CFG['symbol'])['last']
    def candles(self, tf):
        raw = self.ex.fetch_ohlcv(CFG['symbol'], tf, limit=400)
        df = pd.DataFrame(raw, columns=['t', 'open', 'high', 'low', 'close', 'volume'])
        df['t'] = pd.to_datetime(df.t, unit='ms', utc=True)
        return df.set_index('t').iloc[:-1]
    def amt(self, q): return float(self.ex.amount_to_precision(CFG['symbol'], q))
    def trade(self, sl, side, qty, price):
        """side +1 koop, -1 verkoop. Geeft fill-prijs; paper boekt fee 0.1% + slippage 0.05%."""
        if CFG['mode'] == 'paper':
            fill = price * (1 + 0.0005 * side); sl['cash'] -= 0.001 * qty * fill
            return fill
        o = self.ex.create_market_order(CFG['symbol'], 'buy' if side > 0 else 'sell', qty)
        return o.get('average') or price


def sleeve_equity(sl, price):
    return sl['cash'] + (sl['pos'] * sl['qty'] * (price - sl['entry']) if sl['pos'] else 0.0)


def close(b, name, sl, price, reason):
    fill = b.trade(sl, -sl['pos'], sl['qty'], price)
    pnl = sl['pos'] * sl['qty'] * (fill - sl['entry'])
    sl['cash'] += pnl
    total = sl['realized'] + pnl
    pct = total / (sl['qty0'] * sl['entry'] / max(LEV, 1)) * 100
    sl['trades'].append(dict(t=datetime.now(timezone.utc).isoformat(), side=sl['pos'], entry=sl['entry'],
                             exit=fill, pct=round(pct, 2), reason=reason))
    log.info(f'[{name}] SLUIT {"long" if sl["pos"] > 0 else "short"} ({reason}) @ {fill:.2f}  {pct:+.2f}% op inzet')
    sl.update(pos=0, qty=0.0, qty0=0.0, entry=0.0, stop=0.0, tp1=0.0, tp1_hit=False, realized=0.0)


def open_pos(b, name, sl, cfg, side, price, a):
    eq = sleeve_equity(sl, price)
    dist = cfg['sl'] * a if cfg['sl'] else 0.0
    if cfg['size'] == 'risk' and dist > 0:
        notional = min(eq * 0.02 * cur_lev() / (dist / price), eq * cur_lev())
    else:
        notional = eq * cur_lev() * 0.995
    qty = b.amt(notional / price)
    if qty <= 0: return
    fill = b.trade(sl, side, qty, price)
    sl.update(pos=side, qty=qty, qty0=qty, entry=fill, realized=0.0, tp1_hit=False,
              stop=fill - side * dist if dist else 0.0,
              tp1=fill + side * cfg['tp1'] * a if cfg['tp1'] else 0.0)
    log.info(f'[{name}] OPEN {"long" if side > 0 else "short"} {qty} @ {fill:.2f}  stop {sl["stop"]:.2f}')


def on_bar(b, name, sl, cfg, df, price):
    d = tuple(df[k].values.astype(float) for k in ['open', 'high', 'low', 'close', 'volume'])
    L, S, XL, XS = [np.nan_to_num(np.asarray(x)).astype(bool) for x in cfg['fn'](d)]
    a = atr(d[1], d[2], d[3], 14)[-1]
    if sl['pos'] == 1 and XL[-1]: close(b, name, sl, price, 'exit-signaal')
    elif sl['pos'] == -1 and XS[-1]: close(b, name, sl, price, 'exit-signaal')
    elif sl['pos'] == 0:
        if L[-1]: open_pos(b, name, sl, cfg, 1, price, a)
        elif cfg['shorts'] and S[-1]: open_pos(b, name, sl, cfg, -1, price, a)


def watch(b, name, sl, cfg, price):
    if not sl['pos']: return
    p = sl['pos']
    if sl['stop'] and (price - sl['stop']) * p <= 0:
        close(b, name, sl, price, 'break-even stop' if sl['tp1_hit'] else 'stop loss')
    elif sl['tp1'] and not sl['tp1_hit'] and (price - sl['tp1']) * p >= 0:
        q = b.amt(sl['qty'] * cfg['frac'])
        fill = b.trade(sl, -p, q, price)
        gain = p * q * (fill - sl['entry']); sl['cash'] += gain; sl['realized'] += gain
        sl['qty'] -= q; sl['tp1_hit'] = True
        sl['stop'] = sl['entry'] * (1 + p * 0.0025)
        log.info(f'[{name}] DEELWINST {q} @ {fill:.2f}, stop naar break-even')


def update_regime(b, st, daily, price):
    """Trendfilter: BTC daily close boven SMA200 = volle hefboom, anders de helft."""
    up = bool(daily.close.iloc[-1] > daily.close.iloc[-200:].mean())
    if up == st.get('regime_up', True):
        STATE['regime_up'] = up; return
    st['regime_up'] = STATE['regime_up'] = up
    log.info(f'TRENDFILTER: BTC {"boven" if up else "onder"} SMA200, hefboom nu {cur_lev()}x')
    f = 0.5 if not up else 2.0      # open posities halveren of weer verdubbelen
    for name, sl in st['sleeves'].items():
        if not sl['pos']: continue
        q = b.amt(sl['qty'] * abs(f - 1))
        if q <= 0: continue
        side = sl['pos'] * (1 if f > 1 else -1)
        fill = b.trade(sl, side, q, price)
        pnl = sl['pos'] * sl['qty'] * (fill - sl['entry'])        # resultaat tot nu toe vastzetten
        sl['cash'] += pnl; sl['realized'] += pnl; sl['entry'] = fill
        sl['qty'] = sl['qty'] + q if f > 1 else sl['qty'] - q
        log.info(f'[{name}] positie {"verdubbeld" if f > 1 else "gehalveerd"} @ {fill:.2f}')


def rebalance(b, st, price, now=None):
    """Begin van elke maand: alle 7 strategieen terug naar 1/7 van het totaal, ook als er een
    positie open staat (die wordt dan bij- of afgekocht). Dit zit ook zo in de backtest."""
    m = (now or datetime.now(timezone.utc)).strftime('%Y-%m')
    if st['last_rebalance'] == m: return
    st['last_rebalance'] = m
    sls = st['sleeves']; total = sum(sleeve_equity(s, price) for s in sls.values())
    target = total / len(sls)
    for name, sl in sls.items():
        eq = sleeve_equity(sl, price)
        if sl['pos'] and eq > 0:
            f = target / eq
            pnl = sl['pos'] * sl['qty'] * (price - sl['entry'])     # winst/verlies tot nu toe vastzetten
            sl['realized'] += pnl; sl['entry'] = price
            delta = b.amt(sl['qty'] * f) - sl['qty']
            if abs(delta) > 0:
                b.trade(sl, sl['pos'] * (1 if delta > 0 else -1), abs(delta), price)
            sl['qty'] += delta; sl['qty0'] *= f
        sl['cash'] = target - (0 if not sl['pos'] else 0.0)
    log.info(f'Maandelijkse herverdeling: totaal {total:.2f}, per strategie {target:.2f}')


def main():
    b = Broker()
    st = json.load(open(CFG['state_file'])) if os.path.exists(CFG['state_file']) else new_state()
    STATE['regime_up'] = st.get('regime_up', True)
    log.info(f'Portfolio-bot gestart: {CFG["mode"].upper()}, hefboom {LEV}x, {CFG["exchange"]} {CFG["symbol"]}')
    while True:
        try:
            price = b.price()
            dfs = {tf: b.candles(tf) for tf in {'4h', '1d'}}
            update_regime(b, st, dfs['1d'], price)
            for name, cfg in SLEEVES.items():
                sl = st['sleeves'][name]; df = dfs[cfg['tf']]; bar = str(df.index[-1])
                if bar != sl['last_bar']:
                    if sl['last_bar'] is not None: on_bar(b, name, sl, cfg, df, price)
                    sl['last_bar'] = bar
                watch(b, name, sl, cfg, price)
            rebalance(b, st, price)
            total = sum(sleeve_equity(s, price) for s in st['sleeves'].values())
            if int(time.time()) % 3600 < CFG['poll_s']:
                log.info(f'Totaal: {total:.2f}  open: {[k for k, s in st["sleeves"].items() if s["pos"]]}')
            json.dump(st, open(CFG['state_file'], 'w'), indent=1, default=float)
        except Exception as e:
            log.error(f'Fout: {e}')
        time.sleep(CFG['poll_s'])


if __name__ == '__main__':
    main()
