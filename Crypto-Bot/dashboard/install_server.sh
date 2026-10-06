#!/bin/bash
# Installeert de bot als dienst op een Linux-server (Ubuntu/Debian, ook ARM zoals Oracle Ampere).
# De bot start vanzelf bij het opstarten van de server en wordt herstart als hij stopt.
#
# Gebruik (op de server, in de map van de bot):
#   bash install_server.sh
#
# Dashboard bekijken vanaf je eigen computer (de bot is alleen op de server zelf bereikbaar, dat is veilig):
#   ssh -L 8001:localhost:8001 ubuntu@IP-VAN-JE-SERVER
#   en open dan http://localhost:8001 in je browser.
set -e
cd "$(dirname "$0")"
DIR="$(pwd)"
USER_NAME="$(whoami)"

echo "== Benodigde pakketten installeren"
if command -v apt-get >/dev/null; then                      # Ubuntu / Debian
  sudo apt-get update -y
  sudo apt-get install -y python3 python3-venv python3-pip
else                                                        # Oracle Linux / RHEL
  sudo dnf install -y python3.11 python3.11-pip || sudo dnf install -y python3 python3-pip
  if command -v python3.11 >/dev/null; then PY=python3.11; fi
  sudo firewall-cmd --version >/dev/null 2>&1 || true        # dashboard blijft lokaal, geen poort openen
fi
PY=${PY:-python3}

MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$MEM_MB" -lt 2000 ] && [ ! -f /swapfile ]; then
  echo "== Weinig geheugen ($MEM_MB MB): 2 GB wisselgeheugen (swap) aanmaken"
  sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
  sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab > /dev/null
fi

echo "== Python-omgeving maken (duurt een paar minuten, op een kleine server tot 20 minuten)"
if [ ! -d .venv ]; then $PY -m venv .venv; fi
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt

echo "== Controle: kan de server koersen ophalen?"
.venv/bin/python - <<'EOF'
import urllib.request, json
try:
    r = urllib.request.urlopen('https://api.binance.com/api/v3/ping', timeout=10); print('  Binance bereikbaar')
except Exception as e:
    print('  LET OP: Binance niet bereikbaar vanaf deze server (' + str(e)[:80] + ').')
    print('  Kies een server in Europa (bijv. Amsterdam of Frankfurt), of zet bij Instellingen een andere koersbron.')
EOF

echo "== Dienst instellen (start vanzelf, herstart bij een fout)"
sudo tee /etc/systemd/system/crypto-bot.service > /dev/null <<EOF
[Unit]
Description=Crypto Portfolio Bot
After=network-online.target
Wants=network-online.target

[Service]
User=$USER_NAME
WorkingDirectory=$DIR
ExecStart=$DIR/.venv/bin/python $DIR/server.py
Restart=always
RestartSec=10
Environment=PYTHONUNBUFFERED=1
Environment=PORT=8001

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable crypto-bot.service >/dev/null 2>&1 || true
sudo systemctl restart crypto-bot.service || true
sleep 8
if ! systemctl is-active --quiet crypto-bot.service && command -v getenforce >/dev/null && [ "$(getenforce)" = "Enforcing" ]; then
  echo "== Beveiliging (SELinux) staat de dienst niet toe; programma-map vrijgeven"
  sudo chcon -R -t bin_t "$DIR/.venv/bin" 2>/dev/null || true
  sudo chcon -R -t usr_t "$DIR" 2>/dev/null || true
  sudo chcon -R -t bin_t "$DIR/.venv/bin" 2>/dev/null || true
  sudo systemctl restart crypto-bot.service || true
  sleep 8
fi
if ! systemctl is-active --quiet crypto-bot.service; then
  echo "== Dienst start niet, laatste meldingen:"
  journalctl -u crypto-bot -n 15 --no-pager 2>/dev/null || true
  echo "== Andere manier: starten bij het opstarten via cron (werkt altijd)"
  sudo systemctl disable --now crypto-bot.service >/dev/null 2>&1 || true
  cat > "$DIR/run_loop.sh" <<EOL
#!/bin/bash
cd "$DIR"
while true; do PORT=8001 .venv/bin/python server.py >> "$DIR/bot.log" 2>&1; sleep 10; done
EOL
  chmod +x "$DIR/run_loop.sh"
  (crontab -l 2>/dev/null | grep -v run_loop.sh; echo "@reboot $DIR/run_loop.sh") | crontab -
  pkill -f "$DIR/run_loop.sh" 2>/dev/null || true; pkill -f ".venv/bin/python server.py" 2>/dev/null || true
  nohup "$DIR/run_loop.sh" >/dev/null 2>&1 &
  sleep 10
fi
if systemctl is-active --quiet crypto-bot.service || pgrep -f ".venv/bin/python server.py" >/dev/null; then
  echo ""
  echo "Klaar. De bot draait. Versie: $(cat "$DIR/VERSION" 2>/dev/null || echo onbekend)"
  echo "Dashboard: http://localhost:8001 (vanaf je eigen computer: ssh -L 8001:localhost:8001 gebruiker@server)"
  echo "Logboek: journalctl -u crypto-bot -f   (of: tail -f $DIR/bot.log)"
else
  echo "De bot start niet. Laatste regels van het logboek:"
  tail -n 30 "$DIR/bot.log" 2>/dev/null || journalctl -u crypto-bot -n 30 --no-pager
fi
