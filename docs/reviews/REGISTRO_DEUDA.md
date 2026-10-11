# Registro de deuda técnica A–H

Origen: [revisión técnica externa del 2026-10-10](2026-10-10-revision-tecnica-externa.md). La revisión es **evidencia**, no una verdad sobre `main`: cada hallazgo se contrasta con el commit actual.

## Referencia usada para el contraste

| Dato | Valor |
|---|---|
| Repositorio / rama base | `jairomcarmona/dftlab-suite`, `main` |
| Commit contrastado | `ae3f35e` (`docs: record private repository protection limitation and ready policy`), sobre `e502b71` y `baseline-v1` (`bd4fa06`) |
| Fecha del contraste | 2026-10-11 |
| Entorno | Linux 6.18 (contenedor en la nube), Node.js 22.22.0, npm 10.9.4. CI usa Node 24.18.0 en Ubuntu 24.04 y Windows 2022; **la diferencia de versión de Node es una limitación de este contraste** |
| Navegador | Chromium 1194 preinstalado + Playwright global del contenedor (no es dependencia del proyecto) |
| Verificaciones ejecutadas | `node scripts/verify-original-baseline.mjs`: 480 archivos, SHA-256 coincide con `baseline-v1`. `node scripts/verify.mjs`: lectores 341/0, mallas 81/0, cristalografía 371/371 estructuras y 71/71 formatos, build correcto (`dist/dftlab.html` 12 569 636 bytes). |

### Estados usados

- **Reproducido**: ejecutado contra el código actual y observado el fallo.
- **Confirmado por inspección**: el código actual contiene la causa descrita; aún sin reproducción ejecutada.
- **Resuelto previamente**: corregido en `main` (con evidencia, no solo documentación o CI).
- **Pendiente de reproducción o medición**.
- **No aplicable a esta versión**.

## Diferencias entre la copia externa y `main`

| Aspecto | Copia externa (revisión) | `main` @ `ae3f35e` |
|---|---|---|
| Git | Sin `.git` en la raíz; `app/.git` sin commits | Raíz Git con historial, etiqueta `baseline-v1` y manifiesto SHA-256 (480 archivos) |
| `.gitignore`, CI, lockfile | No había | Presentes (`.gitignore`, `.github/workflows/ci.yml` Windows+Linux, `app/package-lock.json`) |
| Cristalografía en Windows | Fallaba por rutas ESM | `pathToFileURL` en `app/tests/crystal/run_tests.mjs:12-17`; CI en `windows-2022` la ejecuta |
| Pantallas | 19 (portada, 15 capítulos, 2 herramientas, 1 postproceso) | 19: coincide (`views/registry.js`) |
| JS propio | 50 archivos, ≈10 928 líneas | 50 archivos, 10 878 líneas (`wc -l`); la diferencia de conteo no se atribuyó a cambios de contenido |
| JSON empaquetados | 16 archivos, 10 678 665 B | 16 archivos, 10 678 665 B: coincide |
| HTML principal | 12 569 636 B | 12 569 636 B: coincide |
| Línea de `calc.js` (A), `ui.js`, `postproc.js` | `calc.js:26,113,117`, etc. | Las ubicaciones citadas coinciden con `main` |
| `env/siesta-env.tar.gz` | Ausente | Ausente |
| `validation/fdf/` (README de pseudos) | Ausente | `app/dftlab/data/pseudos/validation/` existe con `eos/`, `results.json` y `run_eos.py`; **no** hay `validation/fdf/` |
| Licencia propia del proyecto | No había | Sigue sin existir (ver README: pendiente de decisión del propietario) |
| Protección de `main` | n/a | No activable en repositorio privado sin GitHub Pro (HTTP 403); ver README |

## Resumen

