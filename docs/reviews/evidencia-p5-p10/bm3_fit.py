"""BM3 por mínimos cuadrados lineales en x = V^(-2/3). Uso: python3 bm3_fit.py PREFIJO [PREFIJO...]
Lee PREFIJO_<eta>/out (corridas de si_eos_fdf.py con factor de volumen 1.075*eta) y la energía de 'siesta:         Total ='."""
import glob, sys
import numpy as np

V_REF = 5.43**3 / 4 * 1.075          # Å^3, celda primitiva fcc
EV_A3_TO_GPA = 160.21766208

def load(prefix):
    rows = []
    for d in sorted(glob.glob(prefix + '_*')):
        eta = float(d.rsplit('_', 1)[1])
        energy = [l for l in open(d + '/out') if 'siesta:         Total =' in l][-1].split()[-1]
        rows.append((V_REF * eta, float(energy)))
    return np.array(rows)

def bm3(table):
    V, E = table[:, 0], table[:, 1]
    p = np.poly1d(np.polyfit(V**(-2 / 3), E, 3))
    x0 = [z.real for z in p.deriv().r if abs(z.imag) < 1e-12 and z.real > 0 and p.deriv(2)(z.real) > 0][0]
    V0 = x0**-1.5
    B0 = V0 * p.deriv(2)(x0) * (4 / 9) * V0**(-10 / 3) * EV_A3_TO_GPA   # E'(x0)=0
    rms = np.sqrt(np.mean((E - p(V**(-2 / 3)))**2)) * 1000
    return V0, B0, rms

for prefix in sys.argv[1:]:
    V0, B0, rms = bm3(load(prefix))
    print(f'{prefix}: V0={V0:.4f} Å^3  B0={B0:.2f} GPa  rms={rms:.3f} meV')
