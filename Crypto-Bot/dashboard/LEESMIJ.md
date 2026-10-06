# Crypto Portfolio Bot – dashboard

## Starten
1. Installeer Python 3.11 of nieuwer (python.org). Vink op Windows "Add Python to PATH" aan.
2. Windows: dubbelklik `start_windows.bat`. Mac: dubbelklik `start_mac.command` (eerste keer: rechtsklik > Open).
3. De eerste keer worden de onderdelen geinstalleerd (paar minuten). Daarna opent het dashboard op http://localhost:8000
4. Optioneel (Windows): dubbelklik `autostart_windows.bat`, dan start de bot vanzelf als je inlogt.

Laat de computer aan staan; de bot handelt alleen terwijl hij draait. Op de Mac houdt het startbestand
de computer wakker zolang de bot draait.

## Agent (standaardprofiel sinds v13)

De bot is nu een **agent**: een programma dat zelfstandig beslist, uitvoert, zichzelf bewaakt en bij gevaar zelf ingrijpt.
Je kunt hem draaien met het dashboard (`server.py`) of zonder (`python agent.py`, zie onderaan dit hoofdstuk). Beide gebruiken
precies dezelfde motor en dezelfde fail-safes.

### De regels (vast, geen jaarlijkse herinstelling)
Munten: BTC, ETH en SOL, elk een derde van de pot (SOL pas na 200 dagen koershistorie). Een keer per dag, na het dagslot (00:00 UTC):
1. **Marktfilter (hard)**: BTC sluit boven zijn 200-daags gemiddelde én de munt zelf ook. Anders staat die munt in cash. Dit is de
   belangrijkste regel: in 2018 en 2022 (de twee bear markets) verloor de agent daardoor -3% en 0%.
2. **Trend-ensemble**: de inzet is het deel van drie gemiddelden (20, 50 en 100 dagen) waar de koers boven staat: 0, 1/3, 2/3 of 100%.
   Een band van 2% (erin boven gemiddelde +2%, eruit onder gemiddelde -2%) voorkomt heen-en-weer handelen.
3. **Volatiliteitsdoel**: die inzet wordt vermenigvuldigd met 60% / de gemeten beweeglijkheid van de munt (30 dagen, op jaarbasis),
   met een plafond van 1,5x (futures) of 1,0x (spot). Rustige markt: volle inzet. Onrustige markt: automatisch kleiner.
   Zo blijft het risico per munt ongeveer gelijk, in plaats van de inzet.
4. Alleen long, geen shorts. Herbalanceren alleen als het verschil met het doel groter is dan 2% van het deelaccount.
   Elke maand worden de drie delen weer gelijk getrokken; alle winst blijft in de pot.

De exacte code staat in `agent_strategy.py` (een paar functies zonder bijwerkingen) en `modules.py` (AgentModule).

### Hoe gekozen (om zelfbedrog te beperken)
Eerst een brede zoektocht op dagdata 2018-2022 (`onderzoek/agent/`), daarna een controle op 2023 - sep 2026 die bij het kiezen niet is
bekeken. Alleen ingrediënten die ook buiten crypto bekend zijn: trendvolgen, een langetermijnfilter en een volatiliteitsdoel. Buurinstellingen
(andere lengtes, andere band, 150-250 dagen filter) geven allemaal 47-64% per jaar met een daling van -23 tot -39%, dus het resultaat hangt
niet aan één toevallige instelling. Dubbele kosten kosten 1 procentpunt per jaar.

### Resultaat (dagdata 2018 - sep 2026, dezelfde code als live, kosten 0,05% + 0,03% per kant)

| Profiel | Plafond | Per jaar | Grootste daling | Slechtste maand | Trades/jaar | Winrate | Winst/verlies per trade | 2023-2026 (controle) |
|---|---|---|---|---|---|---|---|---|
| **Agent** (futures) | 1,5x | **54%** | **-27%** | -13% | 9 | 28% | +100% / -7% | 42% per jaar, daling -27% |
| Agent spot (geen hefboom) | 1,0x | 48% | -25% | -11% | 10 | 31% | | 36% per jaar, daling -22% |
| Agent rustig (doel 50%, rem bij -15%) | 1,0x | 40% | -23% | -10% | 10 | 31% | | 30% per jaar, daling -19% |
| Trend-vasthouden (oud standaardprofiel) | 1,0x | 33% | -62% | -36% | 7 | 25% | +109% / -6% | 37% per jaar, daling -29% |
| BTC vasthouden | | 24% | -81% | | | | | 55% per jaar, daling -53% |

