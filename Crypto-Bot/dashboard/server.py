"""Dashboard-server. Start met:  python server.py   en open http://localhost:8001

Draait alleen op je eigen computer (127.0.0.1). API keys en Telegram-token blijven lokaal in config.json.

Zelfherstel:
  - een fout in een ronde stopt de bot niet: hij logt, wacht steeds iets langer en probeert opnieuw
  - een bewaker (supervisor) start het bot-proces opnieuw als het onverwacht stopt
  - de stand wordt veilig opgeslagen (eerst naar een tijdelijk bestand, plus reservekopie)
  - verouderde of vreemde koersen: die ronde wordt overgeslagen, er wordt niet gehandeld
  - live: posities worden elk uur vergeleken met de exchange (melden of zelf corrigeren)
  - na een herstart van de computer hervat de bot vanzelf als dat aan staat
"""
import json, os, shutil, threading, time, traceback, collections
from datetime import datetime, timezone
import numpy as np, pandas as pd
from flask import Flask, jsonify, request, send_from_directory
from modules import System, ReplayFeedMulti, ReplayFeed4h, LiveFeedMulti, PaperBrokerMulti, LiveBrokerMulti, PROFILES, COINS
from health import Health, check_prices, data_age_minutes, expected_positions, exchange_positions
from notify import Notifier
from ai_news import NewsWatch, actions as news_actions
from rules import RULES, ALGEMEEN, quality

HERE = os.path.dirname(os.path.abspath(__file__))
try: VERSION = open(os.path.join(HERE, 'VERSION')).read().strip()
except Exception: VERSION = 'onbekend'
CFG_FILE = os.path.join(HERE, 'config.json')
STATE_FILE = os.path.join(HERE, 'state.json')
KILL_FILE = os.path.join(HERE, 'NOODSTOP')          # maak dit bestand aan (leeg) en de bot sluit alles en pauzeert tot je op Hervatten klikt
HEARTBEAT_FILE = os.path.join(HERE, 'heartbeat.json')   # elke ronde bijgewerkt; agent.py --check en een externe bewaker lezen dit
DEFAULT = dict(mode='paper', bron='live', data_exchange='binance', exchange='krakenfutures', symbol_tpl='{c}/USD:USD',
               profiel='agent_stabiel', lev=2.0, rem=False, noodstop=40.0, sysfilter=False,
               filter=True, start_capital=1000.0, w_btc=30.0, w_ls=30.0, w_vol=20.0, w_trend=20.0,
               markt='futures', api_key='', api_secret='', api_password='', risico_akkoord=False, replay_start='2024-03-01', replay_snelheid=40,
               fee_pct=0.05, slip_pct=0.03, risicopariteit=True,
               telegram_token='', telegram_chat='', meld_trades=False, dagrapport_uur=20,
               autostart=True, reconcile='melden', was_actief=False,
               hefboom=0.0, afromen=0, nieuws='uit', claude_key='', nieuws_max_dag=12, nieuws_budget_eur=2.0, nieuws_interval_min=60)
SECRET = ('api_key', 'api_secret', 'api_password', 'telegram_token', 'claude_key')
EXCHANGES = ['myokx', 'okx', 'krakenfutures', 'bybit', 'bitget', 'binance', 'kraken', 'bitvavo', 'coinbase']
DATA_EXCHANGES = ['binance', 'okx', 'bybit', 'kraken']

app = Flask(__name__, static_folder=os.path.join(HERE, 'static'))
LOGS = collections.deque(maxlen=400)
RUN = dict(thread=None, stop=threading.Event(), status='gestopt', fout=None, sys=None, feed=None, replay_pos=None, bt=None,
           want=False, cfg=None)
LOCK = threading.Lock()
HEALTH = Health()


def clean(o):
    """NaN/inf zijn geen geldige JSON: vervangen door null, anders weigert de browser de hele pagina-update."""
    if isinstance(o, float): return o if np.isfinite(o) else None
    if isinstance(o, dict): return {k: clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)): return [clean(v) for v in o]
    if isinstance(o, (np.floating,)): return float(o) if np.isfinite(o) else None
    if isinstance(o, (np.integer,)): return int(o)
    return o


def log(msg, t=None):
    t = datetime.fromtimestamp(t.timestamp()) if t is not None else datetime.now()
    LOGS.appendleft(dict(t=t.strftime('%d-%m-%y %H:%M'), m=msg))


NOTIFY = Notifier(log)
NEWS_FILE = os.path.join(HERE, 'news.json')


def _load_news():
    try: return json.load(open(NEWS_FILE))
    except Exception: return None


NEWS = NewsWatch(log, _load_news())
NEWS_PENDING = collections.deque(maxlen=20)


def news_loop():
    """Nieuwswacht: elke minuut kijken (koppen gratis), Claude alleen bij nieuwe relevante koppen en binnen budget."""
    while True:
        try:
            cfg = load_cfg()
            res = NEWS.poll(cfg)
            if res is not None:
                tmp = NEWS_FILE + '.tmp'; json.dump(NEWS.st, open(tmp, 'w')); os.replace(tmp, NEWS_FILE)
                sc = ', '.join(f'{c} {v:+d}' for c, v in res['munten'].items())
                log(f'Nieuws ({res["koppen"]} koppen, Claude): markt {res["markt"]:+d}' + (f', {sc}' if sc else '') + (f'. {res["reden"]}' if res['reden'] else ''))
                if res['markt'] or res['munten']:
                    NOTIFY.send('nieuws', f'Nieuws: markt {res["markt"]:+d}' + (f', {sc}' if sc else '') + f'. {res["reden"]}')
                NEWS_PENDING.append(res)
        except Exception as e:
            log(f'Nieuwswacht fout: {type(e).__name__}: {e}')
        time.sleep(60)


def load_cfg():
    c = dict(DEFAULT)
    if os.path.exists(CFG_FILE):
        try: c.update(json.load(open(CFG_FILE)))
        except Exception: log('config.json was beschadigd, standaardinstellingen gebruikt')
    return c


def save_cfg(c):
    tmp = CFG_FILE + '.tmp'; json.dump(c, open(tmp, 'w'), indent=1); os.replace(tmp, CFG_FILE)
    try: os.chmod(CFG_FILE, 0o600)
    except Exception: pass


