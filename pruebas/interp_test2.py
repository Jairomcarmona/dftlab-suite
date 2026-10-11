import sys, time, numpy as np, scipy.linalg as la
from ase.build import bulk
from common import *; from wsinterp import build_ws
nk=int(sys.argv[1]); basis=sys.argv[2]
at = bulk('Si','diamond',a=5.431); cell = make_cell(at, basis)
kpts = cell.make_kpts([nk]*3)
mf = dft.KRKS(cell,kpts); mf.xc='pbe'
t=time.time(); mf.kernel(); print(basis,'nk',nk,'SCF',round(time.time()-t,1),'s')
F=np.array(mf.get_fock()); S=np.array(mf.get_ovlp())
f=build_ws(cell,kpts,[nk]*3,[F,S])
path = at.cell.bandpath('LGXUKG', npoints=120); kb = cell.get_abs_kpts(path.kpts)
t=time.time(); E=np.array([la.eigh(*f(k),eigvals_only=True) for k in kb])*HA; print('interp 120k',round(time.time()-t,2),'s')
sel=[0,30,55,75,100,119]
t=time.time(); ex,_=mf.get_bands(kb[sel]); print('exact 6k',round(time.time()-t,1),'s'); ex=np.array(ex)*HA
nocc=cell.nelectron//2
print('max err occ (meV)',np.abs(ex[:,:nocc]-E[sel][:,:nocc]).max()*1e3,' lowest 4 virt (meV)',np.abs(ex[:,nocc:nocc+4]-E[sel][:,nocc:nocc+4]).max()*1e3)
print('gap',E[:,nocc:].min()-E[:,:nocc].max(),'kcbm',path.kpts[np.argmin(E[:,nocc])])
