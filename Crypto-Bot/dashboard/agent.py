"""Agent: de bot als zelfstandig programma, zonder dashboard. Zelfde motor, zelfde fail-safes, plus voorcontroles.

    python agent.py                      # draaien met de instellingen uit config.json (paper tenzij daar 'live' staat)
    python agent.py --paper              # paper afdwingen (geen echte orders), ongeacht config.json
    python agent.py --profiel agent      # ander profiel (agent, agent_spot, agent_rustig, ...)
    python agent.py --check              # alleen voorcontroles + status van een draaiende agent (heartbeat), daarna stoppen
    python agent.py --backtest 2023-01-01 2026-10-01   # agent-profiel doorrekenen op dagdata
    python agent.py --dashboard          # ook het dashboard starten op http://localhost:8001

Fail-safes (allemaal ook actief in het dashboard):
  - noodstop: account X% onder zijn top -> alles dicht, 14 dagen pauze, daarna halve inzet tot een nieuwe top
  - dagstop: X% verlies binnen 24 uur -> alles dicht, 14 dagen pauze (grens ruim boven gewone crashes: alleen voor rampen en fouten)
  - NOODSTOP-bestand: maak een leeg bestand 'NOODSTOP' in deze map -> alles dicht, pauze tot handmatig hervat
  - verouderde koersen (> 2 uur) of een koerssprong > 25% in een ronde -> die ronde niet handelen
  - fouten (exchange onbereikbaar) -> loggen, wachten, opnieuw; de bewaker herstart het proces als het vastloopt
  - live: elk uur posities vergelijken met de exchange (melden of corrigeren)
  - liquidatie-bescherming bij hefboom: sluiten op 60% van de afstand tot liquidatie
  - heartbeat.json: levensteken per ronde, voor een externe bewaker (cron/systemd) en --check
  - stand wordt na elke ronde veilig opgeslagen (tijdelijk bestand + reservekopie)
"""
import argparse, json, os, signal, sys, threading, time
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
os.chdir(HERE)


def preflight(cfg):
    """Voorcontroles. Geeft (problemen, waarschuwingen)."""
    import server
    from modules import PROFILES, LiveBrokerMulti, LiveFeedMulti, COINS
    problems, warns = [], []
    if cfg['profiel'] not in PROFILES and cfg['profiel'] != 'eigen': problems.append(f'onbekend profiel {cfg["profiel"]}')
    if cfg['mode'] == 'live':
        if not cfg.get('risico_akkoord'): problems.append('live gekozen maar risico niet geaccepteerd in de instellingen (risico_akkoord)')
        if not cfg.get('api_key') or not cfg.get('api_secret'): problems.append('live gekozen maar geen API key/secret ingesteld')
        if cfg['start_capital'] <= 0: problems.append('startkapitaal moet groter dan 0 zijn')
        try:
            lev = server.risk_settings(cfg)[0]
            b = LiveBrokerMulti(cfg['exchange'], cfg['api_key'], cfg['api_secret'], cfg['symbol_tpl'], lev, password=cfg.get('api_password', ''), log=lambda m: None, setup=False)
            bal = b.ex.fetch_balance(); free = 0.0
            for q in ('USDT', 'USDC', 'USD', 'EUR'):
                free += float((bal.get('total') or {}).get(q) or 0)
            if free < cfg['start_capital'] * 0.9: warns.append(f'saldo op de exchange ({free:,.0f}) is lager dan het startkapitaal ({cfg["start_capital"]:,.0f})')
            miss = [c for c in ('BTC', 'ETH', 'SOL') if c not in b.tradable]
            if miss: warns.append(f'niet verhandelbaar op {cfg["exchange"]}: {", ".join(miss)} (wordt overgeslagen, resultaat wijkt af van de test)')
            if b.spot and cfg.get('markt') != 'spot': problems.append('de markt-notatie wijst naar spot, maar Soort account staat op futures')
            if b.spot and PROFILES.get(cfg['profiel'], {}).get('lev', 1) > 1: warns.append('spot-account: het profiel wil hefboom, de bot handelt zonder hefboom')
            try:
                if hasattr(b.ex, 'fetch_permissions') or 'withdraw' in json.dumps(bal.get('info', {})).lower(): warns.append('controleer dat de API key GEEN opnamerechten heeft')
            except Exception: pass
        except Exception as e:
            problems.append(f'verbinding met {cfg["exchange"]} mislukt: {type(e).__name__}: {str(e)[:120]}')
    try:
        f = LiveFeedMulti(cfg['data_exchange']); age = server.data_age_minutes(f)
        if age > 120: problems.append(f'koersdata van {cfg["data_exchange"]} is {age:.0f} minuten oud')
    except Exception as e:
        problems.append(f'koersbron {cfg["data_exchange"]} onbereikbaar: {type(e).__name__}: {str(e)[:120]}')
    if cfg.get('telegram_token') and not cfg.get('telegram_chat'): warns.append('Telegram-token ingesteld maar nog geen chat gevonden: stuur een bericht naar je bot')
    if not cfg.get('telegram_token'): warns.append('geen Telegram ingesteld: je krijgt geen meldingen op je telefoon')
    return problems, warns