| ID | Hallazgo | Prioridad | Estado | PR/commit |
|---|---|---|---|---|
| A | `fftGood` y calculadora bloquean la pestaña con entradas vacías/0/NaN/Infinity | Alta | **Reproducido** → corregido en la rama `claude/fix-a-calc-validation` (PR del bloque A) | PR A |
| B | Suscripciones de tema y callbacks de vistas anteriores | Alta | **Reproducido** (58 fallos de navegador en `73dc701`) → corregido en PR #4 (rama `claude/bloque-b-ciclo-vida-pwt4cq`) | PR #4 |
| C | Resultado EIG/KP depende del orden de carga | Alta | **Reproducido** (EIG→KP: primer peso 0.00390625 en vez de 0.005, sin coordenadas k) → corregido en la rama `claude/bloques-c-d-importacion-qke0lu` | PR C/D |
| D | `.RHO` leído como texto; `.dftlab.json` detectado sin visualización | Media | **Reproducido** («archivo de malla demasiado corto»; paquete «leído» sin paneles) → corregido en la misma rama | PR C/D |
| E | Metadatos y nombres de archivo se insertan en `innerHTML` | Media | **Reproducido** (incluido manejador `onerror` ejecutado) → corregido en la rama `claude/fix-e-safe-html` (PR del bloque E, apilado sobre A) | PR E |
| F | Puerta de calidad reproducible | Media | Frontend fusionado con CI Windows/Linux y C/D; entorno de regeneración Python aislado en `codex/entorno-python`, pendiente de calificación CI | PR #5 fusionado @ `296bb15`, CI @ `e4a4a28`; entrega Python separada |
| G | Bandas unen segmentos desconectados | Media | Confirmado por inspección | pendiente |
| H | Recursos (ResizeObserver, escenas 3D) y cálculo pesado | Media/baja | Fugas: confirmadas por inspección; rendimiento: pendiente de medición | pendiente |

## A. Calculadoras: `fftGood` sin dominio

- **Prioridad:** alta. Se dispara durante la edición normal de un campo (borrar un valor) y deja la pestaña colgada, sin perder solo datos sino la sesión de trabajo.
- **Archivos:** `app/dftlab/static/js/views/calc.js` (`fftGood`, `doCell2`).
- **Reproducción (2026-10-11, Node 22.22.0, `timeout 2`):** `fftGood(1)` → 1; `fftGood(0)`, `NaN`, `Infinity` y `-3` exceden el límite (código 124). El campo vacío se lee como `+'' = 0` (longitud 0 → `Math.ceil(0/h) = 0` → `fftGood(0)`); `MeshCutoff` vacío da `h = Infinity`.
- **Criterio de aceptación:** entradas vacías, 0, negativas, NaN e Infinity no bloquean; `fftGood` tiene dominio explícito y terminación garantizada; `doCell2`, `dk` y `ec` se validan por significado físico; valores válidos conservan resultados; entrada inválida muestra un mensaje y no un resultado aparente; pruebas con aislamiento y timeout.
- **Corrección:** nuevo módulo sin DOM `tools/cellmesh.js` (`fftGood` con dominio entero 1…2²⁰ y `RangeError` fuera de él, búsqueda acotada por la siguiente potencia de 2; `validateCellInputs` con rangos físicos: longitudes 0.1–10⁴ Å, ángulos 1–179°, Δk 0.001–10 Å⁻¹, MeshCutoff 1–10⁵ Ry, celda no degenerada, malla real ≤ 8192 y malla k ≤ 1000 por eje). `calc.js` muestra «completa todos los campos» mientras haya un campo vacío y un mensaje de error en entradas inválidas; no genera bloque `.fdf` ni permite exportarlo en esos estados. Las demás calculadoras no se tocaron: no tienen el bucle (campos vacíos/ceros dan «—» o un mensaje).
- **Evidencia después del cambio:** `app/tests/ui/run_calc_tests.mjs` (51 comprobaciones; las entradas peligrosas se ejecutan en procesos hijo con timeout de 5–10 s; `fftGood` verificado para n=1…4000 contra una definición independiente; mallas de los tres presets idénticas a la implementación anterior: Si 36×36×36, Mg 40×40×160, grafito 24×24×60). Comprobación en Chromium sobre `dist/dftlab.html` con red bloqueada: vaciar, 0, negativo en a, γ, Δk y MeshCutoff responde en ms con mensaje, sin excepciones (script de verificación manual; la prueba de navegador persistente se añade con el bloque F).
- **Límites:** los rangos son límites de la interfaz, no restricciones de SIESTA. La prueba de navegador aún no está en CI (pendiente F).

