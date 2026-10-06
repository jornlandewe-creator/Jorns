import json, glob, os, pandas as pd
from multiprocessing import Pool
ROOT='/home/claude/finom/static-klines/.klines-cache'
def conv(args):
    sym,tf=args
    rows=[]
    for f in sorted(glob.glob(f'{ROOT}/{sym}/{tf}/*.json')):
        try: rows+=json.load(open(f))
        except Exception: pass
    if not rows: return sym,tf,0,None,None
    df=pd.DataFrame(rows).iloc[:,[0,1,2,3,4,5,7,8,9]]
    df.columns=['t','open','high','low','close','volume','qvol','ntrades','taker_buy']
    df=df.drop_duplicates('t').sort_values('t')
    for c in df.columns[1:]: df[c]=df[c].astype(float)
    df.index=pd.to_datetime(df.t,unit='ms',utc=True); df=df.drop(columns='t')
    df=df[df.index<'2026-10-01']
    df.to_csv(f'data/coins/{sym.replace("USDT","")}_{tf}.csv')
    return sym,tf,len(df),str(df.index[0])[:10],str(df.index[-1])[:16]
syms=sorted(os.listdir(ROOT)); tfs=['15m','30m','1h','2h','4h','1d']
with Pool(2) as p:
    for r in p.imap(conv,[(s,t) for s in syms for t in tfs]): print(r)
