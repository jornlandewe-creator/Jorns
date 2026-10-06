"""Spoor C1: uur-van-de-dag / dag-van-de-week patronen op 1h data (IS 2022-2023, blind 2024-2026)."""
import numpy as np, pandas as pd, itertools
COINS=['BTC','ETH','BNB','SOL','XRP','ADA','DOGE','AVAX','LINK','DOT']
COST=0.0007; SPLIT='2024-01-01'
rows=[]
for c in COINS:
    df=pd.read_csv(f'data/coins/{c}_1h.csv',index_col=0,parse_dates=True)
    r=np.log(df.close).diff().fillna(0)
    isr=r[r.index<SPLIT]; oos=r[r.index>=SPLIT]
    h_is=isr.groupby(isr.index.hour).mean(); dow_is=isr.groupby(isr.index.dayofweek).mean()
    for mode,th,shorts in itertools.product(['hour','hourdow'],[0.0,0.5,1.0],[False,True]):
        def pos(x):
            sc=h_is.reindex(x.index.hour).values
            if mode=='hourdow': sc=sc+dow_is.reindex(x.index.dayofweek).values/24
            s=np.std(h_is.values)
            p=np.where(sc>th*s,1.0,0.0)
            if shorts: p=np.where(sc<-th*s,-1.0,p)
            return pd.Series(p,x.index)
        out={}
        for nm,x in [('is',isr),('oos',oos)]:
            p=pos(x); g=p*x - COST*p.diff().abs().fillna(0)
            e=np.exp(g.cumsum()); y=(x.index[-1]-x.index[0]).days/365.25
            out[nm]=(e.iloc[-1]**(1/y)-1,(e/e.cummax()-1).min(),p.diff().abs().sum()/2/(y*52))
            out[nm+'_bh']=np.exp(x.sum())**(1/y)-1
        rows.append(dict(coin=c,mode=mode,th=th,shorts=shorts,is_cagr=out['is'][0],oos_cagr=out['oos'][0],oos_dd=out['oos'][1],trades_per_week=out['oos'][2],oos_bh=out['oos_bh'],is_bh=out['is_bh']))
res=pd.DataFrame(rows); res.to_csv('results/intraday_hours.csv',index=False)
pd.set_option('display.width',200)
print(res.groupby(['mode','th','shorts'])[['is_cagr','oos_cagr','oos_dd','trades_per_week']].median().round(3))
print('blind >0:',(res.oos_cagr>0).mean().round(2),' blind > B&H:',(res.oos_cagr>res.oos_bh).mean().round(2))
# zonder kosten: is er uberhaupt een patroon?
