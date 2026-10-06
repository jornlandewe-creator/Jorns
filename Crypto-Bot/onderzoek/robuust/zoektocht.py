"""Aanvulling 4 van REGELS_VOORAF.md: brede zoektocht. De regels in dat bestand zijn leidend; hier niets aan de keuze sleutelen."""
import os, sys, json, itertools, time
import numpy as np, pandas as pd
from numba import njit
os.chdir('/home/claude/bot')
COINS = ['BTC', 'ETH', 'BNB', 'XRP', 'ADA', 'LINK', 'DOGE', 'SOL', 'AVAX', 'DOT']
UNI = {'BTC+ETH': ['BTC', 'ETH'], 'BTC': ['BTC'], '5 munten': ['BTC', 'ETH', 'BNB', 'XRP', 'ADA'], '10 munten': COINS}
LEVS = (1.0, 1.5, 2.0, 3.0)
START, SPLIT, END = '2018-01-01', '2024-01-01', '2026-10-01'
FEE = 0.0005 + 0.0003
BPD = 12                                                      # 2-uurscandles per dag


def rsi(s, n):
    d = s.diff(); up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean(); dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    return 100 - 100 / (1 + up / dn)


def load():
    raw = {c: pd.read_csv(f'data/coins/{c}_2h.csv', index_col=0, parse_dates=True) for c in COINS}
    idx = raw['BTC'].index
    for c in COINS: idx = idx.union(raw[c].index)
    idx = idx[idx < END]
    key = (idx + pd.Timedelta(hours=2)).floor('D') - pd.Timedelta(days=1)       # laatste afgesloten dag
    def fr(f):
        d = pd.read_csv(f, index_col=0, parse_dates=['timestamp'], date_format='ISO8601')
        d.index = pd.to_datetime(d.index, utc=True, format='ISO8601'); return d.fundingRate.resample('1D').sum()
    fb = fr('/home/claude/zwmjj/funding-rate-arb/data/raw/btc_funding_rate.csv'); fe = fr('/home/claude/zwmjj/funding-rate-arb/data/raw/eth_funding_rate.csv')
    D = {}
    for c in COINS:
        h = raw[c].close.reindex(idx)
        dd = pd.read_csv(f'data/coins/{c}_1d.csv', index_col=0, parse_dates=True).close
        dd = dd[dd.index < END]
        m = lambda s: s.reindex(key).values                                       # dagwaarde -> 2u-index
        f = {}
        f['c2'] = h.values; f['dc'] = m(dd)
        for n in (50, 100, 150, 200):
            f[f'sma{n}'] = m(dd.rolling(n).mean()); f[f'ema{n}'] = m(dd.ewm(span=n, adjust=False, min_periods=n).mean())
        for n in (10, 20, 30):
            f[f'sma{n}'] = m(dd.rolling(n).mean()); f[f'ema{n}'] = m(dd.ewm(span=n, adjust=False, min_periods=n).mean())
        f['drsi2'] = m(rsi(dd, 2)); f['drsi14'] = m(rsi(dd, 14))
        f['z20'] = m((dd - dd.rolling(20).mean()) / dd.rolling(20).std())
        for n in (10, 20, 50, 55, 100, 200):
            f[f'hi{n}'] = m(dd.shift(1).rolling(n).max()); f[f'lo{n}'] = m(dd.shift(1).rolling(n).min())
        f['hrsi14'] = rsi(h.ffill(), 14).where(h.notna()).values; f['hrsi2'] = rsi(h.ffill(), 2).where(h.notna()).values
        nd = pd.Series(1, dd.index).cumsum(); f['ndays'] = m(nd)
        fd = (fb if c == 'BTC' else fe if c == 'ETH' else fb * 1.5).reindex(key).values
        f['fund'] = np.nan_to_num(fd, nan=0.0003) / BPD
        D[c] = {k: np.asarray(v, float) for k, v in f.items()}
    return idx, D


# ---------------------------------------------------------------- signaalregels (status per munt)
@njit(cache=True)
def sm_band(p, ma, band):
    T = len(p); out = np.zeros(T); s = 0.0
    for t in range(T):
        if np.isnan(p[t]) or np.isnan(ma[t]): s = 0.0
        elif s == 0.0 and p[t] > ma[t] * (1 + band): s = 1.0
        elif s == 1.0 and p[t] < ma[t] * (1 - band): s = 0.0
        out[t] = s
    return out


