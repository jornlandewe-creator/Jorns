import pandas as pd, numpy as np
e=pd.read_csv('results/var_nolim4_2x.csv',index_col=0,parse_dates=True); e.columns=['tot','btc','b','ls','vol','tr']
d=e.resample('1D').last(); R=d[['b','ls','vol','tr']].pct_change().fillna(0); R[R.index.day==1]=0
bd=pd.read_csv('app/data/coins/BTC_1d.csv.gz',index_col=0,parse_dates=True).close
up=(bd>bd.rolling(100).mean()).shift(1).reindex(R.index).fillna(False)
def run(k_ls, k_tr):
    val=1.0; v=None; out=[]; pm=None; pu=None; base=np.ones(4)/4
    for t in R.index:
        m=(t.year,t.month); u=bool(up[t])
        if m!=pm:
            h=R.loc[:t].iloc[-61:-1]
            if len(h)>20:
                sd=h.std().clip(lower=0.01).values; w=1/sd; w=w/w.sum()
                for _ in range(5): w=np.minimum(w,0.5); w=w/w.sum()
                base=w
        if m!=pm or u!=pu:
            w=base.copy()
            if u: w[1]*=k_ls; w[3]*=k_tr; w[2]*=k_tr
            w=w/w.sum()
            if v is not None: val*=1-0.0016*np.abs(w-v/v.sum()).sum()
            v=val*w
        v=v*(1+R.loc[t].values); val=v.sum(); out.append(val); pm=m; pu=u
    x=pd.Series(out,R.index); y=(x.index[-1]-x.index[0]).days/365.25
    mr=x.resample('ME').last().pct_change(); bm=bd.resample('ME').last().pct_change().reindex(mr.index)
    return (x.iloc[-1])**(1/y)-1,(x/x.cummax()-1).min(),mr[bm>0.05].mean(),mr[bm<-0.05].mean()
for kl,kt in [(1,1),(0.5,1),(0.5,1.5),(0,1.5),(1,1.5),(1,2),(0.75,1.5)]:
    c,dd,u,dn=run(kl,kt); print(f'L/S x{kl} trend+vol x{kt} in stijgende markt: {c*100:.1f}%/jr daling {dd*100:.1f}% stijgmnd {u*100:.1f} daalmnd {dn*100:.1f}  cal {c/-dd:.2f}')
