import sys; sys.argv=['x']
exec(open('regime/scaleout.py').read().split("for name,fn,p")[0])
from library import rsi_mr
def stream(data,sl,tp,frac,bpd):
    rets=[];win=0;n=0
    for d,L,XL,a,ix,s0 in data:
        eq,tr,_=simulate3(d[0],d[1],d[2],d[3],a,L,np.zeros_like(L),XL,np.zeros_like(L),sl,tp,frac,0.0005,0.0003,0.0001/8*(24/bpd),10.0,1.0,s0)
        rets.append(pd.Series(eq,ix).iloc[s0:].resample('1D').last().ffill().pct_change().fillna(0)); win+=(tr>0).sum(); n+=len(tr)
    return pd.concat(rets,axis=1).fillna(0).mean(axis=1), win, n
st,w1,n1=stream(run(supertrend,dict(n=10,m=4.0),'4h','2022-03-01',False,True),2.5,1.0,0.33,6)
vb,w2,n2=stream(run(vol_breakout,dict(n=100,k=3.0),'4h','2022-03-01',True,False),2.5,1.0,0.33,6)
rd,w3,n3=stream(run(rsi_mr,dict(n=7,lo=25,exit=70,tf=200),'1h','2022-03-01',False,True),20.0,0,0,24)
R=pd.concat([st,vb,rd],axis=1).fillna(0); r=R.mean(axis=1)
print('winrate gepoold', round((w1+w2+w3)/(n1+n2+n3),3), 'trades', n1+n2+n3, 'per jaar', round((n1+n2+n3)/4.6))
print('corr', R.corr().round(2).values.tolist())
def s(e):
    y=(e.index[-1]-e.index[0]).days/365.25; return (e.iloc[-1]/e.iloc[0])**(1/y)-1,(e/e.cummax()-1).min()
for L in (1,2,3,4,5):
    e=(1+L*r-max(L-1,0)*0.0002).cumprod()
    a=s(e); i=s(e[e.index<'2024-01-01']); o=s(e[e.index>='2024-01-01']); q=e['2026-06-30':'2026-09-30']
    print(f'{L}x: {a[0]*100:5.1f}%/jr daling {a[1]*100:6.1f}% | 2022-23 {i[0]*100:5.1f}% ({i[1]*100:.0f}%) | 2024-26 {o[0]*100:5.1f}% ({o[1]*100:.0f}%) | jul-sep26 {(q.iloc[-1]/q.iloc[0]-1)*100:5.1f}%')
(pd.DataFrame({'st':st,'vb':vb,'rd':rd})).to_csv('regime/hiwin_combo.csv')
