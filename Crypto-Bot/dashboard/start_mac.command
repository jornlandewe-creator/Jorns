#!/bin/bash
cd "$(dirname "$0")"
command -v python3 >/dev/null || { echo "Python niet gevonden. Installeer Python 3.11 of nieuwer van python.org."; read -p "Enter om te sluiten"; exit 1; }
if [ ! -d .venv ]; then
  echo "Eerste keer: Python-omgeving installeren, dit duurt een paar minuten..."
  python3 -m venv .venv || { echo "Kon geen Python-omgeving maken."; read -p "Enter om te sluiten"; exit 1; }
  .venv/bin/python -m pip install --upgrade pip
  .venv/bin/python -m pip install -r requirements.txt || { echo "Installeren mislukt, zie de melding hierboven."; read -p "Enter om te sluiten"; exit 1; }
fi
PORT=$(cat poort.txt 2>/dev/null || echo 8001)
(sleep 4; open "http://localhost:$PORT") &
while true; do
  caffeinate -i .venv/bin/python server.py
  echo "Het programma is gestopt. Over 10 seconden opnieuw starten (Ctrl+C of venster sluiten om echt te stoppen)..."
  sleep 10
done
