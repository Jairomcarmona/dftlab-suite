"""Particion de Bader en malla (ascenso de maxima pendiente, estilo Henkelman) sobre el .BADER de SIESTA.
Uso: python3 bader_ongrid.py <dir> ; MgO fcc primitivo a=4.21 A, label 'm'. Requiere sisl."""
import sys, itertools, numpy as np
import sisl
d = sys.argv[1]
g = sisl.Grid.read(f"{d}/m.BADER")
rho = g.grid; n = np.array(rho.shape); cell = g.cell; dV = abs(np.linalg.det(cell)) / rho.size
offs = [o for o in itertools.product((-1, 0, 1), repeat=3) if o != (0, 0, 0)]
dist = [np.linalg.norm((np.array(o) / n) @ cell) for o in offs]
flat = rho.ravel(); idx = np.arange(rho.size).reshape(rho.shape)
best = np.full(rho.shape, -1, dtype=np.int64); bestgain = np.zeros(rho.shape)
for o, dd in zip(offs, dist):
    nb = np.roll(rho, shift=tuple(-x for x in o), axis=(0, 1, 2)); nbi = np.roll(idx, shift=tuple(-x for x in o), axis=(0, 1, 2))
    gain = (nb - rho) / dd; m = gain > bestgain
    bestgain = np.where(m, gain, bestgain); best = np.where(m, nbi, best)
nxt = np.where(best < 0, idx, best).ravel()
for _ in range(200):
    nn = nxt[nxt]
    if (nn == nxt).all(): break
    nxt = nn
a0 = 4.21; at = np.array([[0, 0, 0], [.5, .5, .5]]) @ (a0 * np.array([[0, .5, .5], [.5, 0, .5], [.5, .5, 0]]))
Z = [12, 8]; names = ['Mg', 'O']; q = np.zeros(2)
for r in np.unique(nxt):
    pos = (np.array(np.unravel_index(r, rho.shape)) / n) @ cell
    ba, bd = None, 1e9
    for a, p in enumerate(at):
        for sh in itertools.product((-1, 0, 1), repeat=3):
            dd = np.linalg.norm(pos - (p + np.array(sh) @ cell))
            if dd < bd: bd, ba = dd, a
    q[ba] += flat[nxt == r].sum() * dV
print("integral de la malla (e):", rho.sum() * dV)
print("electrones por atomo:", q.round(4)); net = np.array(Z) - q
print("cargas netas:", dict(zip(names, net.round(3))), "suma:", net.sum().round(4))
