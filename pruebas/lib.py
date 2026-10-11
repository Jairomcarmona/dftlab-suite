import sys, time, json, numpy as np
from ase.build import bulk, graphene
from ase import Atoms
from common import *
from pyscf.pbc import df as pdf
def struct(name):
    if name=='Si': return bulk('Si','diamond',a=5.431),'LGXUKG',0
    if name=='C': return bulk('C','diamond',a=3.567),'LGXUKG',0
    if name=='GaAs': return bulk('GaAs','zincblende',a=5.653),'LGXUKG',0
    if name=='LiF': return bulk('LiF','rocksalt',a=4.03),'LGXWKG',0
    if name=='NaCl': return bulk('NaCl','rocksalt',a=5.64),'LGXWKG',0
    if name=='MgO': return bulk('MgO','rocksalt',a=4.21),'LGXWKG',0
    if name=='graphene':
        a=graphene('C2',a=2.46,vacuum=6.0); a.pbc=True; return a,'GMKG',0
    if name=='hBN':
        a=graphene('BN',a=2.50,vacuum=6.0); a.pbc=True; return a,'GMKG',0
    if name=='Fe': return bulk('Fe','bcc',a=2.87),'GHNGPH',1
    if name=='Ni': return bulk('Ni','fcc',a=3.52),'GXWKGL',1
name=sys.argv[1]; basis=sys.argv[2]; nk=[int(x) for x in sys.argv[3].split(',')]
at,pathstr,mag = struct(name)
kw={}
import os
cell = make_cell(at, basis, spin=0, ke_cutoff=float(os.environ.get('KE','120')))
kpts = cell.make_kpts(nk)
t0=time.time()
if mag:
    mf = dft.KUKS(cell,kpts); mf.xc='pbe'; mf=mf.smearing(sigma=0.01, method='fermi')
    # ferromagnetic guess
    dm=np.array(mf.get_init_guess()); dm[0]*=1.15; dm[1]*=0.85
    cyc=[]; mf.callback=lambda e: cyc.append(e['e_tot']); mf.max_cycle=100
    mf.kernel(dm0=dm)
else:
    mf = dft.KRKS(cell,kpts); mf.xc='pbe'
    if os.environ.get('SMEAR'): mf=mf.smearing(sigma=float(os.environ['SMEAR']),method='fermi')
    cyc=[]; mf.callback=lambda e: cyc.append(e['e_tot'])
    mf.kernel()
tscf=time.time()-t0
out=dict(name=name,basis=basis,nk=nk,nao=cell.nao,nelec=int(cell.nelectron),mesh=[int(x) for x in cell.mesh],E=mf.e_tot,conv=bool(mf.converged),ncyc=len(cyc),tscf=round(tscf,1))
if mag:

    occ=np.array(mf.mo_occ); nup=sum(o.sum() for o in occ[0])/len(kpts); ndn=sum(o.sum() for o in occ[1])/len(kpts)
    out['moment_cell']=round(float(nup-ndn),3)
else:
    path=at.cell.bandpath(pathstr, npoints=40); kb=cell.get_abs_kpts(path.kpts)
    pass
    t=time.time(); eb,_=mf.get_bands(kb); out['tbands40']=round(time.time()-t,1)
    eb=np.array(eb)*HA; nocc=cell.nelectron//2
    em=np.array(mf.mo_energy)*HA
    vbm=max(eb[:,:nocc].max(), em[:,:nocc].max()); cbm=min(eb[:,nocc:].min(), em[:,nocc:].min())
    out['gap']=round(float(cbm-vbm),3)
    out['direct_gap_path']=round(float((eb[:,nocc]-eb[:,nocc-1]).min()),3)
    out['kvbm']=path.kpts[np.argmax(eb[:,nocc-1])].round(3).tolist(); out['kcbm']=path.kpts[np.argmin(eb[:,nocc])].round(3).tolist()
print(json.dumps(out)); open('results.jsonl','a').write(json.dumps(out)+'\n')
