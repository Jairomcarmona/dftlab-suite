import sys, time, numpy as np, seekpath
sys.path.insert(0,'.')
from ase.build import bulk; from ase import Atoms
from common import *
conv = bulk('Si','diamond',a=5.431,cubic=True)
sp = seekpath.get_explicit_k_path((conv.cell[:],conv.get_scaled_positions(),conv.numbers), reference_distance=0.03)
prim = Atoms(numbers=sp['primitive_types'], cell=sp['primitive_lattice'], scaled_positions=sp['primitive_positions'], pbc=True)
cell = make_cell(prim,'gth-dzvp',mesh=[25]*3)
mf=dft.KRKS(cell,cell.make_kpts([4,4,4])); mf.xc='pbe'; t=time.time(); mf.kernel()
kb = np.array(sp['explicit_kpoints_abs'])/ 1.0  # seekpath abs k in 1/Angstrom incl. 2pi
kb_bohr = kb*0.52917721  # to 1/Bohr
t2=time.time(); eb,_=mf.get_bands(kb_bohr); eb=np.array(eb)*HA; n=4
print('scf',round(time.time()-t,1),'bands',len(kb),'k',round(time.time()-t2,1),'s gap',round(eb[:,n:].min()-eb[:,:n].max(),3),'cbm at',sp['explicit_kpoints_labels'][np.argmin(eb[:,n])] or np.round(sp['explicit_kpoints_rel'][np.argmin(eb[:,n])],3))
