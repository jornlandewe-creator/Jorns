#!/bin/bash
# Dubbelklik om te starten (eerste keer: rechtermuisknop > Open).
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  osascript -e 'display dialog "Node.js ontbreekt. Installeer de LTS-versie via nodejs.org en start daarna opnieuw." buttons {"OK"} default button 1 with title "Website Motion Capture"'
  open "https://nodejs.org/"
  exit 1
fi

if [ ! -d node_modules ] || [ ! -f node_modules/.wmc-ok-v16 ]; then
  echo "Eerste keer: onderdelen installeren (paar minuten)..."
  npm install --no-audit --no-fund || { echo "npm install mislukt"; read -p "Enter om te sluiten"; exit 1; }
  npx playwright install chromium || { echo "Chromium installeren mislukt"; read -p "Enter om te sluiten"; exit 1; }
  touch node_modules/.wmc-ok-v16
fi

URL=$(osascript -e 'text returned of (display dialog "Welke website wil je vastleggen?" default answer "https://www." with title "Website Motion Capture" buttons {"Annuleren","Start"} default button "Start")' 2>/dev/null)
[ -z "$URL" ] && exit 0

OUT="$HOME/Desktop/Website Captures"
node capture.js "$URL" --out "$OUT"
open "$OUT"
read -p "Klaar. Enter om dit venster te sluiten."