def public_cfg(c):
    p = {k: v for k, v in c.items() if k not in SECRET}
    for k in SECRET: p[k + '_ingesteld'] = bool(c.get(k))
    p['profielen'] = {k: dict(naam=v['naam'], lev=v['lev'], rem=bool(v['brake']), filter=v['sysfilter'], noodstop=(v['stop'] or 0) * 100, verwacht=v['verwacht'],
                              groep=v.get('groep', 'oud'), uitleg=v.get('uitleg', ''))
                      for k, v in PROFILES.items()}
    p['aanbevolen'] = 'agent_stabiel'
    return p


def profile_build(cfg):
    """Verdeling over modules en hoge-winrate stand: van het profiel als dat ze vastlegt, anders de instellingen."""
    p = PROFILES.get(cfg['profiel']) or {}
    w = p.get('weights') or (cfg['w_btc'], cfg['w_ls'], cfg['w_vol'], cfg.get('w_trend', 20.0))
    return w, bool(p.get('scaleout', False)), p.get('hold')


AGENT_BASE_LEV = 1.5   # plafond waarop de Agent-profielen zijn getest; de hefboomknop schaalt doel en plafond samen


def effective_lev(cfg):
    """Hefboom die geldt: de knop (cfg['hefboom'] > 0) of anders die van het profiel."""
    h = float(cfg.get('hefboom') or 0)
    return h if h > 0 else risk_settings(cfg)[0]


def system_kwargs(cfg):
    """Alle profiel-afhankelijke argumenten voor System in een keer (dashboard en agent.py gebruiken dezelfde).
    Hefboomknop: bij een Agent-profiel schaalt hij het plafond én het volatiliteitsdoel (1,5x = zoals getest; 3x = dubbele inzet)."""
    p = PROFILES.get(cfg['profiel']) or {}
    lev, brake, stop, sysf = risk_settings(cfg)
    w, scaleout, hold = profile_build(cfg)
    agent = p.get('agent'); h = float(cfg.get('hefboom') or 0)
    if h > 0:
        lev = h
        if agent:
            f = h / AGENT_BASE_LEV; params = dict(agent.get('params') or {})
            params['vol_target'] = params.get('vol_target', 0.6) * f
            agent = dict(agent, cap=h, params=params)
    return dict(capital=cfg['start_capital'], lev=lev, use_filter=cfg['filter'], weights=w, trend_scaleout=scaleout, hold=hold,
                agent=agent, daystop=p.get('dagstop'), skim=cfg.get('afromen', 0) / 100, risk_parity=cfg['risicopariteit'],
                brake=brake, stop=stop, sysfilter=sysf, spot=cfg.get('markt') == 'spot')


def risk_settings(cfg):
    """Hefboom, rem en noodstop volgens het gekozen profiel (of eigen instellingen)."""
    p = PROFILES.get(cfg['profiel'])
    if p: return p['lev'], p['brake'], p['stop'], p['sysfilter']
    return (float(cfg['lev']), ((0.06, 0.5) if cfg['rem'] else None), (cfg['noodstop'] / 100 if cfg['noodstop'] else None),
            bool(cfg.get('sysfilter', False)))


# ------------------------------------------------------------------ opslag

def save_state(sysm):
    tmp = STATE_FILE + '.tmp'
    with open(tmp, 'w') as f: json.dump(sysm.state(), f, default=float)
    if os.path.exists(STATE_FILE): shutil.copyfile(STATE_FILE, STATE_FILE + '.bak')
    os.replace(tmp, STATE_FILE)


def heartbeat(sysm, feed):
    """Levensteken voor externe bewaking (cron, systemd, agent.py --check)."""
    try:
        d = dict(t=datetime.now(timezone.utc).isoformat(), status=RUN['status'], equity=round(sysm.equity(feed), 2), rem=sysm.meta['rem'],
                 open=len(sysm.positions(feed)), gezondheid=HEALTH.overall(), fouten_op_rij=HEALTH.errors_in_row)
        tmp = HEARTBEAT_FILE + '.tmp'; json.dump(d, open(tmp, 'w')); os.replace(tmp, HEARTBEAT_FILE)
    except Exception: pass


def load_state():
    for path in (STATE_FILE, STATE_FILE + '.bak'):
        if os.path.exists(path):
            try:
                st = json.load(open(path))
                if path.endswith('.bak'): log('Stand hersteld uit reservekopie'); HEALTH.note('let_op', 'Opslag', 'hoofdbestand beschadigd, reservekopie gebruikt')
                return st
            except Exception: continue
    return None


# ------------------------------------------------------------------ meldingen

def make_notify(cfg):
    NOTIFY.configure(cfg['telegram_token'], cfg['telegram_chat'])
    def n(kind, msg): NOTIFY.send(kind, msg)
    return n


def make_log(feed, cfg):
    def lg(m):
        log(m, feed.now())
        if cfg['meld_trades'] and any(w in m for w in (' geopend', ' gesloten', ' long @', 'DEELWINST', 'winst genomen')):
            NOTIFY.send('trade', m)
    return lg


def daily_report(sysm, feed, cfg):
    meta = sysm.meta; eqs = meta['equity']
    if not eqs: return
    now = datetime.now()
    if now.hour != int(cfg['dagrapport_uur']) or meta.get('rapport_dag') == now.strftime('%Y-%m-%d'): return
    meta['rapport_dag'] = now.strftime('%Y-%m-%d')
    tot = sysm.equity(feed); day_ago = pd.Timestamp.now(tz='UTC') - pd.Timedelta(days=1)
    prev = next((x[1] for x in reversed(eqs) if pd.Timestamp(x[0]) <= day_ago), eqs[0][1])
    start = meta['start_capital']; pos = sysm.positions(feed)
    NOTIFY.send('rapport', f'Dagrapport: waarde {tot:,.2f} ({(tot/prev-1)*100:+.2f}% vandaag, {(tot/start-1)*100:+.1f}% totaal). '
                           f'Hefboom nu {sysm.lev_now():g}x, {len(pos)} open posities, status {HEALTH.overall()}.')


