"""Lectura de las corridas y ajuste BM3 independiente (numpy) para construir los vectores de WF-EOS."""
import os
import json, numpy as np, glob, re
S='RUNS/runs/'
EV=160.21766208; A=5.43; V5=A**3/4
def table(prefix, base):
    pts=[]
    for d in sorted(glob.glob(S+'eos/'+prefix+'_*')):
        eta=float(d.rsplit('_',1)[1]); out=open(d+'/out').read()
        mesh=[int(v) for v in re.search(r'InitMesh: MESH =\s*(\d+) x (\d+) x (\d+)',out).groups()]
        e=float(re.findall(r'^siesta: FreeEng =\s*(\S+)\s*$',out,re.M)[-1])
        pts.append({"volume_factor":round(base*eta,6),"volume_A3":round(V5*base*eta,10),"energy_eV":e,"mesh":mesh,
                    "kgrid":{"kind":"MonkhorstPack","block":[[6,0,0,0.5],[0,6,0,0.5],[0,0,6,0.5]]},"relaxation_mode":"fixed-fractional"})
    return pts
def bm3(V,E):
    V=np.array(V);E=np.array(E);x=V**(-2/3);xm=x.mean();xs=x.std();t=(x-xm)/xs
    c=np.linalg.lstsq(np.vander(t,4,increasing=True),E,rcond=None)[0]
    p=np.polynomial.Polynomial(c); r=[z.real for z in p.deriv().roots() if abs(z.imag)<1e-14 and p.deriv(2)(z.real)>0]
    t0=r[0]; x0=xm+xs*t0; V0=x0**-1.5
    px2=p.deriv(2)(t0)/xs**2; px3=p.deriv(3)(t0)/xs**3
    xV1=-2/3*V0**(-5/3); xV2=10/9*V0**(-8/3)
    E2=px2*xV1**2; E3=px3*xV1**3+3*px2*xV1*xV2
    rms=np.sqrt(np.mean((E-p(t))**2))*1000
    return dict(E0_eV=float(p(t0)),V0_A3=float(V0),B0_GPa=float(V0*E2*EV),B0_prime=float(-1-V0*E3/E2),rms_meV=float(rms))
