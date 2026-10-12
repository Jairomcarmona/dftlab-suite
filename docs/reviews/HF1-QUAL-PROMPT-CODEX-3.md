# Prompt único para Codex, v3: de C0 a Q6 con la receta HF-1 registrada

Pega esto tal cual. Sustituye a los prompts [1](HF1-QUAL-PROMPT-CODEX.md) y [2](HF1-QUAL-PROMPT-CODEX-2.md) desde el paso 3. Todo está resuelto en [ADR-017 Adenda 8](../adr/ADR-017-tarea-controladora-qraft-hf1.md#adenda-8-2026-10-12-issue-70-receta-hf-1-registrada-recorrido-completo-de-c0-a-q6-y-arnés-especificado). No preguntes diseño.

## Qué cambió

`main` ya tiene la receta HF-1 (`dftlab_platform.hf1_recipe`) y la validación de flujos controlador. La tarea usa `walltime_seconds = 1800` (la de 3600 no cabía en el presupuesto de QRAFT). El arnés de Q está especificado en H.4 y H.5.

## Pasos

1. **Actualizar.** `git pull --ff-only origin main`, reconstruir el wheel, instalarlo y pasar `test_hf1*.py` y `test_authoring.py` instalados.
2. **Preflight**, una ejecución por versión corregida del código (Adenda 7 G.4), y `controller_profile_findings` con el perfil exterior (Adenda 6 F.2, con tarea de **1800 s**).
3. **Arnés en seco.** Escribe el arnés de operador a partir de `deployment/local/qualify_native_handlers.py` y `qualify_native_runtime.py` con la receta de H.1 (`recipe_registry(...)`, mismo `bundle_sha256` y `profile_id`). Ejecuta `--dry-run` (autoría, sonda, guion; sin `sbatch`). Los fallos son defectos de arnés y se arreglan con G.4.
4. **C0** por la ruta completa de la plataforma: factory con `max_seconds = 1800`, `grace_seconds = 10`; sonda nueva justo antes del `sbatch` (nodo `IDLE` primero); si tu job queda `PENDING` 120 s, cancela solo ese job y repite (máximo 2). Compara `U_scalar_charge` por sitio con D.3.
5. **Q (opción A de F.4)** con el arnés de H.4/H.5: `runtime.pid` escrito antes de `exec`, vigilante por `key.node_id`, `SIGTERM`/`SIGKILL` solo al PID del runtime, copia fresca de `state.sqlite` por intento, `RunInspector().resume(...)` como plan de solo lectura, `sbatch --no-requeue` nuevo con sonda nueva, `wsl --shutdown` y munge/SLURM según F.5.
6. **Veredicto** D.6 con la evidencia de H.5.6. Un solo PR documental final con C0, Q y TRASPASO; cierra el seguimiento en siestaflow #10 y dftlab-suite #70 con su enlace.

## Regla de PR (de Manuel)

Pocos PR; el avance vivo va en comentarios de #70. Los arreglos de código relacionados, en un solo PR. Nunca un PR documental solo para anotar otro PR.

## Nunca

Tocar un job que no creaste; editar entradas, perfil privado, fórmulas, gates, tolerancias, contratos o pins; cambiar la semántica de autoridad, cancelación o propiedad de procesos; declarar `PASS` sin D.6; relanzar un nodo asentado.

## Paradas permitidas (y solo estas)

- Un `FAIL` fuera de las tres clases de G.4, o un error al que ya aplicaste 2 arreglos.
- E.3.2 por debajo de 1800 s después de subir la allocation a 7200 s.
- `FAIL` o `INCONCLUSIVE` de D.6, o que Q4 consuma un intento.
- Contraseña de `sudo` no disponible al reiniciar SLURM tras `wsl --shutdown`.
- Lo que Manuel decida en #70 (opción B de F.4).