# ------------------------------------------------------------------ controles

def checks_before_step(feed, prev_prices, live):
    """Geeft (ok, prijzen). ok=False: deze ronde niet handelen."""
    if not live: return True, {}
    age = data_age_minutes(feed)
    if age > 120:
        HEALTH.set('data', 'probleem', f'laatste koers is {age:.0f} minuten oud, er wordt niet gehandeld'); return False, prev_prices
    HEALTH.set('data', 'ok' if age <= 40 else 'let_op', f'laatste candle {age:.0f} min geleden gesloten')
    prices = {c: feed.price(c) for c in COINS}
    bad = check_prices(prev_prices, prices)
    if bad:
        HEALTH.set('prijzen', 'probleem', f'onwaarschijnlijke koerssprong bij {", ".join(bad)}: ronde overgeslagen'); return False, prev_prices
    HEALTH.set('prijzen', 'ok', 'koersen consistent')
    return True, prices


def reconcile(sysm, broker, cfg, feed):
    """Vergelijk de posities van de bot met die bij de exchange."""
    try:
        want = expected_positions(sysm); have = exchange_positions(broker, COINS)
    except Exception as e:
        HEALTH.set('posities', 'let_op', f'kon posities niet ophalen: {e}'); return
    diffs = {}
    for c in set(want) | set(have):
        w, h = want.get(c, 0.0), have.get(c, 0.0)
        if abs(w - h) * feed.price(c) > max(10.0, 0.02 * sysm.equity(feed)): diffs[c] = (w, h)
    if not diffs:
        HEALTH.set('posities', 'ok', 'posities komen overeen met de exchange'); return
    txt = ', '.join(f'{c}: bot {w:+.4g}, exchange {h:+.4g}' for c, (w, h) in diffs.items())
    if cfg['reconcile'] == 'corrigeren':
        for c, (w, h) in diffs.items():
            q = broker.amt(c, abs(w - h))
            if q > 0:
                try: broker.ex.create_market_order(broker.s(c), 'buy' if w > h else 'sell', q)
                except Exception as e: log(f'Correctie {c} mislukt: {e}')
        HEALTH.set('posities', 'let_op', 'verschil gecorrigeerd: ' + txt); NOTIFY.send('posities', 'Positieverschil gecorrigeerd: ' + txt)
    else:
        HEALTH.set('posities', 'probleem', 'verschil met exchange: ' + txt); NOTIFY.send('posities', 'Positieverschil, controleer: ' + txt, every=3600)


def performance_check(sysm, cfg):
    lev, brake, stop, _ = risk_settings(cfg); meta = sysm.meta
    if not meta['equity']: return
    eq = meta['equity'][-1][1]; dd = eq / max(meta['peak'], 1e-9) - 1
    exp = {1.0: 0.15, 2.0: 0.31, 4.0: 0.48, 6.0: 0.65}.get(lev, 0.12 * lev)
    if meta['rem'] == 'pauze':
        HEALTH.set('noodrem', 'probleem', f'noodstop actief tot {str(meta["pauze_tot"])[:16]}')
    else:
        HEALTH.set('noodrem', 'ok' if meta['rem'] == 'normaal' else 'let_op', {'normaal': 'volle hefboom', 'half': 'halve hefboom (rem)', 'herstart': 'halve hefboom na pauze'}[meta['rem']])
    lvl = 'ok' if -dd < exp * 0.75 else ('let_op' if -dd < exp else 'probleem')
    paused = [k for k in meta.get('mod_pause', {})]
    msg = f'{dd*100:.1f}% onder de top (getest tot ongeveer {exp*100:.0f}%)' + (f', gepauzeerd: {", ".join(paused)}' if paused else '')
    HEALTH.set('prestatie', 'let_op' if (paused and lvl == 'ok') else lvl, msg)


# ------------------------------------------------------------------ bot-proces

