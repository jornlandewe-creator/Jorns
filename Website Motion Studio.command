#!/bin/bash
# Dubbelklik om de Studio te starten (eerste keer: rechtermuisknop > Open).
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  osascript -e 'display dialog "Node.js ontbreekt. Installeer de LTS-versie via nodejs.org en start daarna opnieuw." buttons {"OK"} default button 1 with title "Website Motion Studio"'
  open "https://nodejs.org/"
  exit 1
fi

if [ ! -f node_modules/.wmc-ok-v16 ]; then
  echo "Eerste keer: onderdelen installeren (paar minuten)..."
  npm install --no-audit --no-fund || { echo "npm install mislukt"; read -p "Enter om te sluiten"; exit 1; }
  npx playwright install chromium || { echo "Chromium installeren mislukt"; read -p "Enter om te sluiten"; exit 1; }
  touch node_modules/.wmc-ok-v16
fi

# eenmalig: macOS-blokkade van deze map halen en een snelkoppeling op het bureaublad zetten
xattr -dr com.apple.quarantine . 2>/dev/null
DIR="$(pwd)"
APP="$HOME/Desktop/Website Motion Studio.app"
if [ ! -d "$APP" ] || [ "$(cat "$APP/Contents/Resources/wmc-dir" 2>/dev/null)" != "$DIR" ]; then
  rm -rf "$APP"
  cat > /tmp/wmc-launcher.applescript <<APPLESCRIPT
on run
  set d to "$DIR"
  set running to ""
  try
    set running to do shell script "curl -s -m 1 http://localhost:4747/api/version"
  end try
  if running contains d then
    open location "http://localhost:4747"
  else
    -- andere (oude) versie of niets: opruimen en deze starten
    do shell script "lsof -ti tcp:4747 | xargs kill 2>/dev/null; sleep 0.5; true"
    do shell script "cd " & quoted form of d & " && export PATH=/opt/homebrew/bin:/usr/local/bin:\$PATH && nohup node studio.js > /tmp/website-motion-studio.log 2>&1 &"
  end if
end run
APPLESCRIPT
  osacompile -o "$APP" /tmp/wmc-launcher.applescript && echo "$DIR" > "$APP/Contents/Resources/wmc-dir"
  # eigen icoon voor de snelkoppeling
  ICON="$DIR/studio/icon-512.png"
  if [ -f "$ICON" ] && command -v iconutil >/dev/null 2>&1; then
    T=/tmp/wmc.iconset; rm -rf "$T"; mkdir -p "$T"
    for s in 16 32 128 256; do sips -z $s $s "$ICON" --out "$T/icon_${s}x${s}.png" >/dev/null; d=$((s*2)); sips -z $d $d "$ICON" --out "$T/icon_${s}x${s}@2x.png" >/dev/null; done
    cp "$ICON" "$T/icon_512x512.png"
    iconutil -c icns "$T" -o "$APP/Contents/Resources/applet.icns" 2>/dev/null && touch "$APP"
  fi
  xattr -dr com.apple.quarantine "$APP" 2>/dev/null
  echo "Snelkoppeling gemaakt: Website Motion Studio op je bureaublad."
fi

# draait deze versie al? dan alleen de browser openen. Draait er een andere (oude) versie: die stoppen.
RUNNING="$(curl -s -m 1 http://localhost:4747/api/version 2>/dev/null)"
if [ -n "$RUNNING" ] && echo "$RUNNING" | grep -qF "\"dir\":\"$DIR\""; then open http://localhost:4747; exit 0; fi
if lsof -ti tcp:4747 >/dev/null 2>&1; then echo "Oude Studio gevonden op poort 4747, die wordt gestopt."; lsof -ti tcp:4747 | xargs kill 2>/dev/null; sleep 1; fi
node studio.js
