"""Noodrem v2: hefboom gestuurd door de daling van de onderliggende strategie (1x-schaduw), niet van het account.
Zo blijft de rem niet hangen op lage hefboom na herstel. Optioneel: harde stop op account-daling."""
import numpy as np
from numba import njit
FIN = 0.0003 * 0.6

@njit(cache=True)
def run2(r, L, t1, t2, f1, f2, rec, stop):
    n = len(r); eq = np.ones(n); val = 1.0; s = 1.0; sp = 1.0; state = 0; peak = 1.0; dead = False
    for i in range(n):
        sdd = s / sp - 1
        if t2 > 0 and sdd <= -t2: state = 2
        elif sdd <= -t1 and state < 1: state = 1
        elif sdd > -t1 * rec: state = 0
        lev = L * (f2 if state == 2 else (f1 if state == 1 else 1.0))
        if dead: lev = 0.0
        g = lev * r[i] - max(lev - 1, 0) * FIN
        val *= (1 + g); val = max(val, 1e-9); peak = max(peak, val); eq[i] = val
        if stop > 0 and val / peak - 1 <= -stop: dead = True
        s *= (1 + r[i]); sp = max(sp, s)
    return eq

def boot(a, args, rng, n=3000):
    o = []
    for _ in range(n):
        idx = np.concatenate([np.arange(q, q + 10) for q in rng.integers(0, len(a) - 10, 37)])[:365]
        e = run2(a[idx], *args); o.append(((e / np.maximum.accumulate(e) - 1).min(), e[-1]))
    o = np.array(o); return (o[:, 0] <= -0.5).mean(), (o[:, 0] <= -0.8).mean(), np.median(o[:, 1]) - 1
