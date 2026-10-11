# Ficha de entrada: WF-EOS (T-035)

Estado: **lista para aceptar**. Las decisiones científicas están cerradas y la política v1 está propuesta; Manuel aprueba sus valores (ADR-009). Dueño: QRAFT ([ADR-018](../adr/ADR-018-autoridad-protocolos-siesta-eos-electronica-superficie.md)). Fuente: [maestro §11.1](../../PROPUESTA_MAESTRA_DFTLAB_V2.md). Evidencia: [auditoría P5–P10](../reviews/2026-10-11-auditoria-p5-p10.md#evidencia-siesta-542).

Esta ficha está escrita para que la implemente quien solo programa: si algo no está aquí, en el oráculo o en los vectores, **se pregunta antes de decidirlo**. No se cambian los valores de la política ni los vectores para que una prueba pase.

## Alcance v1

- SIESTA 5.4.2, cálculo **no polarizado en spin** (`Spin non-polarized` o ausente). Un input con spin se rechaza con `SPIN_POLARIZED_UNSUPPORTED_V1`.
- Modos de relajación por volumen: `fixed-fractional` e `internal`. El modo `shape` (volumen constante, `MD.VariableCell` + `MD.ConstantVolume`) queda para v2 con ficha propia.
- Una referencia, una lista de volúmenes, un ajuste BM3.

## Decisiones

| # | Decisión | Por qué |
|---|---|---|
| E-1 | Cada volumen es una **geometría nueva**: celda `s·A` con `s = f^(1/3)`, `f = V/Vref`, y coordenadas cartesianas `s·r` (las fraccionarias no cambian). Atom map 1:1 con el mismo `id` y especie en el mismo orden. No es una variante del escalar `LatticeConstant`. Función de referencia: `deform` y `checkDeformation` del oráculo. | QRAFT guarda la geometría en Å cartesianos con `LatticeConstant 1 Ang` ([`ground_state.py`](https://github.com/Jairomcarmona/siestaflow/blob/41043edcabef39026fe3cb6b7776362695faf9c6/src/qraft/engines/siesta/ground_state.py#L55)). Con coordenadas `Ang`, SIESTA escala la celda pero no los átomos: en Si a 1.06 V el segundo átomo quedó en 2.5653 Bohr en vez de 2.6156 y la energía cambió 15.7 meV. |
| E-2 | Todos los puntos usan **la misma malla real**: el FDF de cada punto lleva `Mesh.Sizes [n1 n2 n3]` igual a la malla que SIESTA eligió para la referencia (`InitMesh: MESH =` de su salida). Después se comprueba `InitMesh: MESH` de cada punto; si difiere, la tabla se rechaza con `MESH_INCONSISTENT`. | Con `MeshCutoff` fijo la malla salta (24³ → 30³ en Si a 154 Ry dentro de ±6 %). V0 se movió 0.31 %, el residuo se cuadruplicó y B0′ cayó de 4.40 a 1.57. |
| E-3 | La k-grid es el mismo bloque `kgrid.MonkhorstPack` en todos los puntos. `kgrid.Cutoff` da `KGRID_NOT_FIXED`; bloques distintos dan `KGRID_INCONSISTENT`. | `kgrid.Cutoff` cambia el número de puntos con el volumen. |
| E-4 | La energía de cada punto es `free_energy`: el valor de la **última** línea `siesta: FreeEng =` de la salida, con 6 decimales. `total_energy` (última `siesta:         Total =`) existe solo como cantidad alternativa declarada. Nunca se usa `siesta: E_KS(eV) =` (4 decimales). La salida debe contener `SCF cycle converged` y `Job completed`; si no, `SCF_NOT_PROVEN`. Función: `finalEnergy`. | En Al con Methfessel–Paxton, `Total` (−74.079115) y `FreeEng` (−74.079164) difieren. QRAFT tiene hoy dos lectores con cantidades distintas: `scientific_observations.py` lee `E_KS(eV)` y `output_parser.py` lee `Total`. |
| E-5 | El modo de relajación es el de la política, igual en todos los puntos (`RELAXATION_MODE_MISMATCH` si no). En `internal`, cada punto relaja posiciones a celda fija (`MD.VariableCell false`) y su grupo espacial final debe ser el de la referencia (`BRANCH_CHANGED` si no), con la tolerancia `symprec` que la política debe declarar para usar ese modo (la v1 no lo usa). | En celdas no cúbicas sin relajar la forma, B0 sale sesgado; v1 lo acepta como aproximación declarada y v2 añade `shape`. |
| E-6 | `Vref` sale de una relajación P=0 del **mismo** modelo (base, pseudos, XC, malla, k). El resultado informa V0/Vref; no exige que coincidan. | En Si SZP/PBE el mínimo quedó en ≈1.075·V(5.43 Å): centrar en el valor experimental deja el mínimo fuera (vector `eos-table-03`). |
| E-7 | Ajuste BM3: E es un polinomio cúbico en `x = V^(−2/3)`. Se ajusta por mínimos cuadrados lineales en `t = (x − media(x)) / desv(x)` (desviación poblacional). V0 es la raíz de dE/dt con d²E/dt² > 0. B0 = V0·E''(V0) en GPa (× 160.21766208) y B0′ = −1 − V0·E'''(V0)/E''(V0). Función: `fitBM3`. | Sin semilla ni optimizador no lineal. Ajustar en `x` crudo está mal condicionado (x varía < 5 %). |
| E-8 | Veredicto en este orden, con los códigos tal cual: admisibilidad (`REJECTED`), luego ajuste (`NOT_ESTABLISHED`) o `ESTABLISHED`. Función: `evaluate`. | Un ajuste que no pasa no da un número sin aviso. |
| E-9 | Ampliar el rango crea una etapa nueva enlazada con su propio lock; nunca muta el anterior. | §11.1 y ADR-005. |

## Veredicto (E-8)

1. **Admisibilidad.** Si falla alguna, `status = REJECTED`, sin ajuste. Razones en este orden: `ENERGY_QUANTITY_MISMATCH`, `TOO_FEW_POINTS`, `KGRID_NOT_FIXED` o `KGRID_INCONSISTENT`, `MESH_INCONSISTENT`, `RELAXATION_MODE_MISMATCH`. (`SPIN_POLARIZED_UNSUPPORTED_V1`, `BRANCH_CHANGED` y `SCF_NOT_PROVEN` se detectan antes, al construir la tabla.)
2. **Ajuste.** Sin mínimo: `NOT_ESTABLISHED` con `NO_MINIMUM`. Con mínimo, se acumulan en este orden:
   - `MINIMUM_OUTSIDE_RANGE`: V0 ≤ V mínimo o ≥ V máximo;
   - si no, `MINIMUM_NOT_BRACKETED`: menos de `min_points_each_side` volúmenes a un lado de V0;
   - `RESIDUAL_TOO_LARGE`: rms/átomo > `max_rms_meV_per_atom`;
   - sensibilidad: se repite el ajuste sin el volumen menor y sin el mayor; `V0_SENSITIVE` si el máximo |ΔV0|/V0 supera `max_rel_dV0`, y `B0_SENSITIVE` si |ΔB0|/B0 supera `max_rel_dB0`.
3. Sin razones: `ESTABLISHED`.

## Resultado

`status`, `reasons` (lista ordenada), `fit` {`E0_eV`, `V0_A3`, `B0_GPa`, `B0_prime`, `rms_meV`} por celda, `sensitivity` {`max_rel_dV0`, `max_rel_dB0`}, `per_atom` {`V0_A3`, `E0_eV`}, `n_atoms`, `quantity`, `policy_id` y la tabla de puntos (`volume_factor`, `volume_A3`, `energy_eV`, `mesh`, `kgrid`, `relaxation_mode`, hash del stdout). Autoridad nativa `PROVISIONAL`. Un `NOT_ESTABLISHED` conserva el ajuste para inspección, pero no se presenta como resultado.

## Política v1 propuesta (`qraft.eos.policy@1-draft`, aprueba Manuel)

| Campo | Valor | Razón |
|---|---|---|
| `volume_factors` | 0.94, 0.96, 0.98, 1.00, 1.02, 1.04, 1.06 | §11.1 del maestro |
| `energy_quantity` | `free_energy` | E-4 |
| `relaxation_mode` | `fixed-fractional` | Lo único probado en esta auditoría |
| `min_points` | 7 | Coincide con la lista |
| `min_points_each_side` | 2 | Una parábola local necesita al menos dos por lado |
| `max_rms_meV_per_atom` | 0.5 | Si con malla fija da 0.05; un error de 4 meV en un punto da 0.57 |
| `max_rel_dV0` | 0.005 | Si con malla fija da 1.0·10⁻⁴ |
| `max_rel_dB0` | 0.05 | Si con malla fija da 0.008; el punto con +4 meV da 0.068 |

## Vectores

[`vectors/wf-eos.cases.json`](vectors/wf-eos.cases.json) contiene 20 casos: 5 de geometría (incluida la trampa de `LatticeConstant` y una celda hexagonal), 5 de lectura de energía y 10 de tabla (Si real con malla fija y variable, mínimo fuera, k-grid, cantidad, pocos puntos, modos mezclados, BM3 sintético exacto, mínimo sin puntos a un lado, punto con error). Los valores esperados se calcularon con numpy, independientes del [oráculo](vectors/eos-oracle.mjs). `node scripts/check-protocol-vectors.mjs` comprueba que concuerdan; corre en `scripts/verify.mjs`.

## Implementación en QRAFT (U-Q10, U-Q11)

Siguiendo el patrón de los protocolos existentes, sin decidir nada nuevo:

1. **U-Q10, geometrías y fan-out.** Construir un protocolo de EOS que parta de un estado relajado (como M7 parte de M6), genere un FDF por volumen con `render_geometry` sobre la geometría de `deform`, añada `Mesh.Sizes` de la referencia y el mismo bloque k, y los ejecute como tareas `siesta` independientes del runtime existente.
2. **U-Q11, evaluación.** Leer cada salida con la regla E-4, construir la tabla y evaluarla como `evaluate`. Debe ser un módulo sin autoridad de ejecución, como `protocols/magnetic_selection.py`.
3. **Pruebas.** Portar `wf-eos.cases.json` como fixture de QRAFT: la implementación Python debe pasar los 20 casos con `arithmetic_tolerance`. Añadir una corrida SIESTA real pequeña (Si, como en la evidencia) en la validación local, no en la CI de PR.

## Decisiones pendientes de Manuel

1. Aprobar los valores de la política v1 o cambiarlos **antes** de implementar.
2. Confirmar el alcance v1 (sin spin y sin `shape`).