Per jaar (Agent): 2018 -3%, 2019 +78%, 2020 +232%, 2021 +106%, 2022 0%, 2023 +73%, 2024 +74%, 2025 -2%, 2026 (t/m sep) +24%.
Positieve maanden: 55% van de maanden waarin de agent in de markt zat (de rest van de tijd staat hij in cash, 0%).

Eerlijk:
- **De winrate per trade is laag (rond 30%)**, net als bij alle trendvolgers: veel kleine verliezen (gemiddeld -7%), weinig grote winsten
  (gemiddeld rond +100%). Een strategie waarbij de meeste trades winnen (dips kopen) is in de zoektocht geprobeerd: hoge winrate, maar
  over 2018-2023 verlies. Daarom is hier gekozen voor "meestal klein verliezen, soms groot winnen", met de daling als harde grens.
- **50% per jaar is het gemiddelde over negen jaar, geen belofte.** 2025 was -2%. Sinds 2023 is het 42% per jaar. Twee jaren met bijna
  niets zijn normaal. Begin op papier, en begin daarna klein.
- De hefboom (1,5x) wordt alleen gebruikt in rustige markten; bij hoge beweeglijkheid zakt de inzet vanzelf onder 1x.
- **Recente periode**: de echte bot-replay in stappen van 30 minuten over maart 2024 - sep 2026 geeft **15% per jaar met een daling van -24%**
  (BTC vasthouden in die periode: 13% per jaar, daling -53%; de dagbacktest vanaf dezelfde datum geeft hetzelfde: 14,7%). Die 2,5 jaar waren
  een zijwaartse markt met scherpe dalingen, het slechtste weer voor trendvolgen. Het gemiddelde van 54% komt vooral uit 2019-2021 en 2023.
  Reken dus niet op 50% elk jaar; reken op een lage daling en op het meepakken van de volgende lange stijging.

### Fail-safes (risico en zelfbescherming)
Alle onderstaande regels zijn actief in het dashboard én in `agent.py`:
- **Noodstop**: account 35% onder zijn top (Agent spot 30%, Agent rustig 25%) -> alles dicht, 14 dagen pauze, daarna halve inzet tot een nieuwe top.
  Dit ligt onder de diepste daling uit de test (-27%): hij hoort nooit af te gaan, en als dat wel gebeurt klopt er iets niet.
- **Dagstop** (nieuw): 12% verlies binnen 24 uur (spot 10%, rustig 8%) -> alles dicht, 14 dagen pauze. Tegen flash-crashes en fouten.
  Ging in de test één keer af (oktober 2025).
- **NOODSTOP-bestand** (nieuw): maak een leeg bestand `NOODSTOP` in de map `dashboard` en de bot sluit alles en pauzeert tot je in het
  dashboard op Hervatten klikt. Werkt ook als je niet bij het dashboard kunt (bijvoorbeeld via SSH: `touch ~/bot/NOODSTOP`).
- **Liquidatie-bescherming** bij hefboom: sluiten op 60% van de afstand tot liquidatie.
- **Koerscontrole**: koersen ouder dan 2 uur of een sprong van meer dan 25% in één ronde -> die ronde wordt niet gehandeld.
- **Foutherstel**: een fout stopt de bot niet (loggen, wachten, opnieuw); een bewaker herstart het proces; de stand wordt na elke ronde
  veilig opgeslagen met reservekopie; na een herstart hervat hij zelf.
- **Heartbeat** (nieuw): `heartbeat.json` wordt elke ronde bijgewerkt (tijd, waarde, stand van de rem, gezondheid). `python agent.py --check`
  leest dit en doet de voorcontroles. Zet dat in cron voor een melding als de bot stil staat.
