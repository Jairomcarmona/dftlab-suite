#!/usr/bin/env python3
"""Referencia independiente (numpy) para el lector .FC y la matriz dinámica: python3 make_fc_reference.py
Construye la matriz de constantes de fuerza completa de la supercelda (3N×3N) por traslación de las filas
de los átomos desplazados y la diagonaliza en Γ de la supercelda. Sus 3N frecuencias son las de los q
conmensurados de la celda primitiva, que run_fc_tests.mjs compara con physics/phonon.js."""
import json, os, re
import numpy as np
F = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures_fc')
THZ = 15.633302
txt = open(os.path.join(F, 'si_fc.FC')).read().split('\n')
na = int(re.search(r':\s*(\d+)', txt[0]).group(1))
rows = np.array([[float(x) for x in l.split()] for l in txt[1:] if l.strip()])
nd = len(rows) // (6 * na)
blk = rows.reshape(nd, 3, 2, na, 3).mean(axis=2)          # [desplazado, α, j, β]
fdf = open(os.path.join(F, 'si_fc.fdf')).read()
lat = np.array([[float(x) for x in l.split()] for l in re.search(r'%block LatticeVectors\n(.*?)%endblock', fdf, re.S).group(1).strip().split('\n')])
pos = np.array([[float(x) for x in l.split()[:3]] for l in re.search(r'%block AtomicCoordinatesAndAtomicSpecies\n(.*?)%endblock', fdf, re.S).group(1).strip().split('\n')])
n = np.array([2, 2, 2])
g = pos * n; R = np.floor(g + 1e-6); u = g - R
kap = [0 if np.allclose(x, u[0], atol=1e-4) else 1 for x in u]
def find(f):
    f = f % 1.0
    for j, p in enumerate(pos):
        d = (p - f + 0.5) % 1.0 - 0.5
        if np.all(np.abs(d) < 1e-4): return j
    raise RuntimeError(f)
P = np.zeros((3 * na, 3 * na))
for i in range(na):
    src = kap[i]                                           # átomo desplazado 0 (κ=0) o 1 (κ=1), en la celda R=0
    shift = (R[i] - R[src]) / n                            # traslación en fracciones de la supercelda
    for j in range(na):
        jj = find(pos[j] - shift)                          # Φ(i,j) = Φ(src, j − T)
        P[3 * i:3 * i + 3, 3 * j:3 * j + 3] = blk[src, :, jj, :]
for i in range(na):                                        # regla de suma acústica en el término propio
    P[3 * i:3 * i + 3, 3 * i:3 * i + 3] = 0
    P[3 * i:3 * i + 3, 3 * i:3 * i + 3] = -sum(P[3 * i:3 * i + 3, 3 * j:3 * j + 3] for j in range(na) if j != i)
P = (P + P.T) / 2
w2 = np.linalg.eigvalsh(P / 28.085)
nu = np.sign(w2) * np.sqrt(np.abs(w2)) * THZ
json.dump({'nAtoms': na, 'nDisplaced': nd, 'superGammaTHz': sorted(nu.tolist()), 'phi00': blk[0, :, 0, :].tolist(), 'phi01': blk[0, :, 1, :].tolist()},
          open(os.path.join(F, 'reference.json'), 'w'), indent=1)
print('ok', nd, 'desplazados; ν min/max', nu.min(), nu.max())
