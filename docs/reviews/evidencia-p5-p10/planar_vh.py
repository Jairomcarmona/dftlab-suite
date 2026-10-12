"""Promedio planar de una malla binaria de SIESTA 5.4.2 (.VH/.VT) y Φ = V_vacío − E_F.
Uso: python3 planar_vh.py SALIDA.out ARCHIVO.VH [ARCHIVO.VT ...]
Supone a3 perpendicular a (a1, a2), slab simétrico y vacío alrededor de z = 0 (ventana de 2 Å a cada lado)."""
import re, struct, sys
import numpy as np

RY_TO_EV = 13.605693122994
BOHR_TO_ANG = 0.529177210903

def read_grid(path):
    raw = open(path, 'rb').read()
    records, offset = [], 0
    while offset < len(raw):                       # registros Fortran secuenciales
        size = struct.unpack_from('<i', raw, offset)[0]
        records.append(raw[offset + 4:offset + 4 + size])
        offset += 8 + size
    cell = np.frombuffer(records[0], dtype='<f8').reshape(3, 3) * BOHR_TO_ANG
    nx, ny, nz, nspin = np.frombuffer(records[1], dtype='<i4')
    data = np.array([np.frombuffer(r, dtype='<f4') for r in records[2:]]).reshape(nspin, nz, ny, nx)
    return cell, data

out = open(sys.argv[1]).read()
fermi = float(re.findall(r'siesta:\s+Fermi\s*=\s*([-\d.]+)', out)[-1])
print(f'E_F = {fermi:.4f} eV')
for path in sys.argv[2:]:
    cell, data = read_grid(path)
    profile = data[0].mean(axis=(1, 2)) * RY_TO_EV
    z = np.arange(len(profile)) * cell[2, 2] / len(profile)
    window = (z < 2.0) | (z > cell[2, 2] - 2.0)
    vacuum = profile[window].mean()
    print(f'{path}: V_vacío = {vacuum:.4f} eV, dispersión en la ventana = {np.ptp(profile[window]):.4f} eV, '
          f'promedio de celda = {profile.mean():.4f} eV, Φ = {vacuum - fermi:.4f} eV')