- **Live**: elk uur worden de posities vergeleken met de exchange (melden of corrigeren). Telegram-meldingen bij noodrem, pauze, fouten, herstart en dagrapport.

### Agent zonder dashboard
```
python agent.py --check                 # voorcontroles (keys, saldo, munten op de exchange, koersbron, Telegram) en de heartbeat
python agent.py --paper                 # paper op live koersen, niets wordt echt gekocht
python agent.py --live                  # echte orders (vereist keys en risico_akkoord in config.json)
python agent.py --dashboard             # agent plus dashboard op http://localhost:8000
python agent.py --backtest 2023-01-01   # het agent-profiel doorrekenen op dagdata vanaf een datum
python backtest_agent.py                # alle agent-profielen 2018 - sep 2026
```
Stoppen met Ctrl+C: open posities blijven staan en de stand is opgeslagen; bij de volgende start gaat hij verder.
De instellingen (profiel, modus, keys, Telegram) staan in `config.json` en zijn ook via het dashboard in te stellen.

## Profielen (Instellingen > Profiel)

### Trend-vasthouden (standaardprofiel tot v12)
Eerst op papier vastgelegd, pas daarna getest (zie onderzoek/robuust/REGELS_VOORAF.md, aanvulling 2 en 3),
zodat de uitkomst niet mooi gemaakt kan zijn door te zoeken.
- De helft van het geld voor BTC, de helft voor ETH.
- Elke dag na het dagslot (00:00 UTC, 02:00 Nederlandse zomertijd): sluit de munt boven haar 200-daags gemiddelde, dan erin;
  zo niet, dan die helft in cash.
- Steeds weer 50/50 gelijk getrokken. Geen hefboom, geen shorts, geen afromen: alle winst blijft doorgroeien.
- Ongeveer 7 trades per jaar. Werkt ook op een gewoon spot-account (EUR of USDC).

Getest 2018 - sep 2026 (dagdata, kosten 0,05% + 0,03% per kant):

| | Per jaar | Grootste daling | Trades | Winrate | Gem. winst | Gem. verlies |
|---|---|---|---|---|---|---|
| Trend-vasthouden (dagelijks) | 33% | -62% | 7 per jaar | 28% | +98% | -6% |
| Zelfde regel, wekelijks (v10) | 29% | -61% | 3,5 per jaar | 45% | +114% | -14% |
| BTC+ETH gewoon vasthouden | 20% | -88% | | | | |
| Sinds 2022: Trend-vasthouden | 25% | -29% | | | | |
| Sinds 2022: BTC+ETH vasthouden | 3% | -69% | | | | |

Per jaar: 2018 -39%, 2019 +32%, 2020 +155%, 2021 +97%, 2022 -9%, 2023 +72%, 2024 +61%, 2025 -9%, 2026 (t/m sep) +20%.
Echte bot-replay maart 2024 - sep 2026: +25% totaal, daling -31% (BTC+ETH vasthouden +6%, daling -58%).

Ook getest en afgewezen (aanvulling 3):
- 10 munten, de 3 sterkste in trend kopen (27 trades per jaar): sinds 2022 -4% per jaar en dalingen tot -77%.
- Hefboom die meebeweegt met de onrust: lager rendement, met dubbele kosten bijna niets over.
- Vaste 2x hefboom: 9% per jaar met een daling van -90%. Hefboom op een trendstrategie met lage winrate vergroot vooral de
  reeks kleine verliezen en de terugval voordat een grote winnaar komt. Daarom geen hefboom in dit profiel.

Eerlijk: dit profiel verliest vaker dan het wint (ongeveer 3 van de 4 trades), maar de verliezen zijn klein en de winsten groot.
Er zitten jaren tussen met verlies (2018, 2022, 2025). In geld wint hij op de lange termijn meer dan hij verliest.

### Trend snel (proef)
Zelfde idee, sneller: 50-daags gemiddelde in plaats van 200, controle elke 2 uur, met een band van 2% (erin boven
gemiddelde +2%, eruit onder gemiddelde -2%) tegen heen-en-weer handelen. BTC+ETH, geen hefboom, ongeveer 13 trades per jaar.

