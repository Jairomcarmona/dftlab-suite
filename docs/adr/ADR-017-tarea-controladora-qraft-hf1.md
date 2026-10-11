# ADR-017: tarea controladora en QRAFT para HF-1 (reserva, lanzamiento directo, cancelación y recuperación)

Estado: **aceptado** el 2026-10-11, con la **Adenda 1** ([#52](https://github.com/Jairomcarmona/dftlab-suite/issues/52)) y la **Adenda 2** ([HubbardFlow #43](https://github.com/Jairomcarmona/SIESTAFLOW_HUBBARD_RESPONSE_BACKBONE/issues/43)) del mismo día. Es diseño: la implementación en QRAFT está pendiente ([siestaflow #10](https://github.com/Jairomcarmona/siestaflow/issues/10)). Concreta [ADR-006](ADR-006-hubbard-hf1-hf2.md) §1 y [ADR-015](ADR-015-hubbardflow-capa-bajo-qraft.md) §1; no cambia [ADR-007](ADR-007-controlador-unico-reconciliacion-idempotencia.md).
Fecha: 2026-10-11. Cambios upstream: **U-Q9** en [QRAFT](../compatibility/QRAFT_4d996ea.md) y **U-H7** en [HubbardFlow](../compatibility/HUBBARDFLOW_e508f47.md).

El texto de abajo ya integra la Adenda 1, cuya sección [Adenda 1](#adenda-1-2026-10-11-issue-52) explica qué cambió y por qué. La [Adenda 2](#adenda-2-2026-10-11-hubbardflow-43) fija cómo se lee `check_resume` al reanudar y cuándo se asienta un nodo; §4 y §6 la remiten.

## Contexto

La calificación HF-1 contra QRAFT `41043ed` (wheel instalado, Python 3.12.10, WSL) falla al preparar el paquete: `gate task must use mpi_processes=1, cpus_per_process=1, nodes=0: hubbard`. El runtime fijado solo conoce dos clases de tarea:

| Clase | Lanzador | Recursos que cuenta | Uso |
|---|---|---|---|
| `siesta` | srun/hydra/openmpi del perfil, bajo MPI | `mpi_processes × cpus_per_process`, nodos con hosts exclusivos | Un SCF |
| `gate` | `DirectLauncher`, sin MPI | 1 CPU, 0 nodos | Comandos pequeños de decisión |

HF-1 necesita una tercera forma de tarea: **un único controlador HubbardFlow, lanzado directamente y sin MPI, que dentro de su reserva lanza sus propios SIESTA MPI**. Si se etiqueta como `siesta`, QRAFT lo arranca bajo MPI (replicado). Si se etiqueta como `gate`, reserva 1 CPU mientras usa un nodo entero. En los dos casos la contabilidad es falsa.

Tres hechos del código condicionan el diseño:

- `DirectLauncher.terminate_all` manda la señal solo al PID del hijo (`execution/direct_launcher.py`).
- HubbardFlow valida sus hosts contra la allocation completa (`execution/slurm_environment.py`, `hosts == SLURM_NNODES`).
- Su checkpoint se identifica por `(campaign_digest, node_id)` y guarda un `NodeReceipt` con `NodeState` y `evidence_digest` (`execution/generic_executor.py`).

## Decisión

### 1. Nueva clase de tarea nativa `controller`

QRAFT añade `kind: controller` al esquema de campaña del paquete. El cambio es aditivo:

- `siesta` y `gate` no cambian, y un paquete sin tareas `controller` se serializa byte a byte igual que hoy.
- Un paquete con alguna tarea `controller` declara `schema_version: "2.1"`, así que un QRAFT anterior lo rechaza por la versión en vez de interpretarlo.

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
    nodes: 1                               # v1: siempre 1 (§7)
    inner_launcher: openmpi                # hydra | openmpi en v1
    inner_processes_per_node: 4
    inner_cpus_per_process: 1
    max_concurrent_inner_launches: 1
  estimated_runtime_seconds: 86400
  max_attempts: 3
```

El paquete no fija CPU: declara la forma interna, y las CPU se resuelven en el runtime (§2).

Reglas de validación (en `load_controller_config` y en el preparador):

- `capability_id` y `reservation` son obligatorios.
- Están prohibidos `command`, `require_scf_converged` y cualquier override de ejecutable.
- `mpi_processes = cpus_per_process = 1` y `nodes = 0` describen el proceso controlador; los recursos reales están en `reservation`.
- `reservation.nodes = 1` en v1.
- `min_cpus = inner_processes_per_node × inner_cpus_per_process × max_concurrent_inner_launches`. Se comprueba contra la capacidad del host en el runtime (§2).
- `inner_cpus_per_process = 1` mientras el preparador exija `cpus_per_process = 1`.
- `inner_launcher` debe ser un lanzador registrado que la capability declare soportar (§3). `srun` interno queda fuera de v1.
- La capability vinculada debe ser `ENGINE` o `EXECUTABLE` y estar en `capability_bindings`, que para tareas `controller` es **obligatorio** (hoy es opcional).
- Solo POSIX: en Windows nativo el paquete se rechaza con `CONTROLLER_REQUIRES_POSIX`.

`reservation`, tal como la declara el paquete, entra en el run lock y en la huella del runtime. Los valores observados en el runtime van a la evidencia del intento y no alteran la huella.

### 2. Reserva y liberación dentro de QRAFT

**Qué significa «host completo».** Es el uso exclusivo, **dentro de esta allocation**, de todas las CPU que el modelo de allocation de QRAFT atribuye a ese host: `runtime_cpus = total_cpus / nodes` del perfil. No afirma poseer las CPU físicas del nodo ni excluir otros jobs del sitio. Eso depende de cómo se pidió el job (`--exclusive`, `OverSubscribe`), y QRAFT no lo infiere.

- **Una sola autoridad.** El `ResourceCoordinator` del `CompiledWorkflowRuntime` concede la reserva como un `ResourceLease` normal con `cpus = runtime_cpus`, `nodes = 1` y `exclusive_hosts = true`. No hay un segundo planificador.
- **Comprobaciones antes del lease.** Se exige `min_cpus ≤ runtime_cpus`. Si no, la tarea falla con `CONTROLLER_ALLOCATION_INSUFFICIENT`.
- **CPU observadas en SLURM.** QRAFT lee `SLURM_JOB_CPUS_PER_NODE`, lo expande en el orden de `scontrol show hostnames` y registra el valor del host como `scheduler_cpus_on_host`. Si es menor que `runtime_cpus`, la tarea se rechaza con `CONTROLLER_ALLOCATION_MISMATCH`: el perfil promete más de lo asignado.
- **CPU en el worker local.** El valor sale de la declaración del perfil (`LOCAL_PROFILE_DECLARATION`), nunca de `os.cpu_count()`.
- **Exclusividad.** Mientras dure el lease, ninguna otra tarea (`siesta`, `controller` ni `gate`) usa ese host ni esas CPU. Un `gate` arranca solo si quedan CPU fuera de la reserva; en un worker de un nodo espera a que el controlador termine.
- **Liberar exige cierre probado** (§5). Que salga el líder no basta, y tampoco que un grupo de procesos esté vacío.
- **Tipos nuevos en `qraft.api`:**
  - `ControllerReservation`, con los campos de `reservation`.
  - Un mapa `controller_reservations: {task_id: ControllerReservation}` que la traducción del paquete pasa al runtime.
  - `ExecutionSpec` (Core Contracts 1.0) no cambia.

### 3. Lanzamiento directo de un punto de entrada declarado, bajo un supervisor

- **Declaración en la capability.** La capability declara en `CapabilityDescriptor.metadata["qraft.controller"]` una extensión versionada `1.0`, con el mismo patrón que `qraft.integration` de U-Q8. Contiene `distribution`, `entrypoint` (nombre de `console_scripts`), los `inner_launchers` soportados y `resume: NATIVE_VERIFIED | NONE`.
- **Resolución del ejecutable.** QRAFT lo resuelve con `importlib.metadata` de esa distribución **en el entorno en ejecución** y obtiene una ruta absoluta.
  - No busca en `PATH`, no acepta comandos del paquete ni del perfil y no descubre plugins.
  - Si el entrypoint no existe, el intento falla antes de reservar con `CONTROLLER_ENTRYPOINT_MISSING`.
- **Comando.** `build_command` de la capability devuelve exactamente `(<entrypoint resuelto>, "--qraft-reservation", <ruta relativa>)`, más argumentos propios sin rutas absolutas. El runtime comprueba que `command[0]` es el entrypoint resuelto.
- **Supervisor.** El lanzador `controller` (nuevo `RegisteredLauncher`, sin MPI) no lanza el controlador directamente. Arranca un **supervisor** de QRAFT, `python -I -m qraft.execution.controller_supervisor`, con `start_new_session=True`.
  - El supervisor fija la contención (§5) **antes** de crear el controlador como hijo suyo, con `stdin` cerrado y el entorno del perfil más `QRAFT_CONTROLLER_RESERVATION=<ruta>`.
  - Registra en el descriptor `pid`, `start_time_ticks` (campo 22 de `/proc/<pid>/stat`) y `boot_id` (`/proc/sys/kernel/random/boot_id`) del supervisor.
  - El runtime nunca envía señales al controlador ni a un grupo: habla con el supervisor.
- **`gate` no cambia:** sigue con `DirectLauncher`.

### 4. Descriptor de reserva y libro de lanzamientos internos

**Descriptor.** QRAFT escribe, antes de lanzar, `.qraft/controller-reservation.json` en el directorio del intento. Usa el contrato nativo **`qraft.controller-reservation@1.0`** con digest `qraft.content-sha256-v1` y queda registrado en el manifiesto del intento. Schema: [`contracts/schemas/qraft-controller-reservation.schema.json`](../../contracts/schemas/qraft-controller-reservation.schema.json).

| Campo | Contenido |
|---|---|
| `run_fingerprint`, `task_id`, `attempt_id`, `attempt_number`, `authority_generation` | Identidad del intento y del fencing de U-Q7 |
| `capability` | `capability_id`, versión y plugin |
| `allocation` | `scheduler` (`slurm`/`local`) y `allocation_id` (job SLURM o ID local) |
| `reserved` | `hosts` (uno, el del runtime), `nodes = 1`, `runtime_cpus`, `min_cpus`, `scheduler_cpus_on_host {value, source}` |
| `containment` | `method` (`SUBREAPER_PIDFD` o `CGROUP_V2_DELEGATED`), `supervisor {pid, start_time_ticks, boot_id}`, `cgroup_path` |
| `inner` | `launcher_kind`, `launcher_command` (ruta absoluta del perfil), `processes_per_node`, `cpus_per_process`, `max_concurrent`, `environment` |
| `deadline` | `stop_launching_at` y `hard_stop_at` (UTC), calculados del tiempo restante menos `shutdown_margin_seconds` |
| `paths` (relativas) | `state_dir`, `stop_request`, `inner_ledger`, `resume_verdict` |
| `previous_attempt` | `null` o `{attempt_id, outcome, closure, state_manifest_sha256}` |

**Libro.** El controlador escribe el libro **`qraft.controller-inner-ledger@1.0`** (JSONL de solo anexado, `fsync` por línea) en `paths.inner_ledger`. Schema de cada línea: [`contracts/schemas/qraft-controller-ledger-entry.schema.json`](../../contracts/schemas/qraft-controller-ledger-entry.schema.json). Cada línea lleva dos identificadores:

- **`key` = `{checkpoint_identity, node_id}`.** Es la identidad lógica **estable entre intentos**: la misma con la que HubbardFlow indexa su checkpoint (`campaign_digest` de `JsonDagCheckpoint` y `node_id` del `LRDag`). Se copia byte a byte. QRAFT no la recalcula ni genera IDs nativos.
- **`trace_id` = `<task_id>/<attempt_id>/<seq del LAUNCH_INTENT>`.** Identifica un lanzamiento concreto. Sirve para trazar y **nunca** para deduplicar.

Eventos:

| Evento | Cuándo | Campos |
|---|---|---|
| `LAUNCH_INTENT` | **Antes** de crear el proceso | hosts, ranks, CPU por rank, digest del argv |
| `LAUNCH_STARTED` | Con el proceso creado | PID |
| `LAUNCH_FINISHED` | Al salir el proceso | código de salida |
| `LAUNCH_ABANDONED` | Al cerrarlo por parada | motivo |
| `NODE_SETTLED` | Después de que HubbardFlow guarda en su checkpoint un `NodeReceipt` terminal para esa clave y termina su paso nativo sin retirarlo (Adenda 2 §B.4) | `NodeState` nativo (`VALIDATED` o un fallo terminal) y `evidence_digest`, copiados tal cual |
| `SETTLEMENT_RECOVERED` | En un intento posterior, para un recibo terminal del checkpoint cuya línea `NODE_SETTLED` se perdió por una caída entre guardar el checkpoint y anotar el libro | `source_attempt_id` (el intento donde terminó el lanzamiento) |

Orden obligatorio: primero el checkpoint y después `NODE_SETTLED`. En la reanudación, las líneas `SETTLEMENT_RECOVERED` van **antes** de cualquier `LAUNCH_INTENT` del intento. Si el libro dice asentado y el checkpoint no, el estado es inconsistente: el controlador rechaza la reanudación (código 75, §6).

**Reglas.** QRAFT evalúa los libros de **todos** los intentos de la tarea, en orden. El intento nunca queda `COMPLETED` si se rompe alguna regla:

| Regla | Código |
|---|---|
| Lanzar una clave ya asentada, en cualquier intento y **con cualquier estado nativo** (también `FAILED_SCIENCE`; nada se relanza hasta que pase) | `DUPLICATE_SETTLED_LAUNCH` |
| Dos lanzamientos abiertos de la misma clave | `CONCURRENT_KEY_LAUNCH` |
| Asentar dos veces | `DUPLICATE_SETTLEMENT` |
| Asentar sin un `LAUNCH_FINISHED` de esa clave en el intento | `SETTLED_WITHOUT_FINISHED_LAUNCH` / `SETTLED_KEY_MISMATCH` |
| Recuperar sin un lanzamiento terminado de esa clave en el intento de origen | `RECOVERED_WITHOUT_LAUNCH` |
| Recuperar después de lanzar | `RECOVERY_AFTER_LAUNCH` |
| `checkpoint_identity` distinta entre líneas | `LEDGER_IDENTITY_CHANGED` |
| `seq` no contigua, IDs ajenos o `trace_id` mal formado | `LEDGER_MALFORMED` / `UNKNOWN_TRACE` |
| Un intent abierto cuando el controlador salió normalmente | `UNCLOSED_INTENT` |
| Hosts fuera de la reserva | `HOSTS_OUTSIDE_RESERVATION` |
| Ranks × CPU concurrentes por encima de `runtime_cpus` | `CPU_EXCEEDED` |
| Más lanzamientos simultáneos que `max_concurrent` | `CONCURRENCY_EXCEEDED` |
| Un intent posterior a `stop_launching_at` | `INTENT_AFTER_DEADLINE` |

Los cuatro últimos códigos se clasifican como `CONTROLLER_RESERVATION_VIOLATED`; los demás, como `CONTROLLER_LEDGER_INCONSISTENT`.

Una clave que se lanzó en un intento interrumpido sin llegar a asentarse **sí** puede relanzarse en un intento posterior. Es un reintento de algo que nunca se confirmó, y solo es posible después de probar el cierre del dueño anterior (§6).

Las reglas son ejecutables:

- [`contracts/fixtures/controller-ledger-rules/cases.json`](../../contracts/fixtures/controller-ledger-rules/cases.json) contiene los vectores de conformidad, con el veredicto esperado de cada caso.
- `check-contracts.mjs` los evalúa con un evaluador de referencia.
- Las pruebas de QRAFT deben dar el mismo veredicto en cada caso.

La comprobación es **posterior** al lanzamiento. La contención preventiva consiste en que el controlador solo recibe ese host y esas CPU, y en SLURM además en los límites del job.

### 5. Contención, cancelación y cierre

La comprobación `killpg(pgid, 0)` **no** prueba el cierre: un descendiente que hizo `setsid` sigue vivo en otro grupo (reproducido en WSL, #52). El cierre se prueba con un mecanismo que vea a todos los descendientes.

**Método A, obligatorio en v1: `SUBREAPER_PIDFD`.**

- El supervisor se declara *child subreaper* (`prctl(PR_SET_CHILD_SUBREAPER, 1)`) antes de crear el controlador. Así, todo descendiente que quede huérfano, aunque haya hecho `setsid` o doble `fork`, se reasigna al supervisor y no a `init`.
- El supervisor recoge (`waitpid`) a todos sus hijos. Un PID no se reutiliza mientras su zombi no se recoja.
- **Criterio de cierre:** el líder ha salido **y** `waitpid(-1, WNOHANG)` del supervisor devuelve `ECHILD`. Como todo descendiente vivo cuelga de un hijo del supervisor o es hijo suyo por reasignación, no tener hijos significa que no queda ningún descendiente.
- **Señales seguras frente a reutilización de PID.**
  1. Recorrer `/proc/<pid>/task/*/children` desde el supervisor.
  2. Abrir cada descendiente con `pidfd_open`.
  3. **Después de abrirlo**, comprobar que su cadena de padres sigue llegando al supervisor; el pidfd fija la identidad.
  4. Enviar con `pidfd_send_signal`.
  5. Repetir hasta `ECHILD`.
- **Requisitos:** Linux ≥ 5.3 (`pidfd_open`) y `prctl` disponible. El `RuntimeProbe` lo comprueba.

**Método B, opcional: `CGROUP_V2_DELEGATED`.** Solo si el probe encuentra un subárbol cgroup v2 delegado y escribible con `cgroup.kill` (Linux ≥ 5.14). El supervisor coloca al controlador en un cgroup hijo nuevo. El cierre es `cgroup.procs` vacío después de `cgroup.kill`. No sustituye la recogida del método A; la complementa.

**Sin ninguno de los dos**, el paquete se rechaza antes de reservar con `CONTROLLER_CONTAINMENT_UNAVAILABLE`.

**Secuencia de parada.** Vale para `SIGTERM` de `scancel`, margen de walltime, `AuthorityLost` de U-Q7 y cancelación de la plataforma.

1. QRAFT deja de conceder leases, escribe `paths.stop_request` y manda `SIGTERM` **al supervisor**.
2. El supervisor manda `SIGTERM` al líder por su pidfd. El controlador lo traduce a su parada cooperativa (U-H7): deja de lanzar, cierra sus lanzamientos internos, anota `LAUNCH_ABANDONED`, guarda su checkpoint y sale.
3. Pasado `termination_grace_seconds`, el supervisor manda `SIGKILL` a cada descendiente por pidfd (o `cgroup.kill`) hasta cumplir el criterio de cierre.
4. El supervisor escribe `.qraft/controller-closure.json` con `{state: CLOSED | OPEN, method, remaining}` y sale. QRAFT lo registra en la evidencia del intento.

**Si el cierre no se prueba**, el intento queda `INTERRUPTED`. Esto pasa cuando el estado es `OPEN`, el supervisor muere sin escribir el cierre (por ejemplo, `SIGKILL` u OOM) o el archivo no es legible.

- La causa es `CONTROLLER_DESCENDANTS_ALIVE` o `CONTROLLER_CLOSURE_UNKNOWN`.
- El lease **no** se libera en esta invocación.
- El cerrojo del estado queda tomado hasta que se pruebe la muerte del dueño (§6).
- QRAFT no intenta adivinar ni mata procesos fuera del árbol del supervisor.

**Límite declarado.** Un proceso creado fuera del árbol mediante otro servicio (`systemd-run`, `at`, `ssh` a la propia máquina, activación D-Bus) no queda contenido por el método A. U-H7 prohíbe esos mecanismos al controlador y a sus lanzadores internos. El método B tampoco los cubre.

### 6. Recuperación tras caída: dos niveles, ningún lanzamiento interno asentado dos veces

**Estado persistente por tarea.**

- QRAFT crea `controller-state/<task_id>/` en la raíz del run, fuera de los directorios de intento, que son inmutables.
- El contenido es de HubbardFlow (checkpoint con su `campaign_digest`, `worker-state`).
- QRAFT es dueño de la ubicación, del cerrojo y de su manifiesto.

**Cerrojo de propiedad.** `controller-state/<task_id>/owner.json` contiene `{attempt_id, authority_generation, host, boot_id, supervisor_pid, supervisor_start_time_ticks, closure_ref}` y se escribe de forma atómica antes de lanzar. Un intento nuevo lo toma solo con una de estas pruebas de muerte del dueño anterior:

| Prueba | Valor en `previous_attempt.closure` |
|---|---|
| El cierre registrado del intento anterior es `CLOSED` | `CLOSED` |
| `boot_id` distinto del registrado: el host reinició, incluido `wsl --shutdown` | `OWNER_DEAD_BY_BOOT_CHANGE` |
| Evidencia terminal verificada del job SLURM anterior (`TerminalSchedulerEvidence`, U-Q5), con `ProctrackType=proctrack/cgroup` comprobado por el probe en ese sitio | `OWNER_DEAD_BY_SCHEDULER_TERMINAL` |

Ni la ausencia de un PID, ni la de un grupo, ni una cola vacía bastan. Si no hay prueba, la tarea queda `BLOCKED` con `CONTROLLER_PREVIOUS_OWNER_ALIVE`, y QRAFT nunca mata a ciegas.

**Integridad entre intentos.** Al cerrar cada intento, QRAFT guarda el SHA-256 del manifiesto del directorio de estado (`state_manifest_sha256`). Antes del siguiente intento verifica que el directorio no ha cambiado; si cambió, la tarea queda `BLOCKED` con `CONTROLLER_STATE_TAMPERED`.

**Reanudar lo hace el controlador, y QRAFT lo verifica.**

1. En el intento N > 1, el descriptor lleva `previous_attempt`.
2. Antes de cualquier lanzamiento interno, el controlador ejecuta `check_resume` (U-H4) contra su línea base, carga el checkpoint, lo concilia con los libros anteriores y revalida en seco los recibos, todo según la Adenda 2 §B.2–§B.3. Para cada recibo terminal sin `NODE_SETTLED`, anota `SETTLEMENT_RECOVERED`.
3. Escribe su veredicto `qraft.controller-resume-verdict@1.0` en `paths.resume_verdict`.
4. Si el veredicto es `REFUSE` (plan, pseudo, `.DM` o política cambiados, libro y checkpoint inconsistentes, un fallo asentado o evidencia asentada que ya no revalida), sale con el código reservado `75`. La tarea queda `BLOCKED` con el motivo nativo y no se reintenta desde cero. `NOT_ESTABLISHED` de `check_resume` no es un rechazo ni una aceptación (Adenda 2 §B.1).

**Sin doble envío.** Lo garantizan dos cosas a la vez: el checkpoint del controlador y las reglas de §4, que QRAFT evalúa sobre la clave estable. `max_attempts` cuenta intentos del controlador, y cada intento posterior al primero es una reanudación.

### 7. SLURM y worker WSL

| | SLURM | Worker local WSL/Linux |
|---|---|---|
| Dónde corre | Supervisor y controlador son hijos del runtime de QRAFT en el paso batch; no son un paso `srun` | Hijos del runtime |
| Host reservado (v1) | El host del paso batch, el único que el supervisor contiene | El host local |
| CPU | `runtime_cpus` del perfil; `SLURM_JOB_CPUS_PER_NODE` del host como observación ≥ `runtime_cpus` | `runtime_cpus` del perfil (`LOCAL_PROFILE_DECLARATION`) |
| Lanzamiento interno | `mpirun`/`mpiexec.hydra` con `--host` = el host reservado | Igual |
| Cancelación externa | `scancel` → `SIGTERM` → §5 | Cancelación de la plataforma → §5 |
| Prueba de muerte del dueño | Cierre `CLOSED`, cambio de `boot_id` o job terminal verificado con proctrack/cgroup | Cierre `CLOSED` o cambio de `boot_id` |

**Varios hosts quedan fuera de v1.** Una reserva de varios hosts, o de un host distinto del que ejecuta el runtime, exige contención positiva por host: un observador en cada nodo, o pasos SLURM con su propio cierre verificable. Hasta que exista, `reservation.nodes > 1` se rechaza con `CONTROLLER_CONTAINMENT_UNAVAILABLE`, y nada se infiere de un grupo local vacío ni de la cola.

QRAFT no hace `sbatch` ni `scancel`: sigue siendo trabajo de SchedulerGateway (conclusión 4 del inventario).

### 8. Resultado y evidencia

- `classify_result` de la capability decide el estado técnico con su propio criterio. QRAFT añade los vetos de §4 a §6. Un `exit 0` no es éxito sin libro válido y cierre `CLOSED`.
- La evidencia del intento incluye:
  - el descriptor y su digest;
  - el libro;
  - `resume_verdict`, si lo hay;
  - `controller-closure.json`;
  - la identidad del supervisor;
  - `state_manifest_sha256`;
  - la cola de stdout/stderr.

  El lock del workflow no cambia.
- La ciencia tampoco: `U_scalar_charge`, `NOT_ESTABLISHED` y los gates siguen siendo de HubbardFlow (ADR-006 §4).

### 9. Lo que no se hace

- Comando genérico, descubrimiento automático de plugins, búsqueda en `PATH` u overrides de comando.
- Un segundo planificador, o el controlador bajo MPI.
- Cambios de gates, fórmulas o tolerancias.
- `srun` interno, varios hosts o reservas en hosts remotos (posteriores).
- Usar la ausencia de un grupo de procesos como prueba de cierre.

## Lado plataforma (dftlab-suite)

- **`CapabilityDescriptor.execution_shape`** es opcional, con `STEP` por omisión. `CONTROLLER` declara que la capability ocupa un host completo de la allocation durante toda su ejecución. En ese caso el schema exige `supports.cancel = COOPERATIVE` y `supports.resume ≠ NATIVE_ASSERTED`.
- **Presupuesto (T-027).** La facturación de un run sale de la observación del scheduler sobre **el job** (`AllocTRES`/`sacct`, ligada por `allocation.allocation_id`): las CPU realmente asignadas, como en T-023b (4 ranks pedidos, 8 CPU asignadas).
  - Nunca se convierten ranks en CPU facturadas.
  - `scheduler_cpus_on_host` del descriptor es evidencia de apoyo, no la fuente de facturación.
  - Antes de la admisión, la retención es una estimación conservadora cuya forma sigue abierta en [#47](https://github.com/Jairomcarmona/dftlab-suite/issues/47).
  - Atribuir el coste a la tarea controladora (`runtime_cpus × duración`) es una proyección, etiquetada como tal.
- **Evidencia.**
  - El descriptor y el libro se guardan como `ArtifactRecord` con `NativeContractRef`.
  - La plataforma valida cada uno con los schemas `qraft-controller-reservation` y `qraft-controller-ledger-entry`. QRAFT empaqueta copias idénticas, y su prueba de consumidor compara el SHA-256 de esos schemas con los de este repositorio.
  - `RunProjection.native_refs` los referencia.
  - Las claves `{checkpoint_identity, node_id}` son IDs hijos de la tarea exterior (ADR-006 §1). La plataforma no los convierte en runs propios.
- **Calificación.** `CapabilityQualificationRecord` con `hubbard_mode: HF-1` exige las pruebas de abajo en el target. Hasta entonces el catálogo no pasa de `CONTRACT_TESTED` y no admite `EXECUTION`.

## Alternativas

| Opción | Motivo para no adoptarla |
|---|---|
| Etiquetar HF-1 como `siesta` | Lo arranca bajo MPI: N controladores replicados y doble lanzamiento interno |
| `gate` con 1 CPU | Contabilidad falsa: reserva 1 CPU y usa un nodo |
| Ampliar `gate` con CPU arbitrarias | Mezcla el comando genérico (prohibido para Hubbard por §8.4) con reservas grandes |
| Fijar las CPU en el paquete como `nodes × total_cpus/nodes` (versión inicial) | Confunde las CPU del modelo con las asignadas o las físicas (#52) |
| `killpg(pgid, 0)` como prueba de cierre (versión inicial) | Un descendiente con `setsid` sobrevive (reproducido, #52) |
| cgroup v2 como único método | Requiere delegación, que el WSL calificado no garantiza; queda como método B opcional |
| `inner_id` con el intento dentro como clave de deduplicación (versión inicial) | Cambia en cada intento, así que no detecta el mismo nodo relanzado (#52) |
| Deduplicar solo los éxitos | Permitiría relanzar un `FAILED_SCIENCE` hasta que pase |
| Que HubbardFlow pida su propio job (`sbatch --wait`) | Doble planificación fuera de la allocation (descartado en ADR-006) |
| Controlar en tiempo real cada lanzamiento interno desde QRAFT | Es HF-2 (U-H5), no HF-1 |

## Consecuencias

- HF-1 deja de estar bloqueado en QRAFT cuando U-Q9 y U-H7 se fusionen y se fijen.
- QRAFT gana un lanzador y un supervisor. `DirectLauncher` y `gate` no cambian.
- En v1 una campaña HF-1 ocupa el host del runtime. En un worker de un nodo no corre nada en paralelo con ella.
- Un cierre no probado retiene recursos y cerrojo hasta reiniciar el host o tener evidencia terminal del job. Es una decisión deliberada: preferimos bloquear a lanzar dos veces.
- La plataforma factura con CPU asignadas observadas, no con ranks ni con el descriptor.

## Contratos afectados

- **QRAFT (nativos, U-Q9):**
  - esquema de campaña `2.1` con `kind: controller`;
  - `qraft.controller-reservation@1.0` y `qraft.controller-inner-ledger@1.0`, con los schemas de este repositorio;
  - extensión `qraft.controller` 1.0 del descriptor;
  - `ControllerReservation` en `qraft.api`;
  - módulo `qraft.execution.controller_supervisor`;
  - códigos `CONTROLLER_REQUIRES_POSIX`, `CONTROLLER_ENTRYPOINT_MISSING`, `CONTROLLER_ALLOCATION_INSUFFICIENT`, `CONTROLLER_ALLOCATION_MISMATCH`, `CONTROLLER_CONTAINMENT_UNAVAILABLE`, `CONTROLLER_RESERVATION_VIOLATED`, `CONTROLLER_LEDGER_INCONSISTENT`, `CONTROLLER_DESCENDANTS_ALIVE`, `CONTROLLER_CLOSURE_UNKNOWN`, `CONTROLLER_PREVIOUS_OWNER_ALIVE` y `CONTROLLER_STATE_TAMPERED`.
- **HubbardFlow (U-H7):**
  - entrypoint `console_scripts` del controlador;
  - hosts, ranks y plazos leídos del descriptor en vez de la allocation;
  - libro con `key` copiada de su checkpoint, y `NODE_SETTLED` después de guardar el checkpoint;
  - conciliación con `SETTLEMENT_RECOVERED` antes de lanzar;
  - `SIGTERM` → parada cooperativa;
  - prohibidos `setsid` y los lanzamientos fuera del árbol;
  - `check_resume` antes de lanzar y código de salida 75 al rechazar;
  - línea base `resume-baseline.json`, revalidación nativa en seco y veredicto `qraft.controller-resume-verdict@1.0` (Adenda 2).
- **Plataforma:**
  - `capability-descriptor` (`execution_shape`);
  - schemas nuevos `qraft-controller-reservation`, `qraft-controller-ledger-entry` y `qraft-controller-resume-verdict`;
  - vectores `controller-ledger-rules` y `controller-resume-rules`.

  Todo es aditivo y sigue en `0.1.x`.

## Pruebas exigidas

QRAFT, con consumidor instalado, sin checkout ni `PYTHONPATH`, con fixtures sintéticos y sin SIESTA real en CI:

1. **Recursos.** Compilar, preparar y ejecutar una tarea `controller` con una capability de prueba vinculada. Comprobar un lease con `cpus = runtime_cpus` y host exclusivo, `peak_cpus`, y que otra tarea `siesta` espera. Comprobar los rechazos `CONTROLLER_ALLOCATION_INSUFFICIENT` y `CONTROLLER_ALLOCATION_MISMATCH` (`SLURM_JOB_CPUS_PER_NODE` simulado menor).
2. **Validación del paquete.** Falta `reservation` o `capability_id`; `nodes > 1`; `command` presente; binding distinto del lock; forma interna que no cabe; Windows nativo.
3. **Entrypoint.** Si no existe, falla antes de reservar. Si `build_command` devuelve otro ejecutable, se rechaza.
4. **Contención.**
   - Un controlador que ignora `SIGTERM`, con un nieto que hace `setsid` y otro que hace doble `fork`: tras la gracia los dos se cierran por pidfd y el cierre es `CLOSED`. Una comprobación de grupo sola no debe pasar este caso.
   - Supervisor muerto con `SIGKILL`: `CONTROLLER_CLOSURE_UNKNOWN`, el lease retenido y el cerrojo tomado.
   - Sin `pidfd_open` simulado: `CONTROLLER_CONTAINMENT_UNAVAILABLE` antes de reservar.
   - Ningún proceso ajeno recibe señales.
5. **Libro.** Cada caso de `contracts/fixtures/controller-ledger-rules/cases.json` produce su veredicto, y cada línea valida contra el schema.
6. **Recuperación.**
   - Matar el runtime con el controlador vivo: el siguiente intento queda `BLOCKED` (dueño vivo).
   - Con cierre `CLOSED`: reanuda con `previous_attempt`.
   - Con cambio de `boot_id` simulado: reanuda.
   - Estado alterado: `CONTROLLER_STATE_TAMPERED`.
   - Veredicto 75: `BLOCKED`.
   - HubbardFlow (U-H7), con el consumidor instalado: cada caso de `contracts/fixtures/controller-resume-rules/cases.json` produce su veredicto, que valida contra `qraft-controller-resume-verdict.schema.json`. Con campañas sintéticas, al menos: checkpoint validado sin cambios, nodo interrumpido, plan, pseudo, `.DM` y política cambiados, y respuesta sin calificación física (Adenda 2 §B.5).
   - Recibo terminal sin `NODE_SETTLED`: `SETTLEMENT_RECOVERED` y ningún relanzamiento.
7. **Regresión.** Los paquetes `siesta`/`gate` 2.0 producen los mismos bytes, huellas y comportamiento. Los schemas empaquetados en QRAFT coinciden por SHA-256 con los de este repositorio.

Calificación de la plataforma, fuera de CI (Ola 3): HF-1 real pequeño en WSL con SLURM 23.11.4 y Open MPI 4.1.6. Incluye el probe de contención y de `ProctrackType`, la cancelación durante un SCF interno (ADR-006 §Pruebas) y una reanudación tras caída.

## Migración

No hay nada que migrar: no hay paquetes HF-1 en uso. El prototipo local de Codex (QRAFT `cbd8404`) no se publica como implementación de este ADR. Codex mantiene la integración HF-1 deshabilitada hasta fijar los commits de U-Q9 y U-H7 en `engine-versions.lock.json` y calificarlos en Windows/WSL.

## Adenda 1 (2026-10-11, issue #52)

Codex leyó la versión inicial (PR #51) y encontró tres compuertas lógicas sin resolver. La segunda la reprodujo en WSL: un descendiente con `setsid` siguió vivo aunque `killpg(pgid, 0)` daba `ProcessLookupError`. Las tres son correctas, y las resoluciones ya están integradas arriba:

| # | Problema | Resolución |
|---|---|---|
| A.1 | `inner_id` incluía el intento, así que la regla «mismo `inner_id` con éxito en dos intentos» no podía detectar un relanzamiento | Clave estable `key = {checkpoint_identity, node_id}` copiada del checkpoint nativo; `trace_id` solo traza. «Asentado» = recibo terminal nativo (también un fallo), con `NODE_SETTLED` después del checkpoint y `SETTLEMENT_RECOVERED` para la ventana de caída. Reglas con códigos, schema de línea y vectores ejecutables (§4, §6) |
| A.2 | Un grupo vacío no prueba el cierre de descendientes que escapan | Supervisor *child subreaper* con pidfd y criterio `ECHILD`; cgroup v2 delegado opcional; sin contención positiva no se lanza. El cierre no probado retiene lease y cerrojo, y la muerte del dueño solo se prueba con cierre `CLOSED`, cambio de `boot_id` o job terminal con proctrack/cgroup. v1 limitado al host del runtime (§3, §5, §6, §7) |
| A.3 | `total_cpus/nodes` no son las CPU físicas ni las facturadas | «Host completo» = exclusividad dentro de la allocation sobre `runtime_cpus`; `SLURM_JOB_CPUS_PER_NODE` como observación con mínimo; facturación desde `AllocTRES` del job, nunca desde ranks ni desde el descriptor (§1, §2, Lado plataforma) |

## Adenda 2 (2026-10-11, HubbardFlow #43)

Codex revisó HubbardFlow en `32ac193` y encontró que §6 pedía «salir con 75 si `check_resume` rechaza», pero `check_resume` nunca da un sí. Su docstring ([`api/resume.py:22-30`](https://github.com/Jairomcarmona/SIESTAFLOW_HUBBARD_RESPONSE_BACKBONE/blob/32ac1936e396e33d7de63421f128b5e1c0641cdd/src/hubbardflow/api/resume.py#L22)) dice que hashes iguales no prueban equivalencia física. Las líneas 76–90 devuelven `IDENTITY_MISMATCH` o `NOT_ESTABLISHED`, siempre con `reusable_response_ids: []` y `physical_equivalence: NOT_ESTABLISHED`. La observación es correcta. Esta adenda fija la lectura sin cambiar la API pública, la política de reutilización, las fórmulas, los gates, las tolerancias ni `FIXED_PROTOCOL_GRID`.

### B.1 Dos preguntas distintas

- **Reutilización científica:** ¿una respuesta de otro run cuenta como la de este? Es la pregunta de `check_resume` y de `qualify_response_reuse`, y su respuesta nativa es «no establecido». El controlador **no** la hace: pide `responses: []`, no reutiliza respuestas y mantiene la política nativa de recálculo directo.
- **Continuidad técnica:** ¿el intento N puede seguir el **mismo** checkpoint de la **misma** campaña sin relanzar nada asentado? La base positiva sale de evidencia nativa que ya existe:
  1. `JsonDagCheckpoint.load` acepta el archivo, y su `campaign_digest` es la `checkpoint_identity` del libro.
  2. El libro y el checkpoint concuerdan (§4 y Adenda 1).
  3. La revalidación nativa, la misma que hace `CampaignRunner._revalidate_reuse` ([`campaign_runner.py:708-770`](https://github.com/Jairomcarmona/SIESTAFLOW_HUBBARD_RESPONSE_BACKBONE/blob/32ac1936e396e33d7de63421f128b5e1c0641cdd/src/hubbardflow/execution/campaign_runner.py#L708)), conserva cada recibo lanzado. Para `REFERENCE` y `PERTURBATION` eso significa el validador nativo sobre los artefactos y el `.DM` de la referencia.
  4. `check_resume` no encuentra ningún cambio frente a la línea base (§B.2).

Por tanto, `NOT_ESTABLISHED` es **neutral** para la continuidad técnica: no rechaza ni autoriza nada. Solo `IDENTITY_MISMATCH` rechaza. El controlador copia el resultado tal cual en el veredicto, nunca lo convierte en aceptación y declara `scientific_effect: "NONE"`. La calificación científica sigue saliendo solo del análisis nativo.

### B.2 Línea base y petición de `check_resume`

En el intento 1, antes del primer `LAUNCH_INTENT`, el controlador escribe `resume-baseline.json` en `paths.state_dir`. Es una petición de `check_resume` completa con `observed_* = expected_*`, sin campos nuevos:

- `expected_plan`: el mapping del `ResolvedPerturbationPlan` de `resolved_perturbation_plan_file`.
- `expected_policies`: `{"campaign": <manifiesto de campaña>}`, con el JSON leído del archivo antes de que el cargador aplique valores por defecto.
- `files`: una fila por entrada de `input_files` (`artifact_id = "input:<ruta>"`) y otra para el manifiesto (`"manifest:<ruta>"`). El `expected_sha256` se mide sobre los bytes; no se copia el declarado. El `.DM` padre de entrada y los pseudos entran aquí.
- `responses: []`, siempre.

En el intento N, la petición repite la línea base con `observed_plan`, `observed_policies` y `observed_sha256` medidos de nuevo (`null` si el archivo falta). La raíz de campaña completa (`.siestaflow`, `runs` y los `.DM` producidos) vive en `paths.state_dir`, de modo que `state_manifest_sha256` (§6) cubre la línea base y los artefactos de los nodos antes de que el controlador arranque.

Una campaña sin `resolved_perturbation_plan_file` corre en el intento 1, pero no se puede reanudar: su intento N da `RESUME_EVIDENCE_INVALID`.

### B.3 Veredicto: la primera regla que aplica decide

| # | Condición observada | Decisión | `reason` |
|---|---|---|---|
| 1 | Falta la línea base, no es una petición válida, trae `responses` no vacío, o `check_resume` lanza `PublicApiError` | `REFUSE` | `RESUME_EVIDENCE_INVALID` |
| 2 | `native_status = IDENTITY_MISMATCH` (`assessment = FAIL`); `blocking` = `changed` | `REFUSE` | `RESUME_INPUTS_CHANGED` |
| 3 | `native_status` distinto de `NOT_ESTABLISHED` (también el histórico `EXACT_MATCH` o uno desconocido), `changed` no vacío, `reusable_response_ids` no vacío o `physical_equivalence ≠ NOT_ESTABLISHED` | `REFUSE` | `RESUME_STATUS_UNRECOGNIZED` |
| 4 | El checkpoint no carga, o su `campaign_digest` no es la `checkpoint_identity` del libro | `REFUSE` | `CHECKPOINT_IDENTITY_MISMATCH` |
| 5 | Una clave asentada sin recibo igual (estado y `evidence_digest`), o un recibo de nodo lanzable sin asentar y sin `LAUNCH_FINISHED` | `REFUSE` | `LEDGER_CHECKPOINT_INCONSISTENT` |
| 6 | Un recibo de nodo lanzable (`REFERENCE`, `PERTURBATION`) distinto de `VALIDATED` | `REFUSE` | `SETTLED_FAILURE_PRESENT` |
| 7 | La revalidación en seco invalida un nodo lanzable, avisa `NODE_EVIDENCE_DIGEST_MISMATCH` o deja un nodo lanzable entre los descendientes de un recibo invalidado | `REFUSE` | `SETTLED_EVIDENCE_INVALID` |
| 8 | Ninguna de las anteriores | `CONTINUE` | `TECHNICAL_CONTINUATION` |

`SETTLEMENT_RECOVERED` se anota después de pasar las reglas 1–5 y antes de la 6.

Con `REFUSE` el controlador sale con 75 sin haber lanzado nada. Con `CONTINUE` ejecuta la reanudación nativa:

- Lanza solo los nodos lanzables sin recibo (`launch_pending`): los no iniciados y los interrumpidos.
- Los nodos derivados (`ALPHA_GATE`, `SHADOW_GATE`, `MATRIX_ANALYSIS`, `U_*`) se invalidan y se recalculan como hace hoy el código nativo, incluida la barrera `replay_barrier` de las sombras. No son lanzamientos internos y no aparecen en el libro.

Reglas 6 y 7: la reanudación nativa (`resume`) relanzaría los fallos y lo que no revalida. El controlador no lo hace, porque sería relanzar una clave asentada (§4) o recalcular en silencio algo completado. La tarea queda `BLOCKED` y decide una persona. Un aviso de digest con el código fijado no debería aparecer nunca; si aparece en la calificación, es un defecto que se reporta, no una regla que se relaja.

### B.4 Cuándo se asienta un nodo dentro de un intento

`CampaignShadow.failed_shadow` retira el recibo fallido de un nodo sombra y vuelve a ejecutar el **mismo** `node_id` como `explicit_fallback` en el mismo intento. Para que §4 siga valiendo, el controlador anota `NODE_SETTLED` cuando termina el paso nativo de ese nodo y solo si el recibo sigue en el checkpoint. Un recibo retirado no se asienta. La clave queda sin asentar, y relanzarla está permitido porque su lanzamiento anterior está cerrado. La evidencia de la retirada queda en `failed_runs` del estado nativo de sombras. Vector: `fallback-de-sombra-en-el-mismo-intento` en `controller-ledger-rules`.

Si el intento cae entre el guardado del recibo fallido y su retirada, el intento siguiente lo recupera como fallo asentado y la regla 6 lo bloquea. Es una ventana rara y la salida es conservadora.

### B.5 Contrato, vectores y lo que cambia en HubbardFlow

- Schema [`qraft-controller-resume-verdict.schema.json`](../../contracts/schemas/qraft-controller-resume-verdict.schema.json) (`qraft.controller-resume-verdict@1.0`). `CONTINUE` exige `NOT_ESTABLISHED` sin cambios, sin respuestas reutilizables y sin equivalencia física afirmada. `REFUSE` no lleva continuación.
- [`contracts/fixtures/controller-resume-rules/cases.json`](../../contracts/fixtures/controller-resume-rules/cases.json) trae 21 vectores:
  - aceptados: checkpoint validado sin cambios, nodo interrumpido, nada lanzado todavía, caída entre checkpoint y libro, respuesta sin calificación física y derivado inválido que se recalcula;
  - rechazados: plan, pseudo, `.DM` de entrada y política cambiados, línea base ausente o con respuestas, estado no reconocido, respuestas reutilizables inesperadas, checkpoint de otro DAG, identidad distinta del libro, inconsistencias del libro, fallo asentado, evidencia que no revalida, digest distinto y referencia inválida que arrastra a sus descendientes.

  `check-contracts.mjs` los evalúa con `evaluateControllerResume`, y `validate_fixtures.py` valida cada veredicto esperado.
- En HubbardFlow (U-H7): la comprobación por nodo de `_revalidate_reuse` se separa en una función pura que devuelve conservados, inválidos y avisos sin escribir nada. `resume` nativo la usa y conserva su comportamiento. El controlador decide con ella antes de mutar el checkpoint. `check_resume` se llama como API pública, sin cambios.
