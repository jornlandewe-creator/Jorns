"""Strategie-momentum: modules die recent verliezen krijgen minder geld. Test op 2022-23 (onderzoek-stromen) en 2024-26 (echte bot)."""
import sys; sys.argv=['x']
import numpy as np, pandas as pd
def run(R, N, mode, k):
    X=R; val=1.0; out=[]; n=X.shape[1]
    for _,g in X.groupby([X.index.year,X.index.month]):
        h=X.loc[:g.index[0]].iloc[-max(61,N+1):-1]
        if len(h)>20:
            w=1/h.iloc[-60:].std().clip(lower=0.005).values; w=w/w.sum()
            if mode!='geen' and len(h)>=N:
                r=(1+h.iloc[-N:]).prod().values-1
                if mode=='uit': f=np.where(r<0,k,1.0)
                else: f=np.clip(1+k*np.sign(r),0.1,3)
                w=w*f; w=w/w.sum() if w.sum()>0 else np.ones(n)/n
            for _ in range(5): w=np.minimum(w,0.5); w=w/w.sum()
        else: w=np.ones(n)/n
        sub=val*w*(1+g).cumprod(); out.append(sub.sum(axis=1)); val=sub.iloc[-1].sum()
    return pd.concat(out)
def st(x,a=None,b=None):
    x=x[(x.index>=(a or x.index[0]))&(x.index<(b or '2100'))]; y=(x.index[-1]-x.index[0]).days/365.25
    c=(x.iloc[-1]/x.iloc[0])**(1/y)-1; d=(x/x.cummax()-1).min(); return c,d
# echte bot 2024-26 (4 modules, 2x, zonder pauze)
e=pd.read_csv('results/var_nolim4_2x.csv',index_col=0,parse_dates=True); e.columns=['tot','btc','b','ls','vol','tr']
d=e.resample('1D').last(); R2=d[['b','ls','vol','tr']].pct_change().fillna(0); R2[R2.index.day==1]=0
# onderzoek 2022-23 (BTC-portfolio + L/S + Trend-mix, 1x)
exec(open('regime/study3.py').read().split("for k, v in CAND.items(): report")[0])
R1=pd.concat([bp_s, ls_r, CAND['Mix (3)']],axis=1); R1.columns=['b','ls','tr']
print('variant                         | 2022-23 onderzoek       | 2024-26 echte bot (2x)        | jul-sep 26')
for N in (30,60,90):
    for mode,k in [('geen',0),('uit',0.5),('uit',0.25),('uit',0.0),('kantel',0.5)]:
        if mode=='geen' and N!=30: continue
        a=run(R1,N,mode,k); c1,d1=st(a,None,'2024-01-01')
        b2=run(R2,N,mode,k); c2,d2=st(b2); q=b2['2026-06-30':'2026-09-30']; q=q.iloc[-1]/q.iloc[0]-1
        nm='huidig' if mode=='geen' else f'{N}d, {mode} x{k}'
        print(f'{nm:30s} | {c1*100:5.1f}%/jr {d1*100:6.1f}% cal {c1/-d1:.2f} | {c2*100:5.1f}%/jr {d2*100:6.1f}% cal {c2/-d2:.2f} | {q*100:5.1f}%')