| | Per jaar | Grootste daling | Winrate | Gem. winst | Gem. verlies |
|---|---|---|---|---|---|
| Trend snel 2018 - sep 2026 | 58% | -49% | 34% | +48% | -6% |
| Trend snel 2018-2023 / 2024 - sep 2026 | 67% / 39% | | | | |
| Trend-vasthouden 2018-2023 / 2024 - sep 2026 | 37% / 23% | | | | |

Per jaar: 2018 -30%, 2019 +42%, 2020 +387%, 2021 +196%, 2022 -32%, 2023 +101%, 2024 +45%, 2025 +36%, 2026 (t/m sep) +23%.
Echte bot-replay maart 2024 - sep 2026: +96% totaal, daling -30%.

Waarom "proef": in de brede zoektocht (aanvulling 4, 1776 varianten: trend, kruisingen, uitbraken, dips kopen in trend,
winst nemen, alleen dips kopen per 2 uur, hefboom 1-3x, 1/2/5/10 munten) koos de vooraf vastgelegde regel de variant met
het hoogste rendement op 2018-2023: 10 munten met 1,5x hefboom (136% per jaar). Op 2024-2026 haalde die maar 9% per jaar met
een daling van -66%. Daarmee faalde hij, en blijft Trend-vasthouden het standaardprofiel.
Wel bleek: op BTC+ETH zonder hefboom zijn bijna alle snellere trendvarianten (50 tot 150 dagen) in beide periodes beter dan
200 dagen, en Trend snel was daarbij de beste op 2018-2023. Maar ik heb 2024-2026 al gezien voordat ik hem koos, dus dat
is geen schone controle. De echte toets is de komende maanden op papier.

Andere lessen uit de zoektocht:
- Hefboom: gemiddeld over alle varianten zakt het rendement op 2024-2026 van 15% (1x) naar 10% (1,5x), 8% (2x) en -4% (3x),
  en de dalingen gaan van -34% naar -81%. Meer hefboom gaf bijna nooit meer rendement.
- Alleen dips kopen per 2 uur: winrate rond 60%, maar 2018-2023 gemiddeld -8% per jaar. Hoge winrate, geen winst.
- Dips bijkopen in een trend: lager rendement dan gewoon de trend volgen.
- Hoe goed een variant het in 2018-2023 deed, voorspelde maar zwak hoe hij het in 2024-2026 deed. Het hoogste
  backtestrendement kiezen is dus geen garantie; eenvoudige regels op BTC+ETH hielden het het best.

Wissel je in een lopend account van profiel, dan sluit de bot de posities van het oude profiel en zet het geld over.

### Overige profielen (actief handelen)
Gekozen met echte replays van de bot (maart 2024 - september 2026), met alle vier modules en futures-kosten.

| Profiel | Hefboom | Noodrem | Noodstop | Per jaar | Grootste daling | Stijgende maand | Dalende maand | Winst na 12 mnd |
|---|---|---|---|---|---|---|---|---|
| Rustig | 1x | uit | -30% | 21% | -11% | +4,0% | -0,2% | 98% |
| Standaard | 2x | uit | -40% | 38% | -23% | +7,8% | -0,5% | 95% |
| Agressief | 4x | aan | -50% | 72% | -38% | +16,6% | -1,4% | 94% |
| Zeer agressief | 6x | aan | -60% | 110% | -54% | +28,6% | -2,5% | 91% |
| Hoge winrate (alleen Trend-long, met winstname) | 4x | uit | -45% | 35% | -34% | +11,7% | -3,1% | 53% |
| Winrate mix (L/S + Trend-long met winstname) | 2x | uit | -45% | 40% | -38% | +7,6% | +1,2% | 99% |
| Winrate mix 3x | 3x | uit | -55% | 50% | -48% | +14,1% | +1,5% | 89% |
| BTC vasthouden | | | | 12% | -53% | +12,9% | -13,1% | |

