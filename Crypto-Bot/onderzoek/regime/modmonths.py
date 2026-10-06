import pandas as pd, numpy as np, sys
f=sys.argv[1]
e=pd.read_csv(f,index_col=0,parse_dates=True); n=e.shape[1]-2
e.columns=['tot','btc']+[f'm{i}' for i in range(n)]
g=e.groupby(e.index.to_period('M'))
first=g.apply(lambda x: x.iloc[min(1,len(x)-1)]); last=g.last()

r=(last/first.values-1)
bt=e.btc.resample('ME').last(); bt=pd.concat([e.btc.iloc[[0]],bt]).pct_change().dropna(); bt.index=bt.index.to_period('M')
r['btc']=bt.reindex(r.index)
tot=e.tot.resample('ME').last(); tot=pd.concat([e.tot.iloc[[0]],tot]).pct_change().dropna(); tot.index=tot.index.to_period('M'); r['tot']=tot
r['kl']=np.where(r.btc>0.05,'stijg',np.where(r.btc<-0.05,'daal','zij'))
pd.set_option('display.width',200)
print((r.drop(columns='kl')*100).round(1).assign(kl=r.kl).to_string())
print((r.groupby('kl').mean(numeric_only=True)*100).round(1))
print('totaal per module (geketend):', ((1+r.drop(columns=['kl','btc','tot'])).prod()-1).round(2).to_dict())
