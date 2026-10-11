# Ficha de entrada: WF-EOS (T-035)

Estado: **borrador para aceptar antes del código**. Dueño: QRAFT ([ADR-018](../adr/ADR-018-autoridad-protocolos-siesta-eos-electronica-superficie.md), aceptado). Fuente: [maestro §11.1](../../PROPUESTA_MAESTRA_DFTLAB_V2.md). Evidencia: [auditoría P5–P10](../reviews/2026-10-11-auditoria-p5-p10.md#evidencia-siesta-542).

Una ficha fija decisiones y qué declara la política. No fija tolerancias: esas van en la política versionada del protocolo (ADR-009) y se declaran antes de ejecutar un caso de validación.

## Decisiones

| # | Decisión | Por qué |
|---|---|---|
| E-1 | Cada volumen es una **geometría nueva** derivada de la referencia: celda `A·s` con `s = (V/Vref)^(1/3)` y las mismas coordenadas fraccionarias, con atom map 1:1. No es una variante del escalar `LatticeConstant`. | QRAFT renderiza la geometría en Å cartesianos con `LatticeConstant 1 Ang` ([`ground_state.py`](https://github.com/Jairomcarmona/siestaflow/blob/41043edcabef39026fe3cb6b7776362695faf9c6/src/qraft/engines/siesta/ground_state.py#L55)). Con coordenadas `Ang`, SIESTA escala la celda pero no los átomos: en Si a 1.06 V el segundo átomo quedó en 2.5653 Bohr en vez de 2.6156 y la energía cambió 15.7 meV. |
| E-2 | Todos los puntos usan **la misma malla real** (`Mesh.Sizes`, que 5.4.2 consulta) o el protocolo rechaza la tabla si `InitMesh: MESH` difiere entre puntos. La política elige cuál. | Con `MeshCutoff` fijo, la malla salta (24³ → 30³ en Si a 154 Ry dentro de ±6 %). El ajuste BM3 movió V0 un 0.31 % y cuadruplicó el residuo (0.40 frente a 0.10 meV). |
| E-3 | La k-grid es un bloque `kgrid.MonkhorstPack` fijo en coordenadas recíprocas; `kgrid.Cutoff` no se admite en EOS. | `kgrid.Cutoff` cambia el número de puntos con el volumen y produce los mismos saltos. |
| E-4 | La cantidad energética se declara: `FreeEng` (E−TS) por defecto si hay smearing; `E_KS` solo si la política lo justifica. Se lee con 6 decimales (`siesta: Total =` o `siesta: FreeEng =`), no de `E_KS(eV)`, que 5.4.2 imprime con 4. | En Al con Methfessel–Paxton, `Total` (−74.079115) y `FreeEng` (−74.079164) difieren; QRAFT tiene hoy dos lectores con cantidades distintas (`scientific_observations.py` lee `E_KS(eV)`; `output_parser.py` lee `Total`). |
| E-5 | Modo de relajación por volumen, uno por política: `fixed-fractional` (sin relajar), `internal` (posiciones a celda fija) o `shape` (posiciones y forma a volumen constante, `MD.VariableCell` + `MD.ConstantVolume`, que 5.4.2 consulta). Escalado isotrópico sin `shape` solo se admite si la simetría fija las razones de celda (cúbico) o si la política lo declara como aproximación. | En celdas no cúbicas, fijar c/a sesga B0. |
| E-6 | `Vref` sale de una relajación P=0 del **mismo** modelo (base, pseudos, XC, malla, k). El informe compara V0 del ajuste con Vref y con la presión de cada punto; no exige que coincidan. | En Si SZP/PBE el mínimo quedó en ≈1.075·V(5.43 Å): un barrido centrado en el valor experimental deja el mínimo fuera del rango. |
| E-7 | Ajuste BM3 por mínimos cuadrados lineales en x = V^(−2/3) (E es cúbico en x). Salidas: E0, V0, B0 en GPa, B0′, residuo rms, sensibilidad al quitar cada extremo. Unidad de normalización declarada: celda, átomo o fórmula. | Sin semilla ni optimizador no lineal; reproducible. Conversión eV/Å³ → GPa = 160.21766208. |
| E-8 | Gates del ajuste: mínimo dentro del rango con puntos a ambos lados, residuo y sensibilidad dentro de la política, misma rama (simetría y momento magnético por punto). Un ajuste que no pasa da `NOT_ESTABLISHED`, no un número sin aviso. | §11.1 del maestro. |
| E-9 | Ampliar el rango crea una etapa nueva enlazada con su propio lock; nunca muta el anterior. | §11.1 y ADR-005. |

## Lo que declara la política (sin valores aquí)

Lista de η o de volúmenes; modo E-5; malla (`Mesh.Sizes` de la referencia o rechazo); cantidad energética E-4; residuo máximo; sensibilidad máxima de V0 y B0; criterio de misma rama; unidad de normalización.

## Vectores que deben existir antes del código

1. Geometría a η = +6 % desde una celda en Å cartesianos: coordenadas fraccionarias iguales a la referencia (falla con la trampa E-1).
2. Tabla con mallas distintas entre puntos: rechazada o marcada según E-2.
3. Tabla cuyo mínimo cae en un extremo: `NOT_ESTABLISHED`.
4. Ajuste sobre la tabla Si de la auditoría (malla fija): V0 = 43.007 Å³ y B0 = 79.8 GPa con la conversión E-7. Es un vector de aritmética, no una validación física (base SZP).
5. Metal con smearing: la tabla usa la cantidad declarada en E-4, no la otra.

## Preguntas abiertas

- ¿El ajuste debe ponderar puntos o tratar el ruido de malla como incertidumbre? Decide la política.
- ¿Vinet o BM4 como comprobación de sensibilidad del modelo de ajuste? Opcional; si se añade, va en la política.
