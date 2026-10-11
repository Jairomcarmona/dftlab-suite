# Evidencia empírica: opciones y salidas de SIESTA 5.4.2

Fecha: 2026-10-11. Entorno: `siesta-env.tar.gz` empaquetado (SIESTA 5.4.2, nompi). Sistema de prueba: H2 en caja de 12 Å, SZ, 100 Ry.
Método: SIESTA acepta en silencio etiquetas desconocidas, así que «no falló» no prueba nada. Se usó el log `fdf.*.log`, que lista cada etiqueta que el código **consultó**, más los archivos que aparecen. Una etiqueta ausente del log no existe en 5.4.2.

## Etiquetas

| Etiqueta del fdf | Resultado en 5.4.2 |
|---|---|
| `Slab.DipoleCorrection`, `SaveBaderCharge`, `SaveRho`, `SaveDeltaRho`, `SaveElectrostaticPotential`, `SaveTotalPotential`, `SaveTotalCharge`, `COOP.Write`, `WriteEigenvalues`, `WriteWaveFunctions`, `OpticalCalculation`, `DFTD3`, `DFTU.*` | consultadas (existen) |
| `ProjectedDensityOfStates`, `LocalDensityOfStates` (bloques) | consultadas; generan `.PDOS.KP` y `.LDOS.KP` |
| `MD.FCfirst/FClast/FCDispl` | consultadas pero **marcadas como deprecated** en el log; produjo `.FC` |
| `WriteMullikenPop`, `WriteHirshfeldPop`, `WriteVoronoiPop` | deprecated; nombres nuevos `Charge.Mulliken`, `Charge.Hirshfeld`, `Charge.Voronoi` |
| `DipoleCorrection`, `GridCellSampling`, `SavePsi`, `Write.DOS` | **no consultadas: no existen** |

## Archivos producidos

`.HSX .DM .EIG .KP .FA .FC .XV .ORB_INDX .BONDS`, `.RHO .DRHO .VH .VT`, `.BADER` y los `*.grid.nc` (Rho, DeltaRho, TotalCharge, TotalPotential, ElectrostaticPotential, BaderCharge). En `.out`: poblaciones Hirshfeld y Voronoi, y «Bader Analysis core-charge setup».

## Átomos fantasma (DL-01)

Un átomo con Z negativo en `ChemicalSpeciesLabel` (`2 -1 H_ghost`) se acepta: SIESTA lo reporta «floating PAOs», genera su `.ion` y la corrida termina con código 0. La base BSSE por contrapeso es viable. Falta comparar energías contra la referencia analítica.

## Pendiente (sigue abierto en `backlog_gates.json`)

- No apareció `.PDOS` ni `.LDOS` completos en la corrida FC corta; hay que repetirlo con corrida SCF normal.
- No se verificó numéricamente la referencia de `.VH/.VT` frente a la energía de Fermi (DL-02) ni que la suma de `.contrib.EPSIMG` reproduzca ε2 (DL-08).
- Falta el manual oficial: el entorno no lo trae. Todo lo anterior es evidencia de comportamiento, no cita del manual.

## Contraste con el manual (siesta-5.4.2.pdf, aportado por Manuel)

- Átomos fantasma: confirmados (Z negativo; orbitales fuera de sitio «para la corrección de contrapeso»). La corrida da 1.0 electrones = carga iónica 1.0 con un H real y un fantasma. DL-01 pasa a RESUELTA.
- `Slab.DipoleCorrection ?|true|false|charge|vacuum|none`; no usar con `NetCharge`.
- `SaveBaderCharge`: densidad de valencia más núcleos modelo gaussianos (radio 1.0 Bohr, H 0.6), archivo `.BADER`, post-proceso con `Util/grid2cube`; el manual aconseja MeshCutoff 300-500 Ry. Falta comprobar que las cargas de Bader suman cero (DL-03 sigue abierta).
- `.VH` = Hartree + pseudopotencial local; `.VT` = local + Hartree + Vxc. El manual no dice cuál es la referencia respecto de Fermi (DL-02 abierta).
- `BornCharge` + `PolarizationGrids` existen (escribe `.BC`); la parte iónica LO-TO está en Vibra, no distribuido con SIESTA. DL-05 sigue abierta.
- `.EPSIMG` está documentado (`Optical.*`: Broaden, Scissor, NumberOfBands, Mesh, PolarizationType); `.contrib.EPSIMG` no aparece en el manual. DL-08 sigue abierta.

## Tests numéricos (DL-02 y DL-08)

