"""Agent-strategie: regels in gewone taal en als pure functies (geen bijwerkingen, alleen afgesloten dagcandles).

Vastgelegd na onderzoek op dagdata 2018 - sep 2026 (zie onderzoek/agent/ en LEESMIJ.md, hoofdstuk "Agent"):
  1. Marktfilter (hard):  BTC sluit boven zijn 200-daags gemiddelde EN de munt zelf ook. Anders: die munt in cash.
  2. Trend-ensemble:      per munt het deel van drie gemiddelden (20, 50, 100 dagen) waar de koers boven staat, met een band van 2%
                          tegen heen-en-weer handelen (erin boven gemiddelde +2%, eruit onder gemiddelde -2%). Geeft 0, 1/3, 2/3 of 1.
  3. Volatiliteitsdoel:   positiegrootte = doel (60% per jaar) / gemeten beweeglijkheid (30 dagen), met een plafond (1,0x spot, 1,5x futures).
                          Rustige markt: volle inzet. Onrustige markt (crash, 2022): automatisch kleiner.
  4. Verdeling:           BTC, ETH en SOL elk een gelijk deel van de pot (SOL pas na 200 dagen koershistorie).
  5. Beslissen:           een keer per dag, na het dagslot (00:00 UTC). Alleen long, geen shorts.

De bot herbalanceert naar het doelgewicht als het verschil groter is dan 2% van de pot (kosten beperken).
"""
import numpy as np, pandas as pd

AGENT_COINS = ('BTC', 'ETH', 'SOL')
AGENT_PARAMS = dict(looks=(20, 50, 100), band=0.02, gate_n=200, vol_n=30, vol_target=0.60, min_hist=200, reb_thresh=0.02)


def trend_state(close, n, band, prev=None):
    """Toestand van één gemiddelde met band: 1 (erin) of 0 (eruit). prev = vorige toestand (hysterese)."""
    c = np.asarray(close, dtype=float)
    if len(c) < n: return 0.0
    ma = c[-n:].mean(); p = c[-1]
    if p > ma * (1 + band): return 1.0
    if p < ma * (1 - band): return 0.0
    return float(prev) if prev is not None else (1.0 if p > ma else 0.0)


def trend_state_series(close, n, band):
    """Zelfde regel, maar over een hele reeks (voor backtests en om de toestand zonder geheugen te herleiden)."""
    s = pd.Series(np.asarray(close, dtype=float))
    ma = s.rolling(n).mean()
    st = pd.Series(np.nan, index=s.index)
    st[s > ma * (1 + band)] = 1.0; st[s < ma * (1 - band)] = 0.0
    return st.ffill().fillna(0.0).values


def ensemble(close, looks, band):
    """Deel van de gemiddelden waar de koers (met band) boven staat: 0 .. 1."""
    return float(np.mean([trend_state_series(close, n, band)[-1] for n in looks]))


def realised_vol(close, n):
    r = pd.Series(np.asarray(close, dtype=float)).pct_change().dropna().iloc[-n:]
    if len(r) < max(10, n // 2): return np.nan
    return float(r.std() * np.sqrt(365))


def target_weight(coin_close, btc_close, cap, p=AGENT_PARAMS):
    """Doelgewicht van één munt (0 .. cap) als deel van het geld dat voor die munt is bestemd.
    coin_close / btc_close: afgesloten dagslotkoersen (nieuwste laatst)."""
    coin_close = np.asarray(coin_close, dtype=float); btc_close = np.asarray(btc_close, dtype=float)
    if len(coin_close) < p['min_hist'] or len(btc_close) < p['gate_n']: return 0.0, dict(reden='te weinig historie')
    btc_up = btc_close[-1] > btc_close[-p['gate_n']:].mean()
    coin_up = coin_close[-1] > coin_close[-p['gate_n']:].mean()
    if not btc_up: return 0.0, dict(reden='BTC onder 200-daags gemiddelde', gate=0, ens=0, vol=None)
    if not coin_up: return 0.0, dict(reden='munt onder 200-daags gemiddelde', gate=0, ens=0, vol=None)
    ens = ensemble(coin_close, p['looks'], p['band'])
    v = realised_vol(coin_close, p['vol_n'])
    scale = min(cap, p['vol_target'] / v) if (v and np.isfinite(v) and v > 0) else 0.0
    w = ens * scale
    return float(w), dict(reden='trend', gate=1, ens=round(ens, 3), vol=round(v, 3) if v == v else None, schaal=round(scale, 3))


def explain(w, info):
    if info.get('reden') != 'trend': return f'cash ({info.get("reden")})'
    return f'{w*100:.0f}% (trend {info["ens"]*100:.0f}% x schaal {info["schaal"]:.2f} bij beweeglijkheid {info["vol"]*100:.0f}%)'
