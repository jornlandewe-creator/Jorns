# Crypto-Bot v13: Agent

Mappen:
- `dashboard/`   de bot zelf (dashboard `server.py`, agent zonder dashboard `agent.py`, strategie `agent_strategy.py`, backtest `backtest_agent.py`).
                 Lees `dashboard/LEESMIJ.md`, hoofdstuk "Agent".
- `onderzoek/`   alle onderzoek; `onderzoek/agent/` is de zoektocht die tot de Agent heeft geleid.
- `tradingview/` Pine-scripts van de oudere strategieën.

Snel starten (paper, niets echt):
```
cd dashboard
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python agent.py --paper        # of: .venv/bin/python server.py voor het dashboard
```
