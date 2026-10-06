import sys; sys.argv=['x']
src=open('regime/study3.py').read().split("for k, v in CAND.items(): report")[0]
exec(src)
def per(name, e):
    for a,b in [('2022-03-01','2024-01-01'),('2024-01-01',None)]:
        c,d=stats(e,a,b); print(f'{name:38s} {a[:4]}-{(b or "2026")[:4]}: {c*100:5.1f}%/jr daling {d*100:5.1f}% cal {c/-d:.2f}')
M=CAND['Mix (3)']
per('BTC-port + L/S + Trend-long', mix([bp_s, ls_r, M], 'risico'))
per('L/S + Trend-long', mix([ls_r, M], 'risico'))
per('BTC-port + L/S', mix([bp_s, ls_r], 'risico'))
