import sys; sys.path.insert(0,'robust')
from test import *
C,R,elig,F=load(); idx=C.index; s0=idx.searchsorted(pd.Timestamp(START,tz='UTC'))-1
reb=reb_mask(idx,7,START); cols=['BTC','ETH']; Rv=R[cols].values; Fz=np.zeros_like(Rv)
up=(C[cols]>C[cols].rolling(200).mean()).astype(float)
f7=F[cols].rolling(7).mean(); hi=f7>f7.rolling(365,min_periods=180).quantile(0.9)
WC=(up*0.5).fillna(0).values; WD=(up*(~hi).astype(float)*0.5).fillna(0).values
hold=np.full_like(Rv,0.5)
res={}
for nm,W,r in [('BTC+ETH vasthouden',hold,None),('C trendfilter',WC,None),('D trendfilter+funding',WD,None)]:
    rb=reb.copy() if nm!='BTC+ETH vasthouden' else reb  # vasthouden: wekelijks 50/50 herverdelen
    eq=sim(Rv,W,rb,FEE,Fz,s0)
    for a,b in [(START,END),('2022-01-01',END)]:
        st=stats(eq,idx,a,b); print(f"{nm:24s} {a[:4]}-{b[:4]}: {st['per_jaar']*100:6.1f}%/jr daling {st['daling']*100:6.1f}% t {st['t']:.2f} zonder top3 {st['zonder_top3']*100:6.0f}% | {st['jaren'] if a==START else ''}")
