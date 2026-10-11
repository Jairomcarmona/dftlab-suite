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
| A | `fftGood` y calculadora bloquean la pestaña con entradas vacías/0/NaN/Infinity | Alta | Reproducido; en corrección (PR del bloque A) | _ver PR A_ |
| B | Suscripciones de tema y callbacks de vistas anteriores | Alta | Confirmado por inspección (sin reproducción de navegador aún) | pendiente |
| C | Resultado EIG/KP depende del orden de carga | Alta | Confirmado por inspección (sin reproducción ejecutada aún) | pendiente |
| D | `.RHO` leído como texto; `.dftlab.json` detectado sin visualización | Media | Confirmado por inspección | pendiente |
| E | Metadatos y nombres de archivo se insertan en `innerHTML` | Media | Confirmado por inspección; en corrección (PR del bloque E) | _ver PR E_ |
| F | Puerta de calidad reproducible | Media | **Parcialmente resuelto** | parcial: `e502b71` |
| G | Bandas unen segmentos desconectados | Media | Confirmado por inspección | pendiente |
| H | Recursos (ResizeObserver, escenas 3D) y cálculo pesado | Media/baja | Fugas: confirmadas por inspección; rendimiento: pendiente de medición | pendiente |

## A. Calculadoras: `fftGood` sin dominio

- **Prioridad:** alta. Se dispara durante la edición normal de un campo (borrar un valor) y deja la pestaña colgada, sin perder solo datos sino la sesión de trabajo.
- **Archivos:** `app/dftlab/static/js/views/calc.js` (`fftGood`, `doCell2`).
- **Reproducción (2026-10-11, Node 22.22.0, `timeout 2`):** `fftGood(1)` → 1; `fftGood(0)`, `NaN`, `Infinity` y `-3` exceden el límite (código 124). El campo vacío se lee como `+'' = 0` (longitud 0 → `Math.ceil(0/h) = 0` → `fftGood(0)`); `MeshCutoff` vacío da `h = Infinity`.
- **Criterio de aceptación:** entradas vacías, 0, negativas, NaN e Infinity no bloquean; `fftGood` tiene dominio explícito y terminación garantizada; `doCell2`, `dk` y `ec` se validan por significado físico; valores válidos conservan resultados; entrada inválida muestra un mensaje y no un resultado aparente; pruebas con aislamiento y timeout.
- **Evidencia:** PR del bloque A (ver abajo cuando se complete).
- **Resuelto en:** _pendiente de PR_.

## B. Ciclo de vida de vistas

- **Prioridad:** alta (error visible y retención de closures/datos en cada montaje).
- **Archivos:** `core/ui.js` (`onTheme`), `main.js` (`route`), todas las vistas que llaman `onTheme` (17 vistas: `ks`, `pseudo`, `potential`, `forces`, `density`, `scf`, `basis`, `postproc`, `phonons`, `spin`, `xc`, `dftu`, `calc`, `solvers`, `bands`, `beyond`, `lectura`), `potential.js:305` y `density.js:346` (ResizeObserver con `root.isConnected`).
- **Inspección en `ae3f35e`:** `onTheme` no devuelve desuscriptor (`ui.js:43-46`); `route()` solo llama `destroy` si la vista lo define y reutiliza el mismo contenedor `#view` (`main.js:23-28`). 9 de las 19 vistas no tienen `destroy`.
- **Reproducción:** pendiente (navegador: `#xc` → `#inicio` → Tema).
- **Criterio de aceptación:** ver mensaje original del encargo (bloque B).

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
- **Archivos:** `core/ui.js` (`esc`), `views/postproc.js` y demás vistas que interpolan datos importados (`lectura`, `phonons`, `forces`, `density`, `potential`, `estructura`), `main.js` (mensaje de error del router).
- **Inspección:** `esc` (`ui.js:15`) no escapa comillas; el resumen del `.out` interpola `o.systemLabel` sin escapar (`postproc.js:82`); los nombres de archivo van en atributos `data-export="${esc(...)}"`.
- **Criterio de aceptación:** ver encargo (bloque E).
- **Resuelto en:** _pendiente de PR_.

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
| Pruebas de navegador | **Pendiente** | `browser_smoke.mjs` sale con 0 si falta Playwright; no está en CI |
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
