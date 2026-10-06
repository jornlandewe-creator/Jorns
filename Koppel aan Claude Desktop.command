#!/bin/bash
# Koppelt Website Motion Studio aan de Claude Desktop-app (MCP). Eenmalig uitvoeren.
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  osascript -e 'display dialog "Node.js ontbreekt. Installeer de LTS-versie via nodejs.org en start daarna opnieuw." buttons {"OK"} default button 1 with title "Website Motion Studio"'
  open "https://nodejs.org/"; exit 1
fi
if [ ! -f node_modules/.wmc-ok-v16 ]; then
  echo "Onderdelen installeren (paar minuten)..."
  npm install --no-audit --no-fund || { echo "npm install mislukt"; read -p "Enter om te sluiten"; exit 1; }
  npx playwright install chromium || { echo "Chromium installeren mislukt"; read -p "Enter om te sluiten"; exit 1; }
  touch node_modules/.wmc-ok-v16
fi
NODE="$(command -v node)"
DIR="$(pwd)"
CFG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
mkdir -p "$(dirname "$CFG")"
"$NODE" -e '
const fs=require("fs");const [cfg,node,dir,out]=process.argv.slice(1);
let c={};try{c=JSON.parse(fs.readFileSync(cfg,"utf8"))}catch(e){}
c.mcpServers=c.mcpServers||{};
c.mcpServers["website-motion-studio"]={command:node,args:[dir+"/mcp.js"],env:{WMC_OUT:out}};
fs.writeFileSync(cfg,JSON.stringify(c,null,2));
console.log("Toegevoegd aan "+cfg);
' "$CFG" "$NODE" "$DIR" "$HOME/Desktop/Website Captures"
echo ""; echo "Controle:"; "$NODE" mcp.js --selftest
osascript -e 'display dialog "Klaar. Sluit Claude Desktop helemaal af (Cmd+Q) en open hem opnieuw. Vraag daarna bijvoorbeeld: Maak een showcase van floorcity.nl" buttons {"OK"} default button 1 with title "Website Motion Studio"'
