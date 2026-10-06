"""Nieuwswacht: leest gratis nieuwsfeeds (RSS) en laat alleen nieuwe, relevante koppen beoordelen door Claude.

Zuinig met credits:
  - koppen ophalen en filteren gebeurt lokaal en kost niets
  - Claude wordt alleen gevraagd als er nieuwe koppen zijn die over de munten of de markt gaan
  - alleen de kop (geen artikel), maximaal 25 per keer, kort antwoord (JSON), goedkoopste model
  - minimaal een uur tussen vragen, maximum per dag en een maandbudget; daarboven stopt hij vanzelf
Kosten: ongeveer 1.000 tokens in en 100 uit per vraag, rond $0,0015. Bij 12 vragen per dag is dat zo'n $0,50 per maand.

Een Anthropic API key (console.anthropic.com) is iets anders dan een Claude-abonnement; je betaalt per gebruik.
"""
import hashlib, json, re, threading, time, urllib.request, xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta

FEEDS = [
    'https://www.coindesk.com/arc/outboundfeeds/rss/',
    'https://cointelegraph.com/rss',
    'https://decrypt.co/feed',
    'https://bitcoinmagazine.com/feed',
    'https://www.theblock.co/rss.xml',
]
MODEL = 'claude-haiku-4-5-20251001'
PRICE_IN, PRICE_OUT = 1.0 / 1e6, 5.0 / 1e6          # dollar per token (Haiku 4.5)
USD_EUR = 0.92
NAMES = {
    'BTC': ['bitcoin', 'btc'], 'ETH': ['ethereum', 'ether', 'eth'], 'BNB': ['bnb', 'binance coin', 'bnb chain'],
    'SOL': ['solana', 'sol'], 'XRP': ['xrp', 'ripple'], 'ADA': ['cardano', 'ada'], 'DOGE': ['dogecoin', 'doge'],
    'AVAX': ['avalanche', 'avax'], 'LINK': ['chainlink', 'link'], 'DOT': ['polkadot', 'dot'],
}
MARKET_WORDS = ['sec', 'etf', 'hack', 'exploit', 'ban', 'fed', 'rate cut', 'rate hike', 'inflation', 'liquidat', 'bankrupt',
                'insolven', 'delist', 'approv', 'crash', 'plunge', 'surge', 'rally', 'tariff', 'regulat', 'lawsuit', 'stablecoin',
                'tether', 'usdt', 'usdc', 'exchange', 'outflow', 'inflow', 'treasury', 'reserve', 'halt', 'freeze', 'sanction']
SYSTEM = (
    'Je beoordeelt cryptonieuws voor een handelsbot op 10 munten: BTC ETH BNB SOL XRP ADA DOGE AVAX LINK DOT. '
    'Geef alleen een score als het nieuws de koers in de komende dagen duidelijk en fors kan bewegen '
    '(hack of diefstal, delisting, verbod, faillissement van een grote partij, ETF-goedkeuring of -afwijzing, grote wetgeving). '
    'Gewone koersberichten, analyses, meningen en voorspellingen krijgen 0. '
    'Schaal: -2 = zeer negatief, -1 = negatief, 0 = niets bijzonders, 1 = positief, 2 = zeer positief. Wees zuinig met 2 en -2. '
    'Antwoord uitsluitend met JSON: {"markt": n, "munten": {"SOL": n}, "reden": "max 20 woorden, Nederlands"}. '
    'Zet alleen munten met een score ongelijk aan 0 in "munten".'
)
WORD_RE = {c: re.compile(r'\b(' + '|'.join(re.escape(w) for w in ws) + r')\b', re.I) for c, ws in NAMES.items()}
MKT_RE = re.compile('|'.join(re.escape(w) for w in MARKET_WORDS), re.I)


