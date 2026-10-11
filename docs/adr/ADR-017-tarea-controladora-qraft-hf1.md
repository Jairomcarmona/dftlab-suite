# ADR-017: tarea controladora en QRAFT para HF-1 (reserva, lanzamiento directo, cancelación y recuperación)

Estado: **aceptado** el 2026-10-11 (diseño; implementación en QRAFT pendiente, [siestaflow #10](https://github.com/Jairomcarmona/siestaflow/issues/10)). Concreta [ADR-006](ADR-006-hubbard-hf1-hf2.md) §1 y [ADR-015](ADR-015-hubbardflow-capa-bajo-qraft.md) §1; no cambia [ADR-007](ADR-007-controlador-unico-reconciliacion-idempotencia.md).
Fecha: 2026-10-11. Cambio upstream: **U-Q9** en [QRAFT](../compatibility/QRAFT_4d996ea.md) y **U-H7** en [HubbardFlow](../compatibility/HUBBARDFLOW_e508f47.md).

## Contexto

La calificación HF-1 contra QRAFT `41043ed` (wheel instalado, Python 3.12.10, WSL) llega hasta el paquete y falla allí: `gate task must use mpi_processes=1, cpus_per_process=1, nodes=0: hubbard`. El runtime fijado solo conoce dos clases de tarea:

| Clase | Lanzador | Recursos que cuenta | Uso |
|---|---|---|---|
| `siesta` | srun/hydra/openmpi del perfil, bajo MPI | `mpi_processes × cpus_per_process`, nodos con hosts exclusivos | Un SCF |
| `gate` | `DirectLauncher`, sin MPI | 1 CPU, 0 nodos | Comandos pequeños de decisión |

HF-1 necesita una tercera forma: **un único controlador HubbardFlow, lanzado directamente y sin MPI, que dentro de su reserva lanza sus propios SIESTA MPI**. Etiquetarlo como `siesta` lo arrancaría bajo MPI (replicado); como `gate` reservaría 1 CPU mientras usa un nodo entero. Las dos opciones falsean la contabilidad, y Codex hizo bien en dejar el fallo explícito.

Además, hoy `DirectLauncher.terminate_all` manda la señal solo al PID del hijo (`execution/direct_launcher.py`), sin grupo de procesos: con un controlador, sus `mpirun` quedarían vivos. Y HubbardFlow valida sus hosts contra la allocation completa (`execution/slurm_environment.py`, `hosts == SLURM_NNODES`), no contra una reserva.

## Decisión

### 1. Nueva clase de tarea nativa `controller`

QRAFT añade `kind: controller` al esquema de campaña del paquete. Es aditiva: `siesta` y `gate` no cambian, y un paquete sin tareas `controller` se serializa byte a byte igual que hoy. Un paquete con alguna tarea `controller` declara `schema_version: "2.1"`, así que un QRAFT anterior lo rechaza por versión en vez de interpretarlo.

Registro de la tarea en `campaign.yaml` (lo emite el `task_adapter` público de U-Q3):

```yaml
- task_id: hf1-lru
  kind: controller
  capability_id: hubbardflow.hf1.lr-u      # igual al del workflow lock; se verifica
  input: protected/hf1-lru/plan/campaign.json
  input_hashes: {...}                      # como siesta/gate
  input_destinations: {...}
  required_artifacts: [...]
  optional_artifacts: [...]
  depends_on: [...]
  transfers: [...]
  mpi_processes: 1                         # el controlador es un proceso
  cpus_per_process: 1
  nodes: 0
  reservation:
    nodes: 1
    cpus: 8                                # = nodes × CPUs por nodo de la allocation
    inner_launcher: openmpi                # hydra | openmpi en la primera versión
    inner_processes_per_node: 4
    inner_cpus_per_process: 1
    max_concurrent_inner_launches: 1
  estimated_runtime_seconds: 86400
  max_attempts: 3
```

Reglas de validación (en `load_controller_config` y en el preparador):

- `capability_id` y `reservation` son obligatorios; `command`, `require_scf_converged` y cualquier override de ejecutable están prohibidos.
- `mpi_processes = cpus_per_process = 1` y `nodes = 0` describen el proceso controlador; los recursos reales están en `reservation`.
- **Reserva de nodos completos.** `reservation.nodes ≥ 1` y `reservation.cpus = reservation.nodes × (total_cpus / nodes)` de la allocation. No hay reservas de medio nodo: los lanzadores internos necesitan hosts propios, y así la cifra coincide con lo que SLURM factura (T-023b observó `AllocTRES cpu=8` para 4 ranks).
- `inner_processes_per_node × inner_cpus_per_process × max_concurrent_inner_launches ≤ cpus / nodes`. `inner_cpus_per_process = 1` mientras el preparador exija `cpus_per_process = 1`.
- `inner_launcher` debe ser un lanzador registrado que la capability declare soportar (§3). `srun` interno queda fuera de la primera versión.
- La capability vinculada debe ser `ENGINE` o `EXECUTABLE` y estar en `capability_bindings`, que para tareas `controller` es **obligatorio** (hoy es opcional).
- Solo en POSIX: en Windows nativo el paquete se rechaza con `CONTROLLER_REQUIRES_POSIX`.

`reservation` entra en el run lock y en la huella del runtime: cambiarla invalida la reutilización de intentos.

### 2. Reserva y liberación dentro de QRAFT

- **Una sola autoridad.** El `ResourceCoordinator` del `CompiledWorkflowRuntime` concede la reserva como un `ResourceLease` normal con `cpus = reservation.cpus`, `nodes = reservation.nodes` y `exclusive_hosts = true`. No hay un segundo planificador ni capacidad aparte para el controlador.
- Mientras dure el lease, ninguna otra tarea (`siesta`, `controller` ni `gate`) usa esos hosts ni esas CPU. Un `gate` solo arranca si quedan CPU fuera de la reserva; en un worker de un nodo espera a que el controlador termine.
- **Liberar exige grupo vacío.** El lease se libera cuando el proceso controlador ha salido **y** su grupo de procesos está vacío (§5). Que salga el líder no basta.
- Tipos nuevos en `qraft.api`: `ControllerReservation` (los campos de `reservation`) y un mapa `controller_reservations: {task_id: ControllerReservation}` que la traducción del paquete pasa al runtime. `ExecutionSpec` (Core Contracts 1.0) no cambia.

### 3. Lanzamiento directo de un punto de entrada declarado

- La capability declara en `CapabilityDescriptor.metadata["qraft.controller"]` (extensión versionada `1.0`, mismo patrón que `qraft.integration` de U-Q8): `distribution`, `entrypoint` (nombre de `console_scripts`), `inner_launchers` soportados y `resume: NATIVE_VERIFIED | NONE`.
- QRAFT resuelve el ejecutable con `importlib.metadata` de esa distribución **en el entorno en ejecución** y obtiene una ruta absoluta. No busca en `PATH`, no acepta comandos del paquete ni del perfil y no descubre plugins. Si el entrypoint no existe, el intento falla antes de reservar (`CONTROLLER_ENTRYPOINT_MISSING`).
- `build_command` de la capability devuelve exactamente `(<entrypoint resuelto>, "--qraft-reservation", <ruta relativa>)`, más argumentos propios sin rutas absolutas. El runtime comprueba que `command[0]` es el entrypoint resuelto.
- El lanzador `controller` (nuevo `RegisteredLauncher`, sin MPI) arranca el proceso con `start_new_session=True` (grupo propio), `stdin` cerrado y el entorno del perfil más `QRAFT_CONTROLLER_RESERVATION=<ruta>`. Registra `pid`, `pgid`, host y `boot_id` en la evidencia del intento antes de esperar.

### 4. Descriptor de reserva y libro de lanzamientos internos

QRAFT escribe, antes de lanzar, `.qraft/controller-reservation.json` en el directorio del intento, con contrato nativo **`qraft.controller-reservation@1.0`** y digest `qraft.content-sha256-v1`, registrado en el manifiesto del intento:

| Campo | Contenido |
|---|---|
| `run_fingerprint`, `task_id`, `attempt_id`, `attempt_number`, `authority_generation` | Identidad del intento y del fencing de U-Q7 |
| `capability` | `capability_id`, versión y plugin |
| `allocation` | `scheduler` (`slurm`/`local`), `allocation_id` (job SLURM o ID local) |
| `reserved` | `hosts` (resueltos, únicos), `nodes`, `cpus` |
| `inner` | `launcher_kind`, `launcher_command` (ruta absoluta del perfil), `processes_per_node`, `cpus_per_process`, `max_concurrent`, `environment` |
| `deadline` | `stop_launching_at` y `hard_stop_at` (UTC), del tiempo restante menos `shutdown_margin_seconds` |
| `paths` (relativas) | `state_dir`, `stop_request`, `inner_ledger`, `resume_verdict` |
| `previous_attempt` | `null` o `{attempt_id, outcome, state_manifest_sha256}` |

El controlador escribe el libro **`qraft.controller-inner-ledger@1.0`** (JSONL de solo anexado, `fsync` por línea) en `paths.inner_ledger`. Por cada lanzamiento interno anota:

1. `LAUNCH_INTENT` **antes** de crear el proceso: `inner_id = <task_id>/<attempt_id>/<id nativo del nodo>`, hosts, ranks, digest del argv y hora.
2. `LAUNCH_STARTED` con su PID.
3. `LAUNCH_FINISHED` con código de salida y duración, o `LAUNCH_ABANDONED` si se cerró por parada.

Al terminar el controlador, QRAFT valida el libro y el intento **nunca** queda `COMPLETED` si:

- un lanzamiento usa hosts fuera de `reserved.hosts`;
- en algún momento los ranks × CPU concurrentes superan `reserved.cpus`, o hay más lanzamientos simultáneos que `max_concurrent`;
- hay un `LAUNCH_INTENT` posterior a `stop_launching_at`;
- hay un `LAUNCH_INTENT` sin cierre;
- el mismo `inner_id` aparece como `LAUNCH_FINISHED` con éxito en dos intentos.

En esos casos la clasificación técnica es `CONTROLLER_RESERVATION_VIOLATED`. Es una comprobación **posterior**: QRAFT no puede vigilar en tiempo real lo que lanza el controlador. La contención preventiva la dan los hosts y ranks que el controlador recibe, sin otros, y en SLURM además los límites del job.

### 5. Cancelación y parada

Se aplica a cualquier petición de parada: `SIGTERM` de `scancel`, margen de walltime, `AuthorityLost` de U-Q7 o cancelación desde la plataforma vía SchedulerGateway.

1. QRAFT deja de conceder leases y escribe `paths.stop_request`.
2. Manda `SIGTERM` **al líder** del grupo. El controlador lo traduce a su parada cooperativa (U-H7), deja de lanzar, cierra sus lanzamientos internos, anota `LAUNCH_ABANDONED`, guarda su checkpoint y sale.
3. Pasado `termination_grace_seconds`, `SIGKILL` **a todo el grupo** (`killpg`).
4. QRAFT comprueba que el grupo está vacío (`killpg(pgid, 0)` → `ProcessLookupError`) y registra `process_group_closed: true`. Si no puede cerrarlo, el intento queda `INTERRUPTED` con `CONTROLLER_DESCENDANTS_ALIVE`, el lease **no** se libera en esta invocación y el estado del controlador sigue bloqueado (§6) hasta reconciliar.

Los lanzadores internos no pueden hacer `setsid` ni demonizarse; HubbardFlow lo garantiza en U-H7. En SLURM, la limpieza por cgroup al terminar el job es la red de seguridad. En el worker WSL no hay cgroup garantizado, así que lo que cuenta es el grupo de procesos más la comprobación del paso 4.

### 6. Recuperación tras caída: dos niveles, ningún lanzamiento interno dos veces

- **Estado persistente por tarea.** QRAFT crea `controller-state/<task_id>/` en la raíz del run, fuera de los directorios de intento, que son inmutables. El contenido es de HubbardFlow (checkpoint con `dag_digest`, `worker-state`). QRAFT es dueño de la ubicación, del cerrojo y de su manifiesto.
- **Cerrojo de propiedad.** `controller-state/<task_id>/owner.json` contiene `{attempt_id, authority_generation, host, boot_id, pgid}` y se escribe de forma atómica antes de lanzar. Un intento nuevo solo puede tomarlo si el dueño anterior está demostrado muerto:
  - mismo host y mismo `boot_id`: el `pgid` ya no existe;
  - otra allocation: evidencia terminal verificada del job anterior (`TerminalSchedulerEvidence` de U-Q5).

  Si no, la tarea queda `BLOCKED` con `CONTROLLER_PREVIOUS_OWNER_ALIVE`; nunca se mata a ciegas un grupo ajeno.
- **Integridad entre intentos.** Al cerrar cada intento, QRAFT guarda el SHA-256 del manifiesto del directorio de estado (`state_manifest_sha256`) en la evidencia. Antes del siguiente intento verifica que el directorio no ha cambiado. Si cambió, `BLOCKED` con `CONTROLLER_STATE_TAMPERED`.
- **Reanudar es responsabilidad del controlador, verificada.** En el intento N > 1, el descriptor lleva `previous_attempt`. Antes de cualquier lanzamiento interno, el controlador ejecuta su `check_resume` (U-H4) y escribe `paths.resume_verdict`. Si lo rechaza (plan, pseudo, `.DM` o política cambiados), sale con el código reservado `75` y la tarea queda `BLOCKED` con el motivo nativo. No se reintenta desde cero en silencio.
- **Sin doble envío interno.** Un `inner_id` con `LAUNCH_FINISHED` correcto en un libro anterior no se relanza: lo impide el checkpoint del controlador y QRAFT lo comprueba (§4). Un `LAUNCH_INTENT` sin cierre en un intento anterior se considera interrumpido y solo puede repetirse después de tomar el cerrojo, es decir, con el dueño anterior demostrado muerto.
- `max_attempts` cuenta intentos del controlador. Cada intento posterior al primero es una reanudación, no un reinicio.

### 7. SLURM y worker WSL

| | SLURM | Worker local WSL/Linux |
|---|---|---|
| Dónde corre el controlador | Hijo directo del runtime de QRAFT en el paso batch; no es un paso `srun` | Hijo directo del runtime |
| Hosts | `scontrol show hostnames` (ya lo hace QRAFT); la reserva toma `nodes` hosts exclusivos | El hostname local; `reservation.nodes = 1` |
| Lanzamiento interno | `mpirun`/`mpiexec.hydra` con `--host` restringido a `reserved.hosts`; en nodos remotos lo arranca el plm de SLURM | Igual, con un host |
| Cancelación externa | `scancel` → `SIGTERM` al job → §5; el cgroup del job limpia lo que quede | Cancelación de la plataforma → §5 |
| Dueño anterior muerto | Evidencia terminal verificada del job (U-Q5) | `pgid` inexistente con el mismo `boot_id` |

QRAFT no hace `sbatch` ni `scancel`: sigue siendo trabajo de SchedulerGateway (conclusión 4 del inventario).

### 8. Resultado y evidencia

- `classify_result` de la capability decide el estado técnico con su propio criterio. QRAFT añade los vetos de §4–§6. Un `exit 0` no es éxito sin libro válido y grupo cerrado.
- Evidencia del intento: descriptor y su digest, libro, `resume_verdict` si lo hay, `pid`/`pgid`/`boot_id`, `process_group_closed`, `state_manifest_sha256` y cola de stdout/stderr. Sin cambios en el lock del workflow.
- La ciencia no cambia: `U_scalar_charge`, `NOT_ESTABLISHED` y los gates siguen siendo de HubbardFlow (ADR-006 §4).

### 9. Lo que no se hace

Comando genérico, descubrimiento automático de plugins, `PATH`, overrides de comando, segundo planificador, controlador bajo MPI, cambios de gates, fórmulas o tolerancias, `srun` interno (posterior), y reservas parciales de nodo.

## Lado plataforma (dftlab-suite)

- **`CapabilityDescriptor.execution_shape`** (opcional, `STEP` por omisión): `CONTROLLER` declara que la capability ocupa nodos completos durante toda su ejecución. El schema exige `supports.cancel = COOPERATIVE` y `supports.resume ≠ NATIVE_ASSERTED` en ese caso.
- **Presupuesto (T-027).** La retención de una tarea `controller` es `reservation.cpus × estimated_runtime_seconds` en `allocated_cpu_second`, leído del run lock nativo y nunca de los ranks internos. La forma de la respuesta de admisión sigue abierta en [#47](https://github.com/Jairomcarmona/dftlab-suite/issues/47).
- **Evidencia.** El descriptor y el libro se guardan como `ArtifactRecord` con `NativeContractRef` (`qraft.controller-reservation@1.0`, `qraft.controller-inner-ledger@1.0`). `RunProjection.native_refs` los referencia. Los `inner_id` son IDs hijos de la tarea exterior, como pide ADR-006 §1, y la plataforma no los convierte en runs propios.
- **Calificación.** `CapabilityQualificationRecord` con `hubbard_mode: HF-1` exige las pruebas de abajo en el target. Hasta entonces el catálogo no pasa de `CONTRACT_TESTED` y no admite `EXECUTION`.

## Alternativas

| Opción | Motivo para no adoptarla |
|---|---|
| Etiquetar HF-1 como `siesta` | Lo arranca bajo MPI: N controladores replicados y doble lanzamiento interno |
| `gate` con 1 CPU | Contabilidad falsa: reserva 1 CPU y usa un nodo |
| Ampliar `gate` con CPU arbitrarias | Mezcla el comando genérico (prohibido para Hubbard por §8.4) con reservas grandes |
| Reserva con CPU arbitrarias sin hosts exclusivos | Los lanzadores internos necesitan hosts propios; repartir un nodo no es verificable ni coincide con la facturación |
| Que HubbardFlow pida su propio job (`sbatch --wait`, como `slurm_foreground`) | Doble planificación fuera de la allocation (descartado en ADR-006) y sin control de recursos de QRAFT |
| Reiniciar HF-1 desde cero en cada intento | Puede repetir cálculos internos; ADR-006 exige reanudar en los dos niveles |
| Controlar en tiempo real cada lanzamiento interno desde QRAFT (callback por nodo) | Es HF-2 (U-H5), no HF-1 |

## Consecuencias

- HF-1 deja de estar bloqueado en QRAFT cuando U-Q9 y U-H7 se fusionen y se fijen.
- QRAFT gana un tercer lanzador. `DirectLauncher` sigue igual para `gate`, pero la lección del grupo de procesos se aplica solo al controlador.
- En un worker de un nodo, una campaña HF-1 ocupa el nodo entero: no corre nada en paralelo con ella. Es lo esperado.
- La plataforma calcula presupuesto con CPU reservadas, no con ranks.

## Contratos afectados

- **QRAFT (nativos, U-Q9):** esquema de campaña `2.1` con `kind: controller`; `qraft.controller-reservation@1.0`; `qraft.controller-inner-ledger@1.0`; extensión `qraft.controller` 1.0 del descriptor; `ControllerReservation` en `qraft.api`; códigos `CONTROLLER_REQUIRES_POSIX`, `CONTROLLER_ENTRYPOINT_MISSING`, `CONTROLLER_RESERVATION_VIOLATED`, `CONTROLLER_DESCENDANTS_ALIVE`, `CONTROLLER_PREVIOUS_OWNER_ALIVE` y `CONTROLLER_STATE_TAMPERED`.
- **HubbardFlow (U-H7):** entrypoint `console_scripts` del controlador; leer hosts, ranks y plazos del descriptor en vez de la allocation; anotar el libro; `SIGTERM` → parada cooperativa; sin `setsid`; `check_resume` antes de lanzar y código de salida 75 al rechazar.
- **Plataforma:** `capability-descriptor` (`execution_shape`, aditivo, `0.1.x`).

## Pruebas exigidas

QRAFT (consumidor instalado, sin checkout ni `PYTHONPATH`, con fixtures sintéticos y sin SIESTA real en CI):

1. Compilar, preparar y ejecutar una tarea `controller` con una capability de prueba vinculada. Comprobar lease con `cpus = reservation.cpus`, hosts exclusivos, `peak_cpus` y que otra tarea `siesta` espera.
2. Validación del paquete: falta `reservation` o `capability_id`; reserva de medio nodo; `command` presente; binding distinto del lock; inner que no cabe; Windows nativo.
3. Entrypoint inexistente: falla antes de reservar. `build_command` con otro ejecutable: rechazado.
4. Cancelación: controlador que ignora `SIGTERM` y tiene un nieto en su grupo → `SIGKILL` al grupo y `process_group_closed: true`. Nieto que escapa con `setsid` → `CONTROLLER_DESCENDANTS_ALIVE` y lease retenido.
5. Libro: hosts fuera de la reserva, concurrencia excedida, intent tras el plazo, intent sin cierre, éxito duplicado entre intentos → nunca `COMPLETED`.
6. Recuperación: matar el runtime con el controlador vivo; el nuevo intento ve el dueño vivo y queda `BLOCKED`. Con el dueño muerto, reanuda con `previous_attempt`. Estado alterado → `CONTROLLER_STATE_TAMPERED`. Veredicto de rechazo (75) → `BLOCKED`.
7. Regresión: paquetes `siesta`/`gate` 2.0 producen los mismos bytes, huellas y comportamiento.

Calificación de la plataforma (fuera de CI, Ola 3): HF-1 real pequeño en WSL con SLURM 23.11.4 y Open MPI 4.1.6, incluida la cancelación durante un SCF interno (ADR-006 §Pruebas) y una reanudación tras caída.

## Migración

Nada que migrar: no hay paquetes HF-1 en uso. Codex mantiene la integración HF-1 deshabilitada hasta fijar los commits de U-Q9 y U-H7 en `engine-versions.lock.json` y calificarlos en Windows/WSL.
