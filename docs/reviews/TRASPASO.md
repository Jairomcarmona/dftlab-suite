# Nota de traspaso: estabilización A, B y E

Fecha: 2026-10-11. Escrita para quien continúe (otro agente o persona) sin acceso a la conversación.

## Estado de ramas y PR

Autorizado por Manuel el 2026-10-11, se fusionaron con merge commit y en este orden: #1 (registro, `cad5f01`), #2 (bloque A, `7fe35b0`), #3 (bloque E, `73dc701`) y #4 (bloque B, rama `claude/bloque-b-ciclo-vida-pwt4cq`; commit de la corrección `30fb2ee`). La punta de `main` tras fusionar #4 es su commit de fusión (`git log -1 origin/main`). Las ramas de trabajo quedan solo como historial: no reutilizarlas; para C/D partir de `main` con una rama nueva (p. ej. `claude/fix-cd-postproc-import`).

## Continuidad con Codex

Si el trabajo pasa a Codex: leer `CLAUDE.md`/`AGENTS.md`, `docs/development/WORKING_RULES.md`, `docs/reviews/REGISTRO_DEUDA.md` y esta nota. El estado vive en el repositorio (registro de deuda y PR), no en la conversación. Antes de ceder: commit pushed, registro actualizado y esta nota con rama, SHA, pendientes y siguiente paso. Nunca dos agentes en la misma carpeta o rama.

## Objetivo

Corregir fallos funcionales, de seguridad y de ciclo de vida del frontend actual antes de migrar. La revisión externa es evidencia: `REGISTRO_DEUDA.md` indica qué está reproducido, confirmado por inspección o pendiente.

## Qué se hizo

- Persistencia de la revisión externa y registro A–H con commit/entorno exactos y diferencias con la copia externa.
- **A:** `tools/cellmesh.js` (`fftGood` acotado, validación física); `views/calc.js` muestra estado de edición o error y no genera `.fdf` inválido.
- **B:** `onTheme` devuelve desuscripción; `core/lifecycle.js` (ámbito por montaje con `alive`/`guard`/`onTheme`/`timeout`/`observer`/`own`); el router libera la vista anterior una sola vez, monta en un contenedor nuevo y pasa `render(el, view)`; las 17 vistas con tema usan `view.onTheme`; lecturas async y timers no actúan tras salir; sin `root.isConnected`.
- **E:** `core/escape.js` (`esc` con comillas), escape de capturas en `annotateLines`, tabla de resumen de `postproc.js` con `H()` para HTML de confianza, error del router con `textContent`.
- Pruebas: `app/tests/ui/run_calc_tests.mjs`, `run_escape_tests.mjs` y `run_lifecycle_tests.mjs` (en `scripts/verify.mjs`); `app/tests/ui/browser_regressions.mjs` (A, E) y `browser_lifecycle.mjs` (B) en navegador (no están en `verify` ni en CI).

## Resultados de pruebas (Node 22.22.0, Linux)

`node scripts/verify.mjs`: lectores, mallas 81/0, lectura anotada, `.FC` 101/0, cristalografía 371/371 y 71/71, calc 51/0, escape 15/0, lifecycle 21/0, build correcto. Tras `node app/scripts/build.mjs`, con Playwright global (`NODE_PATH=$(npm root -g)`): `browser_regressions.mjs` 24/0 y `browser_lifecycle.mjs` todo en verde (58 fallos antes de B). CI (Node 24.18.0, Windows+Linux) en verde en #1–#4 antes de fusionar.

## Pendiente

- **C/D:** hechos (ver «Bloques C y D»). **G, H:** sin empezar.
- **H (heredado de B):** `ResizeObserver` por canvas en `core/chart.js`; liberación de geometrías/materiales/texturas en `core/three-view.js`; medir antes de introducir workers.
- **F:** PR #5 fusionado @ `296bb15`, después de CI Windows/Linux en verde con C/D. Entorno Python implementado en `codex/entorno-python`, pendiente de calificación CI y revisión. Ver entregas F al final de esta nota.
- La auditoría de E cubre las rutas de datos importados; no se revisaron las 19 vistas línea a línea.

## Bloques C y D (importación en Postproceso)

