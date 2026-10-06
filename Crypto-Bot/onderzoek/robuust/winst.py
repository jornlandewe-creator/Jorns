import sys, numpy as np, pandas as pd
sys.path.insert(0,'robust')
def curves():
    out={}
    c=pd.read_csv('robust/curves.csv',index_col=0,parse_dates=True)['Combinatie']; c=c[c.index>='2018-01-01']; out['A+B combinatie 2018-2026']=c
    for nm,f in [('Standaard (bot) 2024-2026','results/pt_standaard_fix.csv'),('Winrate mix 2x (bot) 2024-2026','results/pt_winrate_mix_2xb.csv')]:
        out[nm]=pd.read_csv(f,index_col=0,parse_dates=True).iloc[:,0].resample('1D').last().dropna()
    return out
def st(w):
    y=(w.index[-1]-w.index[0]).days/365.25; return w.iloc[-1]/w.iloc[0], (w.iloc[-1]/w.iloc[0])**(1/y)-1, (w/w.cummax()-1).min()
def afromen(e, frac=0.5):
    r=e.pct_change().fillna(0); bot=1.0; kluis=0.0; hwm=1.0; W=[]
    for t,x in r.items():
        bot*=1+x
        if t.is_month_end or (t+pd.Timedelta(days=1)).day==1:
            if bot>hwm: skim=frac*(bot-hwm); bot-=skim; kluis+=skim; hwm=bot
        W.append(bot+kluis)
    return pd.Series(W,e.index), kluis
def winstslot(e):
    r=e.pct_change().fillna(0); sh=1.0; pk=1.0; f=1.0; w=1.0; W=[]
    for x in r.values:
        w*=1+f*x; sh*=1+x; pk=max(pk,sh); dd=sh/pk-1
        if dd< -0.20: f=0.0
        elif dd< -0.10: f=min(f,0.5)
        elif dd> -0.05: f=1.0
        W.append(w)
    return pd.Series(W,e.index)
for nm,e in curves().items():
    e=e/e.iloc[0]; base=st(e); a,k=afromen(e); sa=st(a); ws=st(winstslot(e))
    print(f'{nm}:')
    print(f'   zonder regel : eind x{base[0]:.2f} ({base[1]*100:.0f}%/jr), grootste daling {base[2]*100:.0f}%')
    print(f'   winst afromen: eind x{sa[0]:.2f} ({sa[1]*100:.0f}%/jr), grootste daling totaal {sa[2]*100:.0f}%, waarvan in kluis {k:.2f}')
    print(f'   winstslot    : eind x{ws[0]:.2f} ({ws[1]*100:.0f}%/jr), grootste daling {ws[2]*100:.0f}%')