Winrate per profiel: Rustig t/m Zeer agressief rond 44%, Hoge winrate 71%, Winrate mix 62-63%.
Hoge winrate werkt alleen als BTC boven zijn 100-daags gemiddelde staat; in 2025 stond het daardoor op -8%.
Bij de Winrate mix komt het grootste deel van het rendement uit 2024; 2025 en 2026 waren rustiger (+6% en +8% bij 2x).

Stijgende maand: gemiddeld in maanden waarin BTC meer dan 5% steeg. Dalende maand: BTC meer dan 5% gedaald.
"Winst na 12 mnd": van alle mogelijke startdagen het deel dat een jaar later op winst stond.
Op korte termijn is het een muntworp: na één maand staat de bot ongeveer de helft van de keren op verlies.
Alle profielen gebruiken verdeling naar risico (rustige modules krijgen meer geld).

- **Noodrem**: staat de strategie zelf 6% onder haar top, dan gaat de hefboom naar de helft. Terug naar vol als
  ze hersteld is tot -3%. Kijkt naar de strategie, niet naar je account, zodat hij na herstel niet blijft hangen.
- **Noodstop**: staat je account zoveel onder zijn top, dan wordt alles gesloten en pauzeert de bot 14 dagen.
  Daarna hervat hij op halve hefboom tot er een nieuwe top is. Je kunt ook eerder handmatig hervatten.

## Zelfherstel
- Een fout (exchange even onbereikbaar, time-out) stopt de bot niet: hij logt, wacht en probeert opnieuw.
- Een bewaker start het bot-proces opnieuw als het vastloopt. Crasht het hele programma, dan start het
  startbestand het binnen 10 seconden opnieuw.
- Koersen ouder dan 2 uur of onwaarschijnlijke koerssprongen (>25% in één minuut): die ronde wordt niet gehandeld.
- De stand wordt veilig opgeslagen met een reservekopie. Is het bestand beschadigd, dan pakt hij de kopie.
- Na een herstart van de computer hervat de bot vanzelf (instelbaar).
- Live: elk uur vergelijkt de bot zijn posities met die bij de exchange. Bij verschil meldt hij dat,
  of corrigeert hij het zelf (instelbaar).
- Module-bewaking: zakt een module veel dieper dan ooit in de test (ongeveer 1,5x zijn slechtste daling),
  dan zet de bot die module op pauze. Hij houdt zijn geld als cash en hervat na 30 dagen vanzelf,
  of eerder als je op Hervatten klikt.

## Live feedback
- **Gezondheid**-paneel: per onderdeel groen, oranje of rood, met uitleg, plus de laatste meldingen.
- **Noodrem**-balk: hoe ver het account onder zijn top staat en hoe ver de noodstop nog weg is.
- **Telegram** (Instellingen): meldingen op je telefoon bij noodrem, pauzes, fouten, herstarts en een
  dagrapport. Optioneel ook bij elke trade. Instellen: zoek in Telegram @BotFather, stuur /newbot,
  kopieer het token naar het dashboard, stuur een berichtje naar je nieuwe bot en klik "Test melding".

## Nieuws met Claude (optioneel)
Instellingen > Nieuws met Claude. De bot leest elke 15 minuten gratis nieuwsfeeds (CoinDesk, Cointelegraph, Decrypt,
Bitcoin Magazine, The Block) en houdt alleen koppen over die over de 10 munten of de markt gaan (hack, ETF, verbod,
delisting, faillissement en dergelijke). Alleen als er zulke nieuwe koppen zijn, vraagt hij Claude (Haiku 4.5, het
goedkoopste model) om ze te beoordelen van -2 tot +2.
- **Zuinig**: alleen de kop, maximaal 25 per keer, kort antwoord. Rond €0,001 per vraag, minimaal een uur ertussen,
  maximaal 12 per dag (instelbaar) en een maandbudget (standaard €2). Meestal kost het minder dan €0,50 per maand.
