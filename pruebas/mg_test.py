import sys, time, numpy as np
from ase.build import bulk
from common import *
from pyscf.pbc.dft import multigrid
basis=sys.argv[1]; nk=int(sys.argv[2]); mode=sys.argv[3]
at = bulk('Si','diamond',a=5.431); cell = make_cell(at, basis)
print('mesh', cell.mesh, 'ke_cutoff', cell.ke_cutoff)
kpts = cell.make_kpts([nk]*3)
mf = dft.KRKS(cell,kpts); mf.xc='pbe'
if mode=='mg': mf = mf.multigrid_numint() if hasattr(mf,'multigrid_numint') else multigrid.multigrid(mf)
if mode.startswith('mesh'):
    m=int(mode[4:]); cell.mesh=[m]*3; cell.build(); mf=dft.KRKS(cell,kpts); mf.xc='pbe'
t=time.time(); mf.kernel(); print(basis,mode,'nk',nk,'SCF',round(time.time()-t,1),'s E',mf.e_tot, mf.converged)
