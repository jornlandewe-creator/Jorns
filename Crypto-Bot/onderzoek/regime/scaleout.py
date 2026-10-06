"""Winrate verhogen met gedeeltelijke winstname: bij +X ATR een deel verkopen en de stop naar break-even."""
import sys, os, numpy as np, pandas as pd
sys.path.insert(0,'/home/claude/bot'); os.chdir('/home/claude/bot')
from engine import atr
from engine3 import simulate3
from library import supertrend
from library2 import trades_surge, vol_breakout
C=['BTC','ETH','BNB','SOL','XRP','ADA','DOGE','AVAX','LINK','DOT']
def run(fn,p,tf,start,vol,gate=False):
    data=[]
    btc_d=pd.read_csv('data/coins/BTC_1d.csv',index_col=0,parse_dates=True).close; g=(btc_d>btc_d.rolling(100).mean()).shift(1)
    for c in C:
        df=pd.read_csv(f'data/coins/{c}_{tf}.csv',index_col=0,parse_dates=True); df=df[df.index>=pd.Timestamp(start,tz='UTC')-pd.Timedelta(days=30)]
        cols=['open','high','low','close','volume']+(['taker_buy','ntrades'] if vol else [])
        d=tuple(df[k].values.astype(float) for k in cols)
        L,_,XL,_=[np.nan_to_num(np.asarray(x,dtype=float)).astype(bool) for x in fn(d,p)]
        if gate:
            gg=g.reindex(df.index.floor('1D')).fillna(False).values.astype(bool); L=L&gg; XL=XL|~gg
        data.append((d,L,XL,atr(d[1],d[2],d[3],14),df.index,df.index.searchsorted(pd.Timestamp(start,tz='UTC'))))
    return data
def evals(data,sl,tp,frac,bpd):
    rets=[];win=0;n=0
    for d,L,XL,a,ix,s0 in data:
        eq,tr,_=simulate3(d[0],d[1],d[2],d[3],a,L,np.zeros_like(L),XL,np.zeros_like(L),sl,tp,frac,0.0005,0.0003,0.0001/8*(24/bpd),10.0,1.0,s0)
        rets.append(pd.Series(eq,ix).iloc[s0:].resample('1D').last().ffill().pct_change().fillna(0)); win+=(tr>0).sum(); n+=len(tr)
    r=pd.concat(rets,axis=1).fillna(0).mean(axis=1); e=(1+r).cumprod(); y=(e.index[-1]-e.index[0]).days/365.25
    return e.iloc[-1]**(1/y)-1,(e/e.cummax()-1).min(),win/max(n,1),n
for name,fn,p,tf,start,vol,gate,sl,bpd in [('Volume-piek 30m',trades_surge,dict(n=200,z=3.0,tf=200),'30m','2024-02-01',True,False,8.0,48),
                                         ('Supertrend 4h (Trend-long)',supertrend,dict(n=10,m=4.0),'4h','2022-03-01',False,True,2.5,6),
                                         ('Volume-uitbraak 4h',vol_breakout,dict(n=100,k=3.0),'4h','2022-03-01',True,False,2.5,6)]:
    data=run(fn,p,tf,start,vol,gate)
    for tp,frac in [(0,0),(0.5,0.5),(1.0,0.33),(1.0,0.5),(1.5,0.5),(2.0,0.5)]:
        c,dd,w,n=evals(data,sl,tp,frac,bpd)
        print(f'{name:28s} winstname {"geen" if not tp else f"{int(frac*100)}% bij +{tp} ATR":18s} winrate {w*100:4.0f}%  {c*100:6.1f}%/jr  daling {dd*100:6.1f}%  trades {n}')
