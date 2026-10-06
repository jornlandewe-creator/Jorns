# Regels vooraf vastgelegd (pre-registratie)

Vastgelegd op 2026-10-05 11:43 UTC, vóór het draaien van een test. Hierna wordt niets meer aan de regels of
instellingen veranderd op basis van de uitkomst. Als de strategie de toetsen niet haalt, is de uitkomst: niet gebruiken.

## Uitgangspunten
- Alleen effecten die ook buiten deze bot in onderzoek zijn aangetoond: trendvolgen per munt (time-series momentum)
  en de sterkste munten kopen / zwakste shorten (cross-sectional momentum).
- Standaard instellingen uit de literatuur, niet gezocht in deze data. Geen jaarlijkse herinstelling.
- Munten doen mee zodra ze minstens 150 dagen koershistorie hebben (BTC, ETH, BNB vanaf 2018, daarna XRP, ADA,
  LINK, DOGE, SOL, AVAX, DOT).

## Strategie A: trend per munt
- Signaal per munt = gemiddelde van het teken van het rendement over 20, 60 en 120 dagen (waarde -1, -1/3, +1/3 of +1).
  Positief = long, negatief = short.
- Grootte per munt: signaal x (40% / beweeglijkheid van die munt over 30 dagen, op jaarbasis) / aantal munten.
- Herverdelen: elke 7 dagen.

## Strategie B: sterkste kopen, zwakste shorten
- Rangschik de munten op rendement over 28 dagen. Long de bovenste derde, short de onderste derde (minstens 1 per kant),
  gelijke gewichten, 50% van de pot long en 50% short.
- Herverdelen: elke 7 dagen.

## Samenvoegen
- Elke strategie wordt geschaald naar 25% beweeglijkheid per jaar, op basis van de 60 dagen ervoor (alleen verleden),
  met hoogstens 3x hefboom. De pot gaat 50/50 naar A en B.

## Kosten
- 0,05% fee + 0,03% slippage per kant over alle omzet.
- Funding: longs betalen en shorts ontvangen de echte funding van BTC en ETH (2020 - apr 2026). Voor andere munten
  1,5x de BTC-funding. Zonder data (voor 2020 en na apr 2026): 0,01% per 8 uur.

## Testperiode
- 1 januari 2018 t/m 30 september 2026 (dagdata). Bevat de dalingen van 2018 en 2022.

## Toetsen (allemaal halen, anders niet gebruiken)
1. t-waarde van het rendement (Sharpe x wortel aantal jaren) minstens 2,0 voor de combinatie.
2. Ook zonder de 3 beste maanden een positief rendement.
3. Elke strategie beter dan minstens 95% van 300 willekeurige bots met dezelfde omzet en dezelfde kosten.
4. Met dubbele kosten nog steeds positief.
5. In minstens 5 van de 8 hele jaren (2018 t/m 2025) positief.
6. Grootste daling hoogstens 35%.

## Ter informatie (niet om te kiezen)
- Uitkomsten met buur-instellingen (andere periodes, andere aantallen) worden getoond om te zien of het resultaat
  niet op één toevallige instelling rust. De vastgelegde instelling blijft de uitkomst.

## Aanvulling: winst vasthouden (vastgelegd 2026-10-05 21:00 UTC, vóór de test)
Twee regels, elk apart getest op: de combinatie A+B (2018-2026), en de echte bot-replays Standaard en Winrate mix (2024-2026).
- **Winst afromen**: aan het eind van elke maand gaat 50% van de winst boven de vorige top naar een kluis. De bot handelt
  daar niet meer mee. Uitkomst = bot + kluis.
- **Winstslot**: de bot meet zijn eigen strategie (zonder hefboomwijzigingen). Staat die meer dan 10% onder haar top,
  dan halve inzet; meer dan 20% onder de top, dan geen inzet. Terug naar volle inzet als ze weer binnen 5% van haar top is.
Toets: de regel helpt alleen als de grootste daling van het totaal duidelijk kleiner wordt (minstens 1/4) en het
eindbedrag hoogstens 1/4 lager uitvalt. Anders niet invoeren.

## Aanvulling 2: vasthouden met trendfilter en funding (vastgelegd 2026-10-05 21:05 UTC, vóór de test)
Geen afromen: alle winst blijft in de pot (volledig doorgroeien).
- **C. BTC+ETH met trendfilter**: 50% BTC en 50% ETH zolang die munt boven haar 200-daags gemiddelde staat, anders die helft in cash.
  Controle elke 7 dagen. Geen hefboom.
- **D. C plus funding**: zoals C, maar is de gemiddelde funding van de laatste 7 dagen hoger dan 90% van het afgelopen jaar
  (iedereen zwaar long), dan die helft in cash.
Toets: beter dan BTC+ETH gewoon vasthouden in rendement per jaar ÉN grootste daling hoogstens de helft daarvan,
over 2018-2026 én apart over 2022-2026. t-waarde ≥ 2,0. Kosten 0,05% + 0,03% per kant.

