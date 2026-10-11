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
| C | Resultado EIG/KP depende del orden de carga | Alta | Confirmado por inspección (sin reproducción ejecutada aún) | pendiente |
| D | `.RHO` leído como texto; `.dftlab.json` detectado sin visualización | Media | Confirmado por inspección | pendiente |
| E | Metadatos y nombres de archivo se insertan en `innerHTML` | Media | **Reproducido** (incluido manejador `onerror` ejecutado) → corregido en la rama `claude/fix-e-safe-html` (PR del bloque E, apilado sobre A) | PR E |
| F | Puerta de calidad reproducible | Media | **Parcialmente resuelto** | parcial: `e502b71` |
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

- **Prioridad:** alta (resultado científico distinto con pesos no uniformes).
- **Archivos:** `views/postproc.js` (`addTexts`), `siesta/index.js` (`parseMany`), `siesta/eig.js`.
- **Inspección:** `addTexts` añade los `.KP` ya cargados solo al parsear un `.EIG` nuevo; un `.KP` posterior no recalcula el `.EIG` existente.
- **Reproducción:** pendiente (cargar fixture de Si: `.EIG` y luego `.KP`).

## D. Binarios y paquetes en postproceso

- **Prioridad:** media.
- **Archivos:** `views/postproc.js` (`addFiles` usa `f.text()`), `siesta/index.js`, `siesta/pack.js`.
- **Inspección:** confirma lectura textual de todos los archivos y ausencia de uso de `unpackDftlab` en `refresh()`.
- **Reproducción:** pendiente.

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
| CI Windows + Linux | Resuelto (configuración) | `.github/workflows/ci.yml` |
| Política de versión de Node | Resuelto en CI y README (24.18.0) | Local de este contraste: 22.22.0 |
| `npm test` | **Pendiente** | `app/package.json` solo tiene `build` y `serve` |
| Fallback `/opt/run/tools/node_modules` | **Pendiente** | `app/scripts/build.mjs:8` |
| `serve` depende de `python3` | **Pendiente** | `app/package.json` |
| Pruebas de navegador | **Pendiente** | `browser_smoke.mjs` sale con 0 si falta Playwright; `browser_regressions.mjs` (A, E) y `browser_lifecycle.mjs` (B) existen pero no están en CI |
| Verificación offline del HTML | **Pendiente** | |
| Dependencias de referencias Python fijadas | **Pendiente** | |
| Procedimiento de copia limpia documentado | Parcial | README: `npm ci` + verify |

## G. Discontinuidades del camino k

- **Prioridad:** media.
- **Archivos:** `views/postproc.js` (bandas), `core/chart.js`, `siesta/bands.js`.
- **Inspección:** pendiente de detalle; se reconoce en la arquitectura.

## H. Recursos y rendimiento

- **Fugas confirmadas por inspección:** `core/chart.js:84` (`new ResizeObserver` sin referencia), `views/potential.js:305`, `views/density.js:346`.
- **Pendiente de inspección fina / medición:** `core/three-view.js` (controles, materiales, texturas), bloqueo de `ks.js` y `phonons.js`. No se decide ningún Web Worker sin medición.
