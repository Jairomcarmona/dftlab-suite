# Prompt único para Codex, v4: repetir C0 como corrida nueva y seguir hasta el veredicto

Pega esto tal cual. Sustituye a los prompts [1](HF1-QUAL-PROMPT-CODEX.md), [2](HF1-QUAL-PROMPT-CODEX-2.md) y [3](HF1-QUAL-PROMPT-CODEX-3.md). Todo está resuelto en [ADR-017 Adenda 9](../adr/ADR-017-tarea-controladora-qraft-hf1.md#adenda-9-2026-10-12-issue-70-c0-falló-por-state-without-an-owner-la-plataforma-prepara-el-estado-después-de-que-qraft-lo-reclama) y en la [Adenda 8](../adr/ADR-017-tarea-controladora-qraft-hf1.md#adenda-8-2026-10-12-issue-70-receta-hf-1-registrada-recorrido-completo-de-c0-a-q6-y-arnés-especificado). No preguntes diseño.

## Qué cambió

El `FAIL` de C0 (`CONTROLLER_STATE_TAMPERED: state without an owner`) era un defecto de la plataforma, no de QRAFT ni de la ciencia: `prepare_task` copiaba el paquete al estado antes de que el supervisor de QRAFT escribiera `owner.json`. Ahora deja el estado vacío y la entrada nueva `dftlab-hf1-controller` lo llena después del reclamo. QRAFT y HubbardFlow no cambian. El wheel debe reconstruirse: sin el script de consola nuevo, QRAFT no encuentra la entrada.

## Pasos

1. **Actualizar.** `git pull --ff-only origin main`, reconstruir el wheel desde la copia limpia, instalarlo en el venv aislado y pasar `test_hf1*.py` y `test_authoring.py` instalados. Confirma que `dftlab-hf1-controller` está en el `bin` del venv.
2. **Preflight**, una ejecución por versión corregida del código (Adenda 7 G.4), más `controller_profile_findings` con el perfil exterior (tarea de **1800 s**). Esperado: pasan también `HF1_PLATFORM_CONTROLLER_ENTRY`, `HF1_HUBBARDFLOW_CONTROLLER_ENTRY` y `HF1_HUBBARDFLOW_CONTROLLER_MODULE`.
3. **Arnés en seco.** Escribe el arnés de operador a partir de `deployment/local/qualify_native_handlers.py` y `qualify_native_runtime.py`, con la receta de la Adenda 8 H.1. `--dry-run`: autoría, sonda y guion, sin `sbatch`. Los fallos son defectos de arnés (G.4).
4. **C0-r2, corrida nueva** (Adenda 9 I.3). No reutilices la corrida fallida ni su `attempt-0001`: `run_id`, claves de idempotencia, raíz, estado y job nuevos, con el mismo paquete ZIP verificado. No borres, muevas ni edites nada de la corrida fallida.
   - Factory con `max_seconds = 1800`, `grace_seconds = 10`; nodo `IDLE` primero, sonda nueva y `sbatch` seguidos; si tu job queda `PENDING` 120 s, cancela solo ese job y repite (máximo 2).
   - Antes de SIESTA guarda como evidencia que `controller-state/<tarea>/owner.json` existe y que los archivos del paquete tienen `mtime` posterior.
   - Compara `U_scalar_charge` por sitio con D.3. Un `FAIL` de D.6 que no sea el defecto de ordenación se reporta como ya se hizo, sin reparar.
5. **Q (opción A de F.4)** con el arnés de la Adenda 8 H.4 y H.5: `runtime.pid` antes de `exec`, vigilante por `key.node_id`, `SIGTERM` y `SIGKILL` solo al PID del runtime, copia fresca de `state.sqlite` por intento, `RunInspector().resume(...)` como plan de solo lectura, `sbatch --no-requeue` nuevo con sonda nueva, `wsl --shutdown` y munge/SLURM según F.5. Q parte de otra corrida nueva, no de la de C0-r2.
6. **Veredicto** de D.6 con la evidencia de H.5.6. Un solo PR documental final con C0-r2, Q y `TRASPASO.md`. Si el navegador no deja adjuntar archivos locales, anota la ruta y el SHA-256 del ZIP de evidencia en #70 y #10. Cierra el seguimiento en siestaflow #10 y dftlab-suite #70.

## Regla de PR (de Manuel)

Pocos PR. El avance vivo va en comentarios de #70. Los arreglos de código relacionados van en un solo PR. Nunca un PR documental solo para anotar otro PR.

## Nunca

Tocar un job que no creaste. Editar entradas, perfil privado, fórmulas, gates, tolerancias, contratos o pins. Cambiar la semántica de autoridad, cancelación o propiedad de procesos. Modificar QRAFT o HubbardFlow. Escribir un `owner.json` o cualquier archivo en el estado antes del reclamo de QRAFT. Declarar `PASS` sin D.6. Relanzar un nodo asentado.

## Paradas permitidas (y solo estas)

- Un fallo fuera de las clases de G.4, o un error al que ya aplicaste 2 arreglos.
- Una causa en QRAFT o HubbardFlow que no se pueda resolver desde la plataforma (Adenda 9 I.7): un solo comentario en #70 con la causa y la línea del código.
- E.3.2 por debajo de 1800 s después de subir la allocation a 7200 s.
- `FAIL` o `INCONCLUSIVE` de D.6, o que Q4 consuma un intento.
- Contraseña de `sudo` no disponible al reiniciar SLURM tras `wsl --shutdown`.
- Lo que Manuel decida en #70 (opción B de F.4).
