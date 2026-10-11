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
