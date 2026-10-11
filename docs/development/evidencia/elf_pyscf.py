"""ELF de referencia con PySCF (todos los electrones, PBE/def2-TZVP) en los mismos puntos de malla que elf_siesta.py"""
import sys; pass  # requiere pyscf instalado
import numpy as np
from pyscf import gto, dft
d, label = sys.argv[1], sys.argv[2]
z = np.load(f"{d}/{label}.elf.npz"); L = float(z['L']); n = z['rho'].shape[0]; pos = z['pos']; Zs = z['species']
sym = {1: 'H', 8: 'O'}
mol = gto.M(atom=[(sym[int(a)], tuple(p)) for a, p in zip(Zs, pos)], unit='Bohr', basis='def2-tzvp', verbose=0)
mf = dft.RKS(mol); mf.xc = 'pbe'; mf.grids.level = 5; mf.kernel()
nocc = mol.nelectron // 2; C = mf.mo_coeff[:, :nocc]
x = np.arange(n) * (L / n); X, Y, Zg = np.meshgrid(x, x, x, indexing='ij')
pts = np.stack([X.ravel(), Y.ravel(), Zg.ravel()], axis=1)
rho = np.zeros(len(pts)); tau = np.zeros(len(pts)); gr = np.zeros((len(pts), 3))
for s in range(0, len(pts), 200000):
    ao = mol.eval_gto('GTOval_sph_deriv1', pts[s:s + 200000])      # (4, N, nao)
    psi = ao[0] @ C; dpsi = [ao[k + 1] @ C for k in range(3)]
    rho[s:s + 200000] = 2 * np.sum(psi ** 2, axis=1)
    tau[s:s + 200000] = sum(np.sum(dp ** 2, axis=1) for dp in dpsi)
    for k in range(3): gr[s:s + 200000, k] = 4 * np.sum(psi * dpsi[k], axis=1)
rs = np.maximum(rho, 1e-12)
D = tau - np.sum(gr ** 2, axis=1) / (8 * rs); Dh = 0.3 * (3 * np.pi ** 2) ** (2 / 3) * rs ** (5 / 3)
elf = (1 / (1 + (D / Dh) ** 2)).reshape(n, n, n); rho = rho.reshape(n, n, n)
np.savez(f"{d}/{label}.elf_pyscf.npz", rho=rho, elf=elf)
print(f"PySCF {label}: E={mf.e_tot:.6f} Ha, electrones en malla = {rho.sum() * (L / n) ** 3:.4f}")
