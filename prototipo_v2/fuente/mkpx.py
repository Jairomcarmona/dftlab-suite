import json,numpy as np,sisl,glob,os
from scipy.interpolate import CubicSpline
B=0.529177
ps=json.load(open('/opt/run/oncv/oncv.json'))
mp=json.load(open('/opt/run/si/xcmap.json'))
# density-weighted histogram of s over the full cell
g=sisl.get_sile('/opt/run/si/si.RHO').read_grid(); rho=g.grid*B**3
cell=g.lattice.cell/B; N=np.array(rho.shape)
F=np.fft.fftn(rho); rec=2*np.pi*np.linalg.inv(cell).T
fr=[np.fft.fftfreq(n,1/n) for n in N]; m1,m2,m3=np.meshgrid(*fr,indexing='ij')
grad=[np.fft.ifftn(1j*(m1*rec[0][i]+m2*rec[1][i]+m3*rec[2][i])*F).real for i in range(3)]
gn=np.sqrt(sum(x*x for x in grad)); r=np.maximum(rho,1e-6); kF=(3*np.pi**2*r)**(1/3); s=gn/(2*kF*r)
h,e=np.histogram(s.ravel(),bins=60,range=(0,3),weights=rho.ravel())
mp['shist']=dict(s=np.round((e[1:]+e[:-1])/2,3).tolist(),w=np.round(h/h.sum(),5).tolist())
eos=json.load(open('/opt/run/xc/eos.json'))
for k in eos: eos[k]['gapG0']=float(np.interp(eos[k]['a0'],eos[k]['a'],eos[k]['gapG']))
gr={'curves':{}}
def en(f):
    try: return float([l for l in open(f) if 'siesta:         Total =' in l][-1].split()[-1])
    except Exception: return None
for xc in ['lda','pbe','drsll','vv']:
    E10=en(f'/opt/run/gr/{xc}_10.0/g.out'); D=[];R=[];C=[]
    for d in [2.9,3.1,3.25,3.4,3.6,3.9,4.4,5.0,6.0]:
        ab=en(f'/opt/run/gr/{xc}_{d}/g.out'); g=en(f'/opt/run/gr/gh_{xc}_{d}/g.out')
        if ab is None or g is None or E10 is None: continue
        D.append(d); R.append((ab-E10)/4*1000); C.append((ab-2*g)/4*1000)
    if len(D)<6: continue
    x=np.linspace(D[0],D[-1],300); cs=CubicSpline(D,C); y=cs(x); i=np.argmin(y); cr=CubicSpline(D,R)(x)
    gr['curves'][xc]=dict(d=[round(v,3) for v in x[::3]],Eb=[round(float(v),2) for v in y[::3]],raw=[round(float(v),2) for v in cr[::3]],dmin=float(x[i]),Emin=float(y[i]),rawmin=float(cr.min()))
    print(xc,'CP dmin %.2f Emin %.1f | raw min %.1f'%(x[i],y[i],cr.min()))
json.dump(dict(pseudo=ps,map=mp,eos=eos,graphite=gr),open('px.json','w'),separators=(',',':'))
print(os.path.getsize('px.json')/1e3,'kB')