**DL-02, función de trabajo de Al(111).** Esto ya estaba hecho en el módulo Aprender 10 (`views/potential.js`, `data/potencial.json`, corridas `wf.tar.gz`: LDA, DZP, Al(111) 5 capas Φ = 4.09 eV, 9 capas con EnergyShift 5 meV 4.26 eV, experimento 4.24–4.26 eV). Lo siguiente es una réplica independiente hecha en esta sesión sin haberlo visto antes. Slab de 5 capas, a = 4.05 Å, celda de 40 Å, PBE, base SZP, MeshCutoff 150 Ry, k 8x8x1, `SaveElectrostaticPotential`. La primera corrida con DZP y mezcla por defecto divergió (carga bailando en el slab); se resolvió con `SCF.Mixer.Method Pulay`, `Weight 0.05`, `History 8`. Resultado: promedio planar de `.VH` en el vacío −0.0853 eV, Fermi del `.out` −4.2616 eV, Φ = 4.176 eV. Experimento ≈ 4.25 eV; tolerancia declarada antes de correr ±0.3 eV; diferencia 0.07 eV. Conclusión: `.VH` y el Fermi del `.out` están en el mismo marco. Para leer `.VH`: `sisl.Grid.read`, eje z, unidades eV.

**DL-08, `.contrib.EPSIMG`.** No había resultados previos: ni los `*.tar.gz` de corridas ni los fixtures del repo contienen un `.contrib.EPSIMG`, y los tests solo cubren el parser. Si diamante, `OpticalCalculation`, `polycrystal`. El archivo trae un bloque por polarización (`ipol` 1, 2, 3) y cada uno aporta 1/3 de ε2: **hay que sumar las tres**, no una. Suma de las tres contra `.EPSIMG`: error máximo / pico = 2.3e-5 (DZP, k 8) y 1.3e-5 (SZP, k 6, ensanche 0.2 eV; tolerancia 1e-3 declarada antes de esta segunda corrida). Hasta 0.6 % relativo en bordes muy débiles del espectro.

Nota para el parser del repo: `parseContribEPSIMG` debe agrupar por `ipol` y, en polycrystal, sumar las tres para recuperar ε2.

## Segunda ronda de validación (DL-03, 05, 07, 13, 14, 15)

Los scripts de análisis están en `docs/development/evidencia/`. Cada criterio se declaró antes de correr, salvo donde se indica «no declarado antes». Detalle numérico en el campo `evidencia` de cada duda en `backlog_gates.json`.

| Duda | Resultado |
|---|---|
| DL-13 | Manual y corridas: PBE, `DFTD3`, `DRSLL` y `VV` funcionan; `SCAN` aborta (`Unknown author`). Sin GW, BSE ni híbridos. |
| DL-03 | MgO, `SaveBaderCharge`, 400 Ry: integral 20.0001 e, suma de cargas netas −0.0001, Mg +1.719. Partición propia en malla. |
| DL-05 | GaAs, `BornCharge`: Z*(Ga) = 2.208 (exp 2.16), suma acústica 0.0045. ω_TO 293 cm⁻¹ (exp 269) y ε_ion 1.72 (≈2.0) no declarados antes. |
| DL-07 | `kramersKronig` del repo sobre oscilador de Lorentz: error de ε₁ −0.42 % a 8 eV, −0.10 % a 12 eV, −0.02 % a 20 eV. |
| DL-14 | H2 contra NIST-JANAF: S dentro de 0.4 J/mol/K, H(T)−H(0) dentro de 0.14 kJ/mol. La frecuencia armónica sale 6.9 % baja (criterio de ±5 % **no cumplido**). |
| DL-15 | GaAs/AlAs (001), potencial promedio: VBO = 0.574 eV (rango declarado 0.35 a 0.65; exp ≈ 0.53). |

No se pudo probar DL-06 (Pyodide): el proxy bloquea `cdn.jsdelivr.net`. DL-04 (ELF propio) no se intentó.

## DL-06, ASE en Pyodide

Pyodide 0.27.7 y ASE 3.29.0 funcionan juntos: bulk Si, slab Al(111) y escritura de extxyz y cif, con numpy, scipy y matplotlib de la distribución de Pyodide. Carga en frío 12.8 s en Node y 13.3 s en Chromium headless con servidor local, unos 40 MB de archivos. El proxy de este entorno bloquea `cdn.jsdelivr.net` y `unpkg.com`, pero `git clone`, `npm pack` y el tarball de `github.com/pyodide/pyodide/releases` sí funcionan. Scripts en `docs/development/evidencia/pyodide_ase_*`. No se probó pymatgen ni calculadores.
