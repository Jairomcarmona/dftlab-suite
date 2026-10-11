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
