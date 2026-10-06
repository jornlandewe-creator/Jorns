# BTC Trading Bot

Profielen (kies met PROFIEL=...):
- trend    4h, meeste rendement (win rate ~22%, backtest ~41%/jr, blind ~18%/jr, max daling ~31%)
- balans   4h, 1/3 winst bij +3 ATR + break-even stop (win rate ~38%, ~29%/jr, blind ~14%/jr)
- winrate  daily, 3 rode dagen op rij kopen (win rate ~68%, ~10%/jr, max daling ~13%)

Starten (paper, niets echt):
    pip install ccxt pandas numpy numba
    PROFIEL=trend python bot.py

Live (pas na maanden paper, sub-account, API-key zonder opnamerechten):
    MODE=live PROFIEL=trend EXCHANGE=bitvavo SYMBOL=BTC/EUR API_KEY=... API_SECRET=... python bot.py

Moet 24/7 draaien (VPS of Raspberry Pi).

Onderzoek
- library.py    23 strategie-families (trend, mean reversion, Sonic R)
- sweep.py      ronde 1: 59.616 backtests (1h/4h/daily, long en long/short, SL/TP/tijdstop)
- sweep3.py     ronde 2: 20.592 backtests met gedeeltelijke winstname
- optimize.py / validate.py   eerste onderzoek (5.544 runs), walk-forward, Monte Carlo
- engine*.py    simulators: fees 0.1%, slippage 0.05%, funding, stops intrabar (slechtste geval)
- results/      alle uitkomsten als CSV

## Portfolio-bot (bot_portfolio.py)
7 strategieen tegelijk, elk 1/7 van het account, maandelijks herverdeeld, met trendfilter
(hefboom en open posities halveren zodra BTC onder SMA200 zit).

    LEV=3 python bot_portfolio.py        # paper

Blind 2024-sep 2026 (replay van de bot zelf): 3x 38.8%/jr max daling -29%, 4x 49.6%/jr max daling -36%.
Hefboom vraagt een futures/CFD-account bij een partij met vergunning in NL/EU.
Onderzoek: portfolio.py (762 combinaties), riskctl.py (992 risicoregels).
