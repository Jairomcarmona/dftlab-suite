# ADR-017: tarea controladora en QRAFT para HF-1 (reserva, lanzamiento directo, cancelación y recuperación)

Estado: **aceptado** el 2026-10-11, con la **Adenda 1** ([#52](https://github.com/Jairomcarmona/dftlab-suite/issues/52)), la **Adenda 2** ([HubbardFlow #43](https://github.com/Jairomcarmona/SIESTAFLOW_HUBBARD_RESPONSE_BACKBONE/issues/43)) y la **Adenda 3** ([#57](https://github.com/Jairomcarmona/dftlab-suite/issues/57), [#59](https://github.com/Jairomcarmona/dftlab-suite/issues/59)) del mismo día. La **Adenda 4** ([#70](https://github.com/Jairomcarmona/dftlab-suite/issues/70), 2026-10-12) fija el caso de calificación real y la integridad tras una caída sin sello; aceptada el 2026-10-12. La **Adenda 5** (#70, 2026-10-12) fija los argumentos `max_seconds`/`grace_seconds` de la factory en modo controller y deja los plazos solo en QRAFT. La **Adenda 12** ([#93](https://github.com/Jairomcarmona/dftlab-suite/issues/93), 2026-10-13) fija la reanudación por la plataforma con generaciones de autoridad y de envío. La **Adenda 6** (#70, 2026-10-12) separa el perfil de la campaña del perfil exterior de SLURM, recoge los huecos de las etapas restantes de la calificación y añade un preflight único. La **Adenda 7** (#70, 2026-10-12) clasifica los dos primeros `FAIL` del preflight, recorre en seco el resto de la calificación y fija el permiso de arreglar y reintentar. Es diseño: la implementación en QRAFT está pendiente ([siestaflow #10](https://github.com/Jairomcarmona/siestaflow/issues/10)). Concreta [ADR-006](ADR-006-hubbard-hf1-hf2.md) §1 y [ADR-015](ADR-015-hubbardflow-capa-bajo-qraft.md) §1; no cambia [ADR-007](ADR-007-controlador-unico-reconciliacion-idempotencia.md). La **Adenda 8** (#70, 2026-10-12) registra la receta HF-1 y recorre C0 a Q6 contra `main`. La **Adenda 9** (#70, 2026-10-12) corrige el orden entre la preparación del estado y el dueño de QRAFT (el `FAIL` de C0). La **Adenda 10** (#70, 2026-10-12) corrige dónde se inicializa la campaña (el segundo `FAIL`, `NO_NUMERICAL_U`). La **Adenda 11** (#70, 2026-10-13) corrige J.2 para HubbardFlow 0.1.3 con `local_wsl`.
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

- `siesta` y `gate` no cambian. Sin tareas `controller`, los bytes de campaña, entradas científicas, locks y scripts existentes permanecen idénticos. Solo el runtime vendorizado y sus hashes pueden actualizarse; el comparador exacto y la excepción al ZIP completo están en la Adenda 3 §C.1.
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
7. **Regresión.** Los paquetes `siesta`/`gate` 2.0 preservan bytes, huellas de campaña/entradas/workflow y comportamiento existentes con el comparador de Adenda 3 §C.1. No se exige el mismo SHA del ZIP cuando cambia su runtime vendorizado; sus hashes nuevos se verifican, no se omiten. Los schemas empaquetados en QRAFT coinciden por SHA-256 con los de este repositorio.

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

Por tanto, `NOT_ESTABLISHED` es **neutral** para la continuidad técnica: no rechaza ni autoriza nada. `IDENTITY_MISMATCH` rechaza por cambios si `changed` no está vacío; si está vacío, es evidencia inconsistente y aplica primero la regla 1 (Adenda 3 §C.2). El controlador copia el resultado tal cual en el veredicto, nunca lo convierte en aceptación y declara `scientific_effect: "NONE"`. La calificación científica sigue saliendo solo del análisis nativo.

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
| 1 | Falta la línea base, no es una petición válida, trae `responses` no vacío, `check_resume` lanza `PublicApiError`, o devuelve `native_status = IDENTITY_MISMATCH` con `changed = []` | `REFUSE` | `RESUME_EVIDENCE_INVALID` |
| 2 | `native_status = IDENTITY_MISMATCH` (`assessment = FAIL`) con `changed` no vacío; `blocking` = `changed` | `REFUSE` | `RESUME_INPUTS_CHANGED` |
| 3 | `native_status` distinto de `NOT_ESTABLISHED` (también el histórico `EXACT_MATCH` o uno desconocido), `changed` no vacío, `reusable_response_ids` no vacío o `physical_equivalence ≠ NOT_ESTABLISHED` | `REFUSE` | `RESUME_STATUS_UNRECOGNIZED` |
| 4 | El checkpoint no carga, o su `campaign_digest` no es la `checkpoint_identity` del libro | `REFUSE` | `CHECKPOINT_IDENTITY_MISMATCH` |
| 5 | Una clave asentada sin recibo igual (estado y `evidence_digest`), o un recibo de nodo lanzable sin asentar y sin `LAUNCH_FINISHED` | `REFUSE` | `LEDGER_CHECKPOINT_INCONSISTENT` |
| 6 | Un recibo de nodo lanzable (`REFERENCE`, `PERTURBATION`) distinto de `VALIDATED` | `REFUSE` | `SETTLED_FAILURE_PRESENT` |
| 7 | La revalidación en seco invalida un nodo lanzable, avisa `NODE_EVIDENCE_DIGEST_MISMATCH` o deja un nodo lanzable entre los descendientes de un recibo invalidado | `REFUSE` | `SETTLED_EVIDENCE_INVALID` |
| 8 | Ninguna de las anteriores | `CONTINUE` | `TECHNICAL_CONTINUATION` |

`SETTLEMENT_RECOVERED` se anota después de pasar las reglas 1–5 y antes de la 6.

La excepción de regla 1 conserva literalmente el resultado nativo no nulo,
con `blocking: []` y `continuation: null`. Tiene precedencia sobre las reglas
2–8, aunque el checkpoint no cargue. Si el resultado no se obtuvo por falta
de evidencia o error de petición, `check_resume` sigue siendo `null`.

Con `REFUSE` el controlador sale con 75 sin haber lanzado nada. Con `CONTINUE` ejecuta la reanudación nativa:

- Lanza solo los nodos lanzables sin recibo (`launch_pending`): los no iniciados y los interrumpidos.
- Los nodos derivados (`ALPHA_GATE`, `SHADOW_GATE`, `MATRIX_ANALYSIS`, `U_*`) se invalidan y se recalculan como hace hoy el código nativo, incluida la barrera `replay_barrier` de las sombras. No son lanzamientos internos y no aparecen en el libro.

Reglas 6 y 7: la reanudación nativa (`resume`) relanzaría los fallos y lo que no revalida. El controlador no lo hace, porque sería relanzar una clave asentada (§4) o recalcular en silencio algo completado. La tarea queda `BLOCKED` y decide una persona. Un aviso de digest con el código fijado no debería aparecer nunca; si aparece en la calificación, es un defecto que se reporta, no una regla que se relaja.

### B.4 Cuándo se asienta un nodo dentro de un intento

`CampaignShadow.failed_shadow` retira el recibo fallido de un nodo sombra y vuelve a ejecutar el **mismo** `node_id` como `explicit_fallback` en el mismo intento. Para que §4 siga valiendo, el controlador anota `NODE_SETTLED` cuando termina el paso nativo de ese nodo y solo si el recibo sigue en el checkpoint. Un recibo retirado no se asienta. La clave queda sin asentar, y relanzarla está permitido porque su lanzamiento anterior está cerrado. La evidencia de la retirada queda en `failed_runs` del estado nativo de sombras. Vector: `fallback-de-sombra-en-el-mismo-intento` en `controller-ledger-rules`.

Si el intento cae entre el guardado del recibo fallido y su retirada, el intento siguiente lo recupera como fallo asentado y la regla 6 lo bloquea. Es una ventana rara y la salida es conservadora.

### B.5 Contrato, vectores y lo que cambia en HubbardFlow

- Schema [`qraft-controller-resume-verdict.schema.json`](../../contracts/schemas/qraft-controller-resume-verdict.schema.json) (`qraft.controller-resume-verdict@1.0`). `CONTINUE` exige `NOT_ESTABLISHED` sin cambios, sin respuestas reutilizables y sin equivalencia física afirmada. `REFUSE` no lleva continuación.
- [`contracts/fixtures/controller-resume-rules/cases.json`](../../contracts/fixtures/controller-resume-rules/cases.json) trae 23 vectores:
  - aceptados: checkpoint validado sin cambios, nodo interrumpido, nada lanzado todavía, caída entre checkpoint y libro, respuesta sin calificación física y derivado inválido que se recalcula;
  - rechazados: plan, pseudo, `.DM` de entrada y política cambiados, línea base ausente o con respuestas, estado no reconocido, respuestas reutilizables inesperadas, checkpoint de otro DAG, identidad distinta del libro, inconsistencias del libro, fallo asentado, evidencia que no revalida, digest distinto, referencia inválida que arrastra a sus descendientes e `IDENTITY_MISMATCH` sin cambios, también con checkpoint que no carga.

  `check-contracts.mjs` los evalúa con `evaluateControllerResume`, y `validate_fixtures.py` valida cada veredicto esperado.
- En HubbardFlow (U-H7): la comprobación por nodo de `_revalidate_reuse` se separa en una función pura que devuelve conservados, inválidos y avisos sin escribir nada. `resume` nativo la usa y conserva su comportamiento. El controlador decide con ella antes de mutar el checkpoint. `check_resume` se llama como API pública, sin cambios.

## Adenda 3 (2026-10-11, issues #57 y #59)

Autorizada expresamente por el usuario tras reproducir ambas contradicciones.
No añade campos, no altera la API científica de `check_resume`, fórmulas,
gates, tolerancias ni las reglas de reutilización científica. Sustituye solo
la garantía imposible del ZIP completo y fija el rechazo del caso inconsistente.

### C.1 Comparador de regresión de paquetes 2.0

Con la misma campaña/materialización, perfil, package_id y opciones, comparar
un paquete del pin QRAFT `41043ed` con uno del nuevo motor:

1. El inventario de archivos fuera de `runtime/` debe ser idéntico. Comparar
   byte a byte cada miembro descomprimido, excepto `manifest.json` y
   `checksums.sha256`: incluye `campaign.yaml`, entradas científicas, locks,
   scripts y demás archivos existentes. No normalizar ni reescribir estos bytes.
2. En `manifest.json`, todos los campos excepto `immutable_files` permanecen
   iguales. Dentro de `immutable_files`, las entradas fuera de `runtime/`
   conservan nombres y digests; las entradas de `runtime/` pueden cambiar o
   añadirse conforme al código instalado. Verificar cada digest contra los
   bytes presentes en su paquete, incluidos los del runtime. Su inventario
   cubre todos los archivos salvo el propio manifiesto y `checksums.sha256`.
3. En `checksums.sha256`, nombres y hashes fuera de `runtime/` y de
   `manifest.json` son idénticos. La excepción para el manifiesto es únicamente
   el hash derivado de los cambios admitidos en el paso 2. Verificar cobertura
   completa (salvo el propio archivo de checksums) y todos los hashes de cada
   paquete; rechazar faltantes, extras respecto de los archivos del paquete,
   duplicados, rutas inseguras o hashes incorrectos. No excluir el runtime de
   la comprobación de integridad.
4. Cambios de tamaño, CRC, compresión u offsets del ZIP derivados de los bytes
   permitidos no son cambios científicos. No se exige identidad del contenedor
   ZIP ni de su SHA-256; conservar metadatos no derivados, como permisos y
   fechas deterministas. Sí se exige el comparador anterior y las huellas de
   campaña/entradas/workflow y el comportamiento 2.0 existentes.
5. Probar el comparador también con alteraciones de una entrada científica,
   campaña, lock, script o hash: debe rechazarlas. No congelar ni duplicar el
   runtime antiguo para satisfacer una igualdad del ZIP, y no ocultar cambios
   del runtime o sus hashes.

### C.2 Resultado nativo inconsistente al reanudar

`native_status = IDENTITY_MISMATCH` con `changed = []` pertenece a la regla 1
de B.3: `REFUSE / RESUME_EVIDENCE_INVALID`, salida75 y ningún lanzamiento.
Conservar todos los campos nativos literalmente, incluso `assessment`,
`reusable_response_ids` y `physical_equivalence`; no sintetizar cambios ni
promover aceptación. `blocking` es vacío y `continuation` es null. La
condición se comprueba antes de cargar/admitir el checkpoint y antes de
recuperar settlements; `checkpoint_identity` es null si no se llegó a cargar.

El schema admite para ese reason un resultado null como antes, o exclusivamente
la copia nativa de este caso inconsistente. Los vectores nuevos comprueban la
precedencia y los fixtures inválidos rechazan un resultado neutral ordinario,
un mismatch con cambios o un blocking fabricado bajo ese reason. La razón,
la versión del contrato y todos sus campos ya existían.

## Adenda 4 (2026-10-12, issue #70): caso de calificación real HF-1 e integridad tras caída sin sello

Estado: **aceptada** por Manuel el 2026-10-12 (caso y regla D.5). Fija el caso que §Pruebas llama «HF-1 real pequeño en WSL» y cierra un hueco de §6 que la calificación encontraría. No cambia fórmulas, gates, tolerancias, schemas ni la política de reutilización. La ficha ejecutable está en [`ADR-017-caso-calificacion-hf1-nio.json`](ADR-017-caso-calificacion-hf1-nio.json); si este texto y la ficha difieren, se detiene y se pregunta.

### D.1 Caso elegido: NiO AFM-II PBE de Stage U-B V6

Se reutiliza un caso ya aprobado, sin ciencia nueva: el material NiO de Stage U-B en HubbardFlow `d7e0b77` (`benchmarks/lr_u/stage_u_b/materials/NiO/`), con calificación U `ACCEPTED` en el baseline V6 ([`SCIENTIFIC_BASELINE_V6.md`](https://github.com/Jairomcarmona/SIESTAFLOW_HUBBARD_RESPONSE_BACKBONE/blob/d7e0b77be20f1f7bd67522764db5b366ebc3ab07/docs/history/SCIENTIFIC_BASELINE_V6.md)).

| Elemento | Valor |
|---|---|
| Sistema | NiO rocksalt, celda magnética AFM-II de 4 átomos (2 Ni, 2 O), `a = 4.17 Å` |
| Física | PBE, espín polarizado, DZP (`EnergyShift 0.005 Ry`), `MeshCutoff 200 Ry`, malla k 2×4×4, proyectores `DFTU.proj` 3d con radio 3.0 Bohr |
| Sitios | `NiLR0` (átomo 1) y `NiLR1` (átomo 2) |
| Malla α | `±0.02, ±0.04, ±0.06 eV`, `FIXED_PROTOCOL_GRID`, BARE y SCREENED |
| Análisis | polinomio grado 3, `minimum_residual_dof = 1`, inversión `raw` |
| DAG | 1 referencia + 24 respuestas (25 SIESTA), `alpha-diagnostic-gate`, `matrix-analysis` |
| Ejecución | SIESTA 5.4.2 Open MPI, 4 ranks, 1 SIESTA a la vez |

Por qué es el más barato que ejercita de verdad la respuesta lineal: tiene los dos modos y la inversión de una matriz 2×2 completa (`χ⁰` y `χ` de rango 2), y una campaña entera dura de 5 a 8 minutos en la laptop. En la corrida P5 los nodos tardaron unos 44 s (referencia), 6 s (BARE) y de 20 a 30 s (SCREENED).

| Alternativa | Motivo para no elegirla |
|---|---|
| Un solo sitio Ni | Es ciencia nueva, sin corrida previa con la que comparar, y no ejercita la inversión matricial |
| NiO 2×1×1 de `corridas/nio` | No es una campaña HubbardFlow ni usa estos inputs aprobados |
| FeO o CoO de Stage U-B | Más caros; CoO quedó en `REVIEW` |
| MnO | `PROTOCOL_REVIEW_REQUIRED` en Stage U-B |

### D.2 Entradas fijadas

La campaña se inicializa con HubbardFlow `d7e0b77` instalado, desde los archivos fuente de abajo, sin editarlos. Los hashes con «sí» no dependen de la ruta ni del UUID: Claude inicializó la campaña dos veces en raíces distintas con `initialize_campaign` de ese commit y salieron idénticos.

| Archivo | SHA-256 | Independiente de ruta |
|---|---|---|
| `materials/NiO/reference.fdf` → `reference.fdf` | `b4fb34e642d862be6949a5b2033a60c5b9fcae56119879583bb3eaf237620ee7` | sí |
| `materials/NiO/material.json` → `provenance/source_lr_config.json` | `4d1ee8d43dd10438e1d85f2132a2767242d8d83b1018e65bc6fbf476c2e0cc8d` | sí |
| `pseudopotentials/NiLR0.psml` y `NiLR1.psml` (mismo archivo) | `192eb05ffb64671715e570e2ca9a99a551cf15544984592082d43004f8554e06` | sí |
| `pseudopotentials/O.psml` | `224ded5c59176d9bcb76d19b7a4a68a48d5dffabf8b262f64d5760250e87c35e` | sí |
| `runtime/backend_compatibility.json` | `5189620dfa1e8b6090cbdbb9c36c412835d16feb5c50bbc82b16c139d3bcff2e` | sí |
| `runtime/siesta_version.txt` | `bb5a9b03dfaec9953401a7ef8db045149461047c44f15f9c5bf7758900b5f3ee` | sí |
| `resolved_perturbation_plan.json` (generado) | `bb6f99dba2414e50889a35c5b4f440e63924745b6a9533ce85c296a6f644abd9`; digest del plan `ce285ffdc500f40204861fb36121d81f3eb246abe15d41632ab793b795f1eb0c` | sí |
| `campaign.lock` (generado) | `d85cbf053a3a62f2fac2e1bcdb969f8ce28c462fcc582af3e83d55f3a6643226` | sí |

`lr_config.json`, `backend_contract.json`, `execution_profile.json`, `campaign_id` e `input_identity` dependen de la ruta o del UUID y no se fijan. El perfil de ejecución es el privado ya declarado `VALIDATED_RUNTIME` (4 CPU, 4 ranks). La raíz de la campaña es `paths.state_dir` (§6, Adenda 2 §B.2). La tarea `controller` usa `reservation = {nodes: 1, inner_launcher: openmpi, inner_processes_per_node: 4, inner_cpus_per_process: 1, max_concurrent_inner_launches: 1}` y `max_attempts: 3`.

### D.3 Resultado esperado y tolerancia

La cantidad es `U_scalar_charge` y sigue siendo `physical_acceptance = NOT_ESTABLISHED` (ADR-006 §4). El valor esperado sale de corridas, no de la literatura: el U de respuesta lineal depende de cómo se definen los proyectores y la base, así que un valor publicado no sirve como tolerancia.

| Sitio | Esperado (eV) |
|---|---|
| NiLR0 | 6.864267700049239 |
| NiLR1 | 6.864387475210124 |

Estos inputs ya corrieron tres veces en el WSL de Manuel, con el mismo binario SIESTA 5.4.2 y 4 ranks: P5 (2026-09-28), `nio_p5_product_2` y TASK22 (2026-10-03, HubbardFlow `0a8a12f`). El objeto `primary` salió idéntico en las tres, con ΔU = 0 ([`TASK22_REAL_RUN.md`](https://github.com/Jairomcarmona/SIESTAFLOW_HUBBARD_RESPONSE_BACKBONE/blob/d7e0b77be20f1f7bd67522764db5b366ebc3ab07/docs/fdebq/TASK22_REAL_RUN.md)). Claude no corrió SIESTA en su contenedor: otro build no puede fijar una igualdad bit a bit en el binario de Manuel, y la evidencia del target ya existe.

- **Tolerancia: `|ΔU| ≤ 0.020 eV` por sitio.** Es la `u_precision_tolerance_eV` ya vigente en `precision_policy.json` de Stage U-B y en el `analysis_policy` de este material; no es un número nuevo. Cubre la cota determinista de redondeo de impresión de este mismo dataset, 0.0118 eV.
- **Lo esperado es ΔU = 0.** Una diferencia distinta de cero dentro de la tolerancia pasa, pero se reporta como observación.

### D.4 Corridas, nodos y puntos de interrupción

Las dos corridas usan campañas nuevas con las mismas entradas. El orden de lanzamiento es el del DAG nativo (`GenericDagExecutor` toma el primer nodo listo en orden): referencia, y luego, para el sitio 0 y después el sitio 1, cada α de −0.06 a +0.06 con BARE antes que SCREENED.

**C0, control sin interrupción.** Una tarea `controller` completa. Prueba el camino fresco y da el valor del código fijado. Se compara con D.3.

**Q, calificación con cancelación y caída.**

| Paso | Acción | Esperado |
|---|---|---|
| Q1 | Intento 1. Cuando el libro tiene `LAUNCH_STARTED` de `response:lr_s000_m0p06_screened` (tercer lanzamiento) sin `LAUNCH_FINISHED`, y su `siesta.out` ya tiene al menos una línea `scf:`, se cancela con la **cancelación de la plataforma** (§5: `stop_request` y `SIGTERM` al supervisor) | `LAUNCH_ABANDONED` de esa clave; `controller-closure.json` = `CLOSED`; sello del estado escrito; lease liberado; intento `INTERRUPTED` |
| Q2 | Intento 2 en un job nuevo | `previous_attempt.closure = CLOSED`; veredicto `CONTINUE / TECHNICAL_CONTINUATION`; ningún `LAUNCH_INTENT` de una clave asentada; `response:lr_s000_m0p06_screened` se relanza |
| Q3 | Cuando `response:lr_s000_p0p02_screened` está en su SCF (misma condición que Q1), `kill -9` **solo al PID del runtime de QRAFT**. Se guardan `ps -o pid,ppid,sid,stat,cmd` del árbol, `sacct` del job y `scontrol show config` (`ProctrackType`) | El job puede quedar terminal en SLURM; supervisor, controlador o SIESTA pueden seguir vivos (es el riesgo de `proctrack/linuxproc`) |
| Q4 | Enseguida, en el mismo arranque, se pide el siguiente intento | `BLOCKED` con `CONTROLLER_PREVIOUS_OWNER_ALIVE`; no arranca supervisor ni SIESTA. Un job terminal no libera nada |
| Q5 | `wsl --shutdown` desde Windows; se reinicia WSL, munge y SLURM; se comprueba que `/proc/sys/kernel/random/boot_id` cambió | — |
| Q6 | Intento 3 | `previous_attempt.closure = OWNER_DEAD_BY_BOOT_CHANGE`; integridad según D.5; veredicto `CONTINUE`; al menos un `LAUNCH_INTENT`; la campaña termina |

Precondiciones de validez de Q:

- En Q1 ya están asentadas la referencia y `response:lr_s000_m0p06_bare`.
- En Q6 queda al menos un nodo lanzable sin asentar.

Si alguna falla (por ejemplo, el orden de lanzamiento no es el esperado o el supervisor huérfano terminó la campaña antes de Q5), Q es `INCONCLUSIVE`. Se repite completa con una campaña nueva. **No se elige otro nodo.** Si Q4 consume un intento de `max_attempts`, se detiene y se reporta.

### D.5 Integridad tras caída sin sello (cambia §6; requiere U-Q9b)

**Hueco encontrado.** En QRAFT `c3ecdea`, `previous_controller_owner` exige `controller-state-manifest.json`, el sello que el supervisor escribe **al cerrar**, incluso cuando la prueba es `OWNER_DEAD_BY_BOOT_CHANGE` (`src/qraft/execution/controller_state.py`). Tras una caída real (`wsl --shutdown`, corte de luz u OOM del supervisor) ese sello no existe. La lectura falla y la tarea queda `BLOCKED` con `CONTROLLER_STATE_TAMPERED`. La prueba sintética `test_positive_owner_death_and_sealed_state` escribe el sello antes de simular el cambio de `boot_id`, un estado que una caída real no puede producir. Así, Q6 no podría pasar nunca, y §Consecuencias («retiene recursos y cerrojo hasta reiniciar el host») tampoco se cumpliría.

**Regla.** Con la prueba `OWNER_DEAD_BY_BOOT_CHANGE`, QRAFT decide así:

| Sello `controller-state-manifest.json` | `controller-closure.json` | Decisión |
|---|---|---|
| Existe | cualquiera | Se compara como hoy; si difiere, `CONTROLLER_STATE_TAMPERED` |
| No existe | No existe | **Caída sin sello.** No es manipulación: no hay con qué comparar. QRAFT mide el manifiesto al admitir, lo pone en `previous_attempt.state_manifest_sha256` y lo registra en la evidencia del intento como `state_seal: ABSENT_AFTER_BOOT_CHANGE`. La continuidad descansa en el veredicto nativo de la Adenda 2 |
| No existe | Existe | `CONTROLLER_STATE_TAMPERED`: el supervisor escribe el sello antes del cierre, así que esa combinación no sale de una caída |

Con la prueba `CLOSED` el sello sigue siendo obligatorio. Sin cambio de `boot_id` y sin cierre, sigue `CONTROLLER_PREVIOUS_OWNER_ALIVE`. No cambia ningún schema: `state_manifest_sha256` ya existe y el marcador va a la evidencia nativa de QRAFT.

**Qué protege entonces.** La línea base `resume-baseline.json`, `check_resume`, la concordancia libro–checkpoint y la revalidación nativa en seco de cada recibo (Adenda 2 §B.2–§B.3) detectan cambios de plan, pseudo, `.DM`, política y evidencia asentada. El nodo que se cortó a mitad de SCF es el caso «nodo interrumpido» que la Adenda 2 ya acepta. Lo que se pierde es detectar una edición manual del estado hecha entre la caída y el reinicio que además pase la revalidación nativa. En un worker local de un solo usuario se acepta; es el precio de poder reanudar tras una caída.

**Pruebas U-Q9b (QRAFT, sintéticas).** Hacen falta cuatro casos:

1. Cambio de `boot_id` sin sello ni cierre: reanuda con el manifiesto medido y el marcador.
2. Cierre sin sello: `TAMPERED`.
3. Sello que difiere: `TAMPERED`.
4. Mismo arranque sin cierre: `PREVIOUS_OWNER_ALIVE`.

La prueba existente con sello y cambio de `boot_id` se conserva.

### D.6 Veredicto de la calificación

| Veredicto | Condición |
|---|---|
| `PASS` | C0 y Q terminan; cada paso de D.4 da lo esperado; las reglas de §4 no fallan en ningún libro; C0 y Q cumplen `|U − esperado| ≤ 0.020 eV` y `|U_Q − U_C0| ≤ 0.020 eV` por sitio |
| `FAIL` | Un relanzamiento de clave asentada, cierre `OPEN`, un proceso ajeno señalado, un paso con un código distinto del esperado o un U fuera de tolerancia |
| `INCONCLUSIVE` | Falla una precondición de D.4; se repite Q completa |

Con `PASS`, el `CapabilityQualificationRecord` `hubbard_mode: HF-1` puede pasar de `CONTRACT_TESTED`. Con `FAIL` no se ajustan tolerancias ni nodos: se reporta.

**Evidencia por corrida:**

- descriptor, libros, veredictos de reanudación, `controller-closure.json` y sello de cada intento;
- `boot_id` antes y después de Q5, y salidas de `ps`, `sacct` y `scontrol` de Q3;
- `lr_u_analysis.v3.json` y `U_scalar_charge` por sitio;
- duración y CPU.

### D.7 Fuera de alcance

- La cancelación con `scancel` directo. Con `proctrack/linuxproc`, `scancel --batch --signal=TERM` señala a todo el árbol del paso batch, también a `mpirun`, y no solo al runtime. Si se quiere calificar ese camino, va en su propio issue.
- La prueba `OWNER_DEAD_BY_SCHEDULER_TERMINAL`, que exige `proctrack/cgroup`.
- Varios hosts.

## Adenda 5 (2026-10-12, issue #70): `max_seconds` y `grace_seconds` de la factory en modo controller

Estado: **aceptada** el 2026-10-12. Responde la [consulta de Codex en #70](https://github.com/Jairomcarmona/dftlab-suite/issues/70#issuecomment-6120356166). No cambia fórmulas, gates, tolerancias, schemas, pins, el perfil privado ni la ficha científica; añade a la ficha solo los dos argumentos del constructor.

### E.1 Qué son esos parámetros

`HubbardFlowCampaignCapability.__init__` exige `max_seconds` (1–3600) y `grace_seconds` (1–10). Los dos son límites del **worker legado** `dftlab_platform.hf1_worker`: solo se escriben en `hf1-request.json`, que `prepare_task` crea cuando no recibe `controller_state_dir`. En modo controller ese archivo no existe, `build_command` no los incluye y ningún proceso los lee (`platform/src/dftlab_platform/hf1_capability.py`, `prepare_task` y `build_command`).

El validador tenía razón: no se derivan del walltime ni del `termination_grace_seconds` del perfil. Hacerlo crearía un segundo reloj sobre el mismo intento, y §2 y ADR-007 piden una sola autoridad. En modo controller los plazos son **solo** de QRAFT:

| Qué | Autoridad en modo controller | Qué pasa al agotarse |
|---|---|---|
| Fin de lanzamientos | `deadline.stop_launching_at` del descriptor (walltime restante menos `shutdown_margin_seconds`, §4) | El controlador no abre más `LAUNCH_INTENT`; uno posterior es `INTENT_AFTER_DEADLINE` |
| Parada | `deadline.hard_stop_at` y la secuencia de §5 | `stop_request` y `SIGTERM` al supervisor; el intento queda `INTERRUPTED` y se reanuda según §6 |
| Gracia de cierre | `termination_grace_seconds` del perfil (§5, paso 3) | `SIGKILL` por pidfd hasta `ECHILD`; el cierre sigue siendo `CLOSED`, y el nodo cortado es un «nodo interrumpido» que se relanza (Adenda 2) |

### E.2 Valores para la calificación HF-1

La factory del operador para C0 y Q usa **`max_seconds = 1800`** y **`grace_seconds = 10`**, fijos e iguales en todos los intentos.

- Son inertes en modo controller: no acortan ni alargan C0 ni Q, y no se presentan como política de tiempo de la tarea.
- Se eligen para que, si algún día una tarea HF-1 cayera por error en el camino legado, el límite siga siendo razonable y no un cheque en blanco. 1800 s es unas 3,75 veces la duración más larga esperada de la campaña NiO (8 min, D.1) y queda por debajo del tope de 3600. 10 s es el máximo que admite el constructor y deja tiempo a la parada cooperativa de `mpirun`.
- No se cambia el constructor en esta adenda. Permitir `None` en modo controller sería más limpio, pero cambia código ya instalado y calificado (wheel de #78) para un parámetro sin efecto. Queda como mejora posible, no como requisito de HF-1.

### E.3 Comprobaciones antes de C0

1. **Inercia.** Una prueba de plataforma fija que dos factories con `max_seconds`/`grace_seconds` distintos preparan la misma campaña y el mismo comando en modo controller, sin crear `hf1-request.json` (`test_controller_mode_ignores_legacy_worker_limits`). En la calificación se comprueba además que el directorio de cada intento no contiene `hf1-request.json`.
2. **Plazo del perfil.** El perfil privado no se edita: su `profile_sha256` está ligado a la factory. Antes de C0 se lee del descriptor del intento 1 que `stop_launching_at` queda al menos **1800 s** después del arranque. Si no, C0 no se lanza y se pregunta en #70. Así el walltime no corta C0 ni los intentos de Q por una causa que D.4 no prevé.
3. **Evidencia.** Cada intento registra `stop_launching_at`, `hard_stop_at`, `shutdown_margin_seconds` y `termination_grace_seconds` tal como los usó QRAFT, junto con los dos valores inertes de la factory.

Ninguno de estos valores entra en D.6: el veredicto sigue dependiendo solo de los pasos de D.4, las reglas de §4 y la tolerancia de 0.020 eV.

## Adenda 6 (2026-10-12, issue #70): dos perfiles, huecos de la calificación real y un preflight único

Estado: **aceptada por defecto** el 2026-10-12. Cierra el bloqueo de C0 («el perfil privado declara `target=local_wsl`, el inspector exige `slurm`») y, tras recorrer en seco con el código de `main` todas las etapas restantes de la calificación, los demás huecos de diseño que se habrían descubierto uno por uno. No cambia fórmulas, gates, tolerancias, schemas, pins ni el perfil privado; nada de lo que fija es ciencia. **F.4** es la única decisión que corresponde a Manuel; hasta que responda rige su opción por defecto.

Alcance de la revisión: se leyeron el inspector, la factory, `NativeWorker`, el puerto SLURM, el libro de envíos, la autoridad local, la sonda de runtime y los scripts de calificación de este repositorio. QRAFT, HubbardFlow y el estado privado del WSL de Manuel no están aquí; lo que depende de ellos lo mide el preflight de F.6 y no se afirma.

### F.1 Dos perfiles, dos funciones

| Perfil | Quién lo usa | Contenido | Estado |
|---|---|---|---|
| **Campaña** (`execution_profile.json` dentro del paquete) | HubbardFlow, para lanzar sus SIESTA | El privado `VALIDATED_RUNTIME`, `target = local_wsl`, 4 CPU, 4 ranks, `openmpi` | **Intacto.** Su SHA-256 es el `profile_sha256` de la factory |
| **Exterior** (identidad nueva) | QRAFT y SLURM: sonda, `sbatch`, reserva del controlador | `target = slurm` (F.2) | Se crea para HF-1; no reutiliza el de T-023b |

En modo controller, HubbardFlow lanza `mpirun` directamente sobre el host reservado (§7) y lee hosts, ranks y plazos del descriptor (§4), así que `local_wsl` en la campaña describe exactamente lo que ocurre. La exigencia `target = slurm` de `inspect_bundle` era del worker legado y no tiene razón de ser aquí.

**Cambio de código (mínimo, en este PR):**

- `inspect_bundle` recibe `allowed_targets`. Por omisión sigue siendo `("slurm",)`, de modo que `hf1_worker` no cambia.
- `HubbardFlowCampaignCapability.inspect_input` pasa `("slurm", "local_wsl")` y el paquete inspeccionado conserva `profile_target`.
- `prepare_task` vuelve a exigir `slurm` en la ruta legado (sin `controller_state_dir`).
- Cualquier otro `target` se rechaza en las dos rutas. Las demás condiciones (`nodes = 1`, `max_parallel_steps = 1`, `total_cpus = reserved_cpus`, `openmpi`, `processes_per_node ≤ reserved_cpus`) no cambian.
- `profile_findings` y `controller_profile_findings` devuelven **todas** las condiciones que fallan, con identificadores estables; `inspect_bundle` y `prepare_controller_task` siguen levantando el mismo `PRECONDITION_FAILED`, ahora sin ocultar cuál era.

### F.2 Perfil exterior de HF-1 (valores fijos)

| Campo | Valor | Por qué |
|---|---|---|
| Identidad | `hf1-controller-outer-slurm-v1`, revisión 1 | Nueva; el de T-023b tiene límite de diez minutos |
| `target`, partición, cuenta, qos | `slurm`; los que `sbatch --test-only` ya aceptó (`local`/`default`/`normal`) | Observado en el preflight de runtime |
| Nodos, CPU, tareas | 1 nodo, `total_cpus = ntasks = processes_per_node = 4`, 1 CPU por tarea | `prepare_controller_task` y D.2 |
| Lanzador y reintentos | `openmpi`, `max_attempts = 3` | Ídem; `max_attempts` es el de la ficha |
| **Tiempo de la allocation** | **3600 s** (la tarea usa `walltime_seconds = 1800`, corregido en la Adenda 8 H.2) | E.3.2 pide `stop_launching_at` ≥ 1800 s tras el arranque; el perfil de T-023b (600 s) lo incumple. Si el cálculo de E.3.2 (última fila) da menos de 1800 s, subir a 7200 s si la partición lo permite y repetir; si no, parar (F.6) |
| Memoria | 2048 MB | NiO de 4 átomos, DZP, 200 Ry. P5 y TASK22 corrieron en esta máquina. Los 512 MB de T-023b no son un precedente |
| Entorno | exactamente `PATH` explícito, `QRAFT_PYTHON` del intérprete instalado, `OMP_NUM_THREADS = OPENBLAS_NUM_THREADS = MKL_NUM_THREADS = 1`; sin módulos | Como T-023b |
| **Comprobación de E.3.2** | Antes del envío: `tiempo de la allocation − shutdown_margin_seconds` del perfil exterior ≥ 1800 s. Después: el descriptor del intento 1 registra `stop_launching_at` y se compara | Sustituye a la lectura previa del descriptor (H12). El descriptor es registro de lo ocurrido, no una puerta; si contradice el cálculo, se reporta sin detener C0 |
| `--no-requeue` | En cada guion `sbatch` de Q | SLURM reencola por defecto un job perdido por reinicio de nodo; un reencolado automático sería un intento sin contar |

### F.3 Huecos hallados

«Verificado» significa leído en `main` de este repositorio; «medir» significa que depende de QRAFT, HubbardFlow o del estado privado y lo comprueba el preflight.

| # | Etapa | Hueco | Evidencia | Cierre |
|---|---|---|---|---|
| H1 | C0 | `target` de la campaña (`local_wsl`) rechazado por el inspector | verificado, `hf1_bundle.py` | F.1 |
| H2 | C0 | El rechazo era opaco y otras condiciones del perfil privado pueden fallar a la vez | verificado | `profile_findings`; el preflight las lista todas |
| H3 | C0 | El perfil exterior no existe; el único precedente (T-023b) usa 600 s y 512 MB, incompatible con E.3.2 | verificado, `qualify_native_runtime.py` | F.2 |
| H4 | C0 | `prepare_controller_task` exige perfil exterior con `max_attempts = 3`, 4 CPU y `openmpi` | verificado | F.2 |
| H5 | C0, Q | La sonda caduca a los 900 s y `NativeWorker` la comprueba al arrancar y antes de crear el controlador | verificado, `runtime_probe.py`, `native_worker.py` | Sonda nueva inmediatamente antes de cada `sbatch` (F.5) |
| H6 | C0 | `NativeWorker` exige `SLURM_JOB_ID` y `SLURM_SUBMIT_DIR` igual a la raíz del paquete; el puerto usa `--chdir` y exige ruta sin espacios, sistema de archivos local, dueño y modo 0700 | verificado, `slurm.py` | El preflight comprueba sistema de archivos, ruta, dueño y modo |
| H7 | Q | **No existe cancelación externa hacia `NativeWorker`.** «Cancelación de la plataforma» (D.4 Q1) no tiene disparador | verificado | F.5: `SIGTERM` al PID del runtime |
| H8 | Q2, Q6 | **Un segundo intento del mismo run es imposible en la plataforma:** `controller_authorities` tiene `run_id` como clave primaria y `create` rechaza cualquier registro previo, incluso retirado; `scheduler_dispatches.run_id` es `UNIQUE`; la reanudación está marcada «todavía pendiente» | verificado, `authority_storage.py`, `submission_storage.py`, `deployment/local/README.md` | **F.4** |
| H9 | Q5 | `wsl --shutdown` mata también al proceso que orquesta desde WSL, y SLURM puede volver con el nodo en `down` o reencolar el job | razonado; el nodo se mide | F.5 |
| H10 | Q | El disparador de Q1 y Q3 (libro con `LAUNCH_STARTED` sin `LAUNCH_FINISHED` y `scf:` en `siesta.out`) cae en ventanas de segundos | D.1: referencia 44 s, BARE 6 s, SCREENED 20 a 30 s | Vigilante de sondeo de 100 ms, solo lectura (F.5) |
| H11 | C0, Q | Open MPI sin `--oversubscribe` rechaza más ranks que ranks disponibles | medir | Preflight `MPI_SLOTS_WITHOUT_OVERSUBSCRIBE` (informativo) |
| H12 | C0 | **E.3.2 (Adenda 5) no se puede cumplir tal como está escrita:** pide leer `stop_launching_at` del descriptor «antes de C0», pero QRAFT escribe el descriptor al crear el intento, ya dentro del job (§4) | verificado, §4 | Se calcula antes del envío y el descriptor lo confirma después (F.2, última fila) |
| H13 | Todas | Cada bloqueo anterior costó un PR de registro y una pausa | — | F.7 |

### F.4 Alcance de Q respecto a la plataforma (decisión de Manuel)

D.4 pide tres intentos del mismo run y D.6 no dice si deben pasar por la autoridad y el libro de envíos de la plataforma. H8 muestra que hoy no pueden.

- **Opción A, por defecto.** Q califica el **controlador** (QRAFT U-Q9/U-Q9b y HubbardFlow U-H7), que es lo que D.4 y D.6 comprueban. C0 pasa por la ruta completa de la plataforma (`NativeWorker`, puerto SLURM, autoridad). Q la recorre con un arnés de operador que lanza un `sbatch` propio por intento y reanuda con la API pública de QRAFT, sin tocar el libro de envíos ni la autoridad de la plataforma. El registro de calificación dirá: «controlador HF-1 reanuda tras cancelación y caída; reanudación por la plataforma, no calificada», y se abre un issue para la autoridad por generaciones.
- **Opción B.** Antes de Q, implementar en la plataforma generaciones de autoridad y reanudación de envíos (migración de dos tablas, ADR nuevo, CI). Q pasaría entonces por la plataforma, a costa de retrasar la calificación.

Esta adenda aplica A. No se mezcla: si Manuel elige B, Q espera a ese ADR.

### F.5 Ceremonias de Q

- **Cancelación de la plataforma (Q1)** = `SIGTERM` enviado **solo** al PID del proceso runtime de QRAFT. Su manejador ejecuta §5 (`stop_request` y `SIGTERM` al supervisor). Nunca `scancel`, nunca a un grupo (D.7). El arnés registra ese PID antes de lanzar.
- **Kill (Q3)** = `SIGKILL` al mismo PID, tras guardar `ps -o pid,ppid,sid,stat,cmd` del árbol, `sacct` y `scontrol show config` (`ProctrackType`).
- **Vigilante.** Un proceso de solo lectura sondea cada 100 ms el libro y `siesta.out`, con las rutas del descriptor. Dispara cuando se cumple exactamente la condición de D.4. Si la ventana se pierde, Q es `INCONCLUSIVE` y se repite completa, como dice D.4.
- **Un `sbatch` por intento**, con `--no-requeue`, sonda nueva justo antes y una sola presentación. Nunca dos jobs vivos de Q.
- **Orquestación de Q5.** El orquestador de Q vive en Windows. Ningún proceso de WSL atraviesa `wsl --shutdown`; el estado de cada paso se escribe en `state.json` antes de ejecutarlo. Tras reiniciar WSL, munge y SLURM se comprueba que `boot_id` cambió, que `sinfo` muestra el nodo `idle` y que no queda ningún job de Q. Si el nodo vuelve `down` por reinicio inesperado, `scontrol update NodeName=<nodo> State=RESUME` es parte de la ceremonia y no altera jobs.
- **Aviso.** `wsl --shutdown` cierra todas las sesiones y distros WSL de Manuel. Codex lo anota en el hilo justo antes de ejecutarlo; no espera respuesta, porque la ficha ya lo acepta.
- **Reanudación (Q2, Q6).** Con la misma llamada pública de QRAFT que usan sus pruebas de consumidor de U-Q9 y U-Q9b. Si esa llamada pide `TerminalSchedulerEvidence`, se obtiene con `SlurmTerminalCollector` y `LocalTerminalSigner` (T-026a, en `main`).

### F.6 Preflight único y regla de parada

`python -I -m dftlab_platform.hf1_preflight` (módulo nuevo, de solo lectura) evalúa de una vez, sin enviar nada, sin crear intento ni descriptor y sin editar perfiles: Python aislado, kernel y `pidfd`/subreaper, `boot_id`, CPU y memoria, sistema de archivos local del estado, herramientas SLURM, `ProctrackType`, `JobRequeue`, partición (`State`, `MaxTime ≥ 2400 s`), un único nodo `idle` con CPU y memoria suficientes, cola vacía, Open MPI 4.1.x y sus ranks, SHA-256 de SIESTA y las condiciones del perfil de la campaña. Imprime **todos** los fallos.

Codex lo ejecuta una vez, antes de C0, y ejecuta además `controller_profile_findings` con su perfil exterior. Si algo falla:

1. Publica **un solo** comentario en #70 con la lista completa de identificadores que fallaron y su valor observado.
2. Corrige solo lo que esta adenda ya resuelve (F.1, F.2, F.5). Lo demás es hecho del entorno de Manuel y se reporta, no se negocia.
3. Las únicas paradas permitidas son los `FAIL` del preflight y que el cálculo de E.3.2 de F.2 dé menos de 1800 s después de subir la allocation a 7200 s. Cualquier otra duda de diseño se resuelve con esta adenda; si no la cubre, se anota como defecto de la adenda y se sigue con la opción conservadora.

### F.7 Evidencia, PR y qué no se hace

- Un PR documental al cerrar C0 y otro al cerrar Q (o al declarar `FAIL`), no uno por paso. Nunca se detiene la calificación para registrar.
- `FAIL` en C0 o en Q se reporta sin reparar (D.6). `INCONCLUSIVE` repite Q completa con campaña nueva.
- Sin cambios en entradas, perfil privado, fórmulas, gates, tolerancias, pins ni contratos. HF-1 sigue deshabilitado hasta el veredicto.

### F.8 Pruebas

`test_local_wsl_campaign_profile_is_controller_only_and_never_slurm_by_default`, `test_profile_findings_name_every_failure_at_once`, `test_outer_allocation_findings_name_every_failure_at_once` y las del preflight (`test_hf1_preflight.py`). Las pruebas que ya existían del inspector no cambian: seguían exigiendo que `local_wsl` se rechazara con el valor por omisión, y así sigue.

## Adenda 7 (2026-10-12, issue #70): los dos FAIL del preflight, el resto de la calificación recorrido en seco y permiso de arreglar y reintentar

Respuesta a que el preflight de F.6 parara en `HOST_PIDFD_AND_SUBREAPER` y `SLURM_PARTITION_QUEUE_EMPTY`. Alcance: se leyeron `hf1_children.py`, `runtime_probe.py`, `native_worker.py`, `slurm.py` y `hf1_preflight.py` en `main`. Nada de esto cambia lo que se califica: ni fórmulas, gates, tolerancias, contratos, pins, entradas ni el perfil privado.

### G.1 Clasificación de los dos fallos

| Identificador | Clase | Causa | Cierre |
|---|---|---|---|
| `HOST_PIDFD_AND_SUBREAPER` (`AttributeError`) | **Defecto del preflight** | El preflight llamaba a `os.pidfd_open`; CPython 3.12.10 de python-build-standalone no lo trae. `OwnedLinuxChildren` ya lo sabe y usa `pidfd_open`/`pidfd_send_signal` de glibc (`hf1_children.py`). El WSL de Manuel no está mal: las pruebas instaladas 27/27, incluidas las de descendientes propios, pasaron ahí | El preflight construye `OwnedLinuxChildren()`, el mismo constructor que usa el worker. Hecho en este PR, con prueba |
| `SLURM_PARTITION_QUEUE_EMPTY` (7 jobs) | **Precondición más estricta que el código** | Ningún código de `main` exige cola vacía. Lo que exige la sonda de runtime es que el nodo esté `IDLE` y sin CPU ni memoria asignadas (`runtime_probe.py`), y `SLURM_ONE_IDLE_NODE_FITS` ya pasó: con el nodo `IDLE` los 7 jobs están `PENDING`, ninguno corre | Sustituida por `SLURM_PARTITION_ACTIVE_JOBS` (FAIL si algún job de la partición no está `PENDING`) y `SLURM_PARTITION_PENDING_JOBS` (INFO: cuántos, de quién, por qué razón y cuántos serían ejecutables ya). Los jobs ajenos son evidencia: nunca se cancelan, se retienen ni se liberan |

Por qué no cambia lo que se califica: la medición científica (`U_scalar_charge` por sitio) y los escenarios de Q dependen de que el nodo esté `IDLE` al sondear y de que Q tenga sus 4 CPU, que es lo que sigue exigiéndose. Un job `PENDING` que no puede arrancar en el nodo no comparte CPU con SIESTA. Si uno ajeno pasa a ejecutable y ocupa el nodo, eso se ve en la sonda siguiente (G.3).

### G.2 Otros huecos del mismo tipo hallados en seco

| # | Etapa | Hueco | Cierre |
|---|---|---|---|
| K1 | Preflight | La sonda de runtime usa un lector de claves estricto (`_fields` rechaza claves repetidas en `scontrol --oneliner`) y exige `State=IDLE`; el preflight usaba otro lector y podía pasar donde la sonda fallara | Nuevo `SLURM_PROBE_SCHEDULER_VIEW`: repite las condiciones de la sonda con el mismo `_fields`. Si falla aquí, la sonda fallaría después |
| K2 | C0, Q | Antes de cada sonda el nodo puede estar aún en `COMPLETING` o recién ocupado por un job ajeno | Antes de cada sonda, esperar a `State=IDLE` (consulta cada 5 s, hasta 600 s). Sonda y `sbatch` seguidos, sin pasos intermedios |
| K3 | C0, Q | Si el job propio queda `PENDING` más de 600 s, la sonda (900 s) caduca antes de arrancar | Pasados 600 s `PENDING`, cancelar **solo el job propio** con `scancel <id>` (aún no tiene intento ni descriptor), sonda nueva y reenviar; máximo 2 veces. Una tercera es `INCONCLUSIVE` por precondición de D.4, se reporta |
| K4 | Q | Un job ajeno ocupa el nodo entre intentos | Es una precondición de D.4 sin cumplir: Q es `INCONCLUSIVE` y se repite completa con campaña nueva. No se elige otro nodo y no se toca el job ajeno |
| K5 | Q3 | `sacct` puede no funcionar si `AccountingStorageType` es `none` | La evidencia de Q3 es mejor esfuerzo: si `sacct` falla se guarda su error y se usan `scontrol show job`, `ps` y `/proc`. No es parada |
| K6 | Todas | Reintentos del preflight: F.6 lo limitaba a una ejecución | Una ejecución **por versión corregida del código** (G.4) |
| K7 | Q5 | Tras `wsl --shutdown` munge y SLURM pueden no levantar solos | Se levantan con el mismo método con el que Codex los dejó funcionando en esta sesión. Si pide una contraseña de `sudo` que no está disponible, es la única parada de Q5 que es de Manuel |

### G.3 Qué hace el arnés con jobs ajenos

Nunca ejecuta `scancel`, `scontrol hold`, `release` ni `update` sobre un job que no creó. Guarda la salida de `squeue` (jobs ajenos) antes y después de cada intento como evidencia. Si no se puede cumplir una precondición de D.4 por un job ajeno, es `INCONCLUSIVE`, no `FAIL`.

### G.4 Permiso de arreglar y reintentar

Para un error nuevo en el preflight, el arnés de operador, la documentación o el empaquetado:

1. **Defecto de código** (el comportamiento no es el que dice el ADR): arreglar con el cambio mínimo, una prueba que lo cubra, un PR a `main` con los cinco checks verdes, reconstruir el wheel y reintentar. Máximo **2 arreglos por identificador de error**. Los arreglos no necesitan permiso adicional.
2. **Verificación más estricta que el código** (como `QUEUE_EMPTY`): se relaja solo si se puede citar la línea de `main` que gobierna esa condición y se añade una nota de campo a esta adenda en el PR documental. Si no se puede citar, es parada.
3. **Hecho del entorno de Manuel** (versión, permiso, servicio caído) con arreglo evidente y reversible que no toca datos de otros: se arregla con el método habitual y se anota.

Nunca se arregla ni se ajusta: entradas, perfil privado, fórmulas, gates, tolerancias, contratos, pins, semántica de autoridad, cancelación o propiedad de procesos, ni jobs de otros. Esos casos y el `FAIL`/`INCONCLUSIVE` de D.6 son las únicas paradas, además de lo que decida Manuel en #70.

### G.5 Pruebas

`test_host_check_uses_the_worker_constructor_not_the_os_module`, `test_foreign_pending_jobs_are_evidence_and_running_jobs_are_conflicts` y `test_probe_view_uses_the_runtime_probe_strictness` en `test_hf1_preflight.py`.

### G.6 Pocos PR (sustituye el primer punto de F.7)

El avance vivo va en comentarios de #70, no en un PR por paso. `TRASPASO.md` se actualiza una vez por etapa cerrada dentro del PR de código de esa etapa, o en un único PR documental al final con C0 y Q juntos. Nunca un PR documental solo para anotar la fusión de otro PR. Los arreglos de código relacionados van en un solo PR. La regla general queda también en `docs/development/WORKING_RULES.md`.

## Adenda 8 (2026-10-12, issue #70): receta HF-1 registrada, recorrido completo de C0 a Q6 y arnés especificado

Respuesta a que Codex parara antes de C0: `main` no tenía una receta HF-1 registrada (`RunIntent` y fragmentos). Esta adenda cierra ese hueco y todos los del mismo tipo hallados al recorrer en seco, contra el código de `main`, cada etapa hasta el veredicto. No cambia entradas, perfil privado, fórmulas, gates, tolerancias, contratos ni pins. Decisiones de plataforma tomadas aquí: las que la ciencia no fija (nombres, identificadores, recursos de la tarea) y que se anotan en H.1.

### H.1 La receta (código: `platform/src/dftlab_platform/hf1_recipe.py`)

La cadena de la plataforma es `VALIDATE_INPUT`, `CREATE_CAMPAIGN`, `CREATE_PLAN` y `PREPARE_PACKAGE` (`AuthoringHandlers`), y la receta se resuelve por `(protocol_id, version)` en `QraftArtifactAuthoring(recipes=...)`. El borrador es un **portador descriptivo**: la ciencia vive en el paquete de la campaña ya verificado (D.2), no en la traducción. La receta no elige ningún número que D.2 no fije; cada valor sale de `reference.fdf` y `material.json` fijados.

| Campo | Valor | Origen |
|---|---|---|
| `protocol` | `dftlab.hubbardflow.hf1-nio-qualification` `0.1.0` (el `recipe_id` de QRAFT es igual) | decisión de plataforma |
| `operation` | `dftlab.hubbardflow.hf1-lr-u` | decisión de plataforma |
| Estructura | celda fcc de 4.17 Å (filas `(0,1,1)`, `(.5,0,.5)`, `(.5,.5,0)`), `NiLR0` `(0,0,0)`, `NiLR1` `(.5,0,0)`, O `(.25,.5,.5)` y `(.75,.5,.5)`, `BULK` | `reference.fdf` |
| Modelo físico | PBE (GGA), carga 0 e, `COLLINEAR`, `SCALAR`, sin Hubbard impuesto | D.2 |
| Política numérica | DZP, 0.005 Ry, 200 Ry, MP `[2,4,4]`, sin smearing, `diagon`, DM 1e-5, H 1e-4 eV, objetivo `U_scalar_charge`; la justificación incluye el `sha256` del paquete | D.2 |
| Fragmento | `hf1-controller`, una tarea `hf1`, capacidad `dftlab.engine.hubbardflow.hf1`, una entrada `campaign` (`application/zip`, contrato `dftlab.hf1.campaign-bundle`), sin salidas declaradas | `prepare_controller_task` |
| Recursos de la tarea | 1 nodo, 1 rango, 1 proceso por nodo, 1 CPU, **1800 s** | H.2 |
| Fuente | `campaign.bundle.zip` ligada a la referencia del artefacto y a su `sha256` | D.2 |

El resolutor compara el borrador almacenado con el esperado y rechaza con `PRECONDITION_FAILED` cualquier diferencia de estructura, modelo, política u operación. Un borrador distinto no puede tomar la receta.

**Qué hace Codex.** Construye `QraftArtifactAuthoring` con `recipes=recipe_registry(api, bundle_ref=<ref del ZIP>, bundle_sha256=<sha>, profile_id="hf1-controller-outer-slurm-v1")` y `controller_adapter_factory` como en `qualify_native_handlers.py`, registra el ZIP como artefacto, crea el borrador con `draft_request(sha, idempotency_key=...)`, y recorre la cadena. No inventa nada: si un paso pide un valor, sale de este cuadro o de D.2.

### H.2 Walltime de la tarea: 1800 s (corrige F.2)

F.2 fijó `walltime_seconds = 3600` en la tarea. QRAFT lo rechaza: `_validate_initial_launch_budget` exige estimación menor que la allocation menos el margen de parada, y 3600 no es menor que 3600 menos el margen. Con **1800 s** (el NiO tarda unos 8 min) se cumple en el empaquetado (1800 + 30 < 3540) y en el lanzamiento. La allocation exterior sigue en 3600 s, `max_attempts` en 3. La ficha JSON se corrige a 1800.

### H.3 Validación de un flujo controlador (`qraft_authoring.py`)

`validate()` exigía informes nativos de SIESTA y, sin ellos, devolvía `PRECONDITION_FAILED`: un flujo HF-1 no los tiene. Ahora, si el bloqueo de la compilación contiene un adaptador de tarea de tipo controlador (`prepare_controller_task`), la validación se hace con ese adaptador, y el recibo dice **`CONTROLLER_BUNDLE_TRANSPORT_ONLY`** (`WARNING`, `HEURISTIC`) con decisión `ACCEPTED_WITH_WARNINGS` y alcance «transporte del paquete; la ciencia no se valida aquí». Nunca devuelve `ACCEPTED`. El camino de SIESTA queda igual. Prueba: `test_controller_workflow_without_native_reports_is_transport_only_never_accepted`.

### H.4 Intentos de Q: copia de `state.sqlite` por intento (cierra H8 en la opción A)

`controller_authorities.run_id` es clave primaria y `create` rechaza cualquier registro, y `scheduler_dispatches.run_id` es único. C0 y el intento 1 de Q usan el estado de plataforma normal. Los intentos 2 y 3 de Q **no** pasan por la plataforma (F.4): el arnés copia el paquete ya preparado, comparte el directorio de `authority-locks`, y para cada intento usa **una copia fresca del `state.sqlite` anterior a la presentación**, con su propio `effect-intent` y contexto de worker. No se borra ni edita ningún registro de autoridad del run original. La copia es del arnés, no del producto.

### H.5 Especificación del arnés de Q

1. **PID del runtime.** El guion `sbatch` escribe `echo $$ > runtime.pid` en el directorio del intento antes de `exec python -I -m ...`. Ese es el PID de `SIGTERM` (Q1) y `SIGKILL` (Q3). Nunca se señala otro.
2. **Vigilante.** Lee el libro JSONL (`qraft.controller-inner-ledger@1.0`): dispara cuando hay `LAUNCH_STARTED` con `key.node_id` igual al nodo de D.4 (por ejemplo `response:lr_s000_m0p06_screened`) y sin `LAUNCH_FINISHED` de ese `trace_id`; y la `siesta.out` del nodo, que se localiza con el `pid` de `LAUNCH_STARTED` (`/proc/<pid>/fd/1` o `cwd`), tiene una línea `scf:`. Sondeo cada 100 ms.
3. **Plazo en cola.** Si el job propio sigue `PENDING` 120 s, se cancela **solo ese job** (aún sin intento ni descriptor), se espera nodo `IDLE`, sonda nueva y reenvío; máximo 2 veces. Sustituye al límite de 600 s de G.2 K3, porque la sonda caduca a los 900 s y deja tiempo para el arranque.
4. **Reanudación.** `RunInspector().resume(...)` es un **plan de solo lectura**; el intento real es un `sbatch` nuevo, con sonda nueva. La evidencia terminal sale de `SlurmTerminalCollector` y `LocalTerminalSigner`.
5. **Primero en seco.** El arnés tiene un modo `--dry-run` que hace autoría, sonda y construye el guion sin enviar nada. Se ejecuta antes de C0 y antes de Q; sus fallos son defectos del arnés (G.4).
6. **Evidencia.** Un directorio por intento con descriptor, libro, `controller-closure.json`, sello, `squeue` antes y después, `ps`/`sacct`/`scontrol` de Q3, `boot_id` antes y después de Q5, `lr_u_analysis.v3.json` y `U_scalar_charge` por sitio de C0 y de Q.

### H.6 Recorrido por etapas (contra `main`)

| Etapa | Verificado en seco | Estado |
|---|---|---|
| Preflight (F.6, G.2) | Pasa en el WSL de Manuel desde Adenda 7 | ok |
| Receta y borrador | Contratos reales de borrador; resolutor; deriva rechazada (`test_hf1_recipe.py`) | cerrado aquí |
| Validación | Flujo controlador sin informes nativos | cerrado aquí |
| Empaquetado | Presupuesto de lanzamiento 1800 + 30 < 3540 | cerrado aquí (H.2) |
| C0 | `NativeWorker`, puerto SLURM, autoridad: precedente T-023b | ok, se mide en el WSL |
| Q1 a Q4, Q6 | Autoridad de un solo intento (H8) | cerrado aquí (H.4, H.5) |
| Q5 | `wsl --shutdown` (F.5, G.2 K7) | ok |
| D.5 / U-Q9b | En QRAFT `main` (PR #12) | ok |
| Veredicto y evidencia | D.3, D.6 | ok |

QRAFT y HubbardFlow se leyeron estáticamente aquí (no se ejecutaron). Lo que solo se mide en el WSL (mpirun absoluto en el perfil exterior, ausencia de claves `SLURM_*` en su entorno, alias del nombre del nodo, `SLURM_JOB_CPUS_PER_NODE`) lo cubre `--dry-run` y G.4.

### H.7 Pruebas

`test_hf1_recipe.py` (4) y la nueva de `test_authoring.py`.

## Adenda 9 (2026-10-12, issue #70): C0 falló por «state without an owner»; la plataforma prepara el estado después de que QRAFT lo reclama

Respuesta al `FAIL` de C0 ([comentario en #70](https://github.com/Jairomcarmona/dftlab-suite/issues/70#issuecomment-6132849184)): SLURM #443 terminó bien y QRAFT `attempt-0001` falló con `CONTROLLER_STATE_TAMPERED: state without an owner`, antes de SIESTA (`NOT_EVALUATED`). No cambia entradas, perfil privado, fórmulas, gates, tolerancias, contratos, pins ni el código de QRAFT y HubbardFlow. Se leyó `controller_state.py`, `controller_supervisor.py`, `controller_runtime.py`, `capability_runtime.py`, `controller_entrypoint.py` y `controller_launcher.py` de QRAFT `334df66`, y `api/controller.py` de HubbardFlow.

### I.1 Causa

Orden de los hechos en el primer intento de una tarea controladora:

| # | Quién | Qué | Fuente |
|---|---|---|---|
| 1 | Runtime de QRAFT | `previous()` lee `controller-state/<tarea>`: no existe, sin dueño previo, sigue | `capability_runtime.py:1111`, `controller_runtime.py:82` |
| 2 | **`prepare_task` de la plataforma** | Creaba el directorio y copiaba ahí los siete archivos del paquete | `hf1_capability.py` (antes de esta adenda) |
| 3 | Supervisor de QRAFT, ya en el job | Vuelve a llamar `previous_controller_owner`: hay archivos y no hay `owner.json`, lo lee como manipulación | `controller_supervisor.py:67`, `controller_state.py:63-66` |
| 4 | Supervisor | Solo después escribiría `owner.json` | `controller_supervisor.py:77` |

El primer intento de cualquier tarea HF-1 fallaba así, sin importar la ciencia. Nada lo cubría: las pruebas de la plataforma llamaban `prepare_task` sin supervisor, y las de QRAFT y HubbardFlow no escriben en el estado antes del dueño.

### I.2 Decisión: entrada propia de la plataforma

| Opción | Resultado |
|---|---|
| Cambiar QRAFT para tolerar estado sin dueño | **Descartada.** Debilita la regla de manipulación de §6 y D.5; el descriptor no admite campos nuevos (`additionalProperties: false` en QRAFT y en la copia de HubbardFlow), así que son dos repositorios, pins y wheels nuevos |
| Escribir un `owner.json` desde la plataforma | **Descartada.** Es fingir la propiedad que solo el supervisor puede reclamar |
| Preparar el estado después del dueño con una entrada de la plataforma | **Elegida.** Solo código de este repositorio, sin tocar el contrato con QRAFT |

La capacidad HF-1 ya declara cuál es su entrada de controlador (`qraft.controller`). Ahora declara `dftlab-hf1-controller`, un script de consola de la distribución `dftlab-platform` (`platform/pyproject.toml`), y QRAFT lo resuelve igual que antes (la distribución instalada, su `RECORD`, sin `PATH`).

| Momento | Quién | Qué hace |
|---|---|---|
| Preparación (antes del supervisor) | `prepare_task` | Crea `controller-state/<tarea>` **vacío** (0700), verifica y registra el paquete en `work/<tarea>/attempt-N/hf1-stage.json` (ruta relativa, `bundle_sha256`, `profile_sha256`, CPU). **No escribe nada en el estado.** En un reintento con dueño verifica los archivos en su sitio, como antes |
| Reclamo | Supervisor de QRAFT | Ve el directorio vacío, escribe `owner.json`, lanza la entrada |
| Entrada (`hf1_controller_entry.py`) | `dftlab-hf1-controller` | Exige `owner.json`; valida que `--qraft-reservation` y `--campaign` tengan la forma de QRAFT; relee el paquete con `inspect_bundle`; en un estado con solo `owner.json` copia los archivos (`xb`, nunca sobrescribe); si ya hay archivos solo los compara. Después llama a `hubbardflow.api.controller.main` con **los mismos argumentos** y en el mismo proceso (la señal `SIGTERM` de Q sigue llegando a su manejador) |
| Cualquier fallo de la entrada | — | Código 2 y mensaje; HubbardFlow no arranca |

Los argumentos que QRAFT valida (`validate_controller_command`) no cambian: la entrada solo sustituye al ejecutable.

### I.3 Cómo se reintenta C0

El `attempt-0001` de la corrida fallida queda asentado y no se toca: ni su directorio, ni su estado, ni su registro de autoridad ni de envíos (`run_id` es único en ambos, H8). Un `attempt-0002` de la misma corrida tampoco sirve: su estado ya tiene archivos y no tiene dueño.

1. **Corrida nueva** (D.4 ya pide campañas nuevas): `run_id`, claves de idempotencia, raíz, estado y job nuevos. Se reutiliza el mismo paquete ZIP verificado (mismos `bundle_sha256` y `profile_sha256`); si la plataforma exigiera un `campaign_id` distinto, solo ese identificador es nuevo y los archivos científicos conservan sus SHA-256, que se comparan con los de la corrida fallida.
2. Se registra como **C0, segunda corrida** (`C0-r2`). El `FAIL` de la primera se queda en `TRASPASO.md` y en #70 con su motivo; no se borra. No contradice a D.6: aquel `FAIL` vale para claves asentadas relanzadas, y ningún nodo de la primera corrida llegó a lanzarse.
3. Evidencia que prueba el arreglo, antes de SIESTA: `controller-state/<tarea>/owner.json` existe, y los archivos del paquete aparecen **después** de él (orden de `mtime`).

### I.4 Resto de la secuencia recorrida en seco

Se siguió C0, Q1 a Q6 y el veredicto contra el código de QRAFT y de HubbardFlow buscando otro orden entre «archivos del estado» y «dueño»:

| Paso | Orden verificado | Resultado |
|---|---|---|
| C0 intento 1 | Admisión → preparación (estado vacío) → reclamo → entrada → HubbardFlow | ok con I.2 |
| Q1 (intento 1 de Q) | Igual que C0 | ok con I.2 |
| Q2 (reanudar tras `SIGTERM`) | El supervisor anterior sella el estado y escribe el cierre; la admisión compara el manifiesto; `prepare_task` solo lee; la entrada solo compara | ok, ninguna escritura entre admisión y supervisor |
| Q3, Q4 | `kill -9` deja `owner.json` con el mismo `boot_id` y sin cierre; el siguiente intento da `CONTROLLER_PREVIOUS_OWNER_ALIVE` **antes** de reservar intento | ok, no consume intento |
| Q5, Q6 | `boot_id` distinto y sin sello → `ABSENT_AFTER_BOOT_CHANGE` (U-Q9b); luego igual que Q2 | ok |
| Archivos del paquete tras una corrida | HubbardFlow los lee y los resume en la línea base; ninguno se reescribe | ok: la verificación en sitio es válida al reanudar |
| Ledger y cierre | Escritos por QRAFT y HubbardFlow dentro del estado y del intento | ok |

No se encontró otro caso. Lo que solo se ve con QRAFT y HubbardFlow instalados lo cubren las comprobaciones nuevas del preflight (I.5) y la evidencia de I.3.3.

### I.5 Comprobaciones nuevas del preflight

`HF1_PLATFORM_CONTROLLER_ENTRY`, `HF1_HUBBARDFLOW_CONTROLLER_ENTRY` y `HF1_HUBBARDFLOW_CONTROLLER_MODULE`: repiten la resolución de QRAFT (distribución instalada, script de consola único, anotado en el `RECORD`, ejecutable) y que `hubbardflow.api.controller` se importa. Un wheel viejo falla ahí, no dentro de un job.

### I.6 Pruebas

En `test_hf1.py`: `test_fresh_state_is_left_empty_so_qraft_does_not_read_it_as_tampered` (la regresión del `FAIL`), `test_entry_stages_after_the_claim_and_resume_never_rewrites_state`, `test_entry_refuses_paths_and_plans_that_do_not_match_the_qraft_layout`, `test_entry_hands_the_same_arguments_to_hubbardflow_only_after_staging` y `test_capability_names_the_platform_console_script_and_the_wheel_declares_it`. En `test_hf1_preflight.py`: `test_controller_entry_check_names_a_missing_or_unrecorded_console_script`.

### I.7 Si aparece otro defecto del mismo tipo

Se aplica G.4 (arreglo mínimo en este repositorio, una prueba, un PR, máximo dos por identificador). Si la causa está en QRAFT o HubbardFlow y no se puede resolver desde la plataforma (como lo era la opción descartada de I.2), es parada: un solo comentario en #70 con la causa y la línea del código.

## Adenda 10 (2026-10-12, issue #70): C0-r2 dio `NO_NUMERICAL_U`; la campaña se inicializa en su raíz final

### J.1 Causa

`observation_assembly.py:132` falló con «PSML for correlated site NiLR0 is absent from the verified input inventory». No falta ningún dato: el PSML de NiLR0 sí está en el inventario del paquete. Es un defecto de disposición de archivos, no de ciencia: ninguna fórmula, gate, tolerancia, contrato ni pin interviene.

`initialize_campaign` de HubbardFlow escribe en `lr_config.json` rutas **absolutas** de la raíz donde inicializó (`pseudopotentials.*`, `static_artifacts.*`, `compatibility_registry`, `version_text_source`, `planning_reference_*`). Al observar, HubbardFlow convierte cada ruta en relativa a la raíz de la campaña (`campaign_relative_path`) y la busca en el inventario relativo. Si la campaña se inicializó en otra raíz que aquella donde se ejecuta (la plataforma la copia a `controller-state/<tarea>`, cuya ruta depende de un `run_id` que no existe al construir el paquete), la ruta no cuelga de la raíz, queda absoluta y no está en el inventario. D.2 ya decía que `lr_config.json`, `backend_contract.json`, `execution_profile.json`, `campaign_id` y `input_identity` dependen de la ruta o del UUID y no están fijados por hash; lo que faltaba era exigir que la ruta de inicialización fuera la de ejecución.

### J.2 Decisión: la raíz final la elige el arnés, antes de inicializar

La raíz de ejecución no tiene que llamarse `extracted/<run_id>`: es cualquier directorio nuevo que el arnés elija al extraer el paquete. Por tanto, **por cada corrida** (C0-r3 y la de Q) el arnés:

1. Elige la raíz `R` de la corrida (nueva, inexistente, ruta ya resuelta con `realpath`) y calcula `S = R/controller-state/<task_id>` (el `task_id` es el de la receta).
2. Inicializa la campaña con HubbardFlow **en `S`**: `campaign_root = S.parent`, `name = S.name` (`S.parent` se crea antes; `pointer_path` fuera de `S`). Comprueba que los siete hashes sin ruta de D.2 coinciden con los fijados.
3. Comprime el contenido de `S` en el ZIP del paquete (`campaign.v2.json` en la raíz del ZIP, sin más archivos que los declarados), calcula `bundle_sha256` y `profile_sha256`, y ejecuta `final_root_findings(bundle, S)` (`dftlab_platform.hf1_bundle`). Debe devolver `[]`.
4. **Borra `S` completo** (QRAFT exige un estado vacío o inexistente, Adenda 9) y registra los hashes.
5. Hace autoría y empaquetado con ese ZIP y **extrae el paquete en `R`**, sin mover ni copiar `R` después. La plataforma crea `S` vacío, QRAFT lo reclama, y `dftlab-hf1-controller` deja los archivos del ZIP en `S`, la misma ruta con la que se inicializó.

Los intentos 2 y 3 de Q reutilizan `R` y `S` en sitio (H.4): mover o copiar `R` reabre este defecto.

Cada corrida tiene su propia campaña (`campaign_id` nuevo, hashes de `lr_config.json` y `backend_contract.json` distintos); I.3.1 («mismo paquete ZIP») queda sustituido: se conserva el paquete **científico** (los siete hashes de D.2), no el ZIP.

### J.3 Código

`final_root_findings` (`hf1_bundle.py`) lista las rutas de `lr_config.json` que no son absolutas, no cuelgan de `S` o no están en el inventario. La usan `prepare_task` (si el estado es nuevo, la admisión falla con `PRECONDITION_FAILED` antes de lanzar nada) y `dftlab-hf1-controller` (antes de escribir en el estado, con el motivo en stderr). Un paquete mal inicializado ya no llega a observar ni gasta un job. No toca fórmulas, gates, tolerancias, contratos, pins, QRAFT ni HubbardFlow.

### J.4 El job exterior en `FAILED (1:0)`

El observador privado de la corrida no está en el repositorio y no se pudo revisar. Lo más probable es que su artefacto (`lr_u_analysis.v3.json`) no existiera porque la observación falló con `NO_NUMERICAL_U`, es decir, la misma causa. Se especifica igualmente, para que no oculte evidencia (G.4, defecto de arnés): el guion `sbatch` guarda la evidencia en un `trap EXIT` (incluida la salida del observador y del `siesta.out`), escribe el artefacto de forma incremental, y su código de salida es el del runtime de QRAFT, no el del observador; un fallo del observador se anota como evidencia y no cambia el estado del job. Antes de relanzar, el arnés lee `slurm-<job>.out/.err` de C0-r2 y clasifica la salida 1:0 en el informe.

### J.5 Lecturas previas a observar (verificadas contra la campaña real)

Todo lo que HubbardFlow lee antes de observar está en `lr_config.json` y se cubre con J.3: PSML, artefactos estáticos, registro de compatibilidad, texto de versión y referencias de planificación. `backend_contract.json` y el inventario usan rutas relativas. El perfil de ejecución (ejecutables y `mpirun`) es exterior y lo cubren el preflight y `controller_profile_findings`.

### J.6 Recorrido por etapas

| Etapa | Qué se verificó | Estado |
|---|---|---|
| Inicializar campaña | En su raíz final (J.2) | cerrado aquí |
| Admisión y estado vacío | Adenda 9; más J.3 | cerrado aquí |
| Entrada tras el reclamo | Comprueba J.3 antes de escribir | cerrado aquí |
| C0-r3 (SIESTA, observación) | PSML en el inventario con ruta relativa | cerrado aquí |
| Q1 a Q6 | Una campaña nueva en su raíz final; Q2 y siguientes reanudan en sitio | cerrado aquí |
| Salida del job exterior | J.4 | cerrado aquí |
| Veredicto | D.3, D.6 | ok |

### J.7 Pruebas

`test_bundle_initialized_outside_its_final_root_is_refused_before_it_can_hide_a_psml` en `test_hf1.py`.

### J.8 Reintento

C0-r3 es otra corrida nueva (raíz, `run_id`, claves y job nuevos). No se toca `attempt-0001` ni nada de C0-r1 y C0-r2; ambos `FAIL` quedan registrados.

## Adenda 11 (2026-10-13, issue #70): J.2 corregida para `local_wsl` en HubbardFlow 0.1.3

### K.1 Qué estaba mal en J.2

J.2 decía que `initialize_campaign(campaign_root=S.parent, name=S.name)` crea la campaña en `S`. Con `target = local_wsl`, HubbardFlow 0.1.3 **ignora `campaign_root`**: `workspace = Path(profile.wsl.workspace_root)` (`wsl_campaign_init.py:99-105`), y la campaña se crea en `workspace_root/<name>`. El mismo directorio es la raíz del cerrojo de SIESTA (`campaign_runner.py:370`, `workspace_root/.siestaflow/single-siesta.lock`). La Adenda 10 se escribió sin leer esa rama. La causa de `NO_NUMERICAL_U` (J.1) y la comprobación `final_root_findings` (J.3) siguen siendo correctas.

### K.2 Decisión (Manuel, 2026-10-13): copia derivada del perfil por corrida

Para que `workspace_root/<name>` sea `S = R/controller-state/<task_id>`, el perfil de la campaña de **esa corrida** lleva `wsl.workspace_root = R/controller-state`, y `name = <task_id>`. El arnés **deriva una copia** del perfil privado `VALIDATED_RUNTIME` que solo difiere en `wsl.workspace_root`; el archivo privado no se edita y no se toca ningún otro campo, ni el pin, ni el contrato. El `profile_sha256` de la factory es el de la copia de esa corrida (corrige la fila «Intacto» de la tabla de perfiles: lo intacto es todo menos esa ruta, que D.2 ya clasifica como dependiente de la ruta).

El cerrojo queda en `R/controller-state/.siestaflow/`, fuera de `S`; QRAFT solo lee y sella `S` (`controller_state.py`, `controller_runtime.py:83`), de modo que no lo ve. Cada corrida tiene su `R`, así que el cerrojo es por corrida.

### K.3 Código

`final_root_findings` añade `execution_profile.wsl.workspace_root` cuando el perfil es `local_wsl` y `workspace_root` no resuelve a `S.parent`. Un perfil sin esa ruta correcta falla en la admisión, no en SIESTA.

### K.4 Arnés

Por corrida: `R` nueva; `S = R/controller-state/<task_id>`; copia derivada del perfil con `wsl.workspace_root = str(R/controller-state)`; `initialize_campaign(..., profile_path=<copia>, name=<task_id>, pointer_path=<fuera de S>)` (no pasar `campaign_root`: se ignora); **comprobar que la raíz devuelta es `S`** y que `final_root_findings == []`. Lo demás es J.2 pasos 3 a 5. `--dry-run` ejecuta `initialize_campaign` de verdad en una `R` de ensayo y la borra por completo (incluido `.siestaflow`); si la raíz no es `S`, es defecto de arnés (G.4).

### K.5 Pruebas

`test_local_wsl_profile_workspace_root_must_be_the_state_parent`; `test_local_wsl_campaign_profile_is_controller_only_and_never_slurm_by_default` lleva ahora un bloque `wsl`.

## Adenda 12 (2026-10-13, issue #93): la plataforma reanuda HF-1 por generaciones de autoridad y de envío

Estado: **aceptada** por Manuel el 2026-10-13 (alcance «3A: solo P7»); la opción A de F.4 ya dejó la reanudación por la plataforma como paso siguiente. Cierra H8 para la plataforma. Fuente: lectura de `authority_storage.py`, `submission_storage.py`, `authority.py`, `authority_recovery.py`, `submissions.py` y `storage.py` en `main` (`9378305`), y de `controller_state.py`, `controller_runtime.py` y `api.py` de QRAFT en `6dec1ba`. Vectores ejecutables: `contracts/fixtures/authority-generations/cases.json` (23 casos), evaluados por `evaluateGenerationAdmission` en `contracts/scripts/check-contracts.mjs`.

### L.1 Qué es una generación

Una **generación** es un intento del controlador de una corrida, numerada 1, 2, 3 (`max_attempts = 3`, F.2). Tiene un registro de autoridad `(run_id, generation)`, un envío `(run_id, generation)` con su `attempt_token` propio y un `attempt_id` propio. La generación N + 1 solo existe después de que la N quedó **retirada**. Nunca hay dos generaciones activas de la misma corrida, y nunca se reutiliza ni se edita el registro de una generación anterior.

### L.2 Qué ya hace QRAFT y qué falta de su lado

QRAFT ya decide, dentro del intento N + 1, si el dueño anterior murió: `previous_controller_owner` devuelve `CLOSED` u `OWNER_DEAD_BY_BOOT_CHANGE`, o lanza `CONTROLLER_PREVIOUS_OWNER_ALIVE`, y lo hace antes de lanzar nada. El descriptor ya lleva `authority_generation` y `attempt_number`, y el veredicto de reanudación (`qraft.controller-resume-verdict@1.0`) se escribe antes de cualquier lanzamiento interno. La plataforma **no reimplementa** nada de eso. Lo que falta es que la plataforma pueda **leer la misma prueba** antes de abrir la generación, y para eso QRAFT no exporta nada hoy en `qraft.api`.

**U-Q19 (QRAFT, aditivo).** Exportar en `qraft.api` una función de solo lectura que envuelva `previous_controller_owner` sin cambiar su comportamiento: entrada raíz, `state_dir`, `boot_id` y host actuales; salida `owner_proof ∈ {CLOSED, OWNER_DEAD_BY_BOOT_CHANGE}` o la excepción `CONTROLLER_PREVIOUS_OWNER_ALIVE`/`CONTROLLER_STATE_TAMPERED`. Es un PR pequeño de QRAFT con prueba de importación y línea en `PUBLIC_API.md`. Si al implementarlo el código real contradice lo descrito aquí (por ejemplo, que `attempt_number` no coincide con la generación), parar y comentarlo en #93.

### L.3 Migración v2 de la autoridad (`authority_storage.py`)

Migración explícita, en una sola transacción, idempotente y con prueba de ida y vuelta de datos:

1. Tabla nueva `controller_authorities`: `(run_id, generation INTEGER NOT NULL CHECK(generation >= 1), project_id, owner_id, document, last_observed_at, retired INTEGER NOT NULL DEFAULT 0 CHECK(retired IN (0,1)), PRIMARY KEY(run_id, generation))`.
2. Copiar cada fila antigua con `generation` = la del documento (hoy siempre 1; si alguna no lo es, abortar) y `retired = 1` si el documento tiene `lease_expires_at = null`.
3. Índice `UNIQUE (run_id) WHERE retired = 0`: una sola generación activa por corrida.
4. `authority_migrations` pasa a `[1, 2]`. Un `versions` distinto sigue siendo «migración explícita requerida». Se valida cada documento migrado contra el contrato.

`create` se parte en dos intenciones: **primera generación** (como hoy) y **siguiente generación**. Ambas ocurren en la transacción de `create`, que ya toma el cerrojo del kernel por `[project, run]`; ese cerrojo no cambia de clave entre generaciones, de modo que dos generaciones no corren a la vez en el mismo host.

### L.4 Migración v2 del libro de envíos (`submission_storage.py`)

`scheduler_dispatches` se recrea con `generation INTEGER NOT NULL`, `UNIQUE(run_id, generation)` (sustituye a `UNIQUE(run_id)`) y se mantiene `UNIQUE(attempt_token)`. `generation` se toma de `intent.authority_generation` del intento guardado (hoy 1; si no, abortar). `scheduler_rpc_entries` conserva su clave foránea. Los envíos antiguos migran como generación 1 sin tocar fase ni recibo.

### L.5 Reglas de admisión (ejecutables)

El evaluador de referencia es `evaluateGenerationAdmission`; la primera regla que aplica decide. Las pruebas de la plataforma deben dar el mismo veredicto para cada caso del JSON.

| Petición | Se admite si, en este orden | Si no |
|---|---|---|
| `DISPATCH_RESERVE`, generación 1 | no hay generaciones ni envío 1 | `RUN_ALREADY_SUBMITTED` |
| `DISPATCH_RESERVE`, generación N > 1 | N = máxima + 1; N ≤ 3; la máxima está retirada; su retiro trae `sacct_terminal` **y** `owner_proof ∈ {CLOSED, OWNER_DEAD_BY_BOOT_CHANGE}`; su envío está `ACKNOWLEDGED`; hay un `resume-plan` con `from_attempt_id` igual al `attempt_id` de la máxima; si QRAFT dio `REFUSE` en esa máxima, el plan nuevo tiene `plan_revision` mayor | `GENERATION_NOT_NEXT`, `ATTEMPTS_EXHAUSTED`, `PREVIOUS_GENERATION_ACTIVE`, `PREVIOUS_TERMINATION_NOT_PROVEN`, `PREVIOUS_DISPATCH_UNRESOLVED`, `RESUME_PLAN_STALE`, `RESUME_REFUSED_PLAN_UNCHANGED` |
| `AUTHORITY_CREATE`, generación N | el envío N existe y pasó de `RESERVED`; N = máxima + 1; la máxima está retirada | `DISPATCH_NOT_STARTED`, `GENERATION_NOT_NEXT`, `PREVIOUS_GENERATION_ACTIVE` |
| `AUTHORITY_CHECK`, generación N | N es la máxima | `SUPERSEDED` (N menor), `UNKNOWN_GENERATION` |

Se admite `AUTHORITY_CREATE` con el envío en `DISPATCH_STARTED` y no solo en `ACKNOWLEDGED`, porque el trabajo de SLURM puede arrancar antes de que la plataforma guarde el recibo. El `authority_check` de la generación N falla en cuanto exista la N + 1: es la defensa contra un controlador viejo que sigue escribiendo.

### L.6 Flujo de una reanudación

1. El usuario crea el `resume-plan` (`CREATE_RESUME_PLAN`, ya existe) con `from_attempt_id` = intento de la máxima generación.
2. `EXECUTE_RESUME_PLAN` (ya existe) reserva el envío N + 1 con un `attempt_token` y un `authority_generation = N + 1` nuevos; aplica las reglas de L.5.
3. Se envía el `sbatch` de ese intento (con `--no-requeue`, F.2). Dentro del job, el worker crea el registro de autoridad N + 1.
4. QRAFT evalúa `previous_controller_owner` y escribe el veredicto de reanudación antes de lanzar. `REFUSE` deja la corrida `BLOCKED`, consume la generación y exige un `resume-plan` con `plan_revision` mayor para otra. No hay reintento automático nunca.
5. Las claves del libro interno son estables entre generaciones (§4): la plataforma no las toca.

### L.7 Retiro de la generación N

`SQLiteNativeAuthorityRetirement.retire` mantiene hoy toda su verificación (`sacct` terminal, `active_allocation_absent`, envío acusado, bloqueo del kernel). Cambios:

- el retiro, en la misma transacción, pone `retired = 1` en `(run_id, generation)`;
- el verificador registrado gana `owner_proof(root) -> "CLOSED" | "OWNER_DEAD_BY_BOOT_CHANGE" | None`, que llama a la función de U-Q19; `None` o una excepción rechazan el retiro con `PRECONDITION_FAILED`. La prueba se guarda en `authority_retirements.owner_proof` (columna nueva; `NULL` en retiros anteriores, que cuentan como `UNPROVEN` para abrir una generación);
- `sacct` terminal solo **no basta**, tal como pide la Adenda 6 para `proctrack/linuxproc`.

### L.8 Qué no cambia

Contratos y schemas públicos (`generation` ya existe en `controller-authority-record` y `authority_generation` en el intento y el recibo), el cerrojo del kernel, la política de «sin takeover automático», la lectura de las retiradas existentes, el pin de QRAFT salvo el que suba U-Q19, y HubbardFlow. HF-1 sigue sin ofrecerse como reanudable a usuarios hasta cerrar #93 y repetir la calificación Q con la plataforma (L.10).

### L.9 Pruebas

En `platform/tests/test_authority_generations.py` y los existentes:

1. Los 23 casos del JSON dan el mismo veredicto en Python.
2. Migración: una base v1 con una autoridad activa, una retirada y un envío en cada fase migra sin perder bytes; un documento con `generation != 1` aborta; la segunda ejecución no hace nada.
3. Concurrencia: dos `create` de la generación 2 a la vez; gana uno y el otro da `PRECONDITION_FAILED` (índice parcial).
4. Fencing: tras crear la generación 2, `authority_check` y `publish` de la 1 fallan y no escriben.
5. `sacct` terminal sin `owner_proof` no retira; con `CLOSED` o `OWNER_DEAD_BY_BOOT_CHANGE`, sí.
6. Un envío 2 en `DISPATCH_STARTED` sin acuse bloquea un intento 3 (`PREVIOUS_DISPATCH_UNRESOLVED`).
7. Los tests existentes de `test_authority.py`, `test_authority_recovery.py`, `test_submissions.py` y `test_native_worker.py` pasan sin cambiar su intención; los que asumían «un solo registro por corrida» se reescriben para la generación 1 y se listan en el PR.

### L.10 Calificación real (Ola 3)

Repetir la secuencia Q1 a Q6 de H.4 pero con los intentos 2 y 3 **por la plataforma** (sin copia manual de `state.sqlite` ni arnés propio de `sbatch`), en el mismo entorno de C0. Mientras no se haga, el registro dice «reanudación por la plataforma, implementada y probada en CI; no calificada en real». Es una corrida que decide Manuel; no se promueve ninguna capability por este ADR.

### L.11 Código y PR

Dos PR en este orden: **U-Q19** en QRAFT, y después **P-4** en `dftlab-suite` (migraciones, reglas, retiro, pruebas, pin de QRAFT al commit fusionado de U-Q19, una línea en `TRASPASO.md`). Sin PR documental.
