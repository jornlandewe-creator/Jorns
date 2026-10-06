"""Bewaking van de bot: controles, meldingen en gegevens voor zelfherstel."""
import collections, threading
from datetime import datetime, timezone
import pandas as pd

LEVELS = {'ok': 0, 'let_op': 1, 'probleem': 2, 'uit': -1}
NAMES = {
    'loop': 'Bot-proces', 'data': 'Koersdata', 'prijzen': 'Prijscontrole', 'orders': 'Orders',
    'posities': 'Posities bij exchange', 'prestatie': 'Prestatie vs verwachting', 'noodrem': 'Noodrem', 'opslag': 'Opslag',
}


class Health:
    def __init__(self):
        self.lock = threading.Lock()
        self.checks = {k: dict(level='uit', msg='nog niet gecontroleerd', t=None) for k in NAMES}
        self.alerts = collections.deque(maxlen=60)
        self.restarts = 0; self.errors_in_row = 0; self.last_step = None

    def set(self, key, level, msg):
        with self.lock:
            old = self.checks.get(key, {}).get('level')
            self.checks[key] = dict(level=level, msg=msg, t=datetime.now().strftime('%d-%m %H:%M'))
            if level in ('let_op', 'probleem') and old != level:
                self.alerts.appendleft(dict(t=datetime.now().strftime('%d-%m %H:%M'), level=level, wat=NAMES.get(key, key), msg=msg))
            elif level == 'ok' and old in ('let_op', 'probleem'):
                self.alerts.appendleft(dict(t=datetime.now().strftime('%d-%m %H:%M'), level='ok', wat=NAMES.get(key, key), msg='hersteld: ' + msg))

    def note(self, level, wat, msg):
        with self.lock:
            self.alerts.appendleft(dict(t=datetime.now().strftime('%d-%m %H:%M'), level=level, wat=wat, msg=msg))

    def overall(self):
        lv = max((LEVELS[c['level']] for c in self.checks.values()), default=0)
        return {2: 'probleem', 1: 'let_op'}.get(lv, 'ok')

    def snapshot(self):
        with self.lock:
            return dict(overall=self.overall(), restarts=self.restarts, laatste_stap=self.last_step,
                        checks=[dict(key=k, naam=NAMES[k], **v) for k, v in self.checks.items()],
                        alerts=list(self.alerts))


def check_prices(prev, cur, max_jump=0.25):
    """Prijssprong groter dan max_jump in één stap = verdachte koers (foute tick, storing)."""
    bad = [c for c, p in cur.items() if prev.get(c) and p and abs(p / prev[c] - 1) > max_jump]
    return bad


def data_age_minutes(feed):
    df = feed.candles('BTC', '30m', n=5)
    if not len(df): return 1e9
    close_time = df.index[-1] + pd.Timedelta(minutes=30)
    now = pd.Timestamp(feed.now())
    if now.tzinfo is None: now = now.tz_localize('UTC')
    return (now - close_time).total_seconds() / 60


def expected_positions(sysm):
    """Netto positie per munt volgens de bot (in munten, + long / - short)."""
    net = collections.defaultdict(float)
    for m in sysm.mods:
        if m.key == 'btc':
            for s in m.t.st['sleeves'].values():
                if s['pos']: net['BTC'] += s['pos'] * s['qty']
        elif m.key == 'ls':
            for c, p in m.st['pos'].items(): net[c] += p['side'] * p['qty']
        else:
            for c, s in m.st['sleeves'].items():               # volume: 'BTC', trend: 'st:BTC', agent: pos = +1 long / -1 short
                if s['pos']: net[c.split(':')[-1]] += (s['pos'] if s['pos'] in (1, -1) else 1) * s['qty']
    return dict(net)


def exchange_positions(broker, coins):
    """Netto posities bij de exchange (futures), omgerekend naar munten."""
    syms = [broker.s(c) for c in coins if broker.s(c) in broker.ex.markets]
    out = {}
    for p in broker.ex.fetch_positions(syms):
        sym = p.get('symbol'); c = next((x for x in coins if broker.s(x) == sym), None)
        if not c: continue
        qty = float(p.get('contracts') or 0) * float(p.get('contractSize') or 1)
        if broker.ex.markets[sym].get('inverse'):
            px = float(p.get('markPrice') or p.get('entryPrice') or 0)
            qty = qty / px if px else 0.0
        side = -1 if (p.get('side') == 'short') else 1
        out[c] = out.get(c, 0.0) + side * qty
    return out
