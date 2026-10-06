"""BTC trading bot met drie geteste profielen. Kies met PROFIEL=trend | balans | winrate.

trend   (standaard)  4h, video-template: EMA200-trend + MACD + ADX + volatiliteit/volume-filter.
                     Stop 2x ATR, exit bij close onder EMA200. Win rate ~22%, backtest ~41%/jr, blind ~18%/jr.
balans               Zelfde instap/stop, maar 1/3 van de positie verkopen bij +3x ATR, daarna stop naar
                     break-even en de rest laten lopen. Win rate ~38%, backtest ~29%/jr, blind ~14%/jr.
winrate              Daily: koop na 3 rode dagcandles op rij als de koers boven de SMA100 staat,
                     verkoop op de eerste groene dagcandle. Geen stop (zo getest). Win rate ~68%,
                     backtest ~10%/jr, grootste daling -13%.

Positiegrootte trend/balans: 2% van het account riskeren per trade, nooit hefboom.
Winrate-profiel: 100% van het account per trade, geen hefboom.

Standaard PAPER-modus (niets echt). Live alleen met MODE=live en API-keys van een sub-account
met alleen handelsrechten (geen opnemen).

  pip install ccxt pandas numpy numba
  PROFIEL=balans python bot.py
  MODE=live EXCHANGE=bitvavo API_KEY=... API_SECRET=... python bot.py
"""
import json, os, time, logging
from datetime import datetime, timezone
import numpy as np, pandas as pd
import ccxt
from strategies import nnfx
from engine import atr

PROFIEL = os.getenv('PROFIEL', 'trend')
PROFILES = {
    'trend':   dict(timeframe='4h', tp1_atr=0, tp1_frac=0),
    'balans':  dict(timeframe='4h', tp1_atr=3.0, tp1_frac=0.33),
    'winrate': dict(timeframe='1d', tp1_atr=0, tp1_frac=0),
}
CFG = dict(
    mode=os.getenv('MODE', 'paper'),
    exchange=os.getenv('EXCHANGE', 'bitvavo'),
    symbol=os.getenv('SYMBOL', 'BTC/EUR'),
    params=dict(trend=200, mf=12, adx=20, volf=0.8, volume=1),
    sl_mult=2.0, risk=0.02, max_lev=1.0,
    paper_start=float(os.getenv('PAPER_START', 1000)),
    poll_s=60, state_file=f'bot_state_{PROFIEL}.json',
    **PROFILES[PROFIEL],
)
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s',
                    handlers=[logging.StreamHandler(), logging.FileHandler(f'bot_{PROFIEL}.log')])
log = logging.getLogger()


def exchange():
    cls = getattr(ccxt, CFG['exchange'])
    kw = {'enableRateLimit': True}
    if CFG['mode'] == 'live':
        kw.update(apiKey=os.environ['API_KEY'], secret=os.environ['API_SECRET'])
    return cls(kw)


def load_state():
    if os.path.exists(CFG['state_file']):
        return json.load(open(CFG['state_file']))
    return dict(pos=0, qty=0.0, entry=0.0, stop=0.0, tp1=0.0, tp1_hit=False,
                cash=CFG['paper_start'], last_bar=None, trades=[])


def save_state(s):
    json.dump(s, open(CFG['state_file'], 'w'), indent=1, default=float)


def candles(ex):
    raw = ex.fetch_ohlcv(CFG['symbol'], CFG['timeframe'], limit=500)
    df = pd.DataFrame(raw, columns=['t', 'open', 'high', 'low', 'close', 'volume'])
    df['t'] = pd.to_datetime(df.t, unit='ms', utc=True)
    return df.set_index('t').iloc[:-1]   # laatste candle is nog niet gesloten


def equity(ex, s, price):
    if CFG['mode'] == 'paper':
        return s['cash'] + s['qty'] * price
    b = ex.fetch_balance()
    base, quote = CFG['symbol'].split('/')
    return b['total'].get(quote, 0) + b['total'].get(base, 0) * price


def market(ex, s, side, qty, price):
    if CFG['mode'] == 'paper':
        fill = price * (1.0005 if side == 'buy' else 0.9995)
        s['cash'] += (-1 if side == 'buy' else 1) * qty * fill - 0.001 * qty * fill
        return fill
    o = ex.create_market_buy_order(CFG['symbol'], qty) if side == 'buy' else ex.create_market_sell_order(CFG['symbol'], qty)
    return o.get('average') or price


