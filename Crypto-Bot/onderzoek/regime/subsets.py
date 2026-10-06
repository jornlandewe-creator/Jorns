import pandas as pd, numpy as np, itertools
e=pd.read_csv('results/var_nolim4_2x.csv',index_col=0,parse_dates=True); e.columns=['tot','btc','b','ls','vol','tr']
d=e.resample('1D').last(); R=d[['b','ls','vol','tr']].pct_change().fillna(0); R[R.index.day==1]=0
bd=pd.read_csv('app/data/coins/BTC_1d.csv.gz',index_col=0,parse_dates=True).close
def run(cols, fixed=None):
    X=R[cols]; val=1.0; out=[]; k=len(cols)
    for _,g in X.groupby([X.index.year,X.index.month]):
        h=X.loc[:g.index[0]].iloc[-61:-1]
        if fixed is not None: w=np.array(fixed)
        elif len(h)>20:
            w=1/h.std().clip(lower=0.01).values; w=w/w.sum()
            for _ in range(5): w=np.minimum(w,0.5); w=w/w.sum()
        else: w=np.ones(k)/k
        sub=val*w*(1+g).cumprod(); out.append(sub.sum(axis=1)); val=sub.iloc[-1].sum()
    x=pd.concat(out); y=(x.index[-1]-x.index[0]).days/365.25
    mr=x.resample('ME').last().pct_change(); bm=bd.resample('ME').last().pct_change().reindex(mr.index)
    c=x.iloc[-1]**(1/y)-1; dd=(x/x.cummax()-1).min()
    return f'{c*100:5.1f}%/jr daling {dd*100:5.1f}% cal {c/-dd:.2f} | stijgmnd {mr[bm>0.05].mean()*100:4.1f} daalmnd {mr[bm<-0.05].mean()*100:4.1f} zij {mr[(bm.abs()<=0.05)].mean()*100:4.1f}'
for cols in [['b','ls','vol'],['b','ls','tr'],['b','ls','vol','tr'],['b','vol','tr'],['ls','vol','tr'],['ls','tr']]:
    print('+'.join(cols).ljust(14), run(cols))
