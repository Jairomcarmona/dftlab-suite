"""IPA dielectric function for Si from PySCF: eps2 from momentum matrix elements, eps1 by Kramers-Kronig."""
import sys, time, json, numpy as np
from ase.build import bulk
from common import *
from pyscf.pbc import df as pdf
nk_scf = 4; nk_opt = int(sys.argv[1]); shift = len(sys.argv) > 2 and sys.argv[2] == 'shift'
at = bulk('Si', 'diamond', a=5.431)
cell = make_cell(at, 'gth-dzvp', mesh=[25]*3)
mf = dft.KRKS(cell, cell.make_kpts([nk_scf]*3)); mf.xc = 'pbe'
t = time.time(); mf.kernel(); print('scf', round(time.time()-t, 1), 's', flush=True)
# dense non-self-consistent mesh (random-ish shift avoids high-symmetry degeneracies)
kd = cell.make_kpts([nk_opt]*3, scaled_center=[0.11, 0.07, 0.03] if shift else None)
t = time.time()
eb, cb = mf.get_bands(kd)
print('nscf', len(kd), 'k:', round(time.time()-t, 1), 's', flush=True)
t = time.time()
ip = cell.pbc_intor('int1e_ipovlp', kpts=kd)   # <grad mu|nu>_k, shape (nk,3,nao,nao)
nocc = cell.nelectron // 2
Omega = cell.vol
de_list, w_list = [], []
herm_err = 0
for k in range(len(kd)):
    P = 1j * np.asarray(ip[k])           # p = -i grad ; <mu|p|nu> = i <grad mu|nu>
    herm_err = max(herm_err, np.abs(P - P.conj().transpose(0, 2, 1)).max())
    C = cb[k]; e = eb[k]
    Pm = np.einsum('mi,xmn,nj->xij', C[:, nocc:].conj(), P, C[:, :nocc])  # (3, nvir, nocc)
    m2 = (np.abs(Pm)**2).sum(0) / 3.0     # isotropic average
    de = e[nocc:, None] - e[None, :nocc]
    de_list.append(de.ravel()); w_list.append(m2.ravel())
de = np.concatenate(de_list); w = np.concatenate(w_list)
print('matrix elements', round(time.time()-t, 1), 's  max non-hermiticity', herm_err)
omega = np.linspace(0.01, 1.0, 2000)  # Hartree
eta = 0.1 / HA
g = np.exp(-((omega[:, None] - de[None, :]) / eta)**2 / 2) / (eta * np.sqrt(2*np.pi))
eps2 = 4*np.pi**2 / (Omega * omega**2) * 2.0 / len(kd) * (g * w[None, :]).sum(1)
# Kramers-Kronig (principal value by excluding the singular point)
dw = omega[1] - omega[0]
eps1 = np.ones_like(omega)
for i, wi in enumerate(omega):
    den = omega**2 - wi**2; den[i] = np.inf
    eps1[i] += 2/np.pi * np.sum(omega * eps2 / den) * dw
# eps1(0) directly from the sum rule form: 1 + 8pi/(Omega Nk) sum |p|^2/de^3
eps0 = 1 + 16*np.pi / (Omega * len(kd)) * np.sum(w / de**3)
neff = Omega / (2*np.pi**2) * np.sum(omega * eps2) * dw   # f-sum, partial electrons
E = omega*HA
pk = E[np.argmax(eps2)]
print(json.dumps(dict(nk=nk_opt, nk_tot=len(kd), eps1_0_KK=round(float(eps1[0]), 2), eps1_0_sum=round(float(eps0), 2),
                      eps2_peak_eV=round(float(pk), 2), eps2_max=round(float(eps2.max()), 1), neff_upto27eV=round(float(neff), 2))))
np.savetxt(f'eps_si_{nk_opt}.dat', np.c_[E, eps1, eps2])
