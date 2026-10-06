from winrate import *
base = dict(tv=0.6, cap=1.5, lo=20, k=1.0)
print('=== buurinstellingen rond TP1 +1 ATR 1/3 + BE')
for sl in (1.5, 2.0, 2.5, 3.0):
    for frac in (0.25, 0.33, 0.4):
        port, tr = run('trend_any', base, sl=sl, tp1=1.0, frac=frac, be=True); line(f'stop {sl} TP1 +1.0 {frac:.0%} BE', port, tr)
for tv in (0.5, 0.7):
    port, tr = run('trend_any', dict(base, tv=tv), sl=2.0, tp1=1.0, frac=0.33, be=True); line(f'tv {tv} stop 2 TP1 +1.0 33% BE', port, tr)
port, tr = run('trend_any', dict(base, cap=1.0), sl=2.0, tp1=1.0, frac=0.33, be=True); line('cap 1.0 (spot) stop 2 TP1 +1.0 33% BE', port, tr)
port, tr = run('trend_any', base, sl=2.0, tp1=1.0, frac=0.33, be=True, tp2=4.0); line('stop 2 TP1 +1.0 33% BE, TP2 +4 ATR rest', port, tr)
port, tr = run('trend_any', base, sl=2.0, tp1=1.0, frac=0.33, be=True, tp2=6.0); line('stop 2 TP1 +1.0 33% BE, TP2 +6 ATR rest', port, tr)
port, tr = run('trend_any', base, sl=2.0, tp1=1.0, frac=0.33, be=True, trail=5.0); line('stop 2 TP1 +1.0 33% BE, trail 5 ATR', port, tr)