def worker(cfg):
    errors = 0; prev_prices = {}; last_rec = 0
    try:
        state = load_state() if cfg['bron'] == 'live' else None
        if cfg['bron'] == 'replay':
            feed = ReplayFeedMulti(os.path.join(HERE, 'data', 'coins'), cfg['replay_start'])
            log(f'Demo gestart: historie vanaf {cfg["replay_start"]} afspelen')
        else:
            feed = LiveFeedMulti(cfg['data_exchange'])
            log(f'Koersen van {cfg["data_exchange"]} (publiek, geen key nodig)')
        RUN['feed'] = feed
        lev, brake, stop, sysf = risk_settings(cfg); lev = effective_lev(cfg)
        sysm = System(log=make_log(feed, cfg), state=state, notify=make_notify(cfg), **system_kwargs(cfg))
        RUN['sys'] = sysm
        if cfg['mode'] == 'live':
            broker = LiveBrokerMulti(cfg['exchange'], cfg['api_key'], cfg['api_secret'], cfg['symbol_tpl'], lev,
                                     password=cfg.get('api_password', ''), log=log)
            if 'BTC' not in broker.tradable: raise RuntimeError(f'Geen BTC-markt gevonden op {cfg["exchange"]}; controleer exchange en markt-notatie')
            if broker.spot and cfg.get('markt') != 'spot':
                raise RuntimeError('De markt-notatie wijst naar spot-markten, maar Soort account staat op futures. Kies "spot" of een futures-notatie zoals {c}/USDT:USDT')
            for m in sysm.mods: m.tradable = broker.tradable
            miss = [c for c in COINS if c not in broker.tradable]
            log('LIVE handelen staat aan: echte orders met jouw API key. Contracten: ' + ', '.join(f'{c} {broker.s(c)}' for c in COINS if c in broker.tradable)
                + (f'. Niet beschikbaar (wordt overgeslagen): {", ".join(miss)}' if miss else ''))
            mx = [broker.max_lev(broker.s(c)) for c in broker.tradable if broker.max_lev(broker.s(c))] if not broker.spot else []
            if mx and min(mx) < sysm.lev:
                cap = float(min(mx)); sysm.lev = cap; sysm._apply_lev(); broker.lev = cap
                log(f'Hefboom verlaagd naar {cap:g}x: meer staat de exchange niet toe op al je munten (profiel wilde {lev:g}x)')
            if broker.spot: log('Spot-account: de bot koopt alleen, zonder hefboom en zonder shorts')
        else:
            broker = PaperBrokerMulti(cfg['fee_pct'] / 100, cfg['slip_pct'] / 100)
        prof = PROFILES.get(cfg['profiel'], {}).get('naam', 'Eigen')
        log(f'Profiel {prof}: hefboom {lev:g}x, rem {"aan" if brake else "uit"}, trendfilter {"aan" if sysf else "uit"}, noodstop {f"{stop*100:.0f}%" if stop else "uit"}')
        if state is None: NOTIFY.send('start', f'Bot gestart ({cfg["mode"]}, profiel {prof}, {lev:g}x).')
        RUN['status'] = 'draait'; RUN['fout'] = None
        HEALTH.set('loop', 'ok', 'draait'); HEALTH.set('orders', 'ok', 'geen fouten')
        HEALTH.set('posities', 'ok' if cfg['mode'] == 'live' else 'uit', 'nog niet vergeleken' if cfg['mode'] == 'live' else 'alleen bij live')
        live = cfg['bron'] == 'live'
        while not RUN['stop'].is_set():
            try:
                ok, prev_prices = checks_before_step(feed, prev_prices, live)
                with LOCK:
                    if os.path.exists(KILL_FILE) and sysm.meta['rem'] != 'pauze':
                        sysm.emergency_stop(feed, broker, feed.now(), 'NOODSTOP-bestand gevonden')
                        NOTIFY.send('rem', 'NOODSTOP-bestand gevonden: alles gesloten, bot pauzeert tot je op Hervatten klikt.')
                    if ok: sysm.step(feed, broker)
                    if live: save_state(sysm)
                if live: heartbeat(sysm, feed)
                while live and NEWS_PENDING:
                    res = NEWS_PENDING.popleft()
                    if load_cfg().get('nieuws') == 'beschermen':
                        act = news_actions(res, pd.Timestamp(feed.now()))
                        if act['uitleg']:
                            with LOCK: closed = sysm.apply_news(feed, broker, feed.now(), act)
                            NOTIFY.send('nieuws', 'Nieuwsactie: ' + '; '.join(act['uitleg']) + (f'. Gesloten: {", ".join(closed)}' if closed else ''))
                HEALTH.set('opslag', 'ok' if live else 'uit', 'stand opgeslagen' if live else 'demo: niet opgeslagen')
                if live and cfg['mode'] == 'live' and time.time() - last_rec > 3600:
                    reconcile(sysm, broker, cfg, feed); last_rec = time.time()
                performance_check(sysm, cfg)
                if live: daily_report(sysm, feed, cfg)
                if errors:
                    log(f'Hersteld na {errors} fout(en)'); HEALTH.set('loop', 'ok', 'hersteld na fout'); HEALTH.set('orders', 'ok', 'geen fouten')
                errors = 0; HEALTH.errors_in_row = 0; HEALTH.last_step = datetime.now().strftime('%d-%m %H:%M:%S')
            except Exception as e:
                errors += 1; HEALTH.errors_in_row = errors
                msg = f'{type(e).__name__}: {e}'; log(f'Fout (poging {errors}): {msg}'); traceback.print_exc()
                where = 'orders' if any(w in msg.lower() for w in ('order', 'insufficient', 'margin', 'balance')) else 'loop'
                HEALTH.set(where, 'let_op' if errors < 5 else 'probleem', msg[:160])
                if errors in (3, 10, 30): NOTIFY.send('fout', f'Fout in de bot ({errors}x achter elkaar): {msg[:200]}')
                RUN['stop'].wait(min(30 * errors, 600) if live else 0.5)
                continue
            if cfg['bron'] == 'replay':
                RUN['replay_pos'] = feed.progress()
                if not feed.advance():
                    log('Demo klaar: einde van de data bereikt'); RUN['want'] = False; break
                time.sleep(1 / max(cfg['replay_snelheid'], 1))
            else:
                RUN['stop'].wait(60)
    except Exception as e:
        RUN['fout'] = f'{type(e).__name__}: {e}'
        log('Fout bij starten: ' + RUN['fout']); traceback.print_exc()
        HEALTH.set('loop', 'probleem', RUN['fout'][:160])
    RUN['status'] = 'gestopt'


def start_worker(cfg):
    RUN['stop'].clear(); RUN['cfg'] = cfg; RUN['want'] = True
    RUN['thread'] = threading.Thread(target=worker, args=(cfg,), daemon=True); RUN['thread'].start(); RUN['status'] = 'start...'


def supervisor():
    """Bewaker: start het bot-proces opnieuw als het onverwacht stopt."""
    while True:
        time.sleep(30)
        try:
            t = RUN['thread']
            if RUN['want'] and RUN['cfg'] and RUN['cfg']['bron'] == 'live' and (t is None or not t.is_alive()) and not RUN['stop'].is_set():
                HEALTH.restarts += 1
                log(f'Bewaker: bot-proces stond stil, opnieuw gestart (herstart {HEALTH.restarts})')
                NOTIFY.send('herstart', f'Bot-proces automatisch herstart (keer {HEALTH.restarts}).', every=600)
                wait = min(60 * HEALTH.restarts, 900); time.sleep(wait)
                if RUN['want'] and not RUN['stop'].is_set(): start_worker(RUN['cfg'])
        except Exception:
            traceback.print_exc()


# ------------------------------------------------------------------ statistiek