## Aanvulling 3: meer trades en hefboom (vastgelegd 2026-10-05 21:26 UTC, vóór de test)
Maatstaf is nu C (Trend-vasthouden). Kosten 0,05% + 0,03% per kant. Varianten met hefboom of shorts betalen de echte funding
(zoals in de hoofdtest); varianten zonder hefboom draaien op spot en betalen geen funding.
- **E. Sterkste in trend (10 munten, long)**: elke 7 dagen. Kandidaten = munten boven hun 200-daags gemiddelde.
  Koop de 3 met het hoogste rendement over 28 dagen, elk 1/3 van de pot. Minder dan 3 kandidaten: rest in cash. Geen hefboom.
- **F. C met hefboom naar beweeglijkheid**: zoals C, maar elke helft krijgt 0,5 x min(2, 60% / beweeglijkheid van die munt
  over 30 dagen op jaarbasis). Rustige markt: tot 2x, onrustige markt: minder dan 1x. Futures, funding betaald.
- **G. C met dagelijkse controle**: zoals C, maar elke dag beslissen en herverdelen in plaats van elke 7 dagen.
- **H. C met vaste 2x hefboom** (ter informatie: wat doet hefboom met de daling). Futures, funding betaald.
Toets (E, F, G apart): hoger rendement per jaar dan C over 2018-2026 ÉN over 2022-2026, grootste daling hoogstens
5 procentpunt dieper dan C, t-waarde ≥ 2,0, met dubbele kosten nog steeds beter dan C, zonder de 3 beste maanden positief.
Haalt geen enkele variant dit, dan blijft C het profiel. Haalt er meer dan één, dan de variant met de hoogste t-waarde.
Trades, winrate, gemiddelde winst en verlies worden getoond maar tellen niet mee voor de keuze.

## Aanvulling 4: brede zoektocht naar het hoogste rendement (vastgelegd 2026-10-05 21:36 UTC, vóór de test)
Data: 2-uurscandles 2018 - sep 2026 (uurdata bestaat pas vanaf 2022). Beslissen op het slot van een candle, uitvoeren tegen dat slot.
Kosten 0,05% + 0,03% per kant. Hefboom boven 1x: futures, echte funding (BTC/ETH; andere munten 1,5x BTC; zonder data 0,01%/8u).
Elke munt een eigen deel van de pot, maandelijks gelijk getrokken; munten doen mee na 200 dagen historie.
Families (per munt, blootstelling 0 tot maximaal de hefboom):
1. Trend: koers boven SMA of EMA van 50/100/150/200 dagen; controle dagelijks of elke 2 uur; band 0% of 2%.
2. Kruising: snel boven langzaam gemiddelde (10/30, 10/50, 20/50, 20/100, 50/200), SMA en EMA, dagelijks.
3. Uitbraak: in bij hoogste koers van N dagen, uit bij laagste van M dagen (20/10, 20/20, 55/20, 100/50, 200/100).
4. Trend + dip kopen: in trend (SMA200 dagelijks) een basis van 50% of 70%; extra erbij tot 100% of 150% bij een dip
   (dag-RSI2 < 10 of < 20, 2u-RSI14 < 30 of < 25, dagslot 1,5 of 2 standaardafwijking onder 20-daags gemiddelde),
   extra eraf bij RSI > 60 of > 80 (bij afwijking: terug op het gemiddelde). Ook: bij trendstart pas instappen op de eerste dip.
5. Trend + winst nemen: in trend 100%, terug naar 50% of 0% als de koers 50/80/100% boven SMA200 staat of dag-RSI14 > 80/85;
   weer vol als dat voorbij is.
6. Alleen dips kopen in trend (2u): RSI14 < 30 / < 25 of RSI2 < 5 / < 10 boven SMA200, uit bij RSI > 60 of na 12 / 36 candles.
Elke variant met hefboom 1x, 1,5x, 2x en 3x, op 4 muntgroepen: BTC+ETH, alleen BTC, 5 munten (BTC ETH BNB XRP ADA), 10 munten.
Keuze (alleen op 2018-2023): hoogste rendement per jaar onder de varianten met daling hoogstens 65% en t-waarde ≥ 2,0.
Alleen die ene winnaar wordt beoordeeld op 2024 - sep 2026 (niet bekeken bij het kiezen). Hij vervangt het huidige profiel
(dagelijkse SMA200 op BTC+ETH, 1x) alleen als hij daar: meer rendement per jaar haalt, een daling heeft hoogstens 5 procentpunt
dieper, en met dubbele kosten nog steeds meer rendement haalt. Faalt hij, dan blijft het huidige profiel.
Ter informatie: top 10, beste per familie, en hoe goed de rangorde op 2018-2023 de rangorde op 2024-2026 voorspelt.
