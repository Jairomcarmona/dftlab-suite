import numpy as np, spglib, seekpath, time
from ase.build import bulk
from ase.io import read, write
# 1) conventional GaAs -> CIF -> read back
conv = bulk('GaAs','zincblende',a=5.653,cubic=True); write('GaAs_conv.cif', conv)
at = read('GaAs_conv.cif'); print('CIF atoms', len(at))
cellt = (at.cell[:], at.get_scaled_positions(), at.numbers)
ds = spglib.get_symmetry_dataset(cellt, symprec=1e-3)
print('space group', ds.international, ds.number, 'n_ops', len(ds.rotations), 'Wyckoff', ds.wyckoffs)
prim = spglib.standardize_cell(cellt, to_primitive=True, symprec=1e-3); print('primitive atoms', len(prim[2]))
# 2) seekpath
t=time.time(); sp = seekpath.get_path(cellt, with_time_reversal=True); print('seekpath', round(time.time()-t,3),'s', 'bravais', sp['bravais_lattice_extended'], 'path', sp['path'])
print('prim lattice from seekpath\n', np.round(sp['primitive_lattice'],3), '\ntransf', np.round(sp['primitive_transformation_matrix'],3))
ex = seekpath.get_explicit_k_path(cellt, reference_distance=0.025); print('explicit k pts', len(ex['explicit_kpoints_abs']))
# 3) supercells and symmetry lowering
sc = at.repeat((2,2,2)); print('2x2x2 atoms', len(sc), spglib.get_spacegroup((sc.cell[:],sc.get_scaled_positions(),sc.numbers)))
sc2 = sc.copy(); sc2.positions[0] += [0.05,0.0,0.0]; print('displaced one atom ->', spglib.get_spacegroup((sc2.cell[:],sc2.get_scaled_positions(),sc2.numbers),symprec=1e-3))
sc3 = sc.copy(); sc3.numbers[0]=30; print('Zn substitution ->', spglib.get_spacegroup((sc3.cell[:],sc3.get_scaled_positions(),sc3.numbers)))
# tolerance demo: slightly distorted cell detected or not depending on symprec
d = at.copy(); d.positions[0]+=[0.01,0,0]
for sp_ in [1e-4,1e-3,2e-2]: print('symprec',sp_, spglib.get_spacegroup((d.cell[:],d.get_scaled_positions(),d.numbers),symprec=sp_))
# 4) XYZ molecule and extended XYZ with lattice
from ase.build import molecule
write('co.xyz', molecule('CO')); m = read('co.xyz'); print('xyz pbc', m.pbc, 'cell', m.cell.lengths())
write('gaas.extxyz', at); e = read('gaas.extxyz'); print('extxyz pbc', e.pbc, e.cell.lengths().round(3))
# 5) NaCl rocksalt from hex/ trigonal setting: AFM NiO cell symmetry
from ase import Atoms
a=4.17; A=a*np.array([[1,.5,.5],[.5,1,.5],[.5,.5,1]])
nio=Atoms('Ni2O2',cell=A,pbc=True,positions=a*np.array([[0,0,0],[.5,.5,0],[0,0,.5],[.5,.5,.5]]))
print('NiO NM (Ni equal)', spglib.get_spacegroup((nio.cell[:],nio.get_scaled_positions(),nio.numbers)))
print('NiO AFM (Ni1 != Ni2 via magmoms)', spglib.get_magnetic_symmetry_dataset((nio.cell[:],nio.get_scaled_positions(),nio.numbers,[1,-1,0,0])).uni_number if hasattr(spglib,'get_magnetic_symmetry_dataset') else 'n/a')
num=nio.numbers.copy(); num[1]=99
print('NiO AFM as two species', spglib.get_spacegroup((nio.cell[:],nio.get_scaled_positions(),num)))
