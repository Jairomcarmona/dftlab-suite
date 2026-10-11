"""NiO/MnO AFM-II: robust route NM -> broken-symmetry PBE+U -> U scan. Logs times, gaps, moments."""
import sys, os, time, json, numpy as np
from ase import Atoms
from common import *
from pyscf.pbc.dft import kukspu
el, basis, nk = sys.argv[1], sys.argv[2], int(sys.argv[3])
Us = [float(x) for x in sys.argv[4].split(',')]
a = {'Ni': 4.17, 'Mn': 4.445}[el]
A = a*np.array([[1, .5, .5], [.5, 1, .5], [.5, .5, 1]])
at = Atoms(f'{el}2O2', cell=A, pbc=True, positions=a*np.array([[0, 0, 0], [.5, .5, 0], [0, 0, .5], [.5, .5, .5]]))
cell = make_cell(at, basis, ke_cutoff=float(os.environ.get('KE', '150')))
kpts = cell.make_kpts([nk]*3); labels = cell.ao_labels(fmt=False)
log = open(f'nio2_{el}_{basis}_{nk}.log', 'w')
t = time.time()
nm = dft.KRKS(cell, kpts); nm.xc = 'pbe'; nm = nm.smearing(sigma=0.01, method='fermi')
nm.verbose = 4; nm.stdout = log; nm.kernel()
res = dict(el=el, basis=basis, nk=nk, nao=cell.nao, mesh=[int(x) for x in cell.mesh], t_nm=round(time.time()-t, 1), conv_nm=bool(nm.converged))
print(json.dumps(res), flush=True)
dnm = np.array(nm.make_rdm1())
d1 = [i for i, l in enumerate(labels) if l[0] == 0 and '3d' in l[2]]
d2 = [i for i, l in enumerate(labels) if l[0] == 1 and '3d' in l[2]]
fa = np.ones(cell.nao); fb = np.ones(cell.nao); fa[d1] = 1.3; fb[d1] = 0.7; fa[d2] = 0.7; fb[d2] = 1.3
dm = np.array([dnm/2*np.sqrt(np.outer(fa, fa)), dnm/2*np.sqrt(np.outer(fb, fb))])
S = np.array(nm.get_ovlp())
out = []
for U in Us:
    mf = kukspu.KUKSpU(cell, kpts, xc='pbe', U_idx=[f'{el} 3d'], U_val=[U])
    mf = mf.smearing(sigma=0.002, method='fermi')
    mf.verbose = 4; mf.stdout = log; mf.max_cycle = 120
    cyc = []; mf.callback = lambda e: cyc.append(1)
    t = time.time(); mf.kernel(dm0=dm); ts = time.time()-t
    dm = mf.make_rdm1()   # continue the scan from this solution
    em = np.array(mf.mo_energy)*HA; occ = np.array(mf.mo_occ)
    homo = max(em[s][occ[s] > 0.5].max() for s in range(2)); lumo = min(em[s][occ[s] < 0.5].min() for s in range(2))
    sp = np.zeros(cell.natm)
    for k in range(len(kpts)):
        ps = ((dm[0][k]-dm[1][k])@S[k]).real.diagonal()
        for i, l in enumerate(labels): sp[l[0]] += ps[i]/len(kpts)
    r = dict(U=U, conv=bool(mf.converged), ncyc=len(cyc), t=round(ts, 1), gap_mesh=round(float(lumo-homo), 3), moments_mulliken=sp.round(3).tolist(), E=mf.e_tot)
    print(json.dumps(r), flush=True); out.append(r)
open('results_u.jsonl', 'a').write(json.dumps(dict(res, scan=out))+'\n')
