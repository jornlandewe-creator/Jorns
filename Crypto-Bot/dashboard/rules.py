"""De handelsregels van elke strategie in gewone taal, en een kwaliteitsoverzicht per strategie.
Deze teksten beschrijven precies wat de code doet (trader.py en modules.py)."""
import numpy as np

RULES = [
    # ---------------- BTC-portfolio: 7 strategieen op BTC, elk 1/7 van de module
    dict(strat='Trend 4h', module='BTC-portfolio', tf='4 uur',
         instap='Koers boven de 200-EMA en die stijgt, MACD positief, ADX boven 20 met +DI boven -DI, beweeglijkheid en volume boven gemiddeld. Alleen long.',
         uit='Koers sluit onder de 200-EMA.', stop='2x ATR onder de instap.',
         grootte='Risico 2% van het deelaccount tot de stop (maximaal het hele deelaccount x hefboom).'),
    dict(strat='Bollinger breakout', module='BTC-portfolio', tf='dag',
         instap='Dagslot breekt boven de bovenste Bollinger-band (50 dagen, 2,5 standaardafwijking). Alleen long.',
         uit='Dagslot onder het 50-daags gemiddelde.', stop='3x ATR onder de instap.', grootte='Hele deelaccount x hefboom.'),
    dict(strat='Keltner breakout', module='BTC-portfolio', tf='dag',
         instap='Dagslot breekt boven het Keltner-kanaal (50-EMA + 1,5x ATR). Alleen long.',
         uit='Dagslot onder de 50-EMA.', stop='1,5x ATR onder de instap.', grootte='Hele deelaccount x hefboom.'),
    dict(strat='Momentum', module='BTC-portfolio', tf='dag',
         instap='Rendement over 60 dagen gaat van negatief naar positief. Alleen long.',
         uit='Rendement over 60 dagen weer negatief.', stop='1,5x ATR; na +1x ATR wordt 1/3 verkocht en gaat de stop naar break-even.',
         grootte='Risico 2% van het deelaccount tot de stop.'),
    dict(strat='Sonic R', module='BTC-portfolio', tf='dag',
         instap='Long: koers boven de 89-EMA en 89-EMA boven de 200-EMA, na een terugval naar de "dragon" (34-EMA van de highs) sluit de koers er weer boven. Short: spiegelbeeld.',
         uit='Koers sluit aan de verkeerde kant van de 89-EMA.', stop='1,5x ATR; na +1,5x ATR 1/3 winst nemen en stop naar break-even.',
         grootte='Risico 2% van het deelaccount tot de stop.'),
    dict(strat='Rode candles', module='BTC-portfolio', tf='dag',
         instap='Na 3 rode dagcandles op rij kopen, alleen als de koers boven het 100-daags gemiddelde staat (dip in een stijgende markt).',
         uit='Eerste groene dagcandle.', stop='Geen vaste stop; de trade duurt meestal 1 tot 3 dagen.', grootte='Hele deelaccount x hefboom.'),
    dict(strat='Supertrend 4h', module='BTC-portfolio', tf='4 uur',
         instap='Supertrend (10, 3) slaat om naar boven. Alleen long.',
         uit='Supertrend slaat om naar beneden.', stop='3x ATR; na +3x ATR 1/3 winst nemen en stop naar break-even.',
         grootte='Risico 2% van het deelaccount tot de stop.'),
    # ---------------- L/S-rotatie
    dict(strat='L/S-rotatie', module='L/S-rotatie', tf='dag',
         instap='Elke 1, 3 of 7 dagen: koop de 2 of 3 sterkste van de 10 munten (alleen als ze boven hun 50-daags gemiddelde staan) en short de 2 of 3 zwakste met negatief momentum. Sterkte = rendement (of rendement gedeeld door beweeglijkheid) over 7 tot 90 dagen. De instellingen kiest de bot elk jaar opnieuw op de 2 jaar ervoor.',
         uit='Bij de volgende herverdeling als de munt niet meer bij de sterkste/zwakste hoort.', stop='Shorts: hard stop op +50% stijging.',
         grootte='Helft van de module long, helft short, gelijk verdeeld over de munten.'),
    # ---------------- Volume-piek
    dict(strat='Volume-piek', module='Volume-piek 30m', tf='30 min',
         instap='Het aantal trades in een 30-minutencandle ligt 3 standaardafwijkingen boven het gemiddelde van 200 candles, de candle is groen en de munt staat boven zijn 200-candle gemiddelde.',
         uit='Koers sluit onder de 20-EMA.', stop='Alleen bij hefboom: ruim voor liquidatie (60% van de afstand).', grootte='1/10 van de module per munt x hefboom.'),
    # ---------------- Trend-long
    dict(strat='Supertrend 4h (Trend-long)', module='Trend-long', tf='4 uur',
         instap='Supertrend (10, 4) slaat om naar boven en BTC staat boven zijn 100-daags gemiddelde.', uit='Supertrend slaat om, of BTC zakt onder het 100-daags gemiddelde.',
         stop='2,5x ATR onder de instap. Profiel Hoge winrate: bij +1x ATR 1/3 winst nemen en stop naar break-even.', grootte='1/30 van de module per munt x hefboom.'),
    dict(strat='Volume-uitbraak 4h', module='Trend-long', tf='4 uur',
         instap='Slot boven de hoogste koers van de laatste 100 candles, met 3x het normale volume.', uit='Slot onder het 50-candle gemiddelde.',
         stop='2,5x ATR onder de instap. Profiel Hoge winrate: bij +1x ATR 1/3 winst nemen en stop naar break-even.', grootte='1/30 van de module per munt x hefboom.'),
    dict(strat='RSI-dip 1h', module='Trend-long', tf='1 uur',
         instap='RSI(7) onder 25 terwijl de munt boven zijn 200-uursgemiddelde staat, en BTC boven zijn 100-daags gemiddelde.', uit='RSI(7) boven 70, of BTC onder het 100-daags gemiddelde.',
         stop='Geen vaste stop (korte trades); bij hefboom ruim voor liquidatie.', grootte='1/30 van de module per munt x hefboom.'),
    # ---------------- Agent winrate
    dict(strat='Agent winrate', module='Agent winrate', tf='dag',
         instap='Elke dag na het dagslot, per munt (BTC, ETH, SOL): alleen als BTC én de munt boven hun 200-daags gemiddelde staan, en de koers meer dan 2% boven '
                'het 20- én het 50-daags gemiddelde sluit. Grootte = 60% / gemeten beweeglijkheid (30 dagen), plafond 1,5x (futures) of 1,0x (spot). Alleen long.',
         uit='Deelwinst: bij +1 ATR (14 dagen) wordt 1/3 verkocht en gaat de stop naar break-even (+0,2%). De rest loopt mee tot het dagslot meer dan 2% onder het '
             '50-daags gemiddelde komt, of tot BTC of de munt onder het 200-daags gemiddelde zakt.',
         stop='2 ATR onder de instap, elke ronde bewaakt. Na de deelwinst: break-even. Bij hefboom ook de liquidatie-bescherming. '
              'Account: noodstop (30% onder de top) en dagstop (25% binnen 24 uur).',
         grootte='Een derde van de pot per munt (SOL pas na 200 dagen historie), elke maand weer gelijk getrokken. Getest: winrate rond 66%, gemiddelde winst +17%, gemiddeld verlies -7,5%.'),
    # ---------------- Agent long/short
    dict(strat='Agent long/short', module='Agent long/short', tf='dag',
         instap='Long: als Agent (BTC en munt boven 200-daags gemiddelde, trend-ensemble 20/50/100, volatiliteitsdoel). Short: alleen als BTC én de munt onder hun '
                '200-daags gemiddelde staan én het 200-daags gemiddelde van BTC lager is dan 20 dagen eerder (bevestigde bear). Short-grootte = deel van de gemiddelden '
                '(20/50/100, band 2%) waar de koers onder staat x 60% / beweeglijkheid x 0,5. Alleen futures.',
         uit='Long: als Agent. Short: koers boven een gemiddelde (plus 2%) verkleint de short; BTC of munt weer boven het 200-daags gemiddelde sluit hem.',
         stop='Long: liquidatie-bescherming bij hefboom. Short: noodstop bij +40% stijging (60% van de afstand tot liquidatie). Account: noodstop 35% en dagstop 25%.',
         grootte='Een derde van de pot per munt, elke maand gelijk getrokken. Shorts betalen in de test 0,03% per dag financiering (geen funding-inkomsten gerekend).'),
    # ---------------- Agent
    dict(strat='Agent', module='Agent', tf='dag',
         instap='Elke dag na het dagslot (00:00 UTC), per munt (BTC, ETH, SOL): alleen als BTC én de munt boven hun 200-daags gemiddelde staan (hard marktfilter). '
                'De inzet is het deel van de gemiddelden van 20, 50 en 100 dagen waar de koers (met 2% band) boven staat: 0, 1/3, 2/3 of 100%, '
                'vermenigvuldigd met 60% / gemeten beweeglijkheid (30 dagen), tot een plafond (1,0x spot, 1,5x futures). Alleen long.',
         uit='Onder het 200-daags gemiddelde (BTC of de munt zelf): alles van die munt verkopen. Zakt de koers onder een gemiddelde (min 2%), dan wordt dat deel verkocht. '
             'Stijgt de beweeglijkheid, dan wordt de positie kleiner.',
         stop='Geen vaste stop per trade; het marktfilter en de krimpende inzet bij onrust zijn de bescherming. Bij hefboom: noodstop op 60% van de afstand tot liquidatie. '
              'Account: noodstop (35% onder de top) en dagstop (25% verlies binnen 24 uur, alleen voor rampen en fouten) sluiten alles en pauzeren 14 dagen.',
         grootte='Een derde van de pot per munt (SOL pas na 200 dagen koershistorie); elke maand weer gelijk getrokken. Herbalanceren alleen bij een verschil groter dan 2%.'),
    # ---------------- Trend-vasthouden
    dict(strat='Trend-vasthouden', module='Trend-vasthouden', tf='dag',
         instap='Elke dag na het dagslot (00:00 UTC): sluit BTC (of ETH) boven zijn 200-daags gemiddelde, dan kopen. Alleen long, geen hefboom.',
         uit='Dagslot onder het 200-daags gemiddelde: verkopen en die helft in cash.',
         stop='Geen vaste stop; het dagslot onder het 200-daags gemiddelde is de uitstap (gemiddeld verlies per trade ongeveer -6%).',
         grootte='De helft van het totaal per munt; elke maand worden de twee helften weer gelijk getrokken. Alle winst blijft in de pot.'),
    dict(strat='Trend snel', module='Trend snel', tf='2 uur (gemiddelde van 50 dagen)',
         instap='Elke 2 uur: koers van BTC (of ETH) meer dan 2% boven zijn 50-daags gemiddelde (van de afgesloten dagen): kopen. Alleen long, geen hefboom.',
         uit='Koers meer dan 2% onder het 50-daags gemiddelde: verkopen en die helft in cash. De band van 2% voorkomt heen-en-weer handelen.',
         stop='Geen vaste stop; de 2%-grens onder het gemiddelde is de uitstap (gemiddeld verlies per trade ongeveer -6%).',
         grootte='De helft van het totaal per munt; elke maand weer gelijk getrokken. Alle winst blijft in de pot.'),
]
ALGEMEEN = [
    'Profiel Agent long/short (v13, alleen futures): als Agent plus shorts op halve grootte in een bevestigde bear market. Dagdata 2018 - sep 2026: 57% per jaar, '
    'daling -30%, 2018 +21% en 2022 +22% (long-only: -3% en 0%). Buiten de steekproef (2023-2026) rond 40% per jaar. Geen enkel geteste variant haalt 50% in elk jaar.',
    'Profiel Agent winrate (v13, standaard): dezelfde poort als Agent maar als losse trades met deelwinst op +1 ATR en break-even stop. Dagdata 2018 - sep 2026: '
    '45% per jaar, daling -24%, 14 trades per jaar, winrate 66%, profit factor 2,8. Buiten de steekproef (2023-2026): 33% per jaar. Winrate hoger dan 50% is geen '
    'bewijs van kunde: wat telt is winrate x gemiddelde winst tegenover gemiddeld verlies (de verwachting per trade).',
    'Profiel Agent (v13): trend-ensemble x hard marktfilter x volatiliteitsdoel op BTC, ETH en SOL. Dagdata 2018 - sep 2026: 54% per jaar, daling -27%, '
    'ongeveer 9 trades per jaar, winrate 28-35% met gemiddelde winst rond +100% tegenover gemiddeld verlies rond -7%. Buiten de steekproef (2023-2026) 43% per jaar. '
    'Dezelfde code als live is doorgerekend met backtest_agent.py.',
    'Instap en uitstap gebeuren op het slot van een candle, uitgevoerd tegen de koers van dat moment. Stops worden elke minuut bewaakt.',
    'Elke maand krijgt elke module geld naar rato van zijn beweeglijkheid (rustige modules meer), maximaal de helft per module.',
    'Noodstop: staat het account het ingestelde percentage onder zijn top, dan gaat alles dicht en pauzeert de bot 14 dagen.',
    'Module-bewaking: zakt een module veel dieper dan in de tests, dan gaat alleen die module 30 dagen op pauze.',
    'Profiel Hoge winrate gebruikt alleen de module Trend-long (3 strategieen op 10 munten) met gedeeltelijke winstname: winrate rond 70%.',
    'Profiel Trend-vasthouden: vooraf vastgelegde regel (eerst regels, dan pas testen). Ongeveer 7 trades per jaar, lage winrate (rond 28%), kleine verliezen (gem. -6%) en grote winnaars (gem. +98%) die maanden doorlopen.',
    'Profiel Trend snel (proef): zelfde idee als Trend-vasthouden maar sneller (50 dagen, elke 2 uur). Beste uitkomst van de brede zoektocht op BTC+ETH zonder hefboom, maar gevonden na het bekijken van 2024-2026: daarom eerst op papier volgen.',
    'Een lage winrate (rond 40-45%) is normaal voor trendvolgen: veel kleine verliezen, minder maar grotere winsten. De verhouding gemiddelde winst / gemiddeld verlies en de profit factor zeggen meer.',
]


def name_key(t):
    s = t.get('strat', '?')
    if t.get('module') == 'Trend-long' and s == 'Supertrend 4h': return 'Supertrend 4h (Trend-long)'
    return s


def quality(trades):
    """Per strategie: aantal, winrate, gemiddelde winst/verlies, profit factor, totaal."""
    out = {}
    for t in trades:
        k = name_key(t); p = float(t.get('pnl') or 0)
        d = out.setdefault(k, dict(strat=k, n=0, win=0, sum_w=0.0, sum_l=0.0, totaal=0.0))
        d['n'] += 1; d['totaal'] += p
        if p > 0: d['win'] += 1; d['sum_w'] += p
        else: d['sum_l'] += p
    rows = []
    for d in out.values():
        nl = d['n'] - d['win']
        rows.append(dict(strat=d['strat'], trades=d['n'], winrate=d['win'] / d['n'] if d['n'] else None,
                         gem_winst=d['sum_w'] / d['win'] if d['win'] else None, gem_verlies=d['sum_l'] / nl if nl else None,
                         profit_factor=(d['sum_w'] / -d['sum_l']) if d['sum_l'] < 0 else None, totaal=round(d['totaal'], 2)))
    return sorted(rows, key=lambda r: -r['totaal'])
