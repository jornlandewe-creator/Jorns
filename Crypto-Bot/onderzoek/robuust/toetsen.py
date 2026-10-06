import sys; sys.path.insert(0,'robust')
from test import *
C, R, elig, F, reb, s0, out = run()
idx=C.index; rng=np.random.default_rng(7); Rv=R.values; Fv=F.values
E=elig.values; rebi=np.where(reb)[0]
# echte (ongeschaalde) strategieen
WA=weights_A(C,R,elig).values; WB=weights_B(C,elig).values
def sh(eq):
    e=pd.Series(eq,idx); e=e[e.index>=START]; r=e.pct_change().dropna(); return r.mean()/r.std()*np.sqrt(365)
shA=sh(sim(Rv,WA,reb,FEE,Fv,s0)); shB=sh(sim(Rv,WB,reb,FEE,Fv,s0))
# A willekeurig: zelfde grootte, teken wisselt met dezelfde kans per herverdeling
sgn=np.sign(WA[rebi]); flips=((sgn[1:]!=sgn[:-1])&(sgn[1:]!=0)&(sgn[:-1]!=0)).sum()/max(((sgn[1:]!=0)&(sgn[:-1]!=0)).sum(),1)
resA=[]
for i in range(300):
    W=np.abs(WA).copy(); s=rng.choice([-1,1],10)
    cur=np.zeros_like(W)
    for j,t in enumerate(rebi):
        flip=rng.random(10)<flips; s=np.where(flip,-s,s)
        nxt=rebi[j+1] if j+1<len(rebi) else len(idx)
        cur[t:nxt]=W[t:nxt]*s
    resA.append(sh(sim(Rv,cur,reb,FEE,Fv,s0)))
# B willekeurig: zelfde aantal posities, plek wordt vervangen met dezelfde kans als bij de echte strategie
L=(WB[rebi]>0); S=(WB[rebi]<0); chg=[]
for j in range(1,len(rebi)):
    if L[j].sum() and L[j-1].sum(): chg.append(1-(L[j]&L[j-1]).sum()/L[j].sum())
p=np.mean(chg)
resB=[]
for i in range(300):
    W=np.zeros_like(WB); longs=set(); shorts=set()
    for j,t in enumerate(rebi):
        ok=list(np.where(E[t])[0]); k=int((WB[t]>0).sum())
        if k==0: continue
        longs={c for c in longs if c in ok and rng.random()>p}; shorts={c for c in shorts if c in ok and rng.random()>p and c not in longs}
        free=[c for c in ok if c not in longs|shorts]; rng.shuffle(free)
        while len(longs)<k and free: longs.add(free.pop())
        while len(shorts)<k and free: shorts.add(free.pop())
        longs=set(list(longs)[:k]); shorts=set(list(shorts)[:k])
        nxt=rebi[j+1] if j+1<len(rebi) else len(idx)
        for c in longs: W[t:nxt,c]=0.5/k
        for c in shorts: W[t:nxt,c]=-0.5/k
    resB.append(sh(sim(Rv,W,reb,FEE,Fv,s0)))
resA=np.array(resA); resB=np.array(resB)
print(f'Toets 3 A trend: echt Sharpe {shA:.2f}, beter dan {(resA<shA).mean()*100:.0f}% van 300 willekeurige (mediaan {np.median(resA):.2f}, 95e pct {np.percentile(resA,95):.2f})')
print(f'Toets 3 B sterk/zwak: echt Sharpe {shB:.2f}, beter dan {(resB<shB).mean()*100:.0f}% van 300 willekeurige (mediaan {np.median(resB):.2f}, 95e pct {np.percentile(resB,95):.2f}), vervangkans {p:.2f}')
C2,R2,e2,F2,reb2,s02,out2=run(cost_mult=2.0)
st=stats(out2['Combinatie'][0],C2.index); print(f"Toets 4 dubbele kosten: combinatie {st['per_jaar']*100:.1f}%/jr, totaal {st['totaal']*100:.0f}%")
print('Ter informatie, buur-instellingen (combinatie, per jaar / daling / t):')
for kw in [dict(A_looks=(10,30,60)),dict(A_looks=(40,120,240)),dict(B_look=14),dict(B_look=56),dict(B_frac=0.25),dict(B_frac=0.5),dict(every=3),dict(every=14)]:
    c_,_,_,_,_,_,o=run(**kw); st=stats(o['Combinatie'][0],c_.index); print(f"   {kw}: {st['per_jaar']*100:.1f}% / {st['daling']*100:.0f}% / t {st['t']:.2f}")
