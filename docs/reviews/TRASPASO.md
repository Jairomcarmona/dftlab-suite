# Nota de traspaso: estabilización A–E

Fecha: 2026-10-11. Escrita para quien continúe (otro agente o persona) sin acceso a la conversación.

## Estado de ramas y PR

| Bloque | Rama | PR | Base |
|---|---|---|---|
| Registro de deuda y revisión externa | `claude/estabilizacion-registro-a-e-7imxti` | #1 | `main` |
| A: calculadoras / `fftGood` | `claude/fix-a-calc-validation` | #2 | rama del registro |
| E: inserción segura | `claude/fix-e-safe-html` | #3 | rama de A |

Los PR están **apilados**: integrar en orden #1 → A → E (al fusionar uno, cambiar la base del siguiente a `main`). Ninguno está fusionado. `main` sigue en `ae3f35e`. Los SHA exactos de cada rama son los de la punta de la rama en GitHub.

## Objetivo

Corregir fallos funcionales, de seguridad y de ciclo de vida del frontend actual antes de migrar. La revisión externa es evidencia: `REGISTRO_DEUDA.md` indica qué está reproducido, confirmado por inspección o pendiente.

## Qué se hizo

- Persistencia de la revisión externa y registro A–H con commit/entorno exactos y diferencias con la copia externa.
- **A:** `tools/cellmesh.js` (`fftGood` acotado, validación física); `views/calc.js` muestra estado de edición o error y no genera `.fdf` inválido.
- **E:** `core/escape.js` (`esc` con comillas), escape de capturas en `annotateLines`, tabla de resumen de `postproc.js` con `H()` para HTML de confianza, error del router con `textContent`.
- Pruebas: `app/tests/ui/run_calc_tests.mjs` y `run_escape_tests.mjs` (en `scripts/verify.mjs`) y `app/tests/ui/browser_regressions.mjs` (no está en `verify` ni en CI).

## Resultados de pruebas (Node 22.22.0, Linux)

`node scripts/verify.mjs`: lectores 341/0, mallas 81/0, lectura anotada 26/0, `.FC` correcto, cristalografía 371/371 y 71/71, calc 51/0, escape 15/0, build correcto. `NODE_PATH=<global> node app/tests/ui/browser_regressions.mjs` tras `node app/scripts/build.mjs`: 24/0. CI (Node 24.18.0, Windows+Linux) no se ha visto sobre estas ramas al escribir esto.

## Pendiente

- **B, C/D, G, H:** sin empezar (hilos separados). Ver el registro para archivos e inspecciones previas (p. ej. 9 de 19 vistas sin `destroy`; `onTheme` sin desuscriptor; `addTexts` de `postproc.js` para EIG/KP; `f.text()` para mallas).
- **F:** `npm test`, quitar el fallback `/opt/run/tools/node_modules` de `app/scripts/build.mjs`, sustituir `serve` con `python3`, Playwright como dependencia fijada y prueba de navegador en CI (incluida `browser_regressions.mjs`, con `REQUIRE_BROWSER=1`), verificación offline.
- La auditoría de E cubre las rutas de datos importados; no se revisaron las 19 vistas línea a línea.

## Siguiente paso

Revisar y fusionar #1, luego A y E; después B (ciclo de vida: `onTheme` con desuscriptor, destrucción en el router, cuidado con `root.isConnected`). Al empezar B, aprovechar `browser_regressions.mjs` para añadir la prueba xc → inicio → tema.

## Reglas a respetar

`baseline-v1` intacta; no cambiar tolerancias científicas; no migrar a React todavía; no dos agentes en la misma carpeta.
