import time, sys, numpy as np
from pyscf.pbc import gto, dft
from ase.build import bulk
from pyscf.pbc.tools import pyscf_ase
basis = sys.argv[1]; nk = int(sys.argv[2]); xc = sys.argv[3] if len(sys.argv)>3 else 'pbe'
at = bulk('Si','diamond',a=5.431)
cell = gto.Cell(); cell.atom = pyscf_ase.ase_atoms_to_pyscf(at); cell.a = at.cell[:]
cell.basis = basis; cell.pseudo='gth-pbe'; cell.verbose=0; cell.build()
kpts = cell.make_kpts([nk]*3)
t=time.time()
mf = dft.KRKS(cell, kpts).density_fit(); mf.xc=xc
cyc=[]
mf.callback = lambda env: cyc.append(env['e_tot'])
e=mf.kernel(); tscf=time.time()-t
# bands
path = at.cell.bandpath('LGXUKG', npoints=60)
kb = cell.get_abs_kpts(path.kpts)
t=time.time(); eb, cb = mf.get_bands(kb); tb=time.time()-t
eb=np.array(eb)*27.2114
nocc=cell.nelectron//2
vbm=eb[:,:nocc].max(); cbm=eb[:,nocc:].min()
ivbm=np.argmax(eb[:,nocc-1]); icbm=np.argmin(eb[:,nocc])
print(f"{basis} nk={nk} {xc} nao={cell.nao} E={e:.6f} conv={mf.converged} ncyc={len(cyc)} tscf={tscf:.1f}s tbands={tb:.1f}s gap={cbm-vbm:.3f} eV vbm@k{ivbm} cbm@k{icbm} kcbm={path.kpts[icbm]}")