- **Rama:** `claude/bloques-c-d-importacion-qke0lu`, desde `main` @ `b691f25`; PR «C y D: importación coherente en Postproceso». Tras fusionar, la punta de `main` es su commit de fusión (`git log -1 origin/main`).
- **Cambios:** `siesta/runset.js` (conjunto de archivos: bytes para mallas, texto para el resto, paquetes desempaquetados y enlace `.EIG ← .KP` recalculado en cada alta/sustitución/baja, con procedencia en `link`); `siesta/pack.js` (validación de tamaño de arreglos; `packBands`, `packDOS`, `packStructure`, `packContents`); `siesta/rho.js` (errores de truncado y cabecera); `views/postproc.js` (lee bytes, paneles de malla y paquete, estado leído/visualizado por archivo, procedencia de pesos en pantalla y exportaciones).
- **Pruebas:** `app/tests/siesta/run_import_tests.mjs` 75/0 (añadida a `scripts/verify.mjs`); `app/tests/ui/browser_import.mjs` 33/0 (20 fallos en `b691f25`). Sin regresiones: `verify.mjs` completo, `browser_regressions.mjs` 24/0, `browser_lifecycle.mjs` en verde (Node 22.22.0, Linux, Playwright global). `browser_import.mjs` debe sumarse a la ejecución de pruebas de navegador en CI que prepara el bloque F (`REQUIRE_BROWSER=1`).
- **Pendientes:** fatbands, COOP/COHP y funciones de onda del paquete no se visualizan en Postproceso (se declara); el emparejamiento EIG/KP no puede verificar coordenadas (el `.EIG` no las tiene).

## Siguiente paso

Bloque **G** (discontinuidades del camino k): `siesta/bands.js` (`.bands` con `BandLines`/`BandPoints`), las bandas de paquetes (`packBands`: etiquetas como `H|P` en Fe) y `drawBands` en `views/postproc.js`. Representar segmentos explícitos solo con respaldo del formato o metadatos, sin umbrales inventados; conservar unidades y la referencia de energía. Después, **H**. Las vistas reciben `render(el, view)`: comprobar `view.alive` tras cada `await`.

## Reglas a respetar

`baseline-v1` intacta; no cambiar tolerancias científicas; no migrar a React todavía; no dos agentes en la misma carpeta.

## Entrega F: calidad reproducible del frontend

