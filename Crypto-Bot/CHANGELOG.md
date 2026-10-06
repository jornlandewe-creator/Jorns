# Changelog Crypto-Bot

## v13 (6 okt 2026): Agent
- Nieuw standaardprofiel **Agent**: BTC+ETH+SOL, hard marktfilter (BTC en munt boven 200-daags gemiddelde), trend-ensemble
  20/50/100 dagen met 2% band, volatiliteitsdoel 60% (30 dagen), plafond 1,5x. Dagdata 2018 - sep 2026: 54% per jaar, daling -27%
  (Trend-vasthouden: 33% per jaar, daling -62%). Controle 2023-2026 (niet gebruikt bij het kiezen): 42% per jaar, daling -27%.
  Varianten: Agent spot (1,0x: 48% / -25%) en Agent rustig (doel 50%, rem bij -15%: 39% / -23%).
- `agent.py`: de bot als zelfstandig programma zonder dashboard, met voorcontroles (`--check`), paper/live, backtest.
- Nieuwe fail-safes: dagstop (25% verlies binnen 24 uur -> alles dicht; een lagere grens verkocht in de replay op de bodem van flash-crashes), NOODSTOP-bestand (handmatige noodstop zonder dashboard),
  heartbeat.json (levensteken voor externe bewaking), liquidatie-bescherming in de agent-module.
- `backtest_agent.py`: dagreplay met dezelfde module-code als live; `onderzoek/agent/`: de zoektocht (lab.py t/m lab4.py).
- Oudere profielen blijven beschikbaar; wisselen van profiel in een lopend account sluit de oude posities en zet het geld over.