## B. Ciclo de vida de vistas

- **Prioridad:** alta (error visible en navegación normal y retención de closures/datos en cada montaje).
- **Archivos:** `core/ui.js` (`onTheme`), `main.js` (`route`), nuevo `core/lifecycle.js`, las 17 vistas que llaman `onTheme` (`ks`, `pseudo`, `potential`, `forces`, `density`, `scf`, `basis`, `postproc`, `phonons`, `spin`, `xc`, `dftu`, `calc`, `solvers`, `bands`, `beyond`, `lectura`) y `estructura` (async tras salir).
- **Inspección en `ae3f35e`:** `onTheme` no devolvía desuscriptor; `route()` solo llamaba `destroy` si la vista lo definía y reutilizaba el mismo contenedor `#view`; 9 de las 19 vistas no tenían `destroy`; `potential.js` y `density.js` creaban un `ResizeObserver` nunca desconectado y usaban `root.isConnected` (siempre verdadero con el contenedor reutilizado); `phonons.js` y `lectura.js` también usaban `root.isConnected`.
- **Reproducción (2026-10-11, `main` @ `73dc701`, Chromium + Playwright 1.56.1, `dist/dftlab.html` desde `file://` sin red):** `app/tests/ui/browser_lifecycle.mjs` → **58 fallos**. `#xc → #inicio → Tema` lanza `Cannot set properties of null (setting 'innerHTML')`; cada pantalla visitada deja 1 `MutationObserver` + 1 listener de `matchMedia` vivos (tras recorrer las 19 y 10 ciclos xc↔inicio: 28 y 28); los errores de callbacks antiguos aparecen incluso mientras se usa otra pantalla.
- **Causa:** suscripciones globales sin propiedad: la vista no tenía forma de liberar lo registrado y el router no tenía un punto único de limpieza.
- **Corrección (PR #4):**
  - `onTheme(f)` devuelve una desuscripción idempotente.
  - `core/lifecycle.js`: `createViewScope()` con `alive`, `signal` (AbortSignal), `add`, `guard`, `onTheme`, `timeout`, `interval`, `observer`, `own` y `dispose` (idempotente, orden inverso, una limpieza que falla no corta las demás; lo registrado tras salir se libera al instante).
  - Router: un ámbito por montaje; libera el anterior (que ejecuta el `destroy` de la vista una sola vez), monta en un contenedor nuevo (`div.viewhost`) y pasa el ámbito como `render(el, view)`; ignora el error de una navegación ya superada.
  - Vistas: `view.onTheme` en las 17; `ResizeObserver` de densidad/potencial con `view.observer` y `view.guard`; `setTimeout` de `ks` y fonones con `view.timeout`; frame y timer de bandas cancelados; lecturas async (postproceso, estructura, fonones, fuerzas, lectura, densidad, potencial, funciones de onda de bandas) comprueban `view.alive` tras cada `await`. En estructura y postproceso esto evita crear un visor 3D de módulo después de `destroy()`. `root.isConnected` ya no se usa como prueba de vigencia (`core/chart.js` lo sigue usando para su propio canvas, que sí se desconecta).
- **Evidencia después:** `app/tests/ui/run_lifecycle_tests.mjs` (21 comprobaciones en Node con dobles de `matchMedia`/`MutationObserver`, incluida en `scripts/verify.mjs`; con el `ui.js` anterior falla: `off is not a function`). `browser_lifecycle.mjs`: todas en verde (19 pantallas: sin errores montada, sin errores al volver a inicio y cambiar tema, suscripciones de tema iguales a la base, sin bucles de `requestAnimationFrame` tras salir; 10× xc↔inicio sin acumulación; salir del postproceso durante la carga de un ejemplo no crea visor ni paneles y al volver carga sin errores). `browser_regressions.mjs` (A y E) 24/0.
- **Límites / pendientes:** las pruebas de navegador no están en CI ni Playwright es dependencia fijada (bloque F; ejecutar con `REQUIRE_BROWSER=1`). La comprobación de bucles de animación ya pasaba antes del cambio (las vistas 3D tenían `destroy`): queda como guarda de regresión, no como fuga confirmada. Fuera de B y pendientes en H: `ResizeObserver` por canvas en `core/chart.js` y liberación fina de geometrías/materiales/texturas en `core/three-view.js`. Las lecturas async no se cancelan (terminan y se descartan); no hay `fetch` de red que abortar en esta versión.

## C. EIG/KP dependen del orden

- **Prioridad:** alta. Con pesos no uniformes cambia la DOS y las integrales; aun con pesos uniformes se pierden las coordenadas k y el informe no dice de dónde salen los pesos.
- **Archivos:** `views/postproc.js` (`addTexts` → `addItems`), nuevo `siesta/runset.js`; `siesta/eig.js` y `parseMany` sin cambios.
- **Reproducción antes del cambio (2026-10-11, `main` @ `b691f25`, Chromium + Playwright 1.56.1 sobre `dist/dftlab.html` sin red):** `app/tests/ui/browser_import.mjs` con `si.EIG` y un `.KP` de la misma malla con pesos no uniformes (el primero 0.005). EIG→KP: la exportación JSON da `weightsFromKP: false`, `weights[0] = 0.00390625` (1/256) y `kpoints: null`; sustituir el `.KP` tampoco recalcula. KP→EIG y la carga conjunta sí dan 0.005: el resultado dependía del orden. Un `.KP` de otra malla se mostraba como «leído» sin explicar que no se usaba. 20 de 33 comprobaciones de C y D fallan en `b691f25`.
- **Causa:** `addTexts` solo pasaba los `.KP` ya cargados al parsear un `.EIG` nuevo; ningún `.EIG` existente se volvía a leer al añadir, sustituir o quitar su `.KP`.
- **Corrección:** `createFileSet()` (`siesta/runset.js`, sin DOM) guarda el contenido original de cada archivo y, tras cada alta, sustitución o baja, recalcula el enlace `.EIG ← .KP` (`relink`). El enlace exige la misma etiqueta (regla de `parseMany`: `si.EIG` ↔ `si.KP`; `.PDOS.KP` no participa), un `.KP` legible, pesos finitos no negativos con suma positiva, coordenadas finitas y el mismo número de puntos k (comprobación existente de `parseEIG`). Dos `.KP` con la misma etiqueta no se desempatan. Si no hay enlace, pesos uniformes y el motivo en `link.note`. Solo se vuelve a leer el `.EIG` cuyo enlace cambió. Las altas se serializan y se aplican tras leer todos los archivos, así que dos cargas concurrentes no se intercalan. Procedencia: `link = {kp, weights, kpoints, note}` en el `.EIG` y `{usedBy}` en el `.KP`; visible en la tabla de archivos, en la lectura de la DOS («pesos si.KP») y en las exportaciones Markdown y JSON.
- **Evidencia después:** `app/tests/siesta/run_import_tests.mjs` (en `scripts/verify.mjs`): los cuatro órdenes dan pesos, coordenadas y DOS idénticos al lector puro `parseEIG(EIG, KP)`; quitar, volver a añadir y sustituir el `.KP`; sustituir o quitar el `.EIG`; `.KP` de otra malla, de otra etiqueta, con peso NaN o negativo, ilegible, duplicado o `.PDOS.KP`. `browser_import.mjs`: los tres órdenes dan la misma exportación, quitar y sustituir recalculan, el motivo de un `.KP` incompatible es visible.
- **Límites:** el emparejamiento sigue siendo por etiqueta y número de puntos k; no se comprueba que las coordenadas del `.KP` correspondan a la malla de la corrida (el `.EIG` no las contiene). No se tocaron algoritmos ni tolerancias de `eig.js`.

## D. Binarios y paquetes en postproceso

- **Prioridad:** media (funciones anunciadas que no funcionaban; sin pérdida de datos).
- **Archivos:** `views/postproc.js`, `siesta/runset.js`, `siesta/pack.js` (validación y adaptadores), `siesta/rho.js` (errores de truncado y cabecera), `siesta/README.md`.
- **Reproducción antes del cambio (mismo entorno, `browser_import.mjs`):** `mgo.RHO` → «archivo de malla demasiado corto» (se leía con `f.text()`); una malla basura daba el mismo mensaje engañoso; `si.dftlab.json` → «leído» y «Ninguno de los archivos tiene un lector gráfico todavía»; un JSON con `"dftlab"` que no es paquete también figuraba como «leído».
- **Causa:** todos los archivos se leían como texto; `refresh()` no usaba `unpackDftlab` ni había paneles para mallas o paquetes; el estado «leído» no distinguía lectura de visualización.
- **Corrección:**
  - Se leen los bytes (`arrayBuffer`); `readEntry` entrega bytes a los lectores de malla (por extensión, como `detectAndParse`) y texto UTF-8 a los demás, que siguen su ruta textual. Pasar texto a una malla da un error explícito. El SHA-256 del informe se calcula ahora sobre los bytes del archivo.
  - Mallas: panel con malla, celda, volumen, unidades, ∫ (solo densidades) y promedio planar por eje en las unidades del archivo; enlace a «Densidad y cargas» o «Potencial» para cortes 2D. `parseGrid` informa «archivo de malla truncado» y rechaza cabeceras imposibles antes de reservar memoria (antes: `RangeError` de `DataView`).
  - Paquetes: `unpackDftlab` en la importación; exige `"dftlab": "siesta-pack"`; `decodeArray` rechaza arreglos cuyo tamaño no coincide con `shape`. Paneles de bandas (`packBands`, energías absolutas sin modificar y E_F del paquete), DOS (`packDOS`, total o ↑/↓ y por l) y metadatos (origen, generador, espín, E_F, gap); la estructura se usa como geometría si no hay otra fuente. Lo que esta pantalla no visualiza se nombra: fatbands, COOP/COHP (n pares) y funciones de onda (n estados).
  - Tabla de archivos: tipo (detección), error de lectura, y qué se visualiza de cada archivo («visualizado», «usado en el resumen», «leído; sin gráfica en esta pantalla», «pesos y k para si.EIG», contenido de paquete no visualizado). Exportación JSON: mallas y paquetes como metadatos y procedencia (sus arreglos completos siguen en el archivo original, identificado por SHA-256).
- **Evidencia después:** `run_import_tests.mjs` (75 comprobaciones en total con C): `.RHO`/`.DRHO` desde bytes idénticos a `parseGrid` directo; texto, truncado y basura con error; `.out`, `.bands` y `live.jsonl` desde bytes iguales que desde texto; `si`, `fe` y `fesoc.dftlab.json` con bandas, DOS y estructura iguales a los arreglos originales (`at()`), y los extras nombrados; paquete truncado, no-paquete, arreglo dañado, forma incoherente, sin bandas y arreglos en línea. `browser_import.mjs` (33/33): panel de malla con gráfica, errores visibles sin excepciones, paquete con bandas/DOS/geometría y la lista de lo no visualizado.
- **Límites:** fatbands, COOP/COHP y funciones de onda de un paquete no se visualizan en Postproceso (se declara en pantalla). Las bandas del paquete se dibujan con el mismo trazado que las de `.bands`, que todavía une segmentos desconectados del camino (p. ej. `H|P` en Fe): es el bloque G. `.TSHS`, `.HSX` y `.WFSX` siguen requiriendo `dftlab_pack.py`.

## E. Inserción de HTML desde metadatos y nombres

- **Prioridad:** media (altera la interfaz desde un archivo importado; superficie para handlers de eventos).
- **Archivos:** `core/escape.js` (nuevo), `core/ui.js`, `siesta/outnotes.js`, `views/postproc.js`, `main.js`.
- **Reproducción antes del cambio (2026-10-11, Chromium sobre `dist/dftlab.html`, red bloqueada):** cargar en `#post` un `.out` con `reinit: System Label: <b data-audit-label="yes">audit</b><img src=x onerror="window.__pwned=1">` crea los elementos `<b>` e `<img>` en el resumen y **ejecuta el manejador** (`window.__pwned === true`); también con nombre de archivo con comillas. Causa: `postproc.js` interpola `o.systemLabel` (y otros campos del `.out`) en `innerHTML` sin escapar; las notas HTML de `outnotes.js` concatenan capturas del archivo (p. ej. SystemLabel, etiqueta de especie, `xc_check`, `Begin …`) que `lectura.js` inserta como HTML; `esc()` no escapaba comillas; `main.js` mostraba `e.message` en `innerHTML`.
- **Corrección:** `esc` (ahora en `core/escape.js`, reexportada por `ui.js`) escapa también `"` y `'`, válido en contenido y en atributos de ambas comillas. La tabla de resumen de `postproc.js` escapa todos los valores salvo los marcados como HTML de confianza con `H()`. `annotateLines` pasa a las reglas las capturas y la línea ya escapadas: las notas siguen siendo HTML propio con el texto del archivo como texto. El mensaje de error del router usa `textContent`. Revisados y ya escapados antes: nombres de archivo en paneles/atributos (`postproc`), `density`, `potential`, `phonons`, `forces`, `lectura` (título, detalle, nombre), `estructura` (origen, fórmula).
- **Evidencia después:** `app/tests/ui/run_escape_tests.mjs` (15 comprobaciones; sin la corrección fallan las cargas útiles con etiquetas en las notas) y `app/tests/ui/browser_regressions.mjs` (24 comprobaciones sobre el HTML compilado: sin elementos ni atributos `on*` inyectados, `__pwned` falso, etiqueta visible como texto, también con nombre de archivo con comillas; antes del cambio fallan las dos de postproceso).
- **Límites:** no se auditó cada interpolación de las 19 vistas, sino todas las rutas por las que entran datos importados (archivos de usuario: `.out`, nombres, `.FC`, mallas, estructuras). Texto empaquetado en la app se considera de confianza. La prueba de navegador usa Playwright global; su integración reproducible en CI es del bloque F. No se añadió CSP.
- **Resuelto en:** PR del bloque E.

## F. Calidad y reproducibilidad

Estado verificado, no solo declarado:

| Aspecto | Estado | Evidencia |
|---|---|---|
| Lockfile npm | Resuelto | `app/package-lock.json`; CI usa `npm ci` |
| Rutas ESM en Windows | Resuelto | `run_tests.mjs:12-17`; CI Windows ejecuta `scripts/verify.mjs`. Se verificó aquí en Linux; la ejecución en Windows queda acreditada por la CI, no por este contraste |
| Git / `.gitignore` / `dist` fuera de Git | Resuelto | `.gitignore`, CI sube HTML como artefacto |
| CI Windows + Linux | Verificada para alcance F en PR #5 | [.github/workflows/ci.yml](../../.github/workflows/ci.yml); [ejecución 38106584161](https://github.com/Jairomcarmona/dftlab-suite/actions/runs/38106584161), ambos jobs en verde |
| Política de versión de Node | Resuelto en CI y README (24.18.0) | Local de este contraste: 22.22.0 |
| `npm test` | Verificado en Windows y Linux (PR #5) | `app/package.json`: referencias, Node A/E/B, build, servidor y navegador obligatorio; `test:node` identifica explícitamente la cobertura parcial |
| Fallback `/opt/run/tools/node_modules` | Resuelto en rama F | `build.mjs` importa esbuild local; sin fallback ni `DFTLAB_NODE_MODULES` |
| `serve` depende de `python3` | Resuelto en rama F | `scripts/serve.mjs`, Node, loopback; prueba del proceso real, GET/HEAD, 404, métodos y límites de rutas |
| Pruebas de navegador | Verificadas en CI Windows/Linux (PR #5) | Playwright local 1.56.1 + lockfile; Chromium 1194; CI instala navegador y ejecuta A/E, B, offline y smoke Moyo. Sin skips por dependencias ausentes |
| Verificación offline del HTML | Verificada en Windows y Linux (PR #5) | Cada HTML aislado en carpeta vacía, `file://`, contexto sin red y sin assets vecinos: WASM SG 227, camino cF2, WebGL y descarga FDF; sin errores ni solicitudes externas |
| Dependencias de referencias Python fijadas | Implementadas en `codex/entorno-python`; calificación CI pendiente | CPython 3.12.10, uv 0.11.14, versiones directas y `uv.lock`; Linux x86_64 / WSL2. Cuatro generadores y seis suites en copia aislada, sin alterar referencias originales ni tolerancias |
| Procedimiento de copia limpia documentado | Resuelto en rama F | [Instalación y verificación](../development/INSTALL_AND_VERIFY.md): clone, `npm ci`, navegador local, `npm test`, Linux `--with-deps`, límites y artefactos |

### Entrega F: alcance y evidencia

- **Base:** `origin/main` @ `b691f253425470d9e1a68b7326cf0566813c8d30`; PR #4 confirmado fusionado antes de crear la rama. **Rama:** `codex/bloque-f`. **Commit de implementación:** `481ea0072f5a1c87f17d35ed4df2a7e679e16304`.
- **Verificación local:** Windows, Node 24.18.0, npm 11.16.0, Playwright 1.56.1 / Chromium 141.0.7390.37 (1194). Tras `npm ci`, `npm test` completo pasa: lectores 341, mallas 81, notas 26, FC 101, estructuras 371 y formatos 71; calc 51, escape 15 y lifecycle Node 21; servidor Node; A/E navegador 24/0; B sin errores/acumulación; ambos HTML offline; smoke Moyo fetch/inline/global. Manifiesto histórico: 480 SHA-256 coinciden. Chromium ausente devuelve exit 1.
- **Build portable:** elimina los enlaces opcionales Google Fonts/preconnect únicamente del entregable, usando fallbacks de sistema ya presentes. Los tres avisos heredados de `import.meta` siguen visibles; se verifican las rutas inline. `dist` sigue ignorado y sin archivos seguidos.
- **Alcance:** sin cambios en router, vistas, `app/src`, vendor, algoritmos ni tolerancias. Las cargas útiles con nombres hostiles se envían en memoria para que Windows no omita ese caso. No se trabajó C/D, G ni H.
- **PR y CI:** [PR #5](https://github.com/Jairomcarmona/dftlab-suite/pull/5), SHA `5b67a2ab4ec47cc8f982bb5c55124990684a32ec`; [ejecución 38106584161](https://github.com/Jairomcarmona/dftlab-suite/actions/runs/38106584161): `Verify (windows-2022)` y `Verify (ubuntu-24.04)` completados con `success`. Checkout limpio, `npm ci`, instalación de Chromium y puerta completa, incluidos navegador y offline. La evidencia Linux procede de ese runner, no de la prueba local. Esta actualización posterior registra el resultado sin cambiar implementación.
- **Pendiente F:** fijar y validar el entorno Python de regeneración de referencias en una entrega específica; no condiciona el build/frontend. No se ejecutó SIESTA.
- **Integración posterior:** merge de `origin/main` @ `b9de59a` (PR #6, C/D) en `codex/bloque-f`; contenido C/D preservado. `browser_import.mjs` se añade al runner de navegador de `npm test` y, por él, a CI. Playwright local obligatorio y configuración WebGL de las demás pruebas; sin cambios en sus criterios científicos. Windows local: importación Node 75/0, navegador C/D 33/0 y puerta completa en verde. La regeneración Python se atenderá en rama independiente después de fusionar F.

### Continuación F: entorno Python de referencias

- **Base:** PR #5 fusionado en `main` @ `296bb15b9f77e58be716adf6b10c886d8ca83d53`, después de integrar PR #6 (C/D), revisar diff y comprobar [CI 38107177262](https://github.com/Jairomcarmona/dftlab-suite/actions/runs/38107177262) Windows/Linux en verde @ `e4a4a28`. `browser_import.mjs` forma parte de `npm test` y CI (33/0).
- **Rama:** `codex/entorno-python`, desde ese `main`, sin reutilizar la carpeta F ni intervenir G/H.
- **Contrato:** entorno opcional independiente en `tools/reference-env/`, CPython 3.12.10, uv 0.11.14, NumPy 2.2.6, SciPy 1.15.3, ASE 3.26.0, spglib 2.7.0, seekpath 2.2.2, sisl 0.16.4. Lock transitivo con hashes, instalación `--locked`, sólo wheels.
- **Plataforma:** Linux x86_64; WSL2 desde Windows. sisl 0.16.4 no publica wheel Windows y su build fuente falla con scikit-build-core actual. No se declara soporte nativo Windows para regeneración; el frontend conserva CI Windows/Linux.
- **Verificación:** `scripts/regenerate_references.py` copia fuentes/fixtures, ejecuta los cuatro generadores originales y seis suites Node sobre resultados nuevos. Conserva informe, hashes y logs bajo `runtime/`; rechaza sobrescribir destinos y nunca promueve referencias. Workflow separado `Python references` en Ubuntu 24.04; evidencia como artefacto de 14 días.
- **Evidencia local:** WSL2 Ubuntu x86_64, CPython 3.12.10, uv 0.11.14 y Node 24.18.0; instalación desde lock con 19 paquetes binarios. Regeneración completa: lectores 341/0, RHO 81/0, lectura anotada 26/0, FC 101/0, importación C/D 75/0, cristalografía 371/371 y formatos 71/71. Informe `success: true`, fuentes originales intactas; manifiesto histórico 480 SHA-256 coincide. Destinos fuente y evidencia preexistente rechazados con exit 2. RHO conserva hash original; otros tres JSON difieren (incluyen redondeo y variación numérica), sin promoción ni relajación de tolerancias.
- **Instrucciones y límites:** [regeneración reproducible](../development/PYTHON_REFERENCES.md). No se ejecuta SIESTA ni se acredita reproducibilidad binaria entre plataformas; no se cambian generadores, lectores, vistas, router, bandas ni tolerancias. Pendiente: calificación local/CI de esta entrega y revisión del PR Python antes de integrar.

## G. Discontinuidades del camino k

- **Prioridad:** media.
- **Archivos:** `views/postproc.js` (bandas), `core/chart.js`, `siesta/bands.js`.
- **Inspección:** pendiente de detalle; se reconoce en la arquitectura.

## H. Recursos y rendimiento

- **Fugas confirmadas por inspección:** `core/chart.js:84` (`new ResizeObserver` sin referencia), `views/potential.js:305`, `views/density.js:346`.
- **Pendiente de inspección fina / medición:** `core/three-view.js` (controles, materiales, texturas), bloqueo de `ks.js` y `phonons.js`. No se decide ningún Web Worker sin medición.