- **Rama:** `codex/bloque-f`, creada desde `origin/main` @ `b691f253425470d9e1a68b7326cf0566813c8d30` después de verificar la fusión del PR #4.
- **SHA de implementación:** `481ea0072f5a1c87f17d35ed4df2a7e679e16304`. Los commits siguientes actualizan sólo el registro y esta nota; consultar la punta con `git rev-parse origin/codex/bloque-f` después de `git fetch origin`.
- **Carpeta aislada:** `C:\Users\Jairo\Downloads\DFTQUANTUMLAB\dftlab-suite-codex-bloque-f`. La carpeta principal permaneció sin cambios.
- **Cambios:** `npm test` como puerta completa; `test:node` parcial explícita; build con esbuild local sin fallback de contenedor; preview Node sólo en loopback; Playwright 1.56.1 y lockfile; CI instala Chromium y ejecuta navegador obligatorio con `REQUIRE_BROWSER=1`. Pruebas existentes A/E y B usan dependencia local y fallan si falta; nombres hostiles mediante FilePayload también en Windows. Nueva prueba de ambos HTML aislados y sin red; smoke Moyo obligatorio. El build usa tipografías de sistema sin enlaces externos opcionales. Guía de copia limpia en `docs/development/INSTALL_AND_VERIFY.md`.
- **Pruebas locales:** Windows, Node 24.18.0, npm 11.16.0. `npm ci` + `npm test`: referencias 341/81/26/101, estructuras 371 y formatos 71; calc 51, escape 15 y lifecycle Node 21; servidor; A/E navegador 24/0; B en verde; ambos HTML offline con WASM/SG 227/cF2/WebGL/exportación FDF; smoke fetch/inline/global. Manifiesto 480 SHA-256 correcto. Comprobación negativa: sin Chromium, exit 1.
- **PR y CI:** [PR #5](https://github.com/Jairomcarmona/dftlab-suite/pull/5). **SHA verificado:** `5b67a2ab4ec47cc8f982bb5c55124990684a32ec`; [ejecución 38106584161](https://github.com/Jairomcarmona/dftlab-suite/actions/runs/38106584161), ambos jobs `Verify (windows-2022)` / `Verify (ubuntu-24.04)` completados con `success`, incluyendo checkout limpio, `npm ci`, navegador y offline. Esta nota posterior registra el resultado sin cambiar código; comprobar los checks de la punta actual del PR antes de integrar.
- **Pendiente F:** entorno Python fijado y validado para regenerar referencias; se consumen las actuales sin modificación. Permanecen los tres avisos `import.meta` heredados, con ruta inline comprobada; no se cambió vendor para ocultarlos.
- **Límite de esta entrega:** router, vistas, `app/src`, física, tolerancias y `baseline-v1` intactos. `dist` sin seguimiento. C/D se trabajan en paralelo; esta entrega no los corrige ni integra. No se ejecutó SIESTA.
- **Continuidad F:** revisar el PR y sus checks antes de integrar; si se continúa en la regeneración Python, abrir tarea y rama específica. No reutilizar ramas de C/D ni modificar su implementación como parte de F.
- **Integración C/D en F:** se incorporó `origin/main` @ `b9de59a` (PR #6) mediante merge, preservando el registro C/D y su implementación. `npm test` y CI ejecutan ahora también `browser_import.mjs` con Playwright local y sin omisiones; verificación Windows local: importación Node 75/0 y navegador C/D 33/0, junto a las demás suites en verde. El alcance del PR #5 sigue siendo F; el entorno Python se realizará después de su fusión, en `codex/entorno-python`.

## Entrega F: entorno Python de referencias

- **Entrega anterior integrada:** [PR #5](https://github.com/Jairomcarmona/dftlab-suite/pull/5), SHA verificado `e4a4a28e3052956ac91f4945947fb1e8f532ea71`; [CI 38107177262](https://github.com/Jairomcarmona/dftlab-suite/actions/runs/38107177262): Windows 2022 y Ubuntu 24.04 en verde, incluida importación C/D. Fusión en `main`: `296bb15b9f77e58be716adf6b10c886d8ca83d53`.
- **Rama / base:** `codex/entorno-python`, desde `296bb15`. SHA de implementación: consultar `git rev-parse origin/codex/entorno-python` después de `git fetch origin`; evidencia de CI se registrará tras completar la calificación.
- **Carpeta aislada:** `C:\Users\Jairo\Downloads\DFTQUANTUMLAB\dftlab-suite-entorno-python`; copia de origen y carpeta principal intactas.
- **Cambios:** proyecto no empaquetado `tools/reference-env`, CPython 3.12.10 y uv 0.11.14 fijados; seis dependencias científicas fijadas y lock transitivo con hashes. Sólo binarios Linux x86_64, WSL2 para Windows. Workflow Python separado, sin modificar CI frontend. [Guía de instalación/regeneración](../development/PYTHON_REFERENCES.md).
- **Calificación:** cuatro generadores originales y seis suites Node en copia temporal; outputs e informe de procedencia en `runtime/`, sin modificar ni sustituir las referencias originales. La aceptación usa aserciones/tolerancias existentes. Los logs y artefactos permiten revisar diferencias de hashes.
- **Pruebas locales:** WSL2 Ubuntu x86_64, CPython 3.12.10, uv 0.11.14, Node 24.18.0. Lock instalado con 19 paquetes binarios. Generación completa y suites contra resultados nuevos: 341/0, 81/0, 26/0, 101/0, C/D 75/0, cristalografía 371/371 y 71/71 formatos. Fuentes intactas según informe; 480 SHA-256 históricos correctos. Destinos fuente y carpeta existente rechazados (exit 2). Tres JSON nuevos difieren de los históricos; ninguno fue sustituido. `git diff --check` correcto; contenido ajeno a F de ambos documentos preservado por comparación con `296bb15`.
- **Pendiente F:** terminar calificación local/CI y revisar PR Python antes de integrarlo. No se promete soporte nativo Windows para sisl 0.16.4 ni identidad binaria entre BLAS/sistemas; frontend verificado en ambos sistemas. No se ejecutó SIESTA.
- **Alcance protegido:** sin cambios en vistas, router, lectores, bandas, generadores científicos, `app/src` ni tolerancias. Sólo se actualizaron F en este traspaso y en el registro. G/H continúan en sus ramas; `dist` sigue fuera de Git.
