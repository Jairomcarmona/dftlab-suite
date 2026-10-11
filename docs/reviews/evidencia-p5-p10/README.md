# Evidencia SIESTA 5.4.2 de la auditoría P5–P10

Fecha: 2026-10-11. Entorno: `siesta-env.tar.gz` del proyecto (SIESTA 5.4.2, build conda `nompi_h7e5ea38_1003`), un hilo, Linux x86_64. Pseudos del repositorio (`app/dftlab/data/pseudos/`): `pbe/Si.psml` (sha256 `db2fcab4…`), `pbe/Al.psml` (`c53846ea…`), `lda/Al.psml` (`2c5aa725…`). Son corridas de diagnóstico con bases pequeñas, no valores de referencia física.

## Scripts

- `si_eos_fdf.py F MODO MESHCUTOFF [EXTRA]`: FDF de Si diamante en celda primitiva fcc con volumen `F·(5.43 Å)³/4`. `MODO=frac` usa coordenadas fraccionarias; `MODO=angtrap` escala solo `LatticeConstant` y deja el segundo átomo en Å cartesianos de la referencia.
- `bm3_fit.py PREFIJO…`: BM3 lineal en V^(−2/3) sobre las corridas `PREFIJO_<η>` con volumen `1.075·η·(5.43 Å)³/4`.
- `planar_vh.py SALIDA .VH [.VT]`: promedio planar de la malla binaria y Φ = V_vacío − E_F.
- `al111_n3_vac18.fdf`: lámina de Al(111) de 3 capas (LDA, DZP, 150 Ry, 12×12×1, mezcla Pulay 0.05), tomada de `app/dftlab/static/js/data/potencial.json` con esos tres cambios. La variante de 24 Å solo cambia la tercera fila de `LatticeVectors` a 28.676537.

## Resultados

**Trampa de `LatticeConstant`** (Si, 80 Ry, η = 1.06): con fraccionarias, segundo átomo en 2.61562 Bohr y E = −265.551907 eV; con `angtrap`, 2.56530 Bohr y E = −265.536218 eV.

**Malla y EOS** (Si SZP/PBE, 6×6×6 desplazada, `MeshCutoff 154 Ry`, η = 0.94…1.06):

| η | 0.94 | 0.96 | 0.98 | 1.00 | 1.02 | 1.04 | 1.06 |
|---|---|---|---|---|---|---|---|
| Malla con `MeshCutoff` | 24³ | 24³ | 24³ | 24³ | 30³ | 30³ | 30³ |
| E (eV) con `MeshCutoff` | −265.501801 | −265.526308 | −265.540296 | −265.545223 | −265.543490 | −265.531431 | −265.512639 |
| E (eV) con `Mesh.Sizes [30 30 30]` | −265.505456 | −265.529846 | −265.543516 | −265.548085 | −265.543490 | −265.531431 | −265.512639 |

BM3: con malla variable V0 = 43.1419 Å³, B0 = 79.43 GPa, rms 0.402 meV; con malla fija V0 = 43.0072 Å³, B0 = 79.83 GPa, rms 0.102 meV.

**Etiquetas consultadas** (log `fdf.*.log`): `Mesh.Sizes`/`MeshSizes`, `MD.ConstantVolume` (con `MD.VariableCell`), `Slab.DipoleCorrection` con valores `charge`, `vacuum` y `true`.

**Energía con smearing** (Al fcc, MP orden 1, 0.02 Ry): `Total` −74.079115 eV, `FreeEng` −74.079164 eV, `E_KS(eV)` −74.0791 (4 decimales).

**Φ de Al(111)**, 3 capas:

| Vacío | E_F (eV) | V_vacío de `.VH` (eV) | Promedio de `.VH` en la celda (eV) | Φ (eV) |
|---|---|---|---|---|
| 18 Å | −4.1679 | −0.2755 | −3.3376 | 3.8923 |
| 24 Å | −4.1102 | −0.2179 | −2.6393 | 3.8924 |

`.VT` da el mismo V_vacío que `.VH` en ambos casos. Las dos corridas convergieron (13 y 12 iteraciones).

## Límites

No se ejecutaron `fat`, `macroave`, `vibra` ni `fcbuild`; solo se comprobó que están en el entorno. El caso de superficie es simétrico, neutro y sin corrección dipolar. Las corridas no se suben a Git; se reproducen con estos scripts.