@njit(cache=True)
def sm_donch(dc, hi, lo):
    T = len(dc); out = np.zeros(T); s = 0.0
    for t in range(T):
        if np.isnan(dc[t]) or np.isnan(hi[t]) or np.isnan(lo[t]): s = 0.0
        elif s == 0.0 and dc[t] > hi[t]: s = 1.0
        elif s == 1.0 and dc[t] < lo[t]: s = 0.0
        out[t] = s
    return out


@njit(cache=True)
def sm_coredip(trend, dip, ex, core, mx, wait):
    """trend: 0/1. dip/ex: 0/1 signalen. wait=1: bij trendstart pas in op de eerste dip (dan vol 1)."""
    T = len(trend); out = np.zeros(T); extra = 0.0; armed = 0.0; prev = 0.0
    for t in range(T):
        if trend[t] < 0.5:
            extra = 0.0; armed = 0.0; prev = 0.0; out[t] = 0.0; continue
        if wait == 1:
            if prev < 0.5: armed = 0.0
            if armed < 0.5 and dip[t] > 0.5: armed = 1.0
            out[t] = armed; prev = 1.0; continue
        if extra == 0.0 and dip[t] > 0.5: extra = 1.0
        elif extra == 1.0 and ex[t] > 0.5: extra = 0.0
        out[t] = core + extra * (mx - core); prev = 1.0
    return out


@njit(cache=True)
def sm_trim(trend, over, back, r):
    T = len(trend); out = np.zeros(T); s = 0.0
    for t in range(T):
        if trend[t] < 0.5: s = 0.0; out[t] = 0.0; continue
        if s == 0.0 and over[t] > 0.5: s = 1.0
        elif s == 1.0 and back[t] > 0.5: s = 0.0
        out[t] = r if s == 1.0 else 1.0
    return out


@njit(cache=True)
def sm_diponly(gate, dip, ex, maxbars):
    T = len(gate); out = np.zeros(T); s = 0.0; nb = 0
    for t in range(T):
        if s == 1.0:
            nb += 1
            if ex[t] > 0.5 or nb >= maxbars or gate[t] < 0.5: s = 0.0
        elif gate[t] > 0.5 and dip[t] > 0.5: s = 1.0; nb = 0
        out[t] = s
    return out


# ---------------------------------------------------------------- uitvoering per munt
@njit(cache=True)
def sleeve(c, tgt, L, fee, fund, fut, s0):
    T = len(c); eq = np.full(T, np.nan); e = 1.0; u = 0.0; prev_t = 0.0
    tr = np.zeros(20000); nt = 0; e0 = 1.0; dead = False
    for t in range(s0, T):
        if np.isnan(c[t]): continue
        if dead: eq[t] = 0.0; continue
        if t > s0 and u != 0.0 and not np.isnan(c[t - 1]):
            e += u * (c[t] - c[t - 1])
            if fut: e -= fund[t] * abs(u * c[t])
        if e <= 0.0:
            e = 0.0; dead = True; eq[t] = 0.0; continue
        g = tgt[t] * L
        if np.isnan(g): g = 0.0
        cur = u * c[t] / e
        if g != prev_t or (g > 0 and abs(cur - g) > 0.1 * g):
            nu = g * e / c[t]; e -= fee * abs(nu - u) * c[t]; u = nu
            if prev_t == 0.0 and g > 0: e0 = e
            if g == 0.0 and prev_t > 0 and nt < 20000: tr[nt] = e / e0 - 1; nt += 1
            prev_t = g
        eq[t] = e
    if prev_t > 0 and nt < 20000: tr[nt] = e / e0 - 1; nt += 1
    return eq, tr[:nt]


@njit(cache=True)
def combine(R, ok, month_start):
    """R: (T,M) rendement per munt per candle; ok: munt doet mee; maandelijks gelijk verdeeld."""
    T, M = R.shape; P = np.ones(T); h = np.zeros(M); val = 1.0; cash = 1.0
    for t in range(T):
        if month_start[t] or h.sum() == 0.0:
            n = 0
            for m in range(M):
                if ok[t, m]: n += 1
            for m in range(M): h[m] = val / n if (ok[t, m] and n > 0) else 0.0
            cash = val - h.sum()
        for m in range(M):
            if h[m] != 0.0 and not np.isnan(R[t, m]): h[m] *= (1 + R[t, m])
        val = h.sum() + cash
        P[t] = val
    return P