def stats(meta, trades):
    e = meta['equity']; start = meta['start_capital']
    out = dict(equity=None, start=start, rendement=None, max_daling=None, weken=[], maanden=[], gem_week=None, gem_maand=None,
               gem_dag=None, pos_weken=None, pos_maanden=None, trades=len(trades), winrate=None, dagen=0, trades_per_week=None)
    if not e: return out
    s = pd.Series([x[1] for x in e], index=pd.to_datetime([x[0] for x in e], utc=True))
    s = s[~s.index.duplicated(keep='last')]
    full = pd.concat([pd.Series([start], index=[s.index[0] - pd.Timedelta(seconds=1)]), s])
    dagen = (s.index[-1] - s.index[0]).total_seconds() / 86400
    out.update(equity=float(s.iloc[-1]), rendement=float(s.iloc[-1] / start - 1), max_daling=float((full / full.cummax() - 1).min()), dagen=dagen)
    d = full.resample('1D').last().ffill().pct_change().dropna()
    if len(d): out['gem_dag'] = float(d.mean())
    for per, key in [('W-SUN', 'weken'), ('ME', 'maanden')]:
        r = full.resample(per).last().ffill().pct_change().dropna()
        out[key] = [dict(periode=str(i.date()), r=float(v)) for i, v in r.items()][-60:]
        if len(r):
            out['gem_' + ('week' if key == 'weken' else 'maand')] = float(r.mean()); out['pos_' + key] = float((r > 0).mean())
    if trades:
        out['winrate'] = float(np.mean([t['pnl'] > 0 for t in trades]))
        if dagen > 1: out['trades_per_week'] = len(trades) / (dagen / 7)
    return out


# ------------------------------------------------------------------ backtest

def bt_worker(cfg, start, end):
    """Backtest op maximale snelheid. Alle beslissingen gebruiken alleen data van voor het moment zelf."""
    try:
        if pd.Timestamp(start) < pd.Timestamp('2024-03-01'):
            feed = ReplayFeed4h(os.path.join(HERE, 'data', 'coins'), start, end)      # voor 2024: stappen van 4 uur (30-minutendata bestaat pas vanaf 2024)
        else:
            feed = ReplayFeedMulti(os.path.join(HERE, 'data', 'coins'), start, end)
        RUN['feed'] = feed
        lev, brake, stop, sysf = risk_settings(cfg); lev = effective_lev(cfg)
        sysm = System(log=lambda m: log(m, feed.now()), state=None, **system_kwargs(cfg))
        RUN['sys'] = sysm
        broker = PaperBrokerMulti(cfg['fee_pct'] / 100, cfg['slip_pct'] / 100)
        RUN['status'] = 'backtest'; RUN['fout'] = None
        t0 = time.time(); n = feed.end - feed.start_i
        prof = PROFILES.get(cfg['profiel'], {}).get('naam', 'Eigen')
        log(f'Backtest {start} t/m {end}, profiel {prof} ({lev:g}x): gestart')
        p0 = {c: feed.price(c) for c in ['BTC', 'ETH', 'SOL']}; p0 = {c: p for c, p in p0.items() if p and np.isfinite(p)}   # munt zonder koers op de startdatum (SOL voor 2020): niet vergelijken
        while not RUN['stop'].is_set():
            with LOCK: sysm.step(feed, broker)
            RUN['replay_pos'] = feed.progress()
            RUN['bt']['voortgang'] = (feed.i - feed.start_i) / max(n, 1)
            if not feed.advance(): break
        with LOCK:
            tot = sysm.equity(feed); hold = {c: feed.price(c) / p0[c] - 1 for c in p0}
        RUN['bt'].update(klaar=True, voortgang=1.0, rendement=tot / cfg['start_capital'] - 1, vasthouden=hold,
                         duur=time.time() - t0, profiel=prof, lev=lev, remmomenten=len(sysm.meta['rem_log']))
        log(f'Backtest klaar: {(tot / cfg["start_capital"] - 1) * 100:+.1f}% (BTC vasthouden {hold["BTC"] * 100:+.1f}%)')
    except Exception as e:
        RUN['fout'] = f'{type(e).__name__}: {e}'; log('Fout: ' + RUN['fout']); traceback.print_exc()
    RUN['status'] = 'gestopt'


@app.post('/api/backtest')
def api_backtest():
    if RUN['status'] in ('draait', 'start...', 'backtest'): return jsonify(ok=False, fout='Stop de bot eerst')
    body = request.get_json(force=True) or {}
    cfg = load_cfg()
    if body.get('profiel'): cfg['profiel'] = body['profiel']
    if body.get('lev') and cfg['profiel'] == 'eigen': cfg['lev'] = min(max(float(body['lev']), 1.0), 6.0)
    if body.get('hefboom') is not None: cfg['hefboom'] = min(max(float(body['hefboom'] or 0), 0.0), 6.0)
    start = body.get('start') or '2024-03-01'; end = body.get('end') or '2026-10-01'
    if pd.Timestamp(end) <= pd.Timestamp(start): return jsonify(ok=False, fout='Einddatum moet na de startdatum liggen')
    if pd.Timestamp(start) < pd.Timestamp('2018-03-01'): return jsonify(ok=False, fout='Backtest kan vanaf 1 maart 2018 (daarvoor is er geen 200 dagen historie)')
    if pd.Timestamp(start) < pd.Timestamp('2024-03-01') and not (PROFILES.get(cfg['profiel']) or {}).get('agent'):
        return jsonify(ok=False, fout='Voor maart 2024 kan alleen met een Agent-profiel (de oude modules hebben 30-minutendata nodig)')
    RUN['stop'].clear(); RUN['sys'] = None; RUN['want'] = False; LOGS.clear()
    RUN['bt'] = dict(start=start, end=end, lev=effective_lev(cfg), klaar=False, voortgang=0.0, profiel_key=cfg['profiel'], hefboom=cfg.get('hefboom', 0))
    RUN['thread'] = threading.Thread(target=bt_worker, args=(cfg, start, end), daemon=True); RUN['thread'].start()
    RUN['status'] = 'backtest'
    return jsonify(ok=True)


# ------------------------------------------------------------------ API

@app.get('/')
def index():
    r = send_from_directory(app.static_folder, 'index.html')
    r.headers['Cache-Control'] = 'no-store, max-age=0'            # nooit een oude pagina uit het browsergeheugen tonen
    return r


@app.get('/favicon.ico')
def favicon(): return ('', 204)


@app.after_request
def no_cache(r):
    if request.path.startswith('/api/'): r.headers['Cache-Control'] = 'no-store'
    return r


