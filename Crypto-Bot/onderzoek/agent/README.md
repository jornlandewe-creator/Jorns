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
