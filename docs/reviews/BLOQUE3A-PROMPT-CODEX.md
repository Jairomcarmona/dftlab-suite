# Prompt único para Codex: bloque 3A (P7)

Pega esto tal cual. Seguimiento en [issue #105](https://github.com/Jairomcarmona/dftlab-suite/issues/105). Todo lo científico y de contrato está decidido en las fichas y el ADR de abajo; no preguntes diseño. Modelo previsto: Sol 6.1 con razonamiento medio.

## 0. Antes de hacer nada (en este orden)

1. En `dftlab-suite`: `git fetch origin && git checkout main && git pull --ff-only origin main`. En `siestaflow` (QRAFT), lo mismo. Si `git pull` no es un avance rápido, para y avisa en #105: tu copia local tiene trabajo que no está en `main`.
2. Lee `AGENTS.md` y `docs/development/WORKING_RULES.md` completos, y di en tu **primer comentario de #105** que los leíste y qué SHA de `main` de cada repositorio estás usando. Si no abres los archivos, esta es la regla completa:

> **Pocos PR (regla fija de todo el proyecto).** El avance diario va en comentarios del issue de seguimiento o en notas no versionadas, no en un PR por paso. `docs/reviews/TRASPASO.md` se actualiza una vez por etapa cerrada, dentro del PR de código de esa etapa, o en un único PR al cerrar un bloque. Nunca se abre un PR documental solo para anotar que otro PR se fusionó. Los arreglos de código relacionados van en un solo PR.

3. **Comprueba el estado real en GitHub antes de planear** (los comentarios, este prompt y tu memoria pueden estar atrasados; **gana GitHub** y anotas la diferencia en #105). Debes confirmar, con enlace o SHA:
   - que el PR [#104](https://github.com/Jairomcarmona/dftlab-suite/pull/104) está fusionado y que `docs/scientific-protocols/README.md` marca **Aceptada** a WF-SURFACE y al modelo de vista LR-U, y que ADR-017 Adenda 12 figura como aceptada. **Si no es así, esta es la única espera permitida del bloque:** comenta en #105 qué falta y espera a que Manuel lo acepte; no empieces por tu cuenta;
   - el `main` de ambos repositorios (a 2026-10-13 al preparar este prompt: `dftlab-suite` `9378305` más lo que haya entrado por #104; `siestaflow` `6dec1ba`, que es también el pin vigente en `engine-versions.lock.json`);
   - que no hay PR abiertos de otro agente que toquen los mismos archivos (MCP de GitHub o `gh`: `authority_storage.py`, `submission_storage.py`, `authority_recovery.py`, `check-contracts.mjs`, `check-protocol-vectors.mjs`).
4. Después de esto no vuelvas a depender de lo que dice este texto sobre el estado de los PR: consulta GitHub cada vez que vayas a abrir, rebasar o fusionar.

## 1. Alcance

| Ticket | Qué es | Ficha (aceptada) | Vectores | Dueño del código |
|---|---|---|---|---|
| T-038, [#93](https://github.com/Jairomcarmona/dftlab-suite/issues/93) | La plataforma reanuda HF-1 por generaciones de autoridad y de envío | `docs/adr/ADR-017-tarea-controladora-qraft-hf1.md`, **Adenda 12** (L.1 a L.11) | `contracts/fixtures/authority-generations/cases.json` (23); evaluador `evaluateGenerationAdmission` en `contracts/scripts/check-contracts.mjs` | plataforma y QRAFT (U-Q19) |
| T-039 | Modelo de vista LR-U (cancelar y reanudar compuestos, observaciones y gates) | `docs/scientific-protocols/LR-U-VISTA.md` | `lru-view.cases.json` (22), `lru-view-oracle.mjs`, más los reales de abajo | plataforma |
| T-040 | WF-SURFACE: Φ por cara, corrección dipolar, convergencia | `docs/scientific-protocols/WF-SURFACE.md` | `surface.cases.json` (33), `surface-oracle.mjs`, evidencia en `docs/reviews/evidencia-p5-p10/superficie/` | QRAFT (U-Q12) y plataforma |

**Fuera de este bloque, no lo toques:** P8 (T-041 HF-2, T-042 fonones, T-043 óptica, T-044 magnetismo), P9 (T-045 a T-048), P10 (T-049 a T-054); HubbardFlow (el repositorio es intocable; HF-2 lo necesita y va en otro prompt); T-032, T-033, T-034; el registro del lock del worker (T-042); la aceptación humana de T-037; los contratos pendientes #30, #31, #35, #44, #47 (son de Claude); `baseline-v1`, tolerancias, goldens, ADR aceptados y las ramas de otros agentes.

**Lo que este bloque no activa:** `platform_resume_enabled` queda en `false` y HF-1 **no se ofrece como reanudable** hasta que Manuel repita la calificación Q por la plataforma (ADR-017 L.10). Eso lo decide Manuel después; no lo pidas ni lo simules.

Los esperados de los vectores salieron de corridas reales de SIESTA 5.4.2 y de constructores independientes (`vectors/build/`). **Nunca cambies un vector, una tolerancia ni un oráculo para que pase una prueba.** Puedes **añadir** vectores en archivos nuevos (como indica LR-U-VISTA «Caso real»); no editar los existentes.

## 2. Orden de trabajo y PR (cuatro PR de código en total)

Rama corta por PR, desde `origin/main` del repositorio correspondiente, nunca reutilizando ramas fusionadas. QRAFT es `Jairomcarmona/siestaflow`.

| Etapa | PR | Contenido | Termina cuando |
|---|---|---|---|
| 1 | Q-7 QRAFT | **U-Q19**: función de solo lectura en `qraft.api` que envuelve `previous_controller_owner` (Adenda 12 L.2), con prueba de importación, línea en `docs/developer/PUBLIC_API.md` y pruebas de que devuelve cada resultado de `previous_controller_owner` (`CLOSED`, `OWNER_DEAD_BY_BOOT_CHANGE`, `PREVIOUS_OWNER_ALIVE`, `TAMPERED`) sin cambiar su comportamiento | CI de QRAFT verde sobre la punta exacta |
| 2 | Q-8 QRAFT | **U-Q12** y protocolo de superficie (sección 3.3): enum `Slab.DipoleCorrection`, protocolo exportado de forma aditiva en `qraft.api`, documento de política `qraft.surface.policy@1` en `scientific_policy_document` y las etiquetas que el barrido de 3.3 encuentre | `surface.cases.json` pasa en QRAFT más la corrida real de 3.1 |
| 3 | P-4 plataforma | T-038: migraciones v2 de autoridad y envíos, reglas de L.5, retiro con `owner_proof`, pruebas de L.9; **un solo cambio de pin** de QRAFT, al commit fusionado de Q-8 (que ya contiene Q-7) | CI verde, evidencia instalada y ensayo de migración de 3.2 |
| 4 | P-5 plataforma | T-039 (módulo y panel de LR-U) y T-040 (consumidor de la superficie) | CI verde |

`TRASPASO.md` se actualiza **solo** dentro de P-4 y P-5, una vez por PR, con la sección «Bloque 3A (Codex)»: rama, SHA, PR, CI, pendientes y siguiente paso. Los PR de QRAFT no tocan `TRASPASO.md`; sus resultados se anotan en #105. Cero PR documentales.

Cada PR de QRAFT sigue la compuerta del plan §19: **copia byte a byte** los JSON de vectores que use a los fixtures de QRAFT (en Q-8, `surface.cases.json`), deja en el README de esa carpeta el SHA de `dftlab-suite` desde el que los copiaste y el SHA-256 de cada archivo, y añade una prueba que falle si el fixture difiere del hash anotado. Las implementaciones se escriben en Python como lo hace QRAFT; los oráculos `.mjs` son la referencia de lectura, no código a copiar.

## 3. Qué hacer en cada etapa

### 3.1 Corridas reales (solo Q-8)

Las pruebas de PR no ejecutan SIESTA. Además, en WSL y con el SIESTA fijado (`/home/jmc/.local/siesta-5.4.2-openmpi/bin/siesta`, SHA-256 `aaa9a2e45a41b12f3aad52ca4fca7c25b1cc6afd3aff2a0c7fe145b1bd9f18ce`, ver `TRASPASO.md`, «Cierre U-Q9»), ejecuta con los FDF de `docs/reviews/evidencia-p5-p10/superficie/` (y `al111_n3_vac18.fdf` de la carpeta superior) y el protocolo nuevo de QRAFT:

- Al(111) 3 capas LDA/DZP, 18 Å: Φ esperada 3.8923 eV. Al(111)+H con `Slab.DipoleCorrection vacuum`: Φ esperadas +z 5.5863 y −z 3.9446 eV. Al(111) GGA/PBE: 3.7197 eV.
- Pseudos del repositorio: comprueba los SHA-256 antes (`lda/Al.psml` `2c5aa725…`, `lda/H.psml` `52e21053…`, `pbe/Al.psml` `c53846ea…`; los hashes completos salen de `sha256sum`, y el prefijo de la evidencia debe coincidir; si no, para y pregunta).
- Esos valores vinieron de un SIESTA conda-forge de un hilo y no de tu build con Open MPI. Se espera acuerdo dentro de unos meV. **Si difiere más, no cambies ningún vector ni política:** comenta en #105 el comando, las dos Φ y la diferencia, y sigue; la comparación se la lleva Manuel.
- Comenta en #105 el comando, la salida resumida (Φ por cara, E_F, anchura de la meseta) y los SHA-256 de FDF y salidas. El resultado se registra como `NUMERICAL_CANDIDATE` y comprobación de tubería. **Ninguna capability pasa de `CONTRACT_TESTED`.**

### 3.2 Comprobaciones que dependen del entorno real

No basta con leer el código. Para cada una, ejecútala y pega la salida en #105:

1. **Wheel instalado.** Antes de P-4 y de P-5: `git archive` limpio, construir el wheel de la plataforma como en `deployment/local/README.md`, instalarlo en un venv aislado con `python -I` y pasar ahí las pruebas instaladas (`test_hf1*.py`, `test_authoring.py`, `test_authority*.py`, `test_submissions.py`, `test_native_worker.py` y las nuevas).
2. **Pin.** Antes de subir el pin en P-4: reconstruir el wheel de QRAFT desde el commit fusionado de Q-8, instalarlo aislado y pasar ahí los fixtures de vectores sobre el paquete instalado. Genera la evidencia de `deployment/local/evidence/` con `deployment/local/qualify_engines.py` en Windows y en WSL, y `probe_engines.py`, como en el commit `72e584c`. No borres ni reescribas los recibos del pin anterior.
3. **Ensayo de la migración v2 (P-4).** Copia el `state.sqlite` de la plataforma de la corrida C0-r3 (job 446) y de la corrida de Q (`41c26f9e-3651-490e-986d-054e71b8babf`) en WSL, **trabaja sobre la copia**, ejecuta la migración y comprueba que cada fila queda como generación 1 con fase, recibo y documentos intactos byte a byte, que la proyección del run se sigue leyendo y que una segunda ejecución no cambia nada. No ejecutes ninguna ceremonia de Q ni envíes un `sbatch`.
4. **Windows y Linux.** Las dos CI deben pasar; si algo difiere por sistema (rutas, finales de línea, symlinks, bloqueos del kernel), arréglalo en el código, no con `skip`.

### 3.3 Detalles por ticket

- **T-038 (P-4).** Sigue ADR-017 Adenda 12 al pie de la letra. Las dos migraciones son explícitas e idempotentes y abortan si algún documento antiguo no es generación 1 (L.3, L.4). Las reglas de admisión (L.5) deben dar el veredicto de cada caso del JSON en una prueba Python que **lea ese mismo archivo** (no una copia). El cerrojo del kernel conserva la clave `[project, run]` entre generaciones. `authority_check` y `publish` de una generación desplazada fallan sin escribir. `owner_proof` llega por el verificador registrado y se guarda en `authority_retirements.owner_proof` (columna nueva); la prueba viene de la función de U-Q19 y no se reimplementa. `max_attempts = 3`. No cambies contratos ni schemas públicos (L.8). Reescribe, y lista en el PR, las pruebas existentes que asumían un solo registro por corrida. **Sin QRAFT-U-Q19 fusionado no empieces la parte de retiro**: haz primero migraciones y reglas.
- **T-039 (P-5).** Módulo `app/dftlab/static/js/application/lru-view.js` (puro, sin DOM, mismas reglas que `lru-view-oracle.mjs`) y panel `application/lru-panel.js` que solo pinta su salida. Una prueba que alimente el módulo con **todos** los casos de `lru-view.cases.json` y compare con `expect` (igualdad profunda; el orden de las claves no importa). Sin frases en español dentro del modelo: solo códigos; los textos de la interfaz salen de ellos. Añade en un archivo **nuevo** `lru-view-real.cases.json` los casos `lru-real-c0-completed` y `lru-real-q-attempts` descritos en LR-U-VISTA «Caso real», con entradas leídas de la plataforma real y un constructor Python independiente en `vectors/build/` que calcule los esperados. `platform_resume_enabled` sale de una configuración privada y vale `false` por omisión.
- **T-040 (Q-8 y P-5).** QRAFT: `Slab.DipoleCorrection` enum de cinco valores (S-2), conservado tal cual; el protocolo implementa S-9 y devuelve el veredicto y las Φ por cara exactamente como `surface-oracle.mjs`; la política `qraft.surface.policy@1` es la tabla de la ficha, sin valores nuevos (si hace falta uno, para esa parte y pregunta); se exporta en `qraft.api` solo lo que la ficha nombra, de forma aditiva (`API_VERSION` 1.0). **Un solo barrido, no dos:** antes de abrir Q-8, pasa por el validador fijado los FDF de las corridas de `superficie/`, el de `al111_n3_vac18.fdf` y los que genere el protocolo; lista en #105 todos los hallazgos de etiqueta no registrada o valor gobernado y corrígelos todos en Q-8. Si después apareciera algo más, es un quinto PR y se pregunta. Plataforma: guarda el resultado de QRAFT con su alcance y política (`policy_ref` según R1) y no recalcula física; la corrección dipolar se declara en el intent. Todo FDF que genere debe pasar el validador de QRAFT.

## 4. Reglas permanentes del proyecto (R1 a R12 de #99) que siguen vigentes

Están completas en [#99](https://github.com/Jairomcarmona/dftlab-suite/issues/99); aquí solo las que tocan este bloque.

| Regla | Qué significa en el bloque 3A |
|---|---|
| R1 | `qraft.surface.policy@1` se convierte en `{policy_id, version: "1.0.0"}` con `digest` = SHA-256 del JSON canónico que entrega el wheel fijado; el texto original va en la evidencia nativa y la conversión inversa lo reproduce byte a byte. Si QRAFT no entrega ese documento, para esa parte. |
| R2 | La plataforma prueba registro, defaults, FDF y `RunIntent`; los veredictos de la superficie son de QRAFT. |
| R3 | `qraft.api` solo recibe exportaciones **aditivas** (U-Q19, protocolo de superficie), con prueba de importación y línea en `PUBLIC_API.md`. La plataforma importa **solo** de `qraft.api`. |
| R4 | El lock privado e inmutable del entorno de worker no se toca (su registro es T-042). |
| R7 | Sin frases en español en el código: claves y códigos. |
| R9 | No se fabrica un estado que no existe (nada de M6 falso, ningún `electronic-state`); lo mismo aquí: ningún `platform_resume_enabled` en `true`, ninguna reanudación «simulada» presentada como calificada. |
| R10 | El proveedor de política de `qraft.api` gana el documento de la superficie, con el contenido exacto de la tabla de la ficha. |
| R12 | Barrido único antes de abrir un PR upstream, y **un solo cambio de pin** en P-4, a un commit ya fusionado. |

## 5. Cuándo parar y cuándo seguir

Paras solo por física, contrato o una decisión de Manuel. **No pares en cada duda: junta las que tengas en un solo comentario de #105** con la pregunta en una línea, las opciones y tu recomendación, y sigue con lo independiente. Todo lo demás tiene regla escrita:

| Situación | Qué haces |
|---|---|
| Un vector no pasa y la ficha, el oráculo y el vector concuerdan entre sí | Es un error de tu implementación. Corrígela. No toques el vector. |
| Un vector no pasa y el oráculo (`node scripts/check-protocol-vectors.mjs` o `node contracts/scripts/check-contracts.mjs`) también falla contra el mismo vector | Para esa etapa. Abre un issue citando ficha, oráculo y vector con `archivo:línea`, y sigue con la siguiente etapa que no dependa. |
| La ficha no dice cómo nombrar un campo interno, una función o un módulo | Elige el nombre que use el código vecino y anótalo en el PR. No es contrato. |
| Necesitas un campo, `reason`, enum, versión o schema **públicos** que ni la ficha ni el ADR nombran | Para esa parte y pregunta en #105. Los nombres que la ficha o la Adenda sí fijan (`PREVIOUS_TERMINATION_NOT_PROVEN`, `DIPOLE_UNCOMPENSATED_ASYMMETRIC`, `qraft.surface.policy@1`, etc.) se usan tal cual. |
| Una pregunta concreta de física o de convención | Pide revisión a `validador_cientifico` (`.codex/agents/validador-cientifico.toml`). **APROBADO** y dentro de la ficha: sigue. **RECHAZADO:** corrige. **REQUIERE_DECISIÓN_DE_MANUEL**, o sale de la ficha: para y pregunta. |
| Una prueba existente falla por tu cambio | Arregla el código. No la saltes, no la marques `xfail`, no cambies su tolerancia. |
| CI falla en algo que no toca tu diff | Reproduce en `main`. Si es igual en `main`, un solo re-run; si persiste, comenta el nombre del check y la causa en #105 y sigue con lo que no dependa. |
| CI falla y no sabes por qué | Lee el log completo del job antes de tocar nada; arregla la causa raíz. Nunca un commit vacío ni cerrar y reabrir el PR. |
| El hash de un pseudo, de un wheel, de una base copiada o de un fixture no coincide con lo anotado | Para: puede ser un archivo alterado. Pregunta en #105. |
| Algo del entorno real no se puede ejecutar aquí (WSL, SLURM, la base de la plataforma) | Haz el ensayo en seco que puedas (comandos de solo lectura, copia de la base), pega la salida, y di exactamente qué falta. No lo marques verificado. |
| Un ensayo en seco o un barrido descubre un problema **de diseño** de la Adenda 12 o de las fichas | Para esa parte, comenta con `archivo:línea` y la evidencia, y sigue con lo independiente. No rediseñes por tu cuenta. |

**Fusión y pins.** Manuel autorizó, de forma acotada, que fusiones cada PR de este bloque y subas el pin de QRAFT, **solo si** se cumplen las tres a la vez: los cinco checks requeridos en verde sobre la punta exacta (`Verify (ubuntu-24.04)`, `Verify (windows-2022)`, `Platform installed wheel` en ambos sistemas y `Regenerate references (ubuntu-24.04)`; en QRAFT, todos los checks que su CI marque como requeridos), el validador científico con **APROBADO** para el diff de esa etapa y el pin apuntando a un commit **ya fusionado** del bloque. Anota en #105 el SHA fusionado. Esta autorización no cubre nada fuera de este bloque, ni subir otros pins (HubbardFlow, SIESTA), ni cambiar protección de ramas, ni activar `platform_resume_enabled`.

## 6. Cierre

Al terminar P-5, un último comentario en #105 con la tabla de cuatro PR (enlace, SHA fusionado, CI), las corridas reales de 3.1 y el ensayo de migración de 3.2 con sus hashes, lo que quedó parado y por qué, y **lo que este bloque no acredita**: HF-1 no se ofrece como reanudable (`platform_resume_enabled = false`) y la reanudación por la plataforma está implementada y probada en CI, **no calificada en real**; la superficie solo está comprobada para Al(111) de 3 capas sin relajar y ninguna Φ es un valor de referencia física; T-039 no pasa de `CONTRACT_TESTED`; no se anuncia ningún workflow como verificado en tiempo de ejecución.

No cierres #105 ni #93: los cierra Manuel.