def parse_feed(xml_bytes):
    """Titels + datum uit RSS of Atom."""
    out = []
    root = ET.fromstring(xml_bytes)
    for it in root.iter():
        tag = it.tag.split('}')[-1]
        if tag not in ('item', 'entry'): continue
        title = None; date = None
        for ch in it:
            t = ch.tag.split('}')[-1]
            if t == 'title': title = (ch.text or '').strip()
            elif t in ('pubDate', 'published', 'updated') and not date: date = (ch.text or '').strip()
        if title: out.append(dict(title=re.sub(r'\s+', ' ', title)[:160], date=date or ''))
    return out


def relevant(title):
    coins = [c for c, rx in WORD_RE.items() if rx.search(title)]
    return coins, bool(coins or MKT_RE.search(title))


class NewsWatch:
    def __init__(self, log=print, state=None):
        self.log = log
        self.st = state or {}
        s = self.st
        s.setdefault('seen', []); s.setdefault('calls', []); s.setdefault('kosten', {}); s.setdefault('laatste', None)
        s.setdefault('last_fetch', 0); s.setdefault('last_call', 0); s.setdefault('koppen', []); s.setdefault('fout', None)
        self.lock = threading.Lock()

    # ---------------------------------------------------------------- kosten en limieten
    def month_cost(self):
        return self.st['kosten'].get(datetime.now().strftime('%Y-%m'), 0.0)

    def calls_today(self):
        d = datetime.now().strftime('%Y-%m-%d')
        return sum(1 for c in self.st['calls'] if c.startswith(d))

    def can_call(self, cfg):
        if not cfg.get('claude_key'): return False, 'geen Claude API key'
        if time.time() - self.st['last_call'] < cfg.get('nieuws_interval_min', 60) * 60: return False, 'te kort na vorige vraag'
        if self.calls_today() >= cfg.get('nieuws_max_dag', 12): return False, 'dagmaximum bereikt'
        if self.month_cost() >= cfg.get('nieuws_budget_eur', 2.0): return False, 'maandbudget bereikt'
        return True, ''

    # ---------------------------------------------------------------- ophalen
    def fetch(self, opener=None):
        new = []; seen = set(self.st['seen']); ok = 0
        for url in FEEDS:
            try:
                req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 crypto-bot'})
                raw = (opener or urllib.request.urlopen)(req, timeout=15).read()
                items = parse_feed(raw); ok += 1
            except Exception:
                continue
            for it in items:
                h = hashlib.sha1(it['title'].lower().encode()).hexdigest()[:16]
                if h in seen: continue
                seen.add(h); self.st['seen'].append(h)
                coins, rel = relevant(it['title'])
                if rel: new.append(dict(it, coins=coins, t=datetime.now(timezone.utc).isoformat(timespec='minutes')))
        self.st['seen'] = self.st['seen'][-3000:]
        return new, ok

    # ---------------------------------------------------------------- Claude
    def ask_claude(self, key, heads, post=None):
        lines = '\n'.join(f'- {h["title"]}' for h in heads[:25])
        body = dict(model=MODEL, max_tokens=200, temperature=0, system=SYSTEM,
                    messages=[dict(role='user', content='Nieuwe koppen:\n' + lines)])
        req = urllib.request.Request('https://api.anthropic.com/v1/messages', data=json.dumps(body).encode(), method='POST',
                                     headers={'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'})
        res = json.loads((post or urllib.request.urlopen)(req, timeout=40).read().decode())
        txt = ''.join(b.get('text', '') for b in res.get('content', []) if b.get('type') == 'text')
        m = re.search(r'\{.*\}', txt, re.S)
        out = json.loads(m.group(0)) if m else {}
        u = res.get('usage', {}); cost_usd = u.get('input_tokens', 0) * PRICE_IN + u.get('output_tokens', 0) * PRICE_OUT
        return self.clean(out), cost_usd * USD_EUR, u

    @staticmethod
    def clean(o):
        def sc(v):
            try: return int(max(-2, min(2, round(float(v)))))
            except Exception: return 0
        coins = {str(k).upper(): sc(v) for k, v in (o.get('munten') or {}).items() if str(k).upper() in NAMES and sc(v) != 0}
        return dict(markt=sc(o.get('markt', 0)), munten=coins, reden=str(o.get('reden', ''))[:200])

    # ---------------------------------------------------------------- ronde
    def poll(self, cfg, opener=None, post=None):
        """Elke minuut aanroepen; doet zelf de planning. Geeft een beoordeling terug of None."""
        if cfg.get('nieuws', 'uit') == 'uit': return None
        with self.lock:
            if time.time() - self.st['last_fetch'] < 15 * 60:
                pending = self.st.get('wacht', [])
            else:
                self.st['last_fetch'] = time.time()
                new, ok = self.fetch(opener)
                if ok == 0:
                    self.st['fout'] = 'geen nieuwsbron bereikbaar'; return None
                self.st['fout'] = None
                pending = (self.st.get('wacht', []) + new)[-60:]
                self.st['wacht'] = pending
                if new: self.st['koppen'] = (new + self.st['koppen'])[:30]
            if not pending: return None
            can, why = self.can_call(cfg)
            if not can: return None
            try:
                res, cost, u = self.ask_claude(cfg['claude_key'], pending, post)
            except Exception as e:
                self.st['fout'] = f'Claude: {type(e).__name__}: {e}'[:200]; self.st['last_call'] = time.time(); return None
            mth = datetime.now().strftime('%Y-%m')
            self.st['kosten'][mth] = round(self.st['kosten'].get(mth, 0.0) + cost, 6)
            self.st['calls'] = (self.st['calls'] + [datetime.now().isoformat(timespec='minutes')])[-500:]
            self.st['last_call'] = time.time(); self.st['wacht'] = []
            res['t'] = datetime.now(timezone.utc).isoformat(timespec='minutes'); res['koppen'] = len(pending)
            res['tokens'] = [u.get('input_tokens', 0), u.get('output_tokens', 0)]
            self.st['laatste'] = res
            return res

    def summary(self, cfg):
        return dict(stand=cfg.get('nieuws', 'uit'), key=bool(cfg.get('claude_key')), laatste=self.st['laatste'],
                    kosten_maand=round(self.month_cost(), 4), budget=cfg.get('nieuws_budget_eur', 2.0),
                    vragen_vandaag=self.calls_today(), max_dag=cfg.get('nieuws_max_dag', 12),
                    koppen=self.st['koppen'][:10], fout=self.st['fout'])


