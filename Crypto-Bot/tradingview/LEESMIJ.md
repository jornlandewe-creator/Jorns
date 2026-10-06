# TradingView (gratis account)

1. Open tradingview.com, zoek BTCUSD (bijv. Bitstamp of Coinbase) of BTCEUR, zet de chart op **4 uur**.
2. Onderaan: **Pine Editor**. Verwijder wat er staat, plak een van de scripts, klik **Add to chart**.
3. Onderaan opent de **Strategy Tester** met rendement, trades en daling.

Scripts:
- `1_trendbot_4h.pine`: de oorspronkelijke trendbot. Instellingen (tandwiel): hefboom, risico, deelwinst.
- `2_portfolio_7_strategieen.pine`: alle 7 strategieen in één script, met hefboom en trendfilter.
  Benadering van de Python-bot: Sonic R alleen long, geen maandelijkse herverdeling.

Gratis kun je backtesten en handmatig paper traden. Automatisch orders doorsturen (webhooks)
kan pas vanaf het betaalde Essential-abonnement. Daarom draait de echte paper-bot in het dashboard.

Geeft TradingView een foutmelding bij het toevoegen? Kopieer de melding en stuur hem door.
