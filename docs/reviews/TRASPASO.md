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

- **C/D, G, H:** sin empezar. Ver el registro (`addTexts` de `postproc.js` para EIG/KP; `f.text()` para mallas; `.dftlab.json` sin `unpackDftlab` en `refresh()`).
- **H (heredado de B):** `ResizeObserver` por canvas en `core/chart.js`; liberación de geometrías/materiales/texturas en `core/three-view.js`; medir antes de introducir workers.
- **F:** alcance frontend implementado en `codex/bloque-f`; CI del PR pendiente de confirmar. Queda fijar el entorno Python de regeneración de referencias. Ver entrega F al final de esta nota.
- La auditoría de E cubre las rutas de datos importados; no se revisaron las 19 vistas línea a línea.

## Siguiente paso

Bloques **C y D** (importación coherente de archivos científicos en `views/postproc.js`): un conjunto de archivos por corrida con recálculo de dependencias EIG↔KP al añadir/sustituir/quitar; bytes para lectores de malla (`parseGrid`) y texto para los textuales; conectar `.dftlab.json` con `unpackDftlab` o declarar exactamente qué no se visualiza. Las vistas reciben ahora `render(el, view)`: comprobar `view.alive` tras cada `await` en el código nuevo.

## Reglas a respetar

`baseline-v1` intacta; no cambiar tolerancias científicas; no migrar a React todavía; no dos agentes en la misma carpeta.

## Entrega F: calidad reproducible del frontend

- **Rama:** `codex/bloque-f`, creada desde `origin/main` @ `b691f253425470d9e1a68b7326cf0566813c8d30` después de verificar la fusión del PR #4.
- **SHA de implementación:** `481ea0072f5a1c87f17d35ed4df2a7e679e16304`. Los commits siguientes actualizan sólo el registro y esta nota; consultar la punta con `git rev-parse origin/codex/bloque-f` después de `git fetch origin`.
- **Carpeta aislada:** `C:\Users\Jairo\Downloads\DFTQUANTUMLAB\dftlab-suite-codex-bloque-f`. La carpeta principal permaneció sin cambios.
- **Cambios:** `npm test` como puerta completa; `test:node` parcial explícita; build con esbuild local sin fallback de contenedor; preview Node sólo en loopback; Playwright 1.56.1 y lockfile; CI instala Chromium y ejecuta navegador obligatorio con `REQUIRE_BROWSER=1`. Pruebas existentes A/E y B usan dependencia local y fallan si falta; nombres hostiles mediante FilePayload también en Windows. Nueva prueba de ambos HTML aislados y sin red; smoke Moyo obligatorio. El build usa tipografías de sistema sin enlaces externos opcionales. Guía de copia limpia en `docs/development/INSTALL_AND_VERIFY.md`.
- **Pruebas locales:** Windows, Node 24.18.0, npm 11.16.0. `npm ci` + `npm test`: referencias 341/81/26/101, estructuras 371 y formatos 71; calc 51, escape 15 y lifecycle Node 21; servidor; A/E navegador 24/0; B en verde; ambos HTML offline con WASM/SG 227/cF2/WebGL/exportación FDF; smoke fetch/inline/global. Manifiesto 480 SHA-256 correcto. Comprobación negativa: sin Chromium, exit 1.
- **PR y CI:** pendiente de apertura/confirmación en Windows 2022 y Ubuntu 24.04. Actualizar esta línea con evidencia antes del traspaso final.
- **Pendiente F:** entorno Python fijado y validado para regenerar referencias; se consumen las actuales sin modificación. Permanecen los tres avisos `import.meta` heredados, con ruta inline comprobada; no se cambió vendor para ocultarlos.
- **Límite de esta entrega:** router, vistas, `app/src`, física, tolerancias y `baseline-v1` intactos. `dist` sin seguimiento. C/D se trabajan en paralelo; esta entrega no los corrige ni integra. No se ejecutó SIESTA.
- **Continuidad F:** revisar el PR y sus checks antes de integrar; si se continúa en la regeneración Python, abrir tarea y rama específica. No reutilizar ramas de C/D ni modificar su implementación como parte de F.
