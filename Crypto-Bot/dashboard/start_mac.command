#!/bin/bash
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  echo "Eerste keer: Python-omgeving installeren, dit duurt een paar minuten..."
  python3 -m venv .venv
  .venv/bin/python -m pip install --upgrade pip
  .venv/bin/python -m pip install -r requirements.txt
fi
(sleep 3; open http://localhost:8000) &
while true; do
  caffeinate -i .venv/bin/python server.py
  echo "Het programma is gestopt. Over 10 seconden opnieuw starten (Ctrl+C of venster sluiten om echt te stoppen)..."
  sleep 10
done
