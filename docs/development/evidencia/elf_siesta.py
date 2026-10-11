"""ELF propio a partir de coeficientes de onda (.WFSX) y orbitales atomicos (.ion) de SIESTA, con sisl.
Uso: python3 elf_siesta.py <dir> <label> [npts]  -> imprime estadisticas y guarda <label>.elf.npz (rho, elf, origen/celda en Bohr)"""
import sys; pass  # requiere sisl instalado
import numpy as np, sisl
BOHR = 0.529177210903
d, label = sys.argv[1], sys.argv[2]; n = int(sys.argv[3]) if len(sys.argv) > 3 else 120
g = sisl.get_sile(f"{d}/{label}.fdf").read_geometry()
es = sisl.get_sile(f"{d}/{label}.selected.WFSX").read_eigenstate(); es.parent = g
nel = int(round(g.atoms.q0.sum())); nocc = nel // 2
grid = sisl.Grid([n, n, n], geometry=g, dtype=np.float64)
psi = []
for i in range(nocc):
    gr = sisl.Grid([n, n, n], geometry=g, dtype=np.complex128); es.sub(i).wavefunction(gr)
    psi.append(gr.grid * BOHR ** 1.5)       # A^-3/2 -> Bohr^-3/2
psi = np.array(psi)
L = np.linalg.norm(g.cell[0]) / BOHR; h = L / n
kk = 2 * np.pi * np.fft.fftfreq(n, d=h)
KX, KY, KZ = np.meshgrid(kk, kk, kk, indexing='ij')
def grad(f):
    F = np.fft.fftn(f)
    return [np.real(np.fft.ifftn(1j * K * F)) for K in (KX, KY, KZ)]
rho = 2 * np.sum(np.abs(psi) ** 2, axis=0)
tau = np.zeros_like(rho); gr = [np.zeros_like(rho) for _ in range(3)]
for p in psi:                     # gradiente de rho analitico desde los orbitales (evita el aliasing de derivar rho = psi^2 por FFT)
    gx = [np.fft.ifftn(1j * K * np.fft.fftn(p)) for K in (KX, KY, KZ)]
    tau += sum(np.abs(c) ** 2 for c in gx)
    for a in range(3): gr[a] += 4 * np.real(np.conj(p) * gx[a])
g2 = sum(c ** 2 for c in gr)
rs = np.maximum(rho, 1e-12)
D = tau - g2 / (8 * rs); Dh = 0.3 * (3 * np.pi ** 2) ** (2 / 3) * rs ** (5 / 3)
elf = 1 / (1 + (D / Dh) ** 2)
dV = h ** 3
print(f"{label}: electrones en malla = {rho.sum() * dV:.4f} (esperado {nel}); tau no negativo, D min = {D[rho > 1e-3].min():.3e}")
m = rho > 1e-3
print(f"  ELF min/max sobre rho>1e-3: {elf[m].min():.4f} / {elf[m].max():.4f}")
np.savez(f"{d}/{label}.elf.npz", rho=rho, elf=elf, L=L, pos=g.xyz / BOHR, species=[a.Z for a in g.atoms])
