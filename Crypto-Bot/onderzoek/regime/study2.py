"""Extra ideeën: (1) in stijgende markt shorten we BTC i.p.v. de zwakste munten; (2) gewicht naar BTC-portfolio in stijgende markt."""
import sys; sys.argv=['x']
exec(open('regime/study.py').read().split("rows = []; curves = {}")[0])
exec("def at_risk" + open('regime/study.py').read().split("def at_risk")[1].split("rows = []")[0])

def slot_btcshort(reg):
    W = W_ls.copy(); rb = reb_ls.copy(); prev=None
    for t in range(s0, T):
        up = bool(reg[t])
        if up:
            w = W_ls[t].copy(); short = w.clip(max=0).sum(); w = w.clip(min=0); w[0] += short; W[t] = w
        if prev is not None and up != prev: rb[t] = True
        prev = up
    return RT.sim_stop(Rv, W, rb, RT.COST, s0, 0.5)

def combo_shift(slot_eq, reg, f):
    sr = np.r_[0, slot_eq[1:] / slot_eq[:-1] - 1]
    S = pd.DataFrame({'a': bp_r, 'b': sr}, index=idx).iloc[s0:]; regs = pd.Series(reg, idx).shift(1).fillna(False).iloc[s0:]
    val = 1.0; out = []; v = None; prev_m = None; prev_up = None; base = np.array([.5,.5])
    for t, (ra, rbb) in zip(S.index, S.values):
        m = (t.year, t.month); up = bool(regs[t])
        if m != prev_m:
            hist = S.loc[:t].iloc[-61:-1]
            if len(hist) > 20: iv = 1 / hist.std().clip(lower=1e-4); base = (iv / iv.sum()).values
        if m != prev_m or up != prev_up:
            w = base.copy()
            if up: w = np.array([base[0] + f * base[1], (1 - f) * base[1]])
            if v is not None: val *= 1 - RT.COST * np.abs(w - v / v.sum()).sum() * 0.5
            v = val * w
        v = v * (1 + np.array([ra, rbb])); val = v.sum(); out.append(val); prev_m = m; prev_up = up
    return pd.Series(out, S.index)

base_eq = RT.sim_stop(Rv, W_ls, reb_ls, RT.COST, s0, 0.5)
res = []
for r in ['BTC>SMA50','BTC>SMA100','BTC>SMA200','SMA50>SMA200','SMA100 + 30d mom']:
    ce = combo(slot_btcshort(REG[r])); L, cr, co = at_risk(ce)
    c1, d1 = stats(ce, T0, SPLIT); c2, d2 = stats(ce, SPLIT); u, dn, _ = months(ce)
    print(f'BTC-short | {r}: bij -20% {cr*100:.1f}% (OOS {co*100:.1f}) | IS {c1*100:.1f}/{d1*100:.1f} OOS {c2*100:.1f}/{d2*100:.1f} stijg {u*100:.1f} daal {dn*100:.1f}')
    for f in (0.5, 1.0):
        ce = combo_shift(base_eq, REG[r], f); L, cr, co = at_risk(ce)
        c1, d1 = stats(ce, T0, SPLIT); c2, d2 = stats(ce, SPLIT); u, dn, _ = months(ce)
        print(f'Naar BTC-portfolio {int(f*100)}% | {r}: bij -20% {cr*100:.1f}% (OOS {co*100:.1f}) | IS {c1*100:.1f}/{d1*100:.1f} OOS {c2*100:.1f}/{d2*100:.1f} stijg {u*100:.1f} daal {dn*100:.1f}')
ce = combo_shift(base_eq, np.zeros(T,bool), 0); L, cr, co = at_risk(ce); print('controle huidig', cr, co)
bt = btc[btc.index>=T0]; print('BTC hold', stats(bt), stats(bt,T0,SPLIT), stats(bt,SPLIT), months(bt))