def heartbeat_status():
    p = os.path.join(HERE, 'heartbeat.json')
    if not os.path.exists(p): return 'geen heartbeat.json (agent draait niet of nog geen ronde gedaan)'
    try:
        d = json.load(open(p)); age = (datetime.now(timezone.utc) - datetime.fromisoformat(d['t'])).total_seconds() / 60
        return (f'laatste ronde {age:.0f} min geleden | status {d.get("status")} | waarde {d.get("equity")} | rem {d.get("rem")} | '
                f'open {d.get("open")} | gezondheid {d.get("gezondheid")} | fouten op rij {d.get("fouten_op_rij")}' + ('  <-- TE OUD' if age > 10 else ''))
    except Exception as e:
        return f'heartbeat.json onleesbaar: {e}'


def main():
    ap = argparse.ArgumentParser(description='Crypto-bot agent (zonder dashboard)')
    ap.add_argument('--paper', action='store_true', help='paper afdwingen')
    ap.add_argument('--live', action='store_true', help='live afdwingen (vereist keys + risico_akkoord in config.json)')
    ap.add_argument('--profiel', help='profiel (agent, agent_spot, agent_rustig, trend_vasthouden, ...)')
    ap.add_argument('--check', action='store_true', help='alleen voorcontroles en status')
    ap.add_argument('--backtest', nargs='*', metavar='DATUM', help='backtest op dagdata: [start] [eind]')
    ap.add_argument('--dashboard', action='store_true', help='ook het dashboard starten')
    ap.add_argument('--poort', type=int, default=8001)
    a = ap.parse_args()

    if a.backtest is not None:
        import backtest_agent
        sys.argv = ['backtest_agent.py', a.profiel or 'agent'] + list(a.backtest)
        backtest_agent.main(); return

    import server
    cfg = server.load_cfg()
    if a.profiel: cfg['profiel'] = a.profiel
    if a.paper: cfg['mode'] = 'paper'
    if a.live: cfg['mode'] = 'live'
    cfg['bron'] = 'live'
    server.NOTIFY.configure(cfg['telegram_token'], cfg['telegram_chat'])

    problems, warns = preflight(cfg)
    print(f'Agent {server.VERSION} | profiel {cfg["profiel"]} | modus {cfg["mode"]} | exchange {cfg["exchange"] if cfg["mode"] == "live" else "-"} | koersen {cfg["data_exchange"]}')
    for w in warns: print('  let op:', w)
    for p in problems: print('  PROBLEEM:', p)
    if a.check:
        print('Heartbeat:', heartbeat_status()); sys.exit(1 if problems else 0)
    if problems:
        print('Niet gestart. Los de problemen op (of draai met --paper).'); sys.exit(1)

    # instellingen vastleggen zodat het dashboard en een herstart dezelfde stand gebruiken
    cfg['was_actief'] = True; server.save_cfg(cfg)
    stop = threading.Event()
    def on_signal(*_):
        print('Stoppen... (open posities blijven staan; de stand is opgeslagen)'); stop.set(); server.RUN['stop'].set(); server.RUN['want'] = False
    signal.signal(signal.SIGTERM, on_signal); signal.signal(signal.SIGINT, on_signal)

    threading.Thread(target=server.supervisor, daemon=True).start()
    threading.Thread(target=server.news_loop, daemon=True).start()
    server.start_worker(cfg)
    if a.dashboard:
        threading.Thread(target=lambda: server.app.run(host='127.0.0.1', port=a.poort, debug=False, threaded=True, use_reloader=False), daemon=True).start()
        print(f'Dashboard: http://localhost:{a.poort}')
    seen = 0
    while not stop.is_set():
        time.sleep(5)
        logs = list(server.LOGS)[::-1]                      # oudste eerst
        for x in logs[seen:]: print(f'{x["t"]} {x["m"]}', flush=True)
        seen = len(logs) if len(logs) < server.LOGS.maxlen else seen   # bij een volle buffer verschuift alles: niet opnieuw afdrukken
        if len(logs) >= server.LOGS.maxlen: seen = len(logs)
    time.sleep(1)


if __name__ == '__main__':
    main()
