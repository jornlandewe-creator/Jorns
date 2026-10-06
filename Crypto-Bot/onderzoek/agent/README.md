# Onderzoek Agent (v13)

Vectorbacktests op dagdata 2018 - sep 2026 (10 munten), kosten 0,05% + 0,03% per kant, hefboom boven 1x betaalt 0,03% per dag.
Keuze op 2018-2022 (in de steekproef), controle op 2023-2026 (buiten de steekproef). Draaien: `python lab.py`, `lab2.py`, `lab3.py`, `lab4.py`.

Volgorde en wat er geleerd is:
1. `lab.py`   Volatiliteitsdoel en trend-ensembles op BTC+ETH en meer munten. Volatiliteitsdoel halveert de slechtste maand,
              maar de grootste daling blijft rond -45% (2022: bear-market-rally's die weer instorten).
2. `lab2.py`  Drawdown-rem en portfolio-volatiliteitsdoel: daling naar -25 tot -30%, maar kost veel rendement buiten de steekproef.
3. `lab3.py`  Marktfilter (langetermijntrend als poort): hard filter op BTC boven zijn 200-daags gemiddelde brengt de daling naar
              -27% zonder rendementsverlies. 2018: -3%, 2022: 0%. Dit is de kern van de Agent.
4. `lab4.py`  Robuustheid: buurinstellingen (15/40/80 .. 30/75/150, band 0-3%, gemiddelde 150-250 dagen, volatiliteitsvenster 30/60,
              doel 50-70%) geven allemaal 47-64% per jaar met een daling van -23 tot -39%. Dubbele en driedubbele kosten: -1 tot -3 punten.
              Munten: BTC+ETH+SOL beste verhouding; 10 munten lager rendement; alleen BTC diepere daling.

Eindkeuze (dashboard/agent_strategy.py): BTC+ETH+SOL, marktfilter BTC én munt boven 200-daags gemiddelde, ensemble 20/50/100 dagen met band 2%,
volatiliteitsdoel 60% (30 dagen), plafond 1,5x (futures) of 1,0x (spot). Controle met de echte module-code: `dashboard/backtest_agent.py`.
5. `winrate.py` / `winrate2.py`  Trade-niveau: deelwinst op +k ATR met break-even stop, alles verkopen op +k ATR, dips kopen. Deelwinst op +1 ATR (1/3) geeft
              winrate 66% tegen ~9 punten minder rendement per jaar en een kleinere daling; alles verkopen op +1 ATR en dips kopen: hoge winrate, weinig rendement.
              Dit werd het profiel Agent winrate (dashboard/modules.py, AgentWinModule).
6. `ls.py`     Long/short op futures: shorts als spiegelbeeld (BTC en munt onder SMA200, snelle gemiddelden onder), shorts betalen 0,03%/dag.
              Halve short-grootte en alleen als het 200-daags gemiddelde van BTC daalt: 2018 +18%, 2022 +22% (long-only -3% en 0%), 57%/jr, daling -28%.
              Volle short-grootte of meer hefboom: diepere daling, minder buiten de steekproef. Geen enkele variant haalt 50% in elk jaar (beste: 5 van 8 jaren).
              Dit werd het profiel Agent long/short (alleen futures).
7. `h4.py`     Snellere agent op 4-uursdata (zelfde poort) en combinatie dag + 4h: 41-53%/jr, daling -27 tot -32%, nooit beter dan de dag-agent
              (54%/jr, -27%). Sneller beslissen helpt niet; de dag-agent blijft de keuze.
8. `regime.py` Regime-agent: per dag per munt een regime (stijgend / dalend / zijwaarts / crisis) met per regime een specialist. Trend long in
              stijgend en trend short in dalend = de Agent long/short. Dips kopen en pieken shorten in zijwaartse markten: winrate 53-61%, maar elke
              variant verliest geld (-3 tot -33%/jr); erbij in de agent kost 5-30 punten rendement en verdubbelt de daling. Crisis-filter
              (beweeglijkheid > x -> cash) kost rendement. Conclusie: in zijwaartse markten is cash de beste specialist.
9. `other.py` / `other2.py`  Andere families, eerlijk tegen de Agent (zelfde poort, volatiliteitsdoel, kosten): Donchian/Turtle-uitbraken, ATR-trailing,
              weekcandles, sterkste-munt-rotatie op 10 munten, volume-bevestiging, kortetermijnmomentum, relatieve sterkte, pyramide, combinaties.
              Geen enkele familie verslaat de Agent op rendement/daling. Twee toevoegingen helpen wel, in alle buurinstellingen: kanteling naar de
              sterkste munt en 25% extra op een nieuwe 50-daagse top. Dat werd het profiel Agent plus. Rotatie op 10 munten: hoogste rendement
              (71%/jr) maar daling -40% en 2019 vrijwel nul.
10. `stable.py`  Stabiel: hoogste rendement per eenheid daling (Calmar). Mix van trend-ensemble en Donchian 55/20 als long-signaal, kanteling + pyramide,
              shorts op kwart grootte: Calmar 2,3 (Agent plus 1,95, Agent 2,0), slechtste maand -10%, controle 2023-2026 44%/jr met daling -22%.
              Lager volatiliteitsdoel (0,5) zonder shorts: Calmar 2,4, daling -22%. Crash-exit op 2 ATR en drawdown-remmen: slechter.
              Dit werd het profiel Agent stabiel (standaard) en Agent stabiel spot.