def close_all(ex, s, price, reason):
    fill = market(ex, s, 'sell', s['qty'], price)
    pnl = s.get('realized', 0.0) + s['qty'] * (fill - s['entry'])          # hele trade, incl. deelwinst
    pct = pnl / (s['qty0'] * s['entry']) * 100
    s['trades'].append(dict(time=datetime.now(timezone.utc).isoformat(), entry=s['entry'], exit=fill,
                            pnl_pct=round(pct, 2), reason=reason, tp1_hit=s['tp1_hit']))
    log.info(f'VERKOCHT ({reason}) @ {fill:.2f}  trade {pct:+.2f}%')
    s.update(pos=0, qty=0.0, entry=0.0, stop=0.0, tp1=0.0, tp1_hit=False, realized=0.0)


def signals(df):
    d = tuple(df[k].values.astype(float) for k in ['open', 'high', 'low', 'close', 'volume'])
    if PROFIEL == 'winrate':
        o, c = d[0], d[3]
        red3 = (c[-1] < o[-1]) and (c[-2] < o[-2]) and (c[-3] < o[-3])
        enter = red3 and c[-1] > np.mean(c[-100:])
        leave = c[-1] > o[-1]
        return enter, leave, 0.0
    L, _, XL, _ = nnfx(d, CFG['params'], shorts=False)
    return bool(L[-1]), bool(XL[-1]), atr(d[1], d[2], d[3], 14)[-1]


def on_new_bar(ex, s, df):
    enter, leave, a = signals(df)
    price = ex.fetch_ticker(CFG['symbol'])['last']
    if s['pos'] == 1 and leave:
        close_all(ex, s, price, 'exit-signaal')
    elif s['pos'] == 0 and enter:
        eq = equity(ex, s, price)
        if PROFIEL == 'winrate':
            notional = eq * 0.995; stop = 0.0
        else:
            dist = CFG['sl_mult'] * a
            notional = min(eq * CFG['risk'] / (dist / price), eq * CFG['max_lev'] * 0.995)
            stop = price - dist
        qty = float(ex.amount_to_precision(CFG['symbol'], notional / price))
        fill = market(ex, s, 'buy', qty, price)
        tp1 = fill + CFG['tp1_atr'] * a if CFG['tp1_atr'] else 0.0
        s.update(pos=1, qty=qty, qty0=qty, realized=0.0, entry=fill, stop=(fill - (price - stop)) if stop else 0.0, tp1=tp1, tp1_hit=False)
        log.info(f'GEKOCHT {qty} @ {fill:.2f}  stop {s["stop"]:.2f}  tp1 {tp1:.2f}  (equity {eq:.2f})')
    else:
        log.info(f'Nieuwe candle, geen actie. Positie: {"long" if s["pos"] else "geen"}  prijs {price:.2f}')


def watch(ex, s):
    """Elke minuut: stop loss en gedeeltelijke winstname bewaken."""
    if s['pos'] != 1:
        return
    price = ex.fetch_ticker(CFG['symbol'])['last']
    if s['stop'] and price <= s['stop']:
        close_all(ex, s, price, 'stop loss' if not s['tp1_hit'] else 'break-even stop')
    elif s['tp1'] and not s['tp1_hit'] and price >= s['tp1']:
        q = float(ex.amount_to_precision(CFG['symbol'], s['qty'] * CFG['tp1_frac']))
        fill = market(ex, s, 'sell', q, price)
        s['realized'] = s.get('realized', 0.0) + q * (fill - s['entry'])
        s['qty'] -= q; s['tp1_hit'] = True
        s['stop'] = max(s['stop'], s['entry'] * 1.0025)
        log.info(f'DEELWINST {q} @ {fill:.2f}, stop naar break-even {s["stop"]:.2f}')


def main():
    ex = exchange(); ex.load_markets()
    s = load_state()
    log.info(f'Bot gestart: profiel {PROFIEL}, {CFG["mode"].upper()} modus, {CFG["exchange"]} {CFG["symbol"]} {CFG["timeframe"]}')
    while True:
        try:
            df = candles(ex)
            bar = str(df.index[-1])
            if bar != s['last_bar']:
                if s['last_bar'] is not None:      # niet handelen op de eerste start-candle
                    on_new_bar(ex, s, df)
                s['last_bar'] = bar
            watch(ex, s)
            save_state(s)
        except Exception as e:
            log.error(f'Fout: {e}')
        time.sleep(CFG['poll_s'])


if __name__ == '__main__':
    main()
