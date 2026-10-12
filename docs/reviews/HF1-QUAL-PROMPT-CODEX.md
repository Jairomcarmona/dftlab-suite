# Prompt único para Codex: HF1-QUAL de C0 a Q6

Pega esto tal cual. Todo lo de diseño está resuelto en [ADR-017 Adenda 6](../adr/ADR-017-tarea-controladora-qraft-hf1.md#adenda-6-2026-10-12-issue-70-dos-perfiles-huecos-de-la-calificación-real-y-un-preflight-único) y en la ficha [`ADR-017-caso-calificacion-hf1-nio.json`](../adr/ADR-017-caso-calificacion-hf1-nio.json). No preguntes diseño: si algo no está cubierto, usa la opción conservadora, anótalo como defecto de la adenda y sigue.

## Contexto

Continúas HF1-QUAL en la etapa 4. `main` incluye ADR-017 Adendas 1 a 6. La Adenda 6 separa el perfil de la campaña del perfil exterior de SLURM, cambia el inspector para que acepte `local_wsl` solo en la ruta controller, y añade un preflight de solo lectura. Reglas vigentes: no se editan entradas, perfil privado, fórmulas, gates, tolerancias, contratos ni pins; `FAIL` se reporta sin reparar; nunca se relanza un nodo asentado; no se toca ningún job SLURM ajeno.

## Pasos

1. **Actualizar.** `git pull --ff-only origin main`. Reconstruir el wheel de plataforma desde esa copia limpia e instalarlo en el entorno WSL aislado como en #78. Ejecutar `test_hf1*.py` instalado: deben pasar todas.
2. **Preflight único.** Ejecutar una sola vez, con el paquete D.2 sin editar:
   `python -I -m dftlab_platform.hf1_preflight --state-dir <estado privado> --partition local --reserved-cpus 4 --bundle <zip> --bundle-sha256 <sha> --profile-sha256 <sha del perfil privado> --siesta /home/jmc/.local/siesta-5.4.2-openmpi/bin/siesta --siesta-sha256 aaa9a2e45a41b12f3aad52ca4fca7c25b1cc6afd3aff2a0c7fe145b1bd9f18ce --output <archivo nuevo>`.
   Añadir `controller_profile_findings(resources, perfil_exterior, 4)` con el perfil del paso 3. Si hay algún `FAIL`, publica **un solo** comentario en #70 con la lista completa y su valor observado, y para. Si no hay ninguno, sigue. Los `INFO` (`ProctrackType`, `JobRequeue`, ranks sin `--oversubscribe`) se guardan en la evidencia.
3. **Perfil exterior.** Crear `hf1-controller-outer-slurm-v1` rev. 1 con los valores de F.2 (1 nodo, 4 CPU, 4 tareas, `openmpi`, `max_attempts = 3`, allocation de 3600 s, tarea con `walltime_seconds = 3600`, 2048 MB, entorno de T-023b, sin módulos). Va en el estado privado, no en el repositorio. Calcula `3600 − shutdown_margin_seconds ≥ 1800`; si no, sube a 7200 s si la partición lo permite; si tampoco, publica un comentario en #70 y para.
4. **Sonda nueva** inmediatamente antes de cada `sbatch` (caduca a los 900 s).
5. **C0** por la ruta completa de la plataforma: paquete 2.1, `NativeWorker`, puerto SLURM, autoridad. Factory con `max_seconds = 1800`, `grace_seconds = 10`. Comprueba que el directorio del intento no contiene `hf1-request.json` y que el descriptor registra `stop_launching_at`; el descriptor es registro, no puerta. Compara `U_scalar_charge` por sitio con D.3. Guarda la evidencia de D.6. Cuando C0 cierre, abre **un** PR documental con su resultado y fusiónalo con los cinco checks verdes; no detengas Q por eso.
6. **Q (opción A de F.4)** salvo que Manuel haya contestado B en #70:
   - Un arnés de operador, un `sbatch` propio por intento con `--no-requeue`, sonda nueva antes de cada uno, nunca dos jobs vivos de Q.
   - Un vigilante de solo lectura que sondea cada 100 ms el libro y `siesta.out` (rutas del descriptor) y dispara exactamente las condiciones de D.4.
   - **Q1:** `SIGTERM` solo al PID del runtime de QRAFT. Nunca `scancel`, nunca a un grupo.
   - **Q2:** reanudar con la misma llamada pública de QRAFT que usan sus pruebas de U-Q9 y U-Q9b. Si pide `TerminalSchedulerEvidence`, usa `SlurmTerminalCollector` y `LocalTerminalSigner` (en `main`).
   - **Q3:** `ps -o pid,ppid,sid,stat,cmd` del árbol, `sacct` y `scontrol show config` (`ProctrackType`); después `SIGKILL` solo al PID del runtime.
   - **Q4:** pedir el siguiente intento en el mismo arranque; esperado `BLOCKED` con `CONTROLLER_PREVIOUS_OWNER_ALIVE`.
   - **Q5:** el orquestador vive en Windows y ningún proceso de WSL atraviesa `wsl --shutdown`; cada paso se escribe en `state.json` antes de ejecutarse. Anota en el hilo que vas a ejecutarlo (cierra las sesiones WSL de Manuel) y sigue sin esperar. Tras reiniciar WSL, munge y SLURM: `boot_id` cambió, el nodo está `idle` (si está `down`, `scontrol update NodeName=<nodo> State=RESUME`) y no queda ningún job de Q.
   - **Q6:** intento 3 con sonda nueva; esperado `OWNER_DEAD_BY_BOOT_CHANGE`, integridad según D.5, `CONTINUE`, campaña completa.
   - Si una precondición de D.4 no se cumple, Q es `INCONCLUSIVE`: se repite completa con campaña nueva. No elijas otro nodo. Si Q4 consume un intento de `max_attempts`, para y reporta.
7. **Veredicto** por D.6 con la evidencia que enumera. Abre **un** PR documental con el resultado de Q y fusiónalo con los cinco checks verdes. Cierra el seguimiento en siestaflow #10 y dftlab-suite #70 con enlace a ese PR.

## Paradas permitidas (y solo estas)

- Algún `FAIL` del preflight o de `controller_profile_findings`, reportado en un único comentario de #70.
- Que el cálculo de E.3.2 siga por debajo de 1800 s después de subir la allocation a 7200 s.
- `FAIL` o `INCONCLUSIVE` de D.6, o que Q4 consuma un intento.
- Lo que Manuel decida en #70 (opción B de F.4).

## Qué no hacer

Preguntar diseño, abrir un PR por paso, editar el perfil privado o las entradas, relanzar una clave asentada, usar `scancel` directo en Q, señalar un proceso ajeno, ajustar una tolerancia, ni declarar `PASS` sin D.6.
