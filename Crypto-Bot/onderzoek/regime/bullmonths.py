import pandas as pd, numpy as np
e=pd.read_csv('results/var_rp_norem_2x.csv',index_col=0,parse_dates=True); e.columns=['tot','btc','m_btc','m_ls','m_vol']
m=e.resample('ME').last(); first=e.iloc[[0]]; m=pd.concat([first,m]); r=m.pct_change().dropna()
r.index=r.index.strftime('%Y-%m')
r['kl']=np.where(r.btc>0.05,'stijgend',np.where(r.btc<-0.05,'dalend','zijwaarts'))
pd.set_option('display.width',200)
print((r[['btc','tot','m_btc','m_ls','m_vol']]*100).round(1).assign(kl=r.kl).to_string())
g=r.groupby('kl')
print((g[['btc','tot','m_btc','m_ls','m_vol']].mean()*100).round(1)); print(g.size())
print('bot>btc fractie', g.apply(lambda x:(x.tot>x.btc).mean()).round(2))
print('bot>0 fractie', g.apply(lambda x:(x.tot>0).mean()).round(2))