- **Alleen melden**: je ziet de beoordeling in het dashboard en krijgt een Telegram-melding bij iets bijzonders.
- **Melden en beschermen**: alleen bij de uitersten doet de bot iets.
  Een munt -2 (bijvoorbeeld een hack): longs op die munt dicht en 3 dagen geen nieuwe longs.
  Een munt +2 (bijvoorbeeld een ETF-goedkeuring): shorts op die munt dicht en 3 dagen geen nieuwe shorts.
  Markt +2: alle shorts dicht. Markt -2: 24 uur geen nieuwe longs.
- Dit is niet terug te testen, want nieuws van vroeger is niet beschikbaar. Begin daarom met "alleen melden".
- Je hebt een Claude API key nodig van console.anthropic.com. Dat is iets anders dan je Claude-abonnement: je betaalt
  per gebruik en zet zelf tegoed op je account. De key blijft op deze computer (config.json).

## Draaien terwijl je laptop uit staat (gratis server)
De bot moet ergens 24 uur per dag aan staan. Zonder te betalen kan dat zo:

**Optie 1: Oracle Cloud "Always Free" (aanrader)**
1. Maak een account op oracle.com/cloud/free. Je hebt een telefoonnummer en creditcard nodig ter controle;
   Oracle zegt niets af te schrijven zolang je niet zelf upgradet. Zet meteen een budgetmelding aan.
2. Kies als thuisregio **Amsterdam** of **Frankfurt**. Dat kun je later niet meer wijzigen, en vanuit de VS
   blokkeert Binance de koersen.
3. Maak een instance: Ubuntu, vorm "Ampere A1", 1 OCPU en 6 GB is ruim genoeg. Bewaar de SSH-sleutel.
   Krijg je "Out of host capacity", probeer het later opnieuw of kies een ander beschikbaarheidsdomein.
4. Kopieer de map van de bot naar de server (bijvoorbeeld met `scp -r dashboard ubuntu@IP:~/bot`) en voer daar uit:
   `cd ~/bot && bash install_server.sh`
5. Dashboard bekijken vanaf je eigen computer: `ssh -L 8000:localhost:8000 ubuntu@IP` en open http://localhost:8000.
   Klik daar een keer op Start. Daarna draait hij door, ook na een herstart van de server.
6. Zet Telegram-meldingen aan, dan zie je alles op je telefoon zonder in te loggen.

Let op: Oracle kan een gratis server terugnemen die een week vrijwel niets doet. De bot gebruikt weinig
rekenkracht, dus houd je mail in de gaten.

**Optie 2: thuis een zuinig apparaat laten aanstaan**
Een Raspberry Pi 4 of 5 (eenmalig rond de €60 tot €90, stroom een paar euro per jaar) of een oude laptop
met Linux. Zelfde stappen vanaf stap 4.

**Niet geschikt**: de gratis server van Google Cloud staat alleen in de VS (Binance geblokkeerd) en heeft 1 GB
geheugen. GitHub Actions en PythonAnywhere (gratis) kunnen geen programma dag en nacht laten draaien.

## Backtest
Klik **Backtest**, kies een periode (of **Laatste 2 maanden**) en een profiel. De bot rekent die periode
door alsof hij toen live draaide, met alleen koersen van voor elk moment. Data loopt tot en met 1 oktober 2026.

## Wat de bot doet
Vier modules met elk een deel van het account, elke maand herverdeeld naar risico (maximaal de helft per module):
1. **BTC-portfolio** – 7 strategieen op BTC met stop loss per trade en trendfilter.
2. **L/S-rotatie** – koopt de sterkste en shortt de zwakste van 10 munten. Kiest elk jaar zelf nieuwe
   instellingen op basis van de 2 jaar ervoor. Shorts hebben een harde stop op +50%.
3. **Volume-piek 30m** – koopt bij een plotselinge explosie in het aantal trades. Bij hefboom sluit hij
   een positie ruim voordat de exchange hem zou liquideren.
4. **Trend-long** – verdient in een stijgende markt, staat in een dalende markt in cash. Drie strategieen op 10 munten:
   Supertrend 4h (rijdt mee met de stijging, stop 2,5x ATR), Volume-uitbraak 4h (nieuwe top op 3x normaal volume)
   en RSI-dip 1h (koopt korte dips in een stijgende munt). Supertrend en RSI-dip kopen alleen als BTC boven
   zijn 100-daags gemiddelde staat. Gekozen op 2022-2023 uit 3080 varianten, gecontroleerd op 2024-2026.

