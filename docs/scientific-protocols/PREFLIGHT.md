# Ficha de entrada: preflight del FDF (T-030)

Estado: **lista para aceptar**. Autoridad: el validador de QRAFT (plan §19: «el validador de QRAFT es el preflight autoritativo; el frontend lo replica con fixtures comunes»). Esta ficha fija **cómo lee SIESTA 5.4.2 un FDF**, comprobado con corridas, para que QRAFT, el servicio y el frontend digan lo mismo. Fuente: [maestro §10](../../PROPUESTA_MAESTRA_DFTLAB_V2.md) y [plan T-030](../../PLAN_IMPLEMENTACION_CLAUDE_CODE.md). Evidencia: [corridas de lectura FDF](../reviews/evidencia-p5-p10/README.md#lectura-fdf-t-030).

Esta ficha está escrita para que la implemente quien solo programa: si algo no está aquí, en el oráculo o en los vectores, **se pregunta antes de decidirlo**. Los vectores dicen lo que SIESTA hizo; no se cambian para que una prueba pase.

## Cómo lee SIESTA 5.4.2 (comprobado)

| # | Regla | Evidencia (H2O, SZ) |
|---|---|---|
| PF-1 | Las etiquetas se comparan sin mayúsculas y sin `.`, `_` ni `-`. Las unidades tampoco distinguen mayúsculas. | `MeshCutoff`, `Mesh.Cutoff`, `mesh_cutoff` y `meshcutoff … RY` son la misma etiqueta. |
| PF-2 | Si una etiqueta aparece varias veces, **gana la primera**. Los `%include` se expanden en su sitio. | Duplicada: gana 100 frente a 200 Ry. `%include` antes de la definición: gana el incluido (150); después: gana la raíz (250). |
| PF-3 | `Etiqueta < archivo` busca **la etiqueta dentro de ese archivo**, que es otro FDF. Un archivo con solo el valor aborta. | `MeshCutoff < mc.val` con `120 Ry`: «Label MeshCutoff not found in mc.val». Con `mc.fdf` que contiene `MeshCutoff 120 Ry`: 120 Ry. |
| PF-4 | `%block X < archivo` toma el archivo como cuerpo del bloque, sin `%endblock` local. | `%block LatticeVectors < lat.dat` dio la celda del archivo. |
| PF-5 | Una magnitud física sin unidad **aborta**; una unidad de otra dimensión aborta; una unidad compatible se convierte con los factores de SIESTA (1 eV = 0.07349864435 Ry). | `MeshCutoff 100`: «no unit specified». `MeshCutoff 100 Ang`: «Incompatible dimensions». `1360.57 eV` → 100.0000505 Ry. |
| PF-6 | Un entero escrito con punto aborta, igual que un real escrito como texto. El exponente Fortran `d` se acepta. Los lógicos aceptan `yes` y `T`. | `MaxSCFIterations 2.0`: «no integer value». `DM.Tolerance abc`: «no real value». `1.2d2 ry` → 120 Ry; `1.d-3` → 0.001. `WriteForces yes` → `Write.Forces T`. |
| PF-7 | Una etiqueta que SIESTA no conoce **se ignora en silencio** y se usa el valor por defecto. | `MeshCutof 300 Ry` (sin la última «f»): SIESTA usó el default de 300 Ry y la etiqueta no aparece en su `fdf.*.log`. |
| PF-8 | `#`, `!` y `;` empiezan un comentario, también al final de un valor. | Las tres formas dieron el valor escrito. |
| PF-9 | Un `%include` cíclico o de un archivo que no existe aborta. | «Too many nested fdf files» y «Cannot open nofile.fdf». |
| PF-10 | **El código de salida es 0 aunque SIESTA aborte por el FDF.** El error va a stderr; no hay `Job completed` ni `0_NORMAL_EXIT`. | Todas las corridas anteriores que abortaron salieron con 0. QRAFT ya clasifica por `Job completed`; nadie debe usar el código de salida como éxito. |

## Decisiones del preflight

| # | Decisión |
|---|---|
| D-1 | El preflight resuelve el FDF como SIESTA (PF-1…PF-4, PF-8, PF-9): `resolve` del oráculo. En la vista previa del frontend, un include que no puede leer da `NOT_CHECKED` de plataforma, nunca `PASS` (maestro §10.1); en QRAFT es `INCLUDE_NOT_FOUND`. |
| D-2 | Lo que SIESTA aborta es `FAIL` en la capa de sintaxis: `INCLUDE_NOT_FOUND`, `CYCLIC_INCLUDE`, `REDIRECT_LABEL_NOT_FOUND`, `UNIT_MISSING`, `UNIT_DIMENSION_MISMATCH`, `INTEGER_EXPECTED`, `REAL_EXPECTED`. `UNIT_UNKNOWN` es `FAIL` si la unidad no está en la tabla fijada de la versión. |
| D-3 | Una etiqueta que no está en el registro fijado de QRAFT es `KEYWORD_NOT_REGISTERED` con estado `REVIEW` (QRAFT no tiene `NOT_CHECKED`; la plataforma la muestra como «no verificada») y, si una etiqueta registrada está a distancia de edición ≤ 2 tras normalizar, la sugiere («¿MeshCutoff?»). No es `FAIL`: SIESTA conoce muchas más etiquetas que el registro. |
| D-4 | Después de correr, las etiquetas del input que no aparecen en el `fdf.*.log` de SIESTA son `INPUT_LABEL_UNUSED` (revisión): SIESTA no las leyó. Es la comprobación con autoridad para erratas y opciones obsoletas. Función: `unusedLabels`. |
| D-5 | Las capas del maestro §10.2 se reparten así: **sintaxis y resolución** = D-1…D-4 (QRAFT `effective_fdf` y registro); **coherencia** = validador de QRAFT `41043ed` (especies, pseudos, conteos, perfil de periodicidad); **protocolo** = gates del protocolo QRAFT ([PRESETS](PRESETS.md), [WF-EOS](WF-EOS.md)…); **recursos** = probe de runtime de la plataforma. Ninguna capa vuelve a implementar otra. |
| D-6 | Cada hallazgo se guarda tal como lo emite QRAFT (`ValidationFinding`: `rule_id`, `code`, `status` `PASS`/`REVIEW`/`FAIL`/`BLOCKED`, `message`, `evidence_class`, `scope`, `subject_id`, `location`, `hint`, `evidence`, `data`) por `NativeContractRef`. La plataforma solo añade la aceptación de un `REVIEW` (actor, justificación, revisión). Un `FAIL` no se acepta con override. `audit_warnings.log` se genera desde ese registro. |
| D-7 | El frontend (`crystal/formats.js`, `parseFDF`) es vista previa y pasa los mismos vectores de resolución. |

## Diferencias que hay que corregir

| Dónde | Hoy | Debe (vector) | Cambio |
|---|---|---|---|
| QRAFT `effective_fdf._scalar_redirect` | Lee el archivo como el valor; un archivo FDF con la etiqueta se lee mal | PF-3 (`pf-redirect-value`, `pf-redirect-fdf`) | **U-Q17** |
| QRAFT `siesta_validation`, unidades | Magnitud sin unidad es `KEYWORD_UNIT_IMPLICIT` en revisión | `FAIL` (`pf-no-unit`) | U-Q17 |
| QRAFT, etiquetas fuera del registro | Se ignoran sin hallazgo | D-3 y D-4 (`pf-typo`, `pf-unused-typo`) | U-Q17 |
| Frontend `parseFDF` | Gana la **última** aparición de escalares y bloques; `%include` y bloques redirigidos se ignoran con aviso | Gana la primera (`pf-dup`, `pf-spell`); includes como D-1 o `NOT_CHECKED` | Plataforma, T-030 |

## Vectores

[`vectors/preflight.cases.json`](vectors/preflight.cases.json) contiene 22 casos. Cada uno lleva los archivos de entrada de una corrida real y, como valor esperado, lo que hizo SIESTA: el `MeshCutoff` de su `fdf.*.log` (o el default), el error fatal de su stderr, la celda leída o las etiquetas que no consultó. El registro y la tabla de unidades de los vectores son mínimos (tres etiquetas; energía y longitud); en producción se usan el registro de QRAFT y la tabla de unidades de SIESTA 5.4.2, fijada con la versión. `node scripts/check-protocol-vectors.mjs` comprueba el [oráculo](vectors/fdf-oracle.mjs) y corre en `scripts/verify.mjs`.

## Implementación, en este orden

1. **QRAFT U-Q17:** PF-3 en `_scalar_redirect`, D-2 para magnitudes sin unidad, D-3 y D-4. Porta `preflight.cases.json` como fixture.
2. **Plataforma:** el servicio llama al validador de QRAFT y guarda sus hallazgos (D-6); el frontend corrige `parseFDF` (primera aparición) y pasa los vectores de resolución.
3. Subir el pin de QRAFT cuando U-Q17 entre.

## Decisión pendiente de Manuel

Aceptar U-Q17 y su orden (después de U-Q9).
