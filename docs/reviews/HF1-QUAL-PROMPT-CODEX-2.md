# Prompt único para Codex, v2: reanudar HF1-QUAL tras los dos FAIL del preflight

Pega esto tal cual. Sustituye al [prompt anterior](HF1-QUAL-PROMPT-CODEX.md) desde el paso 2; los pasos 3 a 7 de aquel siguen igual. Todo está resuelto en [ADR-017 Adenda 7](../adr/ADR-017-tarea-controladora-qraft-hf1.md#adenda-7-2026-10-12-issue-70-los-dos-fail-del-preflight-el-resto-de-la-calificación-recorrido-en-seco-y-permiso-de-arreglar-y-reintentar). No preguntes diseño.

## Qué cambió

Los dos `FAIL` no eran del WSL de Manuel ni de la ciencia. `HOST_PIDFD_AND_SUBREAPER` era un defecto del preflight (llamaba a `os.pidfd_open`, que tu CPython no trae; el worker real usa glibc y ya pasó sus pruebas). `SLURM_PARTITION_QUEUE_EMPTY` era más estricto que el código: lo que exige la sonda es nodo `IDLE`, y los 7 jobs ajenos están `PENDING`. Ambos están corregidos en `main`. Tienes permiso explícito para arreglar y reintentar (Adenda 7 G.4).

## Pasos

1. **Actualizar.** `git pull --ff-only origin main`, reconstruir el wheel de la copia limpia e instalarlo en el entorno WSL aislado. Pruebas `test_hf1*.py` instaladas: deben pasar.
2. **Preflight, una ejecución por versión corregida del código**, con el mismo comando de siempre y el perfil exterior. Esperado: `SLURM_PARTITION_ACTIVE_JOBS=PASS`, `SLURM_PARTITION_PENDING_JOBS=INFO` (guárdalo como evidencia) y `SLURM_PROBE_SCHEDULER_VIEW=PASS`.
   - Si falla un identificador nuevo, aplica G.4 en este orden:
     1. Defecto de código (el comportamiento no es el del ADR): arreglo mínimo, una prueba, PR con los cinco checks verdes, reconstruir wheel y reintentar. **Máximo 2 arreglos por identificador.**
     2. Verificación más estricta que el código: relájala solo si puedes citar la línea de `main` que gobierna esa condición; añade una nota de campo a la Adenda 7 en el PR documental.
     3. Hecho del entorno de Manuel con arreglo evidente y reversible que no toca datos ajenos (servicio caído, permiso propio): arréglalo con el método habitual y anótalo.
   - Un `FAIL` que no cabe en ninguno de los tres se reporta en **un solo** comentario de #70 con todos los identificadores juntos.
3. **Perfil exterior, sondas, C0 y Q** como en el prompt anterior (pasos 3 a 7), con estos añadidos de la Adenda 7:
   - Antes de cada sonda espera a que el nodo esté `IDLE` (cada 5 s, hasta 600 s) y haz sonda y `sbatch` seguidos.
   - Si tu job queda `PENDING` más de 600 s, cancela **solo ese job** con `scancel <id>`, sonda nueva y reenvía; máximo 2 veces, a la tercera es `INCONCLUSIVE` por D.4.
   - Guarda `squeue` completo antes y después de cada intento como evidencia.
   - `sacct` en Q3 es de mejor esfuerzo: si falla, guarda su error y usa `scontrol show job`, `ps` y `/proc`.
   - Tras `wsl --shutdown`, levanta munge y SLURM con el método con el que los dejaste funcionando en esta sesión.

## Nunca

Cancelar, retener, liberar o modificar un job que no creaste. Editar entradas, perfil privado, fórmulas, gates, tolerancias, contratos o pins. Cambiar la semántica de autoridad, cancelación o propiedad de procesos. Declarar `PASS` sin D.6. Relanzar un nodo asentado.

## Paradas permitidas (y solo estas)

- Un `FAIL` fuera de las tres clases de G.4, o un error al que ya aplicaste 2 arreglos.
- E.3.2 por debajo de 1800 s después de subir la allocation a 7200 s.
- `FAIL` o `INCONCLUSIVE` de D.6, o que Q4 consuma un intento.
- Una contraseña de `sudo` que no esté disponible al reiniciar SLURM tras `wsl --shutdown`.
- Lo que Manuel decida en #70 (opción B de F.4).