## Live met je eigen API key
Shorts en hefboom vragen een **futures-account** bij een partij met vergunning in NL/EU.

### OKX (aanbevolen als je daar al een account hebt)
1. **Futures aanzetten**: in OKX Europa heten ze X-Perps. Je doorloopt eerst een korte vragenlijst over risico.
   De maximale hefboom voor particulieren kan lager zijn dan bij het profiel; de bot controleert dat en waarschuwt.
2. **Sub-account**: maak een sub-account "bot" en zet daar alleen het geld op dat de bot mag gebruiken (USDT of USDC).
3. **API key** op dat sub-account: rechten **Lezen + Handelen**, nooit **Opnemen**. Kies een passphrase en bewaar die.
   Draait de bot op een server, vul dan het IP-adres van die server in bij de IP-beperking.
4. **Dashboard** > Instellingen: Modus Live, exchange **myokx** (OKX Europa) of **okx** (internationaal account),
   markt-notatie `{c}/USDT:USDT`, vul API key, secret en passphrase in en klik **Test API key**.
   Je ziet je saldo, welk contract per munt gebruikt wordt en welke munten ontbreken.
5. Zet het **startkapitaal** gelijk aan (of lager dan) het saldo op het sub-account. Begin klein.

Wat de bot zelf regelt:
- Netto positiemodus (one-way). Lukt dat niet, zet dan in OKX bij Instellingen de positiemodus op "One-way".
- Cross margin, en per contract een hefboom met ruimte voor marge. Hoe groot een positie wordt, bepaalt de bot zelf.
- OKX handelt in contracten; de bot rekent munten om en rondt af op wat OKX toestaat. Te kleine orders slaat hij over.
- Munten zonder contract op jouw account worden overgeslagen. Bij de start van OKX X-Perps waren dat onder andere
  BNB, AVAX, LINK en DOT. De Test-knop laat zien hoe dat nu is. Met minder munten wijkt het resultaat af van de backtest.
- Elk uur vergelijkt de bot zijn posities met die bij OKX (melden of zelf corrigeren, zie Zelfherstel).

### Andere EU-brokers
- **Futures** (aanrader, zoals getest): OKX (X-Perps) of Kraken Futures. Kies "Futures" bij Soort account.
  Kraken futures: exchange `krakenfutures`, markt-notatie `{c}/USD:USD`.
- **Spot** (alleen kopen, geen hefboom, geen shorts): elke broker die ccxt ondersteunt, zoals Bitvavo, Kraken of OKX spot.
  Kies "Spot" bij Soort account en markt-notatie `{c}/EUR` (of `{c}/USDC`). Getest maart 2024 - sep 2026:

| Spot met kosten per trade | Per jaar | Grootste daling | Laatste 2 jaar |
|---|---|---|---|
| 0,05% | 19,6% | -10,6% | +63% |
| 0,10% (bijvoorbeeld OKX spot) | 16,7% | -12,1% | +55% |
| 0,25% (bijvoorbeeld Bitvavo) | 7,5% | -16,4% | +31% |
| Ter vergelijking: futures Rustig 1x (0,05%) | 21,1% | -10,8% | +69% |
| Ter vergelijking: BTC vasthouden | 12% | -53% | +38% |

  De bot handelt vaak, dus de kosten per trade bepalen veel. Bij 0,25% is spot het niet waard.
  Zet bij paper de kosten op de echte fee van je broker, dan klopt de proef.
- Het dashboard rekent in dollars (de koersbron is Binance in USDT). Bij een euro-account wijken de bedragen
  daardoor een paar procent af van wat je bij de broker ziet; de winst en het verlies in procenten kloppen wel.

### Algemeen
- Key op een sub-account, alleen handelsrechten, nooit opnemen.
- Keys en tokens blijven op deze computer (config.json); het dashboard is alleen vanaf deze computer bereikbaar.
- Draai eerst minstens een paar weken paper. Begin daarna klein. Geen financieel advies.
