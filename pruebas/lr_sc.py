"""Cococcioni-de Gironcoli linear-response U on NiO AFM-II with single-site perturbation (response matrices)."""
import sys, os, time, json, numpy as np
from ase import Atoms
from common import *
from pyscf.pbc.dft import kukspu
from pyscf.dft.rkspu import _set_U
from pyscf.pbc.dft.krkspu import reference_mol, _make_minao_lo

el, basis = sys.argv[1], sys.argv[2]; kmesh=[int(x) for x in sys.argv[3].split(',')]; rep=[int(x) for x in sys.argv[5].split(',')]
alphas = [float(x) for x in sys.argv[4].split(',')]   # eV
a = {'Ni': 4.17, 'Mn': 4.445}[el]
A = a*np.array([[1, .5, .5], [.5, 1, .5], [.5, .5, 1]])
at = Atoms(f'{el}2O2', cell=A, pbc=True, positions=a*np.array([[0, 0, 0], [.5, .5, 0], [0, 0, .5], [.5, .5, .5]]))
at = at.repeat(rep); up_atoms=[i for i in range(len(at)) if i%4==0]; dn_atoms=[i for i in range(len(at)) if i%4==1]
cell = make_cell(at, basis, ke_cutoff=float(os.environ.get('KE', '150')))
kpts = cell.make_kpts(kmesh); nks = len(kpts)
labels = cell.ao_labels(fmt=False)
# Ground state by the guided route: NM -> broken symmetry PBE+U(5) -> PBE (U=0)
log = open(f'lrsc_{el}_{sys.argv[5]}.log','w')
nm = dft.KRKS(cell, kpts); nm.xc = 'pbe'; nm = nm.smearing(sigma=0.01, method='fermi'); nm.verbose=4; nm.stdout=log
t0 = time.time(); nm.kernel(); dnm = np.array(nm.make_rdm1())
d1 = [i for i, l in enumerate(labels) if l[0] in up_atoms and '3d' in l[2]]
d2 = [i for i, l in enumerate(labels) if l[0] in dn_atoms and '3d' in l[2]]
fa = np.ones(cell.nao); fb = np.ones(cell.nao); fa[d1] = 1.3; fb[d1] = 0.7; fa[d2] = 0.7; fb[d2] = 1.3
dm = np.array([dnm/2*np.sqrt(np.outer(fa, fa)), dnm/2*np.sqrt(np.outer(fb, fb))])
for U in (5.0, 0.0):
    mf = kukspu.KUKSpU(cell, kpts, xc='pbe', U_idx=[f'{el} 3d'], U_val=[U])
    mf.verbose=4; mf.stdout=log; mf.max_cycle = 150
    if U > 0: mf = mf.smearing(sigma=0.002, method='fermi')
    mf.kernel(dm0=dm); dm = mf.make_rdm1()
print('ground state', round(time.time()-t0, 1), 's conv', mf.converged, flush=True)
bare_dm = mf.make_rdm1()
pcell = reference_mol(cell, mf.minao_ref)
U_idx, _, U_lab = _set_U(cell, pcell, mf.U_idx, mf.U_val)
nsite = len(U_idx)
ovlp = cell.pbc_intor('int1e_ovlp', hermi=1, kpts=kpts)
C_ao_lo = _make_minao_lo(cell, pcell, kpts)
C_inv = [[C_k[:, li].conj().T.dot(S_k) for C_k, S_k in zip(C_ao_lo, ovlp)] for li in U_idx]

def site_occ(mo, occ):
    out = []
    for c in C_inv:
        n = 0
        for s in range(2):
            for k in range(nks):
                cs = c[k].dot(mo[s][k]); n += np.einsum('pi,i,pi->', cs.conj(), occ[s][k], cs).real
        out.append(n/nks)
    return np.array(out)

n0 = site_occ(mf.mo_coeff, mf.mo_occ)
print('d occupations', n0.round(4), flush=True)
pert = 0   # perturb site 0 only; site 1 is equivalent by symmetry (spin flip)
bare, scf = [], []
t1 = time.time()
for al in alphas:
    m2 = mf.copy(); m2.alpha = [al/HA if j == pert else 0.0 for j in range(nsite)]
    m2.verbose = 4; m2.stdout = log
    fock = m2.get_fock(dm=bare_dm); e, mo = m2.eig(fock, ovlp)
    bare.append(site_occ(mo, mf.mo_occ) - n0)
    m2.kernel(dm0=bare_dm); scf.append(site_occ(m2.mo_coeff, m2.mo_occ) - n0)
    print('alpha', al, 'dn_bare', bare[-1].round(5), 'dn_scf', scf[-1].round(5), 'conv', m2.converged, flush=True)
tlr = time.time()-t1
al = np.array(alphas); bare = np.array(bare); scf = np.array(scf)
chi0_col = np.array([np.polyfit(al, bare[:, j], 1)[0] for j in range(nsite)])
chi_col = np.array([np.polyfit(al, scf[:, j], 1)[0] for j in range(nsite)])
# 2x2 response matrices from symmetry: chi[i,j] depends only on |i-j| (two equivalent sites)
U_scalar = 1/chi0_col[0] - 1/chi_col[0]
out = dict(el=el, basis=basis, kmesh=kmesh, rep=rep, natom=len(at), alphas=alphas, chi0=chi0_col.round(4).tolist(), chi=chi_col.round(4).tolist(), U_scalar_eV=round(float(U_scalar), 2), t_lr=round(tlr, 1))
print(json.dumps(out)); open('results_lr.jsonl', 'a').write(json.dumps(out)+'\n')
