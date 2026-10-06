#!/bin/bash
# Starten op Linux (server of desktop) zonder dienst: bash start_linux.sh   -> dashboard op http://localhost:8001
cd "$(dirname "$0")"
PY=python3; command -v python3.11 >/dev/null && PY=python3.11
command -v $PY >/dev/null || { echo "Python niet gevonden: sudo apt install python3 python3-venv python3-pip"; exit 1; }
if [ ! -d .venv ]; then
  echo "Eerste keer: Python-omgeving installeren..."
  $PY -m venv .venv || { echo "Kon geen Python-omgeving maken (sudo apt install python3-venv)"; exit 1; }
  .venv/bin/python -m pip install --upgrade pip
  .venv/bin/python -m pip install -r requirements.txt || { echo "Installeren mislukt, zie de melding hierboven."; exit 1; }
fi
while true; do
  PORT=${PORT:-8001} .venv/bin/python server.py
  echo "Gestopt. Over 10 seconden opnieuw (Ctrl+C om echt te stoppen)..."; sleep 10
done
