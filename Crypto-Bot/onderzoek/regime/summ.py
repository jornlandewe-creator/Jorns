import pandas as pd, json, sys; sys.path.insert(0,'/home/claude/bot/app')
from rules import quality
b=pd.read_csv('/home/claude/bot/app/data/coins/BTC_1d.csv.gz',index_col=0,parse_dates=True).close; bm=b.resample('ME').last().pct_change()
for prof,tag in [x.split(':') for x in sys.argv[1:]]:
    j=json.load(open(f'results/pt_{prof}_{tag}.json')); e=pd.read_csv(f'results/pt_{prof}_{tag}.csv',index_col=0,parse_dates=True).iloc[:,0]
    yr={str(y): round((g.iloc[-1]/g.iloc[0]-1)*100,1) for y,g in e.groupby(e.index.year)}
    e2=e[e.index>='2024-10-01']; e2=e2/e2.iloc[0]; e3=e[e.index>='2026-07-01']; e3=e3/e3.iloc[0]
    m=pd.concat([e.iloc[[0]],e.resample('ME').last()]).pct_change().dropna(); bb=bm.reindex(m.index)
    d=e.resample('1D').last(); r12=(d.shift(-365)/d-1).dropna()
    pj=j['per_jaar'] or 0
    print(prof,tag, f"{pj*100:.1f}%/jr daling {j['daling']*100:.1f}% winrate {j['winrate']*100:.0f}% trades {j['trades']} | {yr} | 2j {(e2.iloc[-1]-1)*100:.0f}% | jul-sep {(e3.iloc[-1]-1)*100:.1f}% | stijg {m[bb>0.05].mean()*100:.1f} daal {m[bb<-0.05].mean()*100:.1f} | 12m {(r12>0).mean():.0%}")
    try:
        for x in quality(pd.read_csv(f'results/trades_{prof}_{tag}.csv').to_dict('records')): print('   ', x['strat'], x['trades'], round(x['winrate'],2), round(x['profit_factor'] or 0,2), x['totaal'])
    except Exception as ex: pass
