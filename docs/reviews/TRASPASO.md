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
- **F:** `npm test`, quitar el fallback `/opt/run/tools/node_modules` de `app/scripts/build.mjs`, sustituir `serve` con `python3`, Playwright como dependencia fijada y pruebas de navegador en CI (`browser_regressions.mjs` y `browser_lifecycle.mjs`, con `REQUIRE_BROWSER=1`), verificación offline.
- La auditoría de E cubre las rutas de datos importados; no se revisaron las 19 vistas línea a línea.

## Siguiente paso

Bloques **C y D** (importación coherente de archivos científicos en `views/postproc.js`): un conjunto de archivos por corrida con recálculo de dependencias EIG↔KP al añadir/sustituir/quitar; bytes para lectores de malla (`parseGrid`) y texto para los textuales; conectar `.dftlab.json` con `unpackDftlab` o declarar exactamente qué no se visualiza. Las vistas reciben ahora `render(el, view)`: comprobar `view.alive` tras cada `await` en el código nuevo.

## Reglas a respetar

`baseline-v1` intacta; no cambiar tolerancias científicas; no migrar a React todavía; no dos agentes en la misma carpeta.