def variants():
    V = []
    for ma, n, chk, band in itertools.product(('sma', 'ema'), (50, 100, 150, 200), ('dag', '2u'), (0.0, 0.02)):
        V.append(dict(fam='1 trend', naam=f'{ma.upper()}{n} {chk} band {band:.0%}', kind='band', ma=f'{ma}{n}', chk=chk, band=band, mx=1.0))
    for (fa, sl), ma in itertools.product(((10, 30), (10, 50), (20, 50), (20, 100), (50, 200)), ('sma', 'ema')):
        V.append(dict(fam='2 kruising', naam=f'{ma.upper()} {fa}/{sl}', kind='cross', fast=f'{ma}{fa}', slow=f'{ma}{sl}', mx=1.0))
    for N, M in ((20, 10), (20, 20), (55, 20), (100, 50), (200, 100)):
        V.append(dict(fam='3 uitbraak', naam=f'uitbraak {N}/{M}', kind='donch', N=N, M=M, mx=1.0))
    dips = [('dag-RSI2<10', 'drsi2', 10), ('dag-RSI2<20', 'drsi2', 20), ('2u-RSI14<30', 'hrsi14', 30), ('2u-RSI14<25', 'hrsi14', 25),
            ('dag z<-1,5', 'z20', -1.5), ('dag z<-2', 'z20', -2.0)]
    for (dn, dk, dv), core, mx in itertools.product(dips, (0.5, 0.7), (1.0, 1.5)):
        exits = [(60, 'RSI>60'), (80, 'RSI>80')] if dk != 'z20' else [(0, 'terug op gemiddelde')]
        for ev, en in exits:
            V.append(dict(fam='4 trend+dip', naam=f'basis {core:.0%} tot {mx:.0%}, dip {dn}, uit {en}', kind='coredip', dk=dk, dv=dv, ev=ev, core=core, mx=mx, wait=0))
    for dn, dk, dv in dips:
        V.append(dict(fam='4 trend+dip', naam=f'trendstart: wacht op dip {dn}', kind='coredip', dk=dk, dv=dv, ev=60, core=0.0, mx=1.0, wait=1))
    for cond, r in itertools.product(('50% boven SMA200', '80% boven SMA200', '100% boven SMA200', 'dag-RSI14>80', 'dag-RSI14>85'), (0.5, 0.0)):
        V.append(dict(fam='5 trend+winst nemen', naam=f'naar {r:.0%} bij {cond}', kind='trim', cond=cond, r=r, mx=1.0))
    for (dn, dk, dv), mb in itertools.product((('2u-RSI14<30', 'hrsi14', 30), ('2u-RSI14<25', 'hrsi14', 25), ('2u-RSI2<5', 'hrsi2', 5), ('2u-RSI2<10', 'hrsi2', 10)), (12, 36)):
        V.append(dict(fam='6 alleen dips', naam=f'{dn}, uit RSI>60 of na {mb} candles', kind='diponly', dk=dk, dv=dv, mb=mb, mx=1.0))
    return V


def target(v, f):
    nan = np.isnan
    trend = ((f['dc'] > f['sma200']) & ~nan(f['sma200'])).astype(float)
    k = v['kind']
    if k == 'band':
        p = f['dc'] if v['chk'] == 'dag' else f['c2']
        return sm_band(p, f[v['ma']], v['band'])
    if k == 'cross':
        return ((f[v['fast']] > f[v['slow']]) & ~nan(f[v['slow']])).astype(float)
    if k == 'donch':
        return sm_donch(f['dc'], f[f"hi{v['N']}"], f[f"lo{v['M']}"])
    if k == 'coredip':
        x = f[v['dk']]
        dip = (x < v['dv']).astype(float)
        ex = (x > v['ev']).astype(float) if v['dk'] != 'z20' else (x > 0).astype(float)
        return sm_coredip(trend, dip, ex, v['core'], v['mx'], v['wait'])
    if k == 'trim':
        cnd = v['cond']
        if 'SMA200' in cnd:
            x = float(cnd.split('%')[0]) / 100; over = (f['dc'] > f['sma200'] * (1 + x)).astype(float); back = (f['dc'] < f['sma200'] * (1 + x / 2)).astype(float)
        else:
            lim = float(cnd.split('>')[1]); over = (f['drsi14'] > lim).astype(float); back = (f['drsi14'] < 60).astype(float)
        return sm_trim(trend, over, back, v['r'])
    if k == 'diponly':
        x = f[v['dk']]
        return sm_diponly(trend, (x < v['dv']).astype(float), (x > 60).astype(float), v['mb'])


