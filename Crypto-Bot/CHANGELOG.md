# Changelog Crypto-Bot

## v13 (6 okt 2026): Agent
- Standaardprofiel: Agent long/short. Ook onderzocht en afgewezen: 4-uursagent en combinatie dag + 4 uur (onderzoek/agent/h4.py).
- **Agent long/short** (alleen futures): als Agent plus shorts op halve grootte als BTC en de munt onder hun 200-daags gemiddelde staan en het
  200-daags gemiddelde van BTC daalt. Dagdata 2018 - sep 2026: 57% per jaar, daling -30%, 2018 +21%, 2022 +22%; 2023-2026: 39% per jaar. Shorts betalen 0,03% per dag.
  Module en strategie (AgentModule, agent_strategy.target_weight) zijn nu long/short-bewust; het dashboard en de positievergelijking tellen shorts negatief.
- **Agent winrate** (standaardprofiel): zelfde poort en volatiliteitsdoel als Agent, maar losse trades met deelwinst op +1 ATR (1/3 eruit,
  stop naar break-even) en stop 2 ATR. Dagdata 2018 - sep 2026: 45% per jaar, daling -24%, winrate 66% (Agent zonder winstname: 54%, -27%, 27%).
  Onderzoek in onderzoek/agent/winrate.py: alles verkopen op +1 ATR en dips kopen geven wel een hoge winrate maar weinig rendement.
- Nieuw standaardprofiel **Agent**: BTC+ETH+SOL, hard marktfilter (BTC en munt boven 200-daags gemiddelde), trend-ensemble
  20/50/100 dagen met 2% band, volatiliteitsdoel 60% (30 dagen), plafond 1,5x. Dagdata 2018 - sep 2026: 54% per jaar, daling -27%
  (Trend-vasthouden: 33% per jaar, daling -62%). Controle 2023-2026 (niet gebruikt bij het kiezen): 42% per jaar, daling -27%.
  Varianten: Agent spot (1,0x: 48% / -25%) en Agent rustig (doel 50%, rem bij -15%: 39% / -23%).
- `agent.py`: de bot als zelfstandig programma zonder dashboard, met voorcontroles (`--check`), paper/live, backtest.
- Nieuwe fail-safes: dagstop (25% verlies binnen 24 uur -> alles dicht; een lagere grens verkocht in de replay op de bodem van flash-crashes), NOODSTOP-bestand (handmatige noodstop zonder dashboard),
  heartbeat.json (levensteken voor externe bewaking), liquidatie-bescherming in de agent-module.
- `backtest_agent.py`: dagreplay met dezelfde module-code als live; `onderzoek/agent/`: de zoektocht (lab.py t/m lab4.py).
- Oudere profielen blijven beschikbaar; wisselen van profiel in een lopend account sluit de oude posities en zet het geld over.