# ---------------------------------------------------------------- wat de bot met een beoordeling doet

def actions(res, now, hours_coin=72, hours_mkt=24):
    """Vertaal een beoordeling naar blokkades. Alleen de uitersten (-2 en +2) doen iets."""
    out = dict(sluit_short=[], sluit_long=[], blok_short={}, blok_long={}, uitleg=[])
    until_c = (now + timedelta(hours=hours_coin)).isoformat(); until_m = (now + timedelta(hours=hours_mkt)).isoformat()
    for c, s in res.get('munten', {}).items():
        if s >= 2:
            out['sluit_short'].append(c); out['blok_short'][c] = until_c; out['uitleg'].append(f'{c} zeer positief nieuws: shorts dicht, {hours_coin}u geen short')
        elif s <= -2:
            out['sluit_long'].append(c); out['blok_long'][c] = until_c; out['uitleg'].append(f'{c} zeer negatief nieuws: longs dicht, {hours_coin}u geen long')
    if res.get('markt', 0) >= 2:
        out['sluit_short'].append('*'); out['blok_short']['*'] = until_c; out['uitleg'].append(f'markt zeer positief: alle shorts dicht, {hours_coin}u geen shorts')
    elif res.get('markt', 0) <= -2:
        out['blok_long']['*'] = until_m; out['uitleg'].append(f'markt zeer negatief: {hours_mkt}u geen nieuwe longs')
    return out