def stats(P, idx, a, b):
    e = pd.Series(P, idx); e = e[(e.index >= a) & (e.index < b)].resample('1D').last().dropna()
    e = e / e.iloc[0]; y = (e.index[-1] - e.index[0]).days / 365.25
    r = e.pct_change().dropna(); sh = r.mean() / r.std() * np.sqrt(365) if r.std() > 0 else 0.0
    m = e.resample('ME').last().pct_change(); m.iloc[0] = e.resample('ME').last().iloc[0] - 1
    ex3 = (1 + m.drop(m.nlargest(3).index)).prod() - 1
    cagr = e.iloc[-1] ** (1 / y) - 1 if e.iloc[-1] > 0 else -1.0
    return dict(per_jaar=cagr, daling=float((e / e.cummax() - 1).min()), t=sh * np.sqrt(y), zonder_top3=ex3,
                jaren={int(k): round((g.iloc[-1] / g.iloc[0] - 1) * 100, 1) for k, g in e.groupby(e.index.year)})


def run_variant(v, idx, D, s0, ms, cost_mult=1.0, levs=LEVS, unis=UNI):
    tg = {c: target(v, D[c]) for c in COINS}
    out = []
    for L in levs:
        fut = L * v['mx'] > 1.0
        Rm = np.full((len(idx), len(COINS)), np.nan); ok = np.zeros((len(idx), len(COINS)), np.bool_); trs = {}
        for j, c in enumerate(COINS):
            f = D[c]
            st = np.where((f['ndays'] >= 200) & ~np.isnan(f['c2']))[0]; st = st[st >= s0]
            if not len(st): continue
            eq, tr = sleeve(f['c2'], tg[c], L, FEE * cost_mult, f['fund'] * cost_mult, fut, st[0])
            Rm[:, j] = pd.Series(eq).pct_change(fill_method=None).values
            ok[:, j] = ~np.isnan(eq); trs[c] = tr
        for un, cs in unis.items():
            cols = [COINS.index(c) for c in cs]
            P = combine(Rm[:, cols], ok[:, cols], ms)
            out.append((L, un, P, np.concatenate([trs.get(c, np.zeros(0)) for c in cs])))
    return out


if __name__ == '__main__':
    t0 = time.time()
    idx, D = load()
    s0 = idx.searchsorted(pd.Timestamp(START, tz='UTC'))
    ms = np.r_[True, idx.month[1:] != idx.month[:-1]]
    V = variants(); print(len(V), 'varianten x', len(LEVS), 'hefboom x', len(UNI), 'muntgroepen', flush=True)
    rows = []; curves = {}
    for i, v in enumerate(V):
        for L, un, P, tr in run_variant(v, idx, D, s0, ms):
            a = stats(P, idx, START, SPLIT); b = stats(P, idx, SPLIT, END); w = tr[tr > 0]; l = tr[tr <= 0]
            yrs = (idx[-1] - idx[s0]).days / 365.25
            rows.append(dict(fam=v['fam'], naam=v['naam'], hefboom=L, munten=un, is_jaar=a['per_jaar'], is_daling=a['daling'], is_t=a['t'], is_zt3=a['zonder_top3'],
                             oos_jaar=b['per_jaar'], oos_daling=b['daling'], oos_t=b['t'], trades_jr=len(tr) / yrs, winrate=(len(w) / len(tr)) if len(tr) else np.nan,
                             gem_winst=w.mean() if len(w) else np.nan, gem_verlies=l.mean() if len(l) else np.nan, vi=i, jaren=json.dumps(a['jaren'] | b['jaren'])))
            curves[(i, L, un)] = pd.Series(P, idx).resample('1D').last().values
        if i % 10 == 0: print(i, round(time.time() - t0), 's', flush=True)
    df = pd.DataFrame(rows); df.to_csv('robust/zoektocht.csv', index=False)
    np.save('robust/zoektocht_curves.npy', {str(k): v for k, v in curves.items()}, allow_pickle=True)
    print('klaar', len(df), round(time.time() - t0), 's')