@app.get('/api/state')
def api_state():
    cfg = load_cfg(); sysm = RUN['sys']; feed = RUN['feed']
    out = dict(versie=VERSION, status=RUN['status'], fout=RUN['fout'], config=public_cfg(cfg), logs=list(LOGS)[:100],
               exchanges=EXCHANGES, data_exchanges=DATA_EXCHANGES, replay_pos=RUN['replay_pos'], backtest=RUN['bt'],
               health=HEALTH.snapshot(), telegram=dict(aan=NOTIFY.enabled, ok=NOTIFY.ok, fout=NOTIFY.last_error),
               nieuws=NEWS.summary(cfg))
    if sysm and feed:
        with LOCK:
            try:
                tot = sysm.equity(feed)
                out['prijs'] = feed.price('BTC')
                out['hefboom_nu'] = sysm.lev_now(); out['hefboom_basis'] = sysm.lev; out['hefboom_knop'] = cfg.get('hefboom', 0); out['kluis'] = round(sysm.meta.get('kluis', 0.0), 2)
                btc = [m for m in sysm.mods if m.key == 'btc']
                out['trend_boven_sma200'] = btc[0].t.st['regime_up'] if btc else None
                meta = sysm.meta
                out['rem'] = dict(stand=meta['rem'], pauze_tot=meta['pauze_tot'], log=meta['rem_log'][-10:][::-1],
                                  daling=(tot / max(meta['peak'], 1e-9) - 1), strategie_daling=meta['shadow'] / max(meta['shadow_peak'], 1e-9) - 1,
                                  noodstop=sysm.stop, rem_aan=bool(sysm.brake), filter_aan=sysm.sysfilter, trend_up=meta.get('trend_up', True))
                out['modules'] = [dict(key=m.key, naam=m.name, waarde=round(m.equity(feed), 2), aandeel=m.equity(feed) / tot if tot else 0,
                                       open=len(m.positions(feed)), pauze=meta.get('mod_pause', {}).get(m.key)) for m in sysm.mods]
                out['posities'] = [dict(p, entry=round(p['entry'], 6), pnl=round(p['pnl'], 2)) for p in sysm.positions(feed)]
                reg = []
                for m in sysm.mods:
                    for c, inf in (getattr(m, 'st', {}).get('info') or {}).items():
                        r = inf.get('reden', '')
                        naam = {'trend': 'Stijgend: trend volgen (long)', 'short': 'Dalend (bevestigd): short'}.get(r) or ('Te weinig historie' if 'historie' in r else 'Zijwaarts of onbevestigd: cash')
                        reg.append(dict(module=m.name, coin=c, regime=naam, inzet=inf.get('w', 0), uitleg=r, dag=inf.get('dag'), vol=inf.get('vol')))
                out['regime'] = reg
                tr = sysm.trades(); out['trades'] = tr[-500:][::-1]
                eqs = meta['equity']; step = max(1, len(eqs) // 1500)
                out['curve'] = [x[:3] for x in eqs[::step]] + ([eqs[-1][:3]] if eqs and (len(eqs) - 1) % step else [])
                out['stats'] = stats(meta, tr)
                out['mod_rend'] = [dict(naam=m.name, r=r) for m, r in zip(sysm.mods, sysm.module_returns())]
                nw = meta.get('news', {}); out['nieuws']['blokkades'] = dict(long=nw.get('blok_long', {}), short=nw.get('blok_short', {}))
                out['nieuws']['acties'] = nw.get('log', [])[-5:][::-1]
            except Exception as e:
                out['fout'] = f'{type(e).__name__}: {e}'
    return jsonify(clean(out))


@app.post('/api/start')
def api_start():
    if RUN['status'] in ('draait', 'start...', 'backtest'): return jsonify(ok=False, fout='Bot of backtest draait al')
    cfg = load_cfg()
    if cfg['mode'] == 'live':
        if not (cfg['api_key'] and cfg['api_secret']): return jsonify(ok=False, fout='Vul eerst je API key en secret in bij Instellingen')
        if not cfg['risico_akkoord']: return jsonify(ok=False, fout='Vink eerst aan dat je het risico van live handelen begrijpt')
        if cfg['bron'] != 'live': return jsonify(ok=False, fout='Live handelen kan alleen met live koersen, niet met de demo')
    if cfg['bron'] == 'replay': RUN['sys'] = None
    RUN['bt'] = None
    if cfg['bron'] == 'live': cfg['was_actief'] = True; save_cfg(cfg)
    start_worker(cfg)
    return jsonify(ok=True)


@app.post('/api/stop')
def api_stop():
    RUN['want'] = False; RUN['stop'].set()
    c = load_cfg(); c['was_actief'] = False; save_cfg(c)
    log('Bot gestopt (open posities blijven staan)'); return jsonify(ok=True)


@app.post('/api/hervat')
def api_hervat():
    sysm = RUN['sys']; feed = RUN['feed']
    if not sysm: return jsonify(ok=False, fout='De bot draait niet')
    cfg = RUN['cfg'] or load_cfg()
    broker = PaperBrokerMulti(cfg['fee_pct'] / 100, cfg['slip_pct'] / 100)
    if cfg['mode'] == 'live':
        broker = LiveBrokerMulti(cfg['exchange'], cfg['api_key'], cfg['api_secret'], cfg['symbol_tpl'], sysm.lev,
                                 password=cfg.get('api_password', ''), log=log, setup=False)
    with LOCK: sysm.resume_all(feed, broker, feed.now())
    return jsonify(ok=True)


@app.post('/api/module/<key>/hervat')
def api_module_resume(key):
    sysm = RUN['sys']
    if not sysm: return jsonify(ok=False, fout='De bot draait niet')
    with LOCK: sysm.resume_module(key)
    return jsonify(ok=True)


@app.post('/api/config')
def api_config():
    if RUN['status'] in ('draait', 'backtest', 'start...'): return jsonify(ok=False, fout='Stop de bot voordat je instellingen wijzigt')
    c = load_cfg(); new = request.get_json(force=True) or {}
    for k in DEFAULT:
        if k in new and k not in SECRET:
            c[k] = bool(new[k]) if isinstance(DEFAULT[k], bool) else type(DEFAULT[k])(new[k])
    for k in SECRET:
        if new.get(k): c[k] = new[k].strip()
    if new.get('wis_keys'): c['api_key'] = c['api_secret'] = ''
    if new.get('wis_telegram'): c['telegram_token'] = ''; c['telegram_chat'] = ''
    c['lev'] = min(max(c['lev'], 1.0), 6.0); c['hefboom'] = min(max(float(c.get('hefboom') or 0), 0.0), 6.0)
    if new.get('wis_claude'): c['claude_key'] = ''
    if c['nieuws'] not in ('uit', 'melden', 'beschermen'): c['nieuws'] = 'uit'
    if c['markt'] not in ('futures', 'spot'): c['markt'] = 'futures'
    if c.get('afromen') not in (0, 25, 50, 75): c['afromen'] = 0
    c['nieuws_max_dag'] = int(min(max(c['nieuws_max_dag'], 1), 48)); c['nieuws_budget_eur'] = float(min(max(c['nieuws_budget_eur'], 0.0), 50.0))
    c['nieuws_interval_min'] = int(min(max(c['nieuws_interval_min'], 15), 1440))
    if c['profiel'] not in PROFILES and c['profiel'] != 'eigen': c['profiel'] = 'standaard'
    if c['w_btc'] + c['w_ls'] + c['w_vol'] + c.get('w_trend', 0) <= 0: c['w_btc'] = 100.0
    save_cfg(c); log('Instellingen opgeslagen')
    return jsonify(ok=True, config=public_cfg(c))


@app.post('/api/reset')
def api_reset():
    if RUN['status'] in ('draait', 'start...'): return jsonify(ok=False, fout='Stop de bot eerst')
    for p in (STATE_FILE, STATE_FILE + '.bak'):
        if os.path.exists(p): os.remove(p)
    RUN['sys'] = None; LOGS.clear(); log('Paper-account gereset'); return jsonify(ok=True)


@app.post('/api/test_key')
def api_test_key():
    c = load_cfg()
    try:
        lev = risk_settings(c)[0]
        br = LiveBrokerMulti(c['exchange'], c['api_key'], c['api_secret'], c['symbol_tpl'], lev, password=c.get('api_password', ''), setup=False)
        bal = br.ex.fetch_balance(); tot = {k: round(float(v), 4) for k, v in (bal.get('total') or {}).items() if v}
        free = sum(float((bal.get('free') or {}).get(k) or 0) for k in ('USDT', 'USDC'))
        contracts = {m: br.s(m) for m in COINS if m in br.tradable}
        missing = [m for m in COINS if m not in br.tradable]
        mx = {m: br.max_lev(s_) for m, s_ in contracts.items()}
        warn = []
        if 'BTC' not in br.tradable: warn.append('geen BTC-contract gevonden')
        lows = [v for v in mx.values() if v]
        if lows and min(lows) < lev: warn.append(f'exchange staat minimaal {min(lows):g}x toe op sommige munten, profiel gebruikt {lev:g}x')
        if br.spot: free = sum(float((bal.get('free') or {}).get(k) or 0) for k in ('EUR', 'USDT', 'USDC'))
        if br.spot and c.get('markt') != 'spot': warn.append('dit zijn spot-markten: zet Soort account op spot')
        if not br.spot and c.get('markt') == 'spot': warn.append('dit zijn futures-contracten: zet Soort account op futures, of gebruik een spot-notatie zoals {c}/EUR')
        if c['start_capital'] > free * 1.02: warn.append(f'startkapitaal {c["start_capital"]:g} is meer dan je vrije saldo ({free:,.2f})')
        if missing: warn.append('niet beschikbaar, wordt overgeslagen: ' + ', '.join(missing))
        return jsonify(ok=True, spot=br.spot, saldo=tot, vrij=round(free, 2), contracten=contracts, ontbrekend=missing, max_hefboom=mx, waarschuwingen=warn)
    except Exception as e:
        return jsonify(ok=False, fout=f'{type(e).__name__}: {e}'[:400])


@app.post('/api/test_telegram')
def api_test_telegram():
    c = load_cfg()
    if not c['telegram_token']: return jsonify(ok=False, fout='Vul eerst het Telegram-token in en sla op')
    try:
        NOTIFY.configure(c['telegram_token'], c['telegram_chat'])
        chat = NOTIFY.send_now('Testbericht: meldingen van je crypto-bot werken.')
        if chat != c['telegram_chat']: c['telegram_chat'] = chat; save_cfg(c)
        return jsonify(ok=True, chat=chat)
    except Exception as e:
        return jsonify(ok=False, fout=f'{type(e).__name__}: {e}')


@app.post('/api/test_claude')
def api_test_claude():
    c = load_cfg()
    if not c.get('claude_key'): return jsonify(ok=False, fout='Vul eerst de Claude API key in en sla op')
    try:
        res, cost, u = NEWS.ask_claude(c['claude_key'], [dict(title='Bitcoin trades sideways as markets await Fed decision')])
        return jsonify(ok=True, antwoord=res, kosten_eur=round(cost, 5), tokens=[u.get('input_tokens'), u.get('output_tokens')])
    except Exception as e:
        return jsonify(ok=False, fout=f'{type(e).__name__}: {e}'[:300])


@app.get('/api/regels')
def api_regels():
    sysm = RUN['sys']; tr = []
    if sysm:
        with LOCK: tr = sysm.trades()
    return jsonify(regels=RULES, algemeen=ALGEMEEN, kwaliteit=quality(tr))


@app.get('/api/rapport')
def api_rapport():
    """Rapport om in een chat met Claude te plakken (zonder API key). Geen keys of tokens."""
    cfg = load_cfg(); sysm = RUN['sys']; feed = RUN['feed']
    L = [f'# Crypto-bot rapport {datetime.now().strftime("%d-%m-%Y %H:%M")} (versie {VERSION})', '',
         f'Status: {RUN["status"]}' + (f' | fout: {RUN["fout"]}' if RUN['fout'] else ''),
         f'Instellingen: bron {cfg["bron"]}, modus {cfg["mode"]}, soort {cfg.get("markt")}, exchange {cfg["exchange"]}, profiel {cfg["profiel"]}, '
         f'hefboom {cfg["lev"]}, noodstop {cfg["noodstop"]}%, startkapitaal {cfg["start_capital"]}, kosten {cfg["fee_pct"]}% + {cfg["slip_pct"]}%, nieuws {cfg.get("nieuws")}']
    h = HEALTH.snapshot()
    L += ['', '## Gezondheid', f'Algemeen: {h.get("overall")} | laatste ronde {h.get("laatste_stap")} | herstarts {h.get("restarts")}']
    for c in (h.get('checks') or []):
        L.append(f'- {c.get("naam")}: {c.get("level")} {c.get("msg", "")}')
    for a in (h.get('alerts') or [])[:5]: L.append(f'- melding {a.get("t")}: {a.get("wat")} {a.get("level")} {a.get("msg")}')
    if sysm and feed:
        with LOCK:
            try:
                tr = sysm.trades(); st = stats(sysm.meta, tr); tot = sysm.equity(feed)
                L += ['', '## Resultaat', f'Waarde {tot:,.2f} | rendement {(st["rendement"] or 0)*100:.2f}% | grootste daling {(st["max_daling"] or 0)*100:.2f}% | '
                      f'dagen {st["dagen"]:.1f} | trades {st["trades"]} | winrate {((st["winrate"] or 0)*100):.0f}% | BTC nu {feed.price("BTC"):,.0f} | hefboom nu {sysm.lev_now():g}x | rem {sysm.meta["rem"]}']
                L += ['', '## Modules']
                for m, r in zip(sysm.mods, sysm.module_returns()):
                    L.append(f'- {m.name}: waarde {m.equity(feed):,.2f}, rendement {r*100:.2f}%, open {len(m.positions(feed))}'
                             + (f', GEPAUZEERD ({sysm.meta["mod_pause"][m.key]["why"]})' if sysm.meta.get('mod_pause', {}).get(m.key) else ''))
                L += ['', '## Open posities'] + [f'- {p["module"]} | {p["strat"]} | {p["coin"]} {p["side"]} | instap {p["entry"]:.6g} | stop {p.get("stop") or "-"} | open {p["pnl"]:+.2f}'
                                                 for p in sysm.positions(feed)] or ['- geen']
                L += ['', '## Kwaliteit per strategie', '| strategie | trades | winrate | gem winst | gem verlies | profit factor | totaal |', '|---|---|---|---|---|---|---|']
                for q in quality(tr):
                    f = lambda v, p=False: '-' if v is None else (f'{v*100:.0f}%' if p else f'{v:.2f}')
                    L.append(f'| {q["strat"]} | {q["trades"]} | {f(q["winrate"], True)} | {f(q["gem_winst"])} | {f(q["gem_verlies"])} | {f(q["profit_factor"])} | {q["totaal"]:.2f} |')
                L += ['', '## Laatste 30 trades'] + [f'- {t["t"][:16]} | {t.get("module", "")} | {t.get("strat")} | {t.get("coin", "BTC")} {t.get("side")} | {t.get("entry")} -> {t.get("exit")} | {t.get("pnl"):+} | {t.get("reason")}'
                                                     for t in tr[-30:][::-1]]
                if sysm.meta.get('rem_log'): L += ['', '## Noodrem/noodstop'] + [f'- {x}' for x in sysm.meta['rem_log'][-5:]]
            except Exception as e:
                L.append(f'(fout bij maken rapport: {type(e).__name__}: {e})')
    else:
        L += ['', 'De bot draait nu niet.']
    n = NEWS.summary(cfg)
    if n['stand'] != 'uit': L += ['', '## Nieuws', f'Laatste: {n["laatste"]} | kosten deze maand EUR {n["kosten_maand"]} | fout: {n["fout"]}']
    L += ['', '## Logboek (laatste 40)'] + [f'- {x["t"]} {x["m"]}' for x in list(LOGS)[:40]]
    txt = '\n'.join(L)
    for k in SECRET:                                        # zekerheid: nooit keys in het rapport
        if cfg.get(k): txt = txt.replace(cfg[k], '***')
    return jsonify(ok=True, tekst=txt)


def autostart():
    c = load_cfg(); NOTIFY.configure(c['telegram_token'], c['telegram_chat'])
    if c['autostart'] and c['was_actief'] and c['bron'] == 'live' and os.path.exists(STATE_FILE):
        log('Automatisch hervat na herstart van de computer of het programma')
        NOTIFY.send('herstart', 'Bot automatisch hervat na een herstart.')
        start_worker(c)


DEFAULT_PORT = 8001


def free_port(start, host='127.0.0.1', tries=10):
    """Eerste vrije poort vanaf start (de gewenste poort kan bezet zijn door een vorige bot of een ander programma)."""
    import socket
    for p in range(start, start + tries):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sk:
            sk.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try: sk.bind((host, p)); return p
            except OSError: continue
    return start


def main():
    import sys
    if sys.version_info < (3, 10):
        print(f'Python {sys.version.split()[0]} is te oud: installeer Python 3.11 of nieuwer (python.org).'); sys.exit(1)
    want = int(os.getenv('PORT') or (sys.argv[1] if len(sys.argv) > 1 and sys.argv[1].isdigit() else DEFAULT_PORT))
    port = free_port(want)
    if port != want: print(f'  Poort {want} is bezet (draait de bot al?), ik gebruik poort {port}')
    log(f'Dashboard gestart, versie {VERSION}, poort {port}'); print(f'\n  Dashboard: http://localhost:{port}\n  Stoppen: Ctrl+C\n', flush=True)
    try: open(os.path.join(HERE, 'poort.txt'), 'w').write(str(port))        # startbestanden lezen dit om de browser te openen
    except Exception: pass
    threading.Thread(target=supervisor, daemon=True).start()
    threading.Thread(target=news_loop, daemon=True).start()
    autostart()
    if os.getenv('OPEN_BROWSER') == '1':                           # startbestanden: browser pas openen als de server echt draait
        def _open():
            import webbrowser, urllib.request
            for _ in range(60):
                time.sleep(1)
                try: urllib.request.urlopen(f'http://127.0.0.1:{port}/api/state', timeout=2); break
                except Exception: continue
            try: webbrowser.open(f'http://localhost:{port}')
            except Exception: pass
        threading.Thread(target=_open, daemon=True).start()
    app.run(host='127.0.0.1', port=port, debug=False, threaded=True, use_reloader=False)


if __name__ == '__main__':
    main()
