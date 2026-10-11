import re,json,numpy as np
def ds(a,rmax=6.0,n=220):
    a=np.array(a); a=a[a[:,0]<=rmax]
    if len(a)>n: a=a[np.unique(np.linspace(0,len(a)-1,n).round().astype(int))]
    return np.round(a,5).tolist()
def parse(fn):
    L=open(fn).read().split("\n"); D={'p':[],'L':[],'r':[],'C':[],'wf':{},'pj':{},'ld':{}}
    for s in L:
        t=s.split()
        if not t: continue
        if t[0]=='!p': D['p'].append([float(v) for v in t[1:]])
        elif t[0]=='!L': D['L'].append([float(v) for v in t[1:]])
        elif t[0]=='!r': D['r'].append([float(v) for v in t[1:]])
        elif t[0]=='!C': D['C'].append([float(v) for v in t[1:]])
        elif t[0]=='&': D['wf'].setdefault(t[1],[]).append([float(v) for v in t[2:]])
        elif t[0]=='@': D['pj'].setdefault(t[1],[]).append([float(v) for v in t[2:]])
        elif t[0]=='!' and len(t)==5: D['ld'].setdefault(t[1],[]).append([float(v) for v in t[2:]])
    txt=open(fn).read()
    out={}
    out['V']=ds([[r[0]]+r[2:] for r in D['p']])   # r, V_s, V_p, V_d (ionic, Ha)
    out['Vloc']=ds(D['L'])
    out['rho']=ds(D['r'])          # r, rhoV, rhoC, rhoM
    # wavefunctions: split states if r restarts
    wf={}
    for l,rows in D['wf'].items():
        sets=[[]]
        for row in rows:
            if sets[-1] and row[0]<sets[-1][-1][0]: sets.append([])
            sets[-1].append(row)
        wf[l]=[ds(s,8.0) for s in sets]
    out['wf']=wf
    out['ld']={l:np.round(np.array(v),4).tolist() for l,v in D['ld'].items()}
    out['conv']={}
    for row in D['C']: out['conv'].setdefault(str(int(row[0])),[]).append(row[1:])
    # rc
    m=re.search(r"#\s+l,\s+rc,\s+ep,.*?\n((?:\s+\d.*\n)+)",txt)
    out['rc']=[float(s.split()[1]) for s in m.group(1).strip().split("\n")]
    # test config 0 eigenvalues and config table
    tc=re.findall(r"Test configuration (\d+)\n\n.*?\n((?:\s+\d+\s+\d+\s+[\d.]+.*\n)+)",txt)
    out['tests']=[]
    for i,blk in tc:
        rows=[]
        for s in blk.strip().split("\n"):
            t=s.split(); rows.append([int(t[0]),int(t[1]),float(t[2]),float(t[3])]+([float(t[4]),float(t[5].replace('D','e'))] if len(t)>4 else []))
        ex=re.search(rf"Test configuration {i}\n.*?PSP excitation error=\s*([-\dD.+]+)",txt,re.S)
        out['tests'].append(dict(rows=rows,exc=float(ex.group(1).replace('D','e'))))
    g=re.search(r"Testing for bound ghosts\n(.*?)\n Testing for highly",txt,re.S)
    out['ghost']=[s.strip() for s in g.group(1).split("\n") if s.strip()] if g else []
    g2=re.search(r"Testing for highly-localized positive-energy ghosts\n(.*?)\n\nTest configuration",txt,re.S)
    out['ghostp']=[s.strip() for s in g2.group(1).split("\n") if s.strip()] if g2 else []
    a=re.search(r"#\s+n\s+l\s+f\s+energy \(Ha\)\n((?:\s+\d.*\n)+)",txt)
    out['ae']=[[int(t.split()[0]),int(t.split()[1]),float(t.split()[2]),float(t.split()[3].replace('D','e'))] for t in a.group(1).strip().split('\n')]
    return out
res={n:parse(f"{n}/{n}.out") for n in ["si_lda","si_pbe","si_ghost","c_lda","c_pbe"]}
for n,o in res.items(): print(n,o['rc'],list(o['wf'].keys()),[len(v) for v in o['wf'].values()],list(o['ld'].keys()),o['tests'][0]['rows'][-1], len(o['ghost']),len(o['ghostp']), list(o['conv'].keys()))
json.dump(res,open('oncv.json','w')); import os; print(os.path.getsize('oncv.json')/1e3,'kB')
