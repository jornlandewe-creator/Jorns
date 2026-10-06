"""Noodrem en module-pauze, vooraf gekozen drempels, getest op (a) de 3-module replay mrt 2024-sep 2026
en (b) de langere reeks 2022-2026 (BTC-portfolio + L/S walk-forward)."""
import pandas as pd, numpy as np
FIN=0.0003*0.6

def series_a():
    e=pd.read_csv('results/replay_fut_1.0x.csv',index_col=0,parse_dates=True); M={}
    for k,c in [('btc','btc.1'),('ls','ls'),('vol','vol')]:
        x=e[c].resample('1D').last(); r=x.pct_change(); r[r.index.day==1]=np.nan; M[k]=r
    return pd.DataFrame(M).dropna(how='all').fillna(0)
def series_b():
    D=pd.read_csv('results/streams.csv',index_col=0,parse_dates=True)
    ls=pd.read_csv('results/ls4h_wf_k23_s50.csv',index_col=0,parse_dates=True).iloc[:,0]
    Q=pd.concat({'btc':D['BTC-portfolio (7)'].pct_change(),'ls':ls},axis=1).dropna(); return Q[Q.index>='2022-01-01']

def run(R,L,brake=None,guard=None):
    """brake=(d1,d2,pause_days): >d1 daling -> halve hefboom, >d2 -> alles dicht pause_days, daarna piek resetten.
       guard=(dd,days): module met eigen daling >dd (op 1x) pauzeert days dagen."""
    n,k=R.shape; vals=R.values; idx=R.index
    eq=1.0; peak=1.0; pause=0; out=[]; w=np.ones(k)/k
    meq=np.ones(k); mpk=np.ones(k); mpause=np.zeros(k)
    hist=[]
    for t in range(n):
        if t>=60 and (t==0 or idx[t].day==2):
            sd=np.std(np.array(hist[-60:]),axis=0); sd[sd<=0]=1e9; w=(1/sd)/(1/sd).sum()
        r=vals[t]; hist.append(r)
        meq*=1+r; mpk=np.maximum(mpk,meq)
        act=np.ones(k)
        if guard:
            for j in range(k):
                if mpause[j]>0: act[j]=0; mpause[j]-=1
                elif meq[j]/mpk[j]-1<-guard[0]: mpause[j]=guard[1]; act[j]=0; mpk[j]=meq[j]
        ww=w*act; ww=ww/ww.sum() if ww.sum()>0 else ww
        lev=L
        if brake:
            dd=eq/peak-1
            if pause>0: lev=0; pause-=1; 
            elif dd<-brake[1]: lev=0; pause=brake[2]; peak=eq
            elif dd<-brake[0]: lev=L/2
        g=lev*(ww*r).sum()-max(lev-1,0)*FIN
        eq*=1+g; peak=max(peak,eq); out.append(eq)
    x=pd.Series(out,idx); y=len(x)/365
    return (x.iloc[-1])**(1/y)-1,(x/x.cummax()-1).min(),x

def boot_risk(x,thr=-0.5,nsim=3000,seed=2):
    g=x.pct_change().fillna(0).values; rng=np.random.default_rng(seed); c=0
    for _ in range(nsim):
        idx=np.concatenate([np.arange(s,s+10) for s in rng.integers(0,len(g)-10,37)])[:365]
        p=np.cumprod(1+g[idx]); c+=(p/np.maximum.accumulate(p)-1).min()<=thr
    return c/nsim*100

if __name__=='__main__':
    for nm,R in [('A: 3 modules mrt24-sep26',series_a()),('B: 2 modules 2022-2026',series_b())]:
        print('\n==',nm)
        for L in [2,4,6]:
            for lab,br,gd in [('geen',None,None),('noodrem 15/25%',(0.15,0.25,14),None),('noodrem 20/30%',(0.20,0.30,14),None),
                              ('module-pauze 30%',None,(0.30,30)),('noodrem 20/30 + pauze',(0.20,0.30,14),(0.30,30))]:
                c,dd,x=run(R,L,br,gd)
                print(f'  {L}x {lab:24s} {c*100:6.1f}%/jr  daling {dd*100:6.1f}%  kans -50% in jaar {boot_risk(x):5.1f}%')
