# Ficha de entrada: presets de corrida simple S-01…S-08 (T-029)

Estado: **lista para aceptar**. Las decisiones están cerradas y probadas con SIESTA 5.4.2; Manuel aprueba la política v1 y los cambios upstream U-Q14…U-Q16. Dueño de los gates: QRAFT ([ADR-018](../adr/ADR-018-autoridad-protocolos-siesta-eos-electronica-superficie.md): QRAFT es la autoridad de los protocolos SIESTA no Hubbard). La plataforma elige el preset, construye el `RunIntent` y presenta. Fuente: [maestro §9.2](../../PROPUESTA_MAESTRA_DFTLAB_V2.md) y [plan T-029](../../PLAN_IMPLEMENTACION_CLAUDE_CODE.md). Evidencia: [corridas de presets](../reviews/evidencia-p5-p10/README.md#presets-s-01s-08).

Esta ficha está escrita para que la implemente quien solo programa: si algo no está aquí, en el oráculo o en los vectores, **se pregunta antes de decidirlo**. No se cambian los valores de la política ni los vectores para que una prueba pase.

## Alcance v1

- SIESTA 5.4.2. Spin `non-polarized` o `polarized` (colineal). `non-colinear` y `spin-orbit` solo por la ruta M8 de QRAFT, que ya exige pseudos totalmente relativistas; los 60 pseudos del repositorio son escalares (`relativity="scalar"`), así que la biblioteca incluida no ofrece SOC.
- Un preset produce **un** cálculo SIESTA más sus gates. El usuario no dibuja un DAG.
- Fonones periódicos no son S-07: son otro protocolo (maestro §9.3).

## Reglas comunes

| # | Regla | Por qué |
|---|---|---|
| P-1 | Cada preset produce un `RunIntent` (`contracts/schemas/run-intent.schema.json`) con `protocol.protocol_id` y `protocol.version` de la tabla de presets, `purpose` `EXPLORATORY` por defecto y `numerical_policy_ref` a `qraft.presets.policy@1-draft`. | Maestro §9.2: «todo preset produce un RunIntent». |
| P-2 | La energía de una corrida es la última `siesta: FreeEng =` (6 decimales), como en [WF-EOS](WF-EOS.md) E-4. | Una sola regla de lectura en toda la plataforma. |
| P-3 | El FDF usa los nombres no obsoletos de 5.4.2: `FC.Displacement`, `FC.First`, `FC.Last` (no `MD.FCDispl`, que 5.4.2 marca «deprecated») y `Charge.Mulliken end` (no `WriteMullikenPop`). Única excepción: S-05 escribe `MD.NumCGSteps 0` porque QRAFT M6 lo exige; 5.4.2 lo traduce a `MD.Steps` (comprobado con 0 y con 2). | El log `fdf.*.log` de 5.4.2 avisa de los nombres obsoletos. |
| P-4 | En toda relajación, la fuerza neta de la última geometría cumple \|ΣF\| < `MD.MaxForceTol`; si no, `NET_FORCE_ABOVE_TOLERANCE`. En S-01 la fuerza neta solo se informa. | Por invariancia traslacional ΣF = 0; lo que queda es error de la malla real. En H2O relajada a 200 Ry, \|ΣF\| fue 0.0008 eV/Å; con la misma geometría a 300, 400 y 500 Ry fue 0.092, 0.022 y 0.307 eV/Å, y a 700 Ry 0.0003 eV/Å. Una fuerza neta mayor que la tolerancia hace que «relajada» no signifique nada. |
| P-5 | Los gates son de QRAFT. Los validadores JS del frontend son vista previa y no emiten un veredicto aceptado. | ADR-018 y maestro §10.1. |
| P-6 | Los defaults del preset entran en el digest del plan y se muestran. Ninguno se presenta como ley universal (`16 Å`, `500 Ry`, Gamma). | Maestro §9.2 y plan T-029. |

## Presets

| ID | Ruta en QRAFT `41043ed` | Qué falta | FDF obligatorio | Gates (códigos) |
|---|---|---|---|---|
| S-01 molécula | M6 estado fundamental con perfil `periodicity: molecule` | **U-Q14**: gates de molécula | Celda cúbica si hay carga; sin bloque k (o `1 0 0 0` ×3 sin desplazamiento); `Spin polarized` si el número de electrones es impar | `SCF_NOT_PROVEN`, `KGRID_NOT_GAMMA`, `BASIS_OVERLAPS_IMAGES`, `CHARGED_CELL_NO_MADELUNG`, `ODD_ELECTRONS_UNPOLARIZED` |
| S-02 bulk, relajación atómica | M5 (CG, Broyden o FIRE, celda fija) | Gate P-4 en **U-Q15** | `MD.TypeOfRun`, `MD.Steps` > 0, `MD.MaxForceTol` explícito, bloque `kgrid.MonkhorstPack` | `SCF_NOT_PROVEN`, `NOT_RELAXED`, `NET_FORCE_ABOVE_TOLERANCE` |
| S-03 bulk, celda variable P=0 | Ninguna: M5 rechaza `MD.VariableCell` | **U-Q15**: protocolo de celda variable | Lo de S-02 más `MD.VariableCell T`, `MD.TargetPressure 0 GPa`, `MD.MaxStressTol` y `Mesh.Sizes` (regla V-1) | Los de S-02 más `MESH_CHANGED_DURING_RELAXATION`, `MESH_CUTOFF_BELOW_REQUEST` y `SYMMETRY_CHANGED` (revisión) |
| S-04 slab con restricciones | M5 | Gate P-4 en U-Q15; constructor y restricciones de T-028 (G-05, G-06) | Lo de S-02 más `Geometry.Constraints` según la regla R-1 | Los de S-02 |
| S-05 single point | M6 estado fundamental | Nada | `MD.TypeOfRun CG`, `MD.NumCGSteps 0`, sin `MD.Steps` distinto de 0 | `SCF_NOT_PROVEN` |
| S-06 densidad, potencial y Denchar | M6 más utilidad `denchar` | Utilidad en el lock del worker (T-042) | Lo de S-05 más las salidas pedidas (regla D-1) | `SCF_NOT_PROVEN`, archivos requeridos presentes |
| S-07 vibración molecular FC | Ninguna | **U-Q16**: protocolo FC y análisis armónico | Geometría relajada con el mismo modelo, `MD.TypeOfRun FC`, `FC.Displacement`, `FC.First 1`, `FC.Last N` | `SCF_NOT_PROVEN`, `ATOM_MAP_MISMATCH`, `GEOMETRY_NOT_RELAXED`, `IMAGINARY_VIBRATION` (revisión) |
| S-08 spin y carga | M8 selección magnética y `validate_magnetic_input` | Nada para colineal | Spin declarado; `DM.InitSpin` completo si es polarizado; SOC solo con pseudos totalmente relativistas | Los de M8; en molécula, también los de S-01 |

`protocol_id` de cada preset: `qraft.preset.<id en minúsculas>@1` (por ejemplo `qraft.preset.s-01@1`). Mientras su ruta no exista en QRAFT, el catálogo lo muestra como `DESIGNED`, no como ejecutable calificado.

## S-01: molécula aislada

| # | Decisión | Evidencia |
|---|---|---|
| M-1 | Solo Gamma. Un bloque k distinto de 1×1×1 sin desplazamiento da `KGRID_NOT_GAMMA`. | H2O en 10 Å con 2×2×2: 8 puntos k y la misma energía que en Gamma (−466.851912 eV), con 8 veces el coste. El generador actual (`fdfgen.js`) no tiene modo molécula: para una caja de 10 Å y `kspacing 0.2` produce 4×4×4 desplazada 0.5, que ni siquiera contiene Gamma. |
| M-2 | La base no debe alcanzar a ninguna imagen. Después de correr, la línea `Folding of H and S implicitly performed` da `BASIS_OVERLAPS_IMAGES`. Antes de correr, `imageInteraction` estima lo mismo con los radios de la base (rc máximo de orbital y de proyector KB por especie, en Bohr, de los `.ion` o de la salida); sin radios, el resultado previo es `NOT_CHECKED`. | H2O DZP (rc O 4.30, H 5.23 Bohr): en 6 Å SIESTA pliega H y S; en 8 y 10 Å no. `imageInteraction` predice lo mismo en los tres casos. |
| M-3 | Con carga neta, la celda debe ser SC, FCC o BCC. SIESTA suma entonces `Emadel` (corrección monopolar). Si avisa `Energy correction terms can not be applied`, `CHARGED_CELL_NO_MADELUNG`. | H2O⁺ en cajas cúbicas de 10, 14 y 18 Å: `Emadel` = 14.399645·q²·2.8372975/(2a) con error < 1 µeV. En caja 10×12×14 Å, `Emadel = 0` y el aviso aparece. |
| M-4 | Número impar de electrones con `Spin non-polarized` da `ODD_ELECTRONS_UNPOLARIZED`. | H2O⁺ sin spin corre sin queja con 7 electrones y ocupación fraccionaria. |
| M-5 | La convergencia respecto a la caja es una etapa enlazada del protocolo de convergencia existente, no un número fijo. La corrección de Madelung solo quita el monopolo. | Con Madelung, H2O⁺ cambia 36.5 meV de 10 a 14 Å y 15.1 meV de 14 a 18 Å; neutra, 3.0 y 0.8 meV. |
| M-6 | El renderizador no escribe `Slab.DipoleCorrection` en S-01: es para slabs (WF-SURFACE). | — |
| M-7 | El resultado incluye `net_force_eV_A` (\|ΣF\| de la última geometría) como diagnóstico, sin gate. | P-4. |

## S-02 y S-04: relajación a celda fija

- Ruta M5 sin cambios de entrada. U-Q15 añade `NOT_RELAXED` (sin `outcoor: Relaxed`) y P-4 a M5.
- **R-1, restricciones.** `Geometry.Constraints` se escribe con una línea `atom i` por átomo fijo, con `i` positivo en el orden de `AtomicCoordinatesAndAtomicSpecies`, sin rangos ni índices negativos. Una restricción de dirección se escribe `atom i x y z`. Comprobado en 5.4.2: `atom -1` fija el **último** átomo, así que un índice negativo depende del orden de la geometría; `atom [1 -- 2]` y `atom 1 2` fijan los mismos átomos; `atom 2 1. 0. 0.` anula solo la componente x de la fuerza del átomo 2. El constructor de slabs (G-05) y las restricciones (G-06) son de [T-028](../../PLAN_IMPLEMENTACION_CLAUDE_CODE.md).
- La salida informa `Max … constrained`: la convergencia de M5 usa ese valor, porque las fuerzas de átomos fijos no se anulan.
- En celdas hexagonales, el preset usa malla k sin desplazamiento en los ejes del plano hexagonal: un desplazamiento 0.5 rompe la simetría de 6 órdenes de la malla. Es un default del renderizador, no un gate, y no se probó con SIESTA en esta auditoría.

## S-03: celda variable a P=0 (U-Q15)

| # | Decisión | Evidencia |
|---|---|---|
| V-1 | El FDF lleva `Mesh.Sizes` igual a la malla que SIESTA elige para la celda inicial (`InitMesh: MESH =`). Más de una malla distinta en la salida da `MESH_CHANGED_DURING_RELAXATION`. | Si SZP/PBE desde 5.43 Å con `MeshCutoff 154 Ry`: la malla oscila 24³↔30³ entre pasos de CG y el volumen final es 43.064 Å³. Con `Mesh.Sizes [30 30 30]` queda en 43.0035 Å³, a 0.009 % del V0 de la EOS con la misma malla (43.0072 Å³). |
| V-2 | Si la celda crece, el corte efectivo baja. Si el mínimo de `Mesh cutoff (required, used)` queda por debajo del pedido, `MESH_CUTOFF_BELOW_REQUEST`: se encadena una etapa nueva con `Mesh.Sizes` recalculado sobre la celda final, nunca se edita la anterior. | En la corrida con malla fija el corte usado bajó de 253 a 241 Ry (pedido 154). |
| V-3 | `MD.TargetPressure` y `MD.MaxStressTol` explícitos. | El default de presión existe, pero no se ve en el FDF. |
| V-4 | Se compara el grupo espacial inicial y final con G-02 (Moyo) y el `symprec` de la política. Si cambia, `SYMMETRY_CHANGED` en revisión: puede ser una transición real o ruido de la malla. | En Si, la celda final tiene componentes fuera de la forma fcc de −0.004 Å y los átomos se movieron 1.8·10⁻⁴ en fraccionarias, sin que la simetría lo permita. |

## S-05: single point

M6 sin cambios. El FDF lleva `MD.TypeOfRun CG` y `MD.NumCGSteps 0` (requisito de QRAFT M6) y no lleva `MD.Steps` distinto de 0. Energía por P-2; `SCF_NOT_PROVEN` si falta `SCF cycle converged` o `Job completed`.

## S-06: densidad, potencial y Denchar

- **D-1.** Cada salida se pide con su opción y se exige como archivo: `SaveRho T` → `.RHO`; `SaveElectrostaticPotential T` → `.VH`; `WriteDenchar T` y `WriteWaveFunctions T` → `.PLD`, `.DIM` y `.WFSX` para `denchar`. Si falta un archivo pedido, el resultado no se marca completo.
- **D-2.** `denchar` viene del mismo entorno que `siesta` y entra en el lock (T-042). Escribe la densidad en electrones/Bohr³ (lo dice su salida).
- **D-3.** La malla de `denchar` incluye los dos extremos: el paso es (Max − Min)/(N − 1). Al integrar sobre una celda periódica completa hay que quitar el último plano de cada eje, o se cuenta dos veces. En H2O (caja de 10 Å, 60³ puntos, bordes en vacío) la integral da 8.0004 electrones.
- **D-4.** El coste se muestra antes de correr: puntos de la malla real de la referencia y número de estados pedidos.

## S-07: vibración molecular (U-Q16)

| # | Decisión | Evidencia |
|---|---|---|
| F-1 | Parte de una geometría relajada con el **mismo** modelo (base, pseudos, XC, malla, k). El primer bloque de fuerzas de la corrida FC (geometría sin desplazar) debe tener `Max` ≤ `max_reference_force_eV_A`; si no, `GEOMETRY_NOT_RELAXED`. | H2O sin relajar (Max 2.3 eV/Å): flexión 1431 cm⁻¹ y tensiones 4065 y 4231 cm⁻¹. Relajada: 1556, 3578 y 3738 cm⁻¹. Una geometría relajada a 200 Ry tiene fuerzas de 0.29 eV/Å a 500 Ry. |
| F-2 | `FC.Displacement 0.02 Ang`, `FC.First 1`, `FC.Last N` (todos los átomos salvo que el intent declare un subconjunto). | Default de 5.4.2: 0.04 Bohr = 0.021 Å. |
| F-3 | Las frecuencias se calculan desde `<SystemLabel>.FC`, no con `vibra`: diferencia central (promedio de los dos signos), matriz simetrizada, ponderada por masas, **proyección de Eckart** de traslaciones y rotaciones (6 modos, 5 si es lineal, detectados por rango) y diagonalización en el complemento. Funciones: `parseFC` y `harmonicModes`. | Orden del archivo comprobado contra las fuerzas de la salida (átomo i, dirección, signo −/+, átomo j, componente). Flexión de H2O con `vibra` a 200, 400 y 700 Ry: 1731.8, 1555.1 y 1543.7 cm⁻¹. Con proyección: 1561.4, 1555.6 y 1555.5 cm⁻¹. La malla real mete rotaciones espurias de 200–440 cm⁻¹ que `vibra` mezcla con la flexión. |
| F-4 | Las masas son las del intent: masas atómicas estándar de una tabla fijada, o isótopos declarados. No se toman del pseudo. | `vibra` no lee las masas del FDF de SIESTA: exige una quinta columna en las coordenadas. |
| F-5 | El resultado informa, como diagnóstico, el número de modos rígidos, el mayor \|ω\| de los modos rígidos sin proyectar y la violación de la regla de suma acústica (máximo \|Σⱼ K\|, eV/Å²). | A 200 Ry: 443 cm⁻¹ y 13.2 eV/Å²; a 400 Ry: 201 cm⁻¹ y 2.4 eV/Å². |
| F-6 | Una frecuencia vibracional negativa tras proyectar da `IMAGINARY_VIBRATION` en revisión: punto de silla o geometría no convergida. | — |
| F-7 | La convergencia de las frecuencias con la malla es una etapa enlazada del protocolo de convergencia. | De 200 a 400 Ry la flexión cambia 5.8 cm⁻¹; de 400 a 700 Ry, 0.1 cm⁻¹. |

## S-08: spin y carga

Ruta M8 de QRAFT sin cambios: `validate_magnetic_input` acepta solo declaraciones magnéticas completas y exige evidencia de pseudo relativista para SOC. En una molécula se aplican además M-3 y M-4. Un sistema periódico con carga neta ya da `PERIODIC_NET_CHARGE_REVIEW` en el validador de QRAFT; el preset lo muestra tal cual.

## Política v1 propuesta (`qraft.presets.policy@1-draft`, aprueba Manuel)

| Campo | Valor | Razón |
|---|---|---|
| `max_reference_force_eV_A` | 0.01 | H2O relajada con tolerancias de 0.005 y 0.002 eV/Å dio Max entre 0.0006 y 0.0034 eV/Å al iniciar FC; sin relajar, 2.3 eV/Å |
| `fc_displacement_A` | 0.02 | F-2 |
| `symprec_A` | el de G-02 (T-028) | V-4; se fija con la ficha de T-028 |

Ningún otro gate de esta ficha tiene umbral: se decide con líneas de la salida o con las tolerancias que el propio FDF declara.

## Vectores

[`vectors/presets.cases.json`](vectors/presets.cases.json) contiene 26 casos: 4 de imagen periódica (agua en 6, 8 y 10 Å y una caja oblicua sintética), 2 de lectura de salida, 3 de Madelung, 8 de molécula, 4 de relajación y 5 de vibración (cuatro reales y una diatómica sintética con ω = √(k/μ)). Cada caso lleva un extracto de la salida real (las líneas que usan los gates). Los valores esperados se calcularon con numpy, independientes del [oráculo](vectors/presets-oracle.mjs) (`vectors/build/build_presets_cases.py`). `node scripts/check-protocol-vectors.mjs` comprueba que concuerdan y corre en `scripts/verify.mjs`.

## Implementación, en este orden

1. **Plataforma (puede empezar ya).** Registro de presets con `protocol_id`, defaults (P-6) y renderizado FDF según esta ficha; `RunIntent` por preset. S-02, S-04, S-05, S-06 y S-08 tienen ruta en QRAFT; S-01, S-03 y S-07 quedan `DESIGNED` hasta U-Q14…U-Q16. Prueba: el FDF de cada preset pasa el validador de QRAFT `41043ed` (T-030) y, para molécula, no contiene bloque k distinto de Gamma.
2. **QRAFT U-Q14** (gates de molécula, M-1…M-4), **U-Q15** (P-4 y `NOT_RELAXED` en M5; protocolo de celda variable V-1…V-4) y **U-Q16** (FC y análisis armónico F-1…F-6). Cada uno porta su parte de `presets.cases.json` como fixture y debe pasarla sin cambiar valores ni tolerancias.
3. **Plataforma.** Subir el pin de QRAFT y quitar `DESIGNED` de cada preset cuyo cambio upstream entró.

## Decisiones pendientes de Manuel

1. Aprobar la política v1.
2. Aceptar U-Q14…U-Q16 en el inventario de QRAFT y su orden respecto de U-Q10…U-Q13 (todos después de U-Q9).
