"""Offset de banda de valencia por potencial electrostatico promedio (SIESTA .VH + .EIG).
Uso: python3 vbo_analysis.py <dir> ; espera bulk_GaAs, bulk_AlAs y sl (superred (001) con n celdas convencionales de cada material)."""
import sys, re; sys.path[:0]=["/tmp/sislenv"]
import numpy as np
import sisl
d = sys.argv[1]; a = 5.653; n = 3
def vbm_vbar(label):
    t = open(f"{d}/{label}.EIG").read().split()
    nb, ns, nk = int(t[1]), int(t[2]), int(t[3]); v = np.array(t[4:], float); i = 0; E = []
    for _ in range(nk):
        i += 1; E.append(v[i:i + nb * ns]); i += nb * ns
    E = np.array(E)
    ne = int(float(re.search(r"Total number of electrons:\s+([\d.]+)", open(f"{d}/{label}.out").read()).group(1)))
    vbm = E[:, ne // 2 - 1].max()
    g = sisl.Grid.read(f"{d}/{label}.VH")
    return vbm, g.grid.mean(), g
res = {}
for m in ("GaAs", "AlAs"):
    vbm, vbar, _ = vbm_vbar(f"bulk_{m}"); res[m] = (vbm, vbar); print(f"{m}: VBM={vbm:.4f} eV, <V>={vbar:.4f} eV, VBM-<V>={vbm - vbar:.4f} eV")
g = sisl.Grid.read(f"{d}/sl.VH"); pz = g.grid.mean(axis=(0, 1)); N = len(pz); L = 2 * n * a; z = np.arange(N) * L / N
# promedio macroscopico: ventana = periodo del cristal en z (a/2) aplicada dos veces
w = max(1, int(round((a / 2) / (L / N))))
def mov(x):
    k = np.ones(w) / w; xp = np.concatenate([x[-w:], x, x[:w]]); return np.convolve(xp, k, 'same')[w:-w]
mac = mov(mov(pz))
mid_Ga = mac[(z > 0.5 * n * a - 0.25 * a) & (z < 0.5 * n * a + 0.25 * a)].mean()
mid_Al = mac[(z > 1.5 * n * a - 0.25 * a) & (z < 1.5 * n * a + 0.25 * a)].mean()
dV = mid_Ga - mid_Al
print(f"superred: <V> macroscopico centro GaAs={mid_Ga:.4f}, centro AlAs={mid_Al:.4f}, dV={dV:.4f} eV")
vbo = (res["GaAs"][0] - res["GaAs"][1]) - (res["AlAs"][0] - res["AlAs"][1]) + dV
print(f"VBO(GaAs - AlAs) = (E_v-<V>)_GaAs - (E_v-<V>)_AlAs + (<V>_GaAs - <V>_AlAs)_SL = {vbo:.3f} eV")
