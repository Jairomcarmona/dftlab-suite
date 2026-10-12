# Ficha de entrada: WF-ELECTRONIC fino (T-036: gap, fat bands y masas)

Estado: **lista para aceptar**. Bandas, DOS y PDOS ya existen en QRAFT (protocolo M7, `siestaflow.siesta.band-structure` y `siestaflow.siesta.dos-pdos`). Esta ficha cubre lo que falta: el gap con su alcance, las fat bands y las masas direccionales. Dueño: QRAFT ([ADR-018](../adr/ADR-018-autoridad-protocolos-siesta-eos-electronica-superficie.md), aceptado), cambio U-Q13. Fuente: [maestro §11.2](../../PROPUESTA_MAESTRA_DFTLAB_V2.md). Evidencia: [corridas de Si](../reviews/evidencia-p5-p10/README.md#estructura-electrónica-t-036).

Esta ficha está escrita para que la implemente quien solo programa: si algo no está aquí, en el oráculo o en los vectores, **se pregunta antes de decidirlo**. Los vectores dicen lo que hicieron SIESTA y `fat`; no se cambian para que una prueba pase.

## Lo que ya resuelve QRAFT `41043ed`

- Camino k con SeeK-path sobre la celda original (`get_explicit_k_path_orig_cell`), HPKOT, tramos y evidencia de inversión temporal; en modo automático bloquea si la transformación no está resuelta.
- Las propiedades parten de un estado M6 inmutable (FDF final, `.DM`, pseudos con hash).
- La rama de bandas de M7 escribe `BandLinesScale ReciprocalLatticeVectors` y lee `.bands`, `.DOS` y `.PDOS` sin inferir gaps ni picos.

## Lo que hace SIESTA 5.4.2 (comprobado)

| # | Hecho | Evidencia (Si, PBE, DZP, a = 5.43 Å) |
|---|---|---|
| E-1 | Con `BandLinesScale pi/a` en una celda no ortorrómbica, SIESTA escribe en stdout «ERROR: pi/a option should only be used for orthorhombic cells. No calculation performed.», no calcula bandas y termina con `Job completed`. `pi/a` es el valor por defecto de `BandLinesScale`. | Celda FCC: sin `.bands`; con `ReciprocalLatticeVectors`, `.bands` de 541 k. La autoría de QRAFT (`workflow_authoring.py`, rama `band_structure`) acepta `pi/a` en cualquier celda. |
| E-2 | `.bands` con `BandLines`: E_F; k_min k_max; E_min E_max; nb ns nk; por k la distancia acumulada (1/Bohr) y las energías (eV, 4 decimales, **sin restar E_F**); etiquetas. Con `BandPoints`: no hay línea k_min k_max, cada k lleva kx ky kz cartesianas (1/Bohr, 5 decimales) y no hay etiquetas. | `parseBands` del oráculo. |
| E-3 | `fat` necesita `SystemLabel.bands.WFSX`, que solo se escribe con `WFS.Write.For.Bands T`. `COOP.Write T` escribe `SystemLabel.fullBZ.WFSX` (malla SCF), no las funciones del camino. | Corridas `path` y `coop`. |
| E-4 | `.EIGFAT`: cabecera `# SystemLabel min_band, max_band: b1 b2`; nb ns nk; por k «ik kx ky kz» (1/Bohr) y pares (E, peso) por banda, pesos con 5 decimales. Las energías son las del `.bands`. | 45 k, bandas 1–8: diferencia máxima 0 eV. |
| E-5 | Los pesos son de Mulliken: una partición completa de orbitales suma 1 por estado, y un peso puede ser negativo. | s+p+d: error máximo 1·10⁻⁵ (redondeo de tres términos). En todo el camino de 541 k y 26 bandas hay pesos de −0.55. |
| E-6 | Dentro de un grupo degenerado, el peso de cada estado depende de la base que eligió el diagonalizador; la suma del grupo no. | Átomo 1 en Si: 38 estados se apartan de 0.5 más de 10⁻³ y los 38 son degenerados. |
| E-7 | Si: gap indirecto de 0.5562 eV sobre el camino Γ-X-W-L-Γ-K de 541 k, mínimo de conducción en Δ a 0.847 de Γ-X; máximo de valencia triple en Γ. Con 45 k sobre el mismo camino, 0.5684 eV. Solo L-Γ: 1.5478 eV. | `el-gap-*`. |
| E-8 | Masas en el mínimo Δ con `BandPoints` de paso 0.0025·2π/a y ventana de ±0.05 Å⁻¹: longitudinal 0.925, transversal 0.194. En Γ la banda de valencia es triple: no hay masa de una sola banda. | `el-mass-*`. |

## Decisiones

| # | Decisión | Por qué |
|---|---|---|
| B-0 | Una corrida de bandas pide `BandLinesScale ReciprocalLatticeVectors`. Si stdout trae el error de E-1, es `FAIL` `BAND_SCALE_REJECTED`; si falta el `.bands` pedido, `FAIL` `BANDS_NOT_WRITTEN`. El código de salida no cuenta ([PREFLIGHT](PREFLIGHT.md) PF-10). `bandRunCheck`. | E-1: hoy la autoría de QRAFT deja pasar `pi/a`. |
| B-1 | El gap se calcula con el número de bandas ocupadas por spin (electrones de valencia / 2 sin spin), nunca con E_F, y se informa con su alcance: `PATH` (camino de `BandLines`) o `POINTS` (lista de `BandPoints`), la muestra citada, directo o indirecto y los k del extremo. Si el mínimo de la banda n+1 no supera el máximo de la n, es `NO_GAP`. «Gap global» solo con evidencia de búsqueda fuera de la muestra; no hay vector para eso todavía. `bandGap`. | E-7: el número depende del muestreo. Con E_F, un metal mal ocupado parecería aislante. |
| B-2 | Fat bands en la misma corrida de bandas con `WFS.Write.For.Bands T`, proyectadas con la utilidad `fat` de la distribución fijada (versión en el lock del worker) y con el `.mpr` guardado como artefacto. Las proyecciones de una partición completa se comprueban: energías iguales a las del `.bands` (`energy_match_eV`) y suma 1 por estado dentro de `weight_rounding` × número de proyecciones. Si no, `FAIL` con `FAT_BANDS_MISMATCH` o `PARTITION_INCOMPLETE`. Los pesos negativos se muestran tal cual; no se recortan a [0, 1]. `fatPartition`. | E-3…E-5. |
| B-2b | Para colorear o comparar pesos se suman dentro de cada grupo degenerado (`degeneracy_meV`). | E-6. |
| B-3 | La masa es **direccional**: una línea recta de `BandPoints` que pasa por el extremo, con dirección cartesiana, centro, paso y número de puntos guardados. El protocolo hace dos corridas desde el estado M6: el camino (para localizar el extremo) y las líneas de masa. Las líneas transversales se centran en el extremo ajustado sobre la línea longitudinal. Ajuste cuadrático por mínimos cuadrados en la ventana de ±`fit_halfwidth_invA` alrededor del punto muestreado extremo; masa = ħ²/(mₑ · d²E/dk²), con signo invertido para huecos. Se informan la curvatura, el desplazamiento del extremo ajustado, los puntos usados y el rms. `directionalMass`. | §11.2. El tensor completo exige un muestreo 3D y queda fuera de v1. |
| B-4 | La masa es `NOT_ESTABLISHED` (sin número) si: otra banda está a `degeneracy_meV` o menos en el extremo (`DEGENERATE_EXTREMUM`); la ventana tiene menos de `min_points_per_side` puntos a un lado (`EXTREMUM_AT_LINE_END`); la curvatura tiene el signo contrario al portador (`CURVATURE_SIGN`); o la línea no es recta dentro de `straightness_invA` (`LINE_NOT_STRAIGHT`). | Un ajuste parabólico sobre bandas cruzadas da números sin sentido (E-8, valencia de Si en Γ). |
| B-5 | Las energías de bandas, DOS y PDOS conservan E_F de la corrida que las produjo; una alineación con otra corrida se registra como operación. | E-2; [WF-SURFACE](WF-SURFACE.md) S-7: E_F depende de la celda. |

### Política `qraft.electronic.policy@1-draft`

| Campo | Valor | Origen |
|---|---|---|
| `fit_halfwidth_invA` | 0.05 | Ventana de E-8; con la malla de 0.0025·2π/a deja 35 puntos. |
| `min_points_per_side` | 3 | Mínimo para que la parábola no se apoye en un solo lado. |
| `degeneracy_meV` | 5 | El triplete de Si en Γ aparece separado 0.6 meV por el redondeo y la diagonalización. |
| `straightness_invA` | 2·10⁻⁵ | SIESTA escribe k con 5 decimales en 1/Bohr (≈ 10⁻⁵ Å⁻¹). |
| `energy_match_eV` | 10⁻⁴ | Un dígito de los 4 decimales de `.bands` y `.EIGFAT`. |
| `weight_rounding` | 5·10⁻⁶ | Medio dígito de los 5 decimales de `.EIGFAT`. |

## Diferencias que hay que corregir

| Dónde | Hoy | Debe (vector) | Cambio |
|---|---|---|---|
| QRAFT `workflow_authoring.py`, `band_structure` | Acepta `BandLinesScale pi/a` en cualquier celda | B-0 (`el-run-pi-a`) | **U-Q13** |
| QRAFT M7 | No calcula gap ni masas; no hay fat bands ni lectura de `BandPoints` | B-1…B-4 (`el-gap-*`, `el-mass-*`, `el-fat-*`) | U-Q13 |
| Frontend, Calculadoras (`views/calc.js`, «h⁺ Si, Γ→X» y «Γ→L») | Ajusta una masa a la banda de valencia superior en Γ, que es triple | `NOT_ESTABLISHED` (`el-mass-vb-100`, `el-mass-vb-111`) | Plataforma, T-036; la calculadora puede quedar como ejercicio con el aviso |

## Vectores

[`vectors/electronic.cases.json`](vectors/electronic.cases.json) contiene 23 casos: 3 de corrida (B-0), 4 de gap, 11 de masa (6 de las corridas de Si y 5 sintéticos con parábolas exactas) y 5 de fat bands. Las salidas reales están una sola vez en `inputs`, recortadas a las bandas 1–8 en el mismo formato. Los valores esperados vienen de una implementación independiente en numpy (`vectors/build/build_electronic_cases.py`). `node scripts/check-protocol-vectors.mjs` comprueba el [oráculo](vectors/electronic-oracle.mjs) y corre en `scripts/verify.mjs`.

## Implementación, en este orden

1. **QRAFT U-Q13:** B-0 en la autoría y en la clasificación de la corrida; lector de `BandPoints`; protocolo de masas (dos corridas desde M6); `fat` fijado y `.mpr` como artefacto; gap, masas y comprobación de fat bands como en el oráculo. Porta `electronic.cases.json` como fixture.
2. **Plataforma:** guarda los resultados de QRAFT con su alcance y su política; el frontend los muestra y corrige la calculadora de masas.
3. Subir el pin de QRAFT cuando U-Q13 entre.

## Decisión pendiente de Manuel

Aprobar la política `qraft.electronic.policy@1-draft`. U-Q13 ya está aceptado con ADR-018; esta ficha le añade B-0 y la lectura de `BandPoints`.
