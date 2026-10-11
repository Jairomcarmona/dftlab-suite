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

## Presets (S-01…S-08)

Mismo entorno, más `vibra` y `denchar` del mismo `siesta-env`. Pseudos `pbe/O.psml` y `pbe/H.psml`. Los FDF de H2O salen de `h2o_box_fdf.py`; los de Si, de `si_eos_fdf.py`. Los extractos de salida y los valores esperados están en [`presets.cases.json`](../../scientific-protocols/vectors/presets.cases.json), generado por `build_presets_cases.py`.

| Corrida | FDF | Resultado |
|---|---|---|
| H2O neutra, cajas 6, 8, 10, 14 y 18 Å, 200 Ry | `h2o_box_fdf.py "L L L" 0 non-polarized 200` | En 6 Å aparece `Folding of H and S implicitly performed`; en 8 Å y más, no |
| H2O⁺ cajas 10, 14, 18 Å | `… 1 polarized 200` | `Emadel` 2.042804, 1.459146 y 1.134891 eV; FreeEng −454.392136, −454.428615 y −454.443693 eV |
| H2O⁺ caja 10×12×14 Å | `"10 12 14" 1 polarized 200` | Aviso `Energy correction terms can not be applied`; `Emadel = 0` |
| H2O⁺ sin spin | `… 1 non-polarized 200` | Corre con 7 electrones y `Spin configuration = none` |
| H2O con malla k 2×2×2 | añade `kgrid.MonkhorstPack` 2×2×2 | 8 puntos k; misma FreeEng que Gamma (−466.851912 eV) |
| H2O relajada a 200 Ry (CG, 0.005 eV/Å) y recalculada a 150…700 Ry | `Mesh.Cutoff` variable | \|ΣF\| (eV/Å): 0.005, 0.0008, 0.092, 0.022, 0.307, 0.0003 para 150, 200, 300, 400, 500, 700 Ry. A 500 Ry no depende de `DM.Tolerance 1e-6`; con `Mesh.Sizes [150 150 150]` da 0.246 |
| FC de H2O | `MD.TypeOfRun FC`, `FC.Displacement 0.02 Ang`, `FC.First 1`, `FC.Last 3` | Sin relajar, a 200 Ry y relajada a 400 y 700 Ry (CG, 0.002 eV/Å). `vibra` exige `AtomicCoordinatesFormat NotScaledCartesianAng` y la masa como quinta columna; con eso, flexión 1731.8, 1555.1 y 1543.7 cm⁻¹ a 200, 400 y 700 Ry. Con proyección de Eckart desde el `.FC`: 1561.4, 1555.6 y 1555.5 cm⁻¹ |
| Si celda variable P=0 desde 5.43 Å | `si_eos_fdf.py` con `MD.VariableCell T`, `MD.TargetPressure 0 GPa`, `MD.MaxStressTol 0.05 GPa`, 154 Ry | Con `MeshCutoff` la malla oscila 24³↔30³ y V = 43.0638 Å³; con `Mesh.Sizes [30 30 30]`, V = 43.0035 Å³ y corte usado de 253 a 241 Ry |
| Restricciones (H2O SZ, 2 pasos CG) | `Geometry.Constraints` | `atom -1` fija el último átomo; `atom [1 -- 2]` y `atom 1 2` fijan los mismos; `atom 2 1. 0. 0.` anula solo F_x del átomo 2 |
| `MD.NumCGSteps` | `MD.NumCGSteps 0` y `2` | 5.4.2 lo usa como valor de `MD.Steps` (0 y 3 pasos CG) |
| Denchar | `WriteDenchar T`, `WriteWaveFunctions T`, `Denchar.TypeOfRun 3D` sobre la caja completa, 60³ | Densidad en electrones/Bohr³; paso (Max − Min)/(N − 1); integral 8.0004 electrones |

## Límites

No se ejecutaron `fat`, `macroave` ni `fcbuild`; solo se comprobó que están en el entorno. `vibra` y `denchar` se ejecutaron para los presets. El caso de superficie es simétrico, neutro y sin corrección dipolar. Las corridas no se suben a Git; se reproducen con estos scripts.
