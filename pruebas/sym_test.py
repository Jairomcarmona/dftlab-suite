import sys, time, numpy as np
from ase.build import bulk
from common import *
from pyscf.pbc import df as pdf
basis=sys.argv[1]; nk=int(sys.argv[2]); dfm=sys.argv[3]
at = bulk('Si','diamond',a=5.431); cell = make_cell(at, basis, space_group_symmetry=True, symmorphic=False)
kpts = cell.make_kpts([nk]*3, space_group_symmetry=True, time_reversal_symmetry=True)
print('nkpts ibz', kpts.nkpts_ibz)
mf = dft.KRKS(cell,kpts); mf.xc='pbe'
if dfm=='gdf': mf=mf.density_fit()
t=time.time(); mf.kernel(); print(basis,dfm,'nk',nk,'SCF(sym)',round(time.time()-t,1),'s E',mf.e_tot, mf.converged)
path = at.cell.bandpath('LGXUKG', npoints=10); kb = cell.get_abs_kpts(path.kpts)
mf.with_df = pdf.FFTDF(cell)
t=time.time(); eb,_=mf.get_bands(kb); print('bands FFTDF 10k',round(time.time()-t,1),'s')
