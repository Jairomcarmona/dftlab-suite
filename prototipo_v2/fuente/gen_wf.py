import sys; sys.path.insert(0,'/opt/run/si'); import wf_lib; from wf_lib import *; import json,gzip,base64
wf_lib.N=28; N=28
d=json.load(open('si_proto.json')); b=d['bands']; x=np.array(b['x']); kc=np.array(b['kcart'])
H=sisl.get_sile('si.fdf').read_hamiltonian(); g=H.geometry
# indices: high-symmetry + quarter points of each segment
labx=[l[0] for l in b['labels']]
hs=[]
for lx in labx:
    hs+= list(np.where(np.abs(x-lx)<1e-4)[0])
hs=sorted(set(hs))
idx=set(hs)
segs=[(hs[i],hs[i+1]) for i in range(len(hs)-1) if hs[i+1]-hs[i]>1]
for a,c in segs:
    L=c-a; m=3 if L>40 else (2 if L>25 else 1)
    for j in range(1,m+1): idx.add(a+round(j*L/(m+1)))
idx=sorted(idx); print(len(idx), idx)
nb=8; out=[]; raw=bytearray()
for i in idx:
    kf=g.lattice.cell@kc[i]/(2*np.pi)
    es=H.eigenstate(kf); eig=es.eig
    for n in range(nb):
        c,e=cube_from_prim(H,kf,n)
        # global phase: maximize real part weight
        ph=np.angle(np.sum(c**2))/2; c=c*np.exp(-1j*ph)
        s=np.abs(c).max(); q=np.clip(np.round(127*np.stack([c.real,c.imag])/s),-127,127).astype(np.int8)
        raw+=q.tobytes()
        deg=int(np.sum(np.abs(eig[:nb]-e)<1e-3))
        out.append(dict(k=int(i),n=n,E=float(e),scale=float(s),deg=deg))
    print(i,flush=True)
gz=gzip.compress(bytes(raw),9)
json.dump(dict(N=N,a=5.43,nb=nb,kidx=[int(i) for i in idx],states=out,data=base64.b64encode(gz).decode()),open('wf.json','w'))
print(len(raw)/1e6,len(gz)/1e6)
