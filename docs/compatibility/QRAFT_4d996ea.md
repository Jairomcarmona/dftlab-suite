# QRAFT HPC @ `4d996ea`: API pública real

Fuente: [`Jairomcarmona/siestaflow@4d996ea7c580e5638e470bbf32624c88fd762f7d`][Q] (punta de `main`, 2026-09-15), distribución `qraft-hpc` 0.2.0, import `qraft`, Python ≥ 3.11, licencia BSD-3-Clause, única dependencia obligatoria PyYAML. Leído el 2026-10-11 sin modificar el repositorio.

[Q]: https://github.com/Jairomcarmona/siestaflow/blob/4d996ea7c580e5638e470bbf32624c88fd762f7d

## 1. Qué declara público el propio motor

QRAFT tiene una política escrita y hay que respetarla:

- **Python:** solo los nombres de `qraft.__all__` ([`src/qraft/__init__.py:14`][Q-init]; [`docs/developer/PUBLIC_API.md`][Q-api]). Son configuración/aplicación (`QraftApplication`, `ApplicationConfiguration`), `ScientificIdentity`, `ExecutionSpec`, `ExecutionProfile`/`ProfileStore`, `OutputModel`, los protocolos `EngineAdapter`, `LauncherAdapter`, `SchedulerAdapter`, los modelos de caminos de bandas (M7.1) y los de spin (M8-A/B/C). «All other modules are internal unless a specific contract document declares otherwise.»
- **Contratos persistentes:** `Core Contracts 1.0` ([`docs/design/CORE_CONTRACTS_1_0.md`][Q-cc], estado `IMPLEMENTED / INTERNAL ADOPTION IN PROGRESS`), versionados `MAJOR.MINOR` e independientes de la versión del paquete. Es el documento de contrato que hace públicos los 13 contratos de [`contracts/catalog.py`][Q-cat] y el paquete `qraft.contracts`.
- **CLI estable 0.2:** `init`, `check`, `run`, `status`, `resume`, `results`, `examples` ([`docs/user/cli.md`][Q-cli]), con códigos de salida 0/2/3/4/5. Las familias `workflow`, `run prepare|inspect|status|resume`, `scientific`, `campaign` y `remote` son «experimental or specialized»; además imprimen `DEPRECATED` y remiten a `qraft advanced …`.
- **Compatibilidad:** en 0.x una minor puede romper API; `1.0` congelará CLI/Python. Un schema con major desconocido falla cerrado; la evidencia nunca se migra en sitio ([`docs/user/compatibility.md`][Q-compat]).
- Los identificadores `siestaflow.*` son superficie de compatibilidad, no errores de nombre ([`docs/compatibility/naming.md`][Q-naming]).

## 2. Contratos de datos públicos (Core Contracts 1.0)

| Contrato | Uso por la plataforma |
|---|---|
| `siestaflow.workflow-definition@1.0` | Documento previo al lock que devuelve el compositor |
| `siestaflow.workflow-lock@1.0` | DAG resuelto; `NativeContractRef` de un plan |
| `siestaflow.run-lock@1.0` | Liga lock, perfil, campaña del controlador e identidad por tarea |
| `siestaflow.execution-request@1.0` / `execution-evidence@1.0` | Tarea con recursos exactos / salida, clase de fallo y artefactos |
| `siestaflow.workflow-event@1.0` | Evento append-only para monitorización/API/UI |
| `siestaflow.artifact-reference@1.0` | Identidad por contenido, rol, ruta relativa segura |
| `siestaflow.validation-report@1.0` | Hallazgos con `PASS`/`REVIEW`/`BLOCKED`/`FAIL`, ámbito y clase de evidencia |
| `siestaflow.plugin-descriptor@1.0` | Declaración explícita de plugin y capacidades |
| `siestaflow.scientific-intent@1.0`, `scientific-artifact@1.0`, `numerical-profile@1.0`, `scientific-approval@1.0` | Intención, artefacto tipado, perfil `PROVISIONAL`/`APPROVED` y aprobación humana ligada a hashes |

Envelope: `ContractEnvelope` inmutable con `contract`, `producer`, `payload`, `extensions` (namespaced) y `content_sha256`; campos de primer nivel desconocidos se rechazan ([`contracts/serialization.py:90`][Q-ser]). **Digest nativo:** SHA-256 de `json.dumps(canonical_primitive(v), sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)` en UTF-8 ([`serialization.py:59`][Q-ser59]). No es JCS: la plataforma lo conserva y no lo recalcula con otra canonicalización.

Vocabularios ([`contracts/status.py`][Q-status], [`core/runtime.py:168`][Q-rt]): `TaskState` (12 valores, incluidos `REVIEW`, `INTERRUPTED`, `CANCELLED`, `INCOMPLETE`), `DecisionStatus` (`PASS`, `REVIEW`, `FAIL`, `BLOCKED`, agregados por el más restrictivo), `FailureType` (11 clases) y `ScientificDecision` (`NOT_EVALUATED`, `ACCEPTED`, `REJECTED`). No hay `NOT_ESTABLISHED` en QRAFT: ese valor llega de HubbardFlow y la plataforma no debe mapearlo a un enum de QRAFT.

## 3. Ruta canónica §7: qué existe y con qué estatus

| Paso §7 | Clase/función en el commit | Estatus público | Notas |
|---|---|---|---|
| WorkflowComposer | `WorkflowComposer.compose(intent, policy, fragments) -> dict` ([`workflow_composition.py:100`][Q-comp]) | Interno (ADR 0003 lo describe, pero no está en `__all__`) | Devuelve el mapping de `WorkflowDefinition` 1.0, no un envelope |
| WorkflowCompiler | `WorkflowCompiler.compile(path: Path)`, `write_workflow_lock(...)` ([`workflows/compiler.py:15`][Q-wc]) | Interno | Solo compila desde archivo; escritura atómica del lock |
| RunPreparer | `RunPreparer(repository_root, *, validator, task_adapters).prepare(RunPreparationRequest)` ([`run_preparation.py:131`][Q-rp]) | Interno | Solo SLURM; todo por rutas; `execution_authorized=False`, `submission_performed=False` |
| CompiledWorkflowRuntime | `CompiledWorkflowRuntime(...).run()` ([`execution/capability_runtime.py:249`][Q-cr]) | Interno | Exige registro congelado; journal `state/workflow_runtime.journal.jsonl`, eventos `evidence/workflow_events.jsonl`; `runtime_fingerprint` incluye workflow e identidades |
| Controlador | `CanonicalController.from_file(...).run()` ([`execution/canonical_controller.py:32`][Q-cc2]) | Interno | Registra solo `register_siesta_engine` y `register_generic_command` ([`:166`][Q-cc166]) |
| Registro de capacidades | `CapabilityRegistry.register/resolve/freeze/descriptors` ([`contracts/plugins.py:124`][Q-reg]) | Público vía `qraft.contracts` | Valida métodos requeridos por `CapabilityKind`; sin descubrimiento por entry points |
| CLI equivalente | `qraft workflow compose|compile`, `qraft run prepare|inspect|status|resume` con `--json` | Experimental/deprecado | Única vía hoy para operar sin importar módulos internos |

Cancelación y reanudación: no hay operación `cancel`. El controlador instala manejadores de `SIGUSR1`/`SIGTERM` y para de forma cooperativa ([`execution/slurm_environment.py:221`][Q-sig]); quien cancela es el scheduler. `qraft run resume PACKAGE --previous-job-terminal` exige que el llamador *afirme* que el job anterior terminó: QRAFT no reconcilia con SLURM. El `RLock` del runtime es de proceso y no excluye a dos procesos (coincide con §13.3 de la propuesta).

## 4. Puertos de plataforma §6.3 frente a QRAFT

| Puerto / operación | Qué hay en QRAFT | Hueco |
|---|---|---|
| CampaignAuthoring.describe | `CapabilityRegistry.descriptors()`, `qraft workflow recipes` | Sin API pública ni JSON versionado de recetas |
| CampaignAuthoring.compose | `WorkflowComposer` (interno), CLI experimental | U-Q1 |
| CampaignAuthoring.validate | `ValidationReport` público; validador SIESTA contextual interno | U-Q1 |
| CampaignAuthoring.compile | `WorkflowCompiler` desde archivo (interno) | U-Q1, U-Q2 |
| RunPackageService.prepare/verify/inspect | `RunPreparer` interno; `run inspect` experimental; `load_run_lock` interno | U-Q1, U-Q3 |
| SchedulerGateway.submit/observe/cancel/reconcile | **No existe**: QRAFT prepara el paquete y el script; no hace `sbatch`/`scancel`. `SchedulerAdapter` público solo describe | Es de la plataforma (correcto según §6.3); U-Q5 para el resume |
| ArtifactStore | `ArtifactReference`/`ArtifactTransfer` públicos (ruta relativa + SHA esperado) | Ninguno: la plataforma implementa el almacén |
| Eventos §6.2 | `workflow-event@1.0` en JSONL | U-Q4: sin cursor/secuencia por stream documentados |
| Transport, Identity | Fuera del alcance de QRAFT | Ninguno |

## 5. Cambios upstream necesarios (Ola 1, Codex)

Cada cambio va con fixture de consumidor y sin copiar código al árbol de la plataforma.

| ID | Cambio en QRAFT | Por qué | Prioridad |
|---|---|---|---|
| U-Q1 | Declarar pública (en `PUBLIC_API.md` y `__all__` o un módulo `qraft.api`) la ruta compose → compile → prepare → inspect, con tipos de entrada/salida estables | Sin esto el adaptador usaría nombres internos, lo que prohíbe la propuesta §19.2 | Bloquea T-022 |
| U-Q2 | `WorkflowCompiler.compile_mapping(definition)` o equivalente sin pasar por archivo, con el mismo digest que `compile(path)` | El servicio compone en memoria; escribir un temporal sólo para compilar mezcla identidad y ruta | Media |
| U-Q3 | Punto de extensión público para `task_adapters` del `RunPreparer` y para el registro del `CanonicalController` (hoy fijo a SIESTA + comando genérico; la CLI construye `RunPreparer(Path.cwd())` sin adaptadores, [`cli.py:1918`][Q-cli1918]) | HF-1 necesita una capacidad HubbardFlow especializada que llegue al controlador; el comando genérico no basta (§8.4) | Bloquea HF-1 |
| U-Q4 | Documentar `workflow-event@1.0` con `sequence` monótona por run, `event_id` estable y política de rotación del JSONL | La plataforma referencia eventos nativos con cursor/replay (§6.2) | Media |
| U-Q5 | `resume` que acepte evidencia de terminación del scheduler (estado `sacct` firmado por la plataforma) en vez de solo la bandera `--previous-job-terminal` | Reconciliación §13.2; hoy la garantía depende de una afirmación | Media |
| U-Q6 | Fijar el schema de la salida `--json` de `check`/`status`/`run inspect` (o declararla no contractual) | La API muestra estado observado; sin schema no hay fixture de consumidor | Baja |
| U-Q7 | Punto de comprobación público antes de lanzar un intento y antes de publicar estado/evidencia (callback o token de generación que el runtime verifica) | ADR-007: hoy no hay fencing; los `ResourceLease` de [`execution/resource_coordinator.py`][Q-rc] son reservas de CPU/nodos, no propiedad del run, y los `Lock` son de hilo | Alta para multi-worker |
| U-Q8 | Campos tipados (o una extensión namespaced documentada) en `CapabilityDescriptor` para modos/targets, soporte de cancel/resume y referencias de pruebas | ADR-012: hoy solo hay `capability_id`, `kind`, `implementation_version`, contratos de entrada/salida, `engine` y `metadata` libre | Media |
| U-Q9 | Clase de tarea `controller`: proceso sin MPI bajo un supervisor *child subreaper* con pidfd (cierre probado por `ECHILD`), reserva exclusiva del host del runtime (`runtime_cpus`, v1 un host), entrypoint declarado por la capability vinculada, descriptor `qraft.controller-reservation@1.0`, libro `qraft.controller-inner-ledger@1.0` con clave estable `{checkpoint_identity, node_id}` y estado persistente con cerrojo de propiedad ([ADR-017](../adr/ADR-017-tarea-controladora-qraft-hf1.md) con Adenda 1, [siestaflow #10](https://github.com/Jairomcarmona/siestaflow/issues/10), [#52](https://github.com/Jairomcarmona/dftlab-suite/issues/52)) | Comprobado contra `41043ed`: el runtime solo acepta `siesta` y `gate`, y `gate` exige 1 CPU y 0 nodos; HF-1 falla en la preparación del paquete | Bloquea HF-1 |
| U-Q10 | Generador de geometrías por deformación con coordenadas fraccionarias conservadas y atom map, y fan-out de N cálculos (sin relajar, posiciones a celda fija o forma a volumen constante) con malla real (`Mesh.Sizes`) y k-grid fijas ([WF-EOS](../scientific-protocols/WF-EOS.md) E-1…E-5) | Las variantes actuales cambian un escalar; escalar `LatticeConstant` con coordenadas `Ang` no escala los átomos ([auditoría P5–P10](../reviews/2026-10-11-auditoria-p5-p10.md) H-02, H-03). Aceptado con [ADR-018](../adr/ADR-018-autoridad-protocolos-siesta-eos-electronica-superficie.md); entra después de U-Q9 | Bloquea T-035 |
| U-Q11 | Protocolo EOS: tabla E(V) con cantidad energética declarada y leída con 6 decimales, ajuste BM3 lineal en V^(−2/3), gates y resultado con autoridad nativa (WF-EOS E-4, E-6…E-9) | Dos lectores de energía con cantidades y precisiones distintas (H-04); no hay ajuste ni gate de EOS. Aceptado con ADR-018; entra después de U-Q9 | Bloquea T-035 |
| U-Q12 | `Slab.DipoleCorrection` como enum `true\|false\|charge\|vacuum\|none` en el registro 5.4.2 y en la validación electrostática; protocolo de superficie con promedio planar de `.VH`, meseta por cara y Φ ([WF-SURFACE](../scientific-protocols/WF-SURFACE.md)) | Comprobado contra `41043ed`: el registro lo tipa `boolean` y `vacuum` da `KEYWORD_VALUE_INVALID`; SIESTA 5.4.2 lo acepta (H-08). Aceptado con ADR-018; entra después de U-Q9 | Bloquea T-040 |
| U-Q13 | Fat bands en la corrida de bandas (`COOP.Write`, `.WFSX`, utilidad `fat` fijada) y analizador de masas direccionales y tensor con regla de degeneración ([WF-ELECTRONIC](../scientific-protocols/WF-ELECTRONIC.md)) | M7 exporta bandas sin gaps ni masas (H-07). Aceptado con ADR-018; entra después de U-Q9 | Bloquea T-036 fino |
| U-Q14 | Gates de molécula aislada sobre la salida: solo Gamma, `Folding of H and S` (base que alcanza imágenes), corrección de Madelung aplicada con carga neta y spin con número impar de electrones ([presets](../scientific-protocols/PRESETS.md) M-1…M-4) | Hoy el perfil `periodicity: molecule` existe, pero ningún gate lee esas líneas; el generador actual produce mallas k desplazadas para moléculas. Propuesto en la ficha de presets; entra después de U-Q9 | Bloquea S-01 de T-029 |
| U-Q15 | Fuerza neta y `NOT_RELAXED` en M5; protocolo de celda variable con `Mesh.Sizes` fijo, corte efectivo comprobado y comparación de simetría ([presets](../scientific-protocols/PRESETS.md) P-4, V-1…V-4) | Comprobado contra `41043ed`: M5 rechaza `MD.VariableCell`. Con `MeshCutoff` la malla oscila 24³↔30³ durante la relajación. Propuesto en la ficha de presets; entra después de U-Q9 | Bloquea S-03 de T-029 |
| U-Q16 | Protocolo FC molecular: geometría de referencia relajada con el mismo modelo, lectura del `.FC` y análisis armónico con proyección de Eckart ([presets](../scientific-protocols/PRESETS.md) F-1…F-6) | No hay protocolo FC; `vibra` mezcla rotaciones espurias de la malla con la flexión de H2O (1731.8 frente a 1561.4 cm⁻¹ a 200 Ry). Propuesto en la ficha de presets; entra después de U-Q9 | Bloquea S-07 de T-029 |

No hace falta en QRAFT: un `cancel` propio (lo hace SchedulerGateway con `scancel` sobre la allocation), un nuevo enum de catálogo (los estados `DESIGNED…SCIENTIFICALLY_QUALIFIED` son de la plataforma) ni un almacén de artefactos.

[Q-init]: https://github.com/Jairomcarmona/siestaflow/blob/4d996ea7c580e5638e470bbf32624c88fd762f7d/src/qraft/__init__.py#L14
[Q-api]: https://github.com/Jairomcarmona/siestaflow/blob/4d996ea7c580e5638e470bbf32624c88fd762f7d/docs/developer/PUBLIC_API.md
[Q-cc]: https://github.com/Jairomcarmona/siestaflow/blob/4d996ea7c580e5638e470bbf32624c88fd762f7d/docs/design/CORE_CONTRACTS_1_0.md
[Q-cat]: https://github.com/Jairomcarmona/siestaflow/blob/4d996ea7c580e5638e470bbf32624c88fd762f7d/src/qraft/contracts/catalog.py
[Q-cli]: https://github.com/Jairomcarmona/siestaflow/blob/4d996ea7c580e5638e470bbf32624c88fd762f7d/docs/user/cli.md
[Q-compat]: https://github.com/Jairomcarmona/siestaflow/blob/4d996ea7c580e5638e470bbf32624c88fd762f7d/docs/user/compatibility.md
[Q-naming]: https://github.com/Jairomcarmona/siestaflow/blob/4d996ea7c580e5638e470bbf32624c88fd762f7d/docs/compatibility/naming.md
[Q-ser]: https://github.com/Jairomcarmona/siestaflow/blob/4d996ea7c580e5638e470bbf32624c88fd762f7d/src/qraft/contracts/serialization.py#L90
[Q-ser59]: https://github.com/Jairomcarmona/siestaflow/blob/4d996ea7c580e5638e470bbf32624c88fd762f7d/src/qraft/contracts/serialization.py#L59
[Q-status]: https://github.com/Jairomcarmona/siestaflow/blob/4d996ea7c580e5638e470bbf32624c88fd762f7d/src/qraft/contracts/status.py
[Q-rt]: https://github.com/Jairomcarmona/siestaflow/blob/4d996ea7c580e5638e470bbf32624c88fd762f7d/src/qraft/core/runtime.py#L168
[Q-comp]: https://github.com/Jairomcarmona/siestaflow/blob/4d996ea7c580e5638e470bbf32624c88fd762f7d/src/qraft/workflow_composition.py#L100
[Q-wc]: https://github.com/Jairomcarmona/siestaflow/blob/4d996ea7c580e5638e470bbf32624c88fd762f7d/src/qraft/workflows/compiler.py#L15
[Q-rp]: https://github.com/Jairomcarmona/siestaflow/blob/4d996ea7c580e5638e470bbf32624c88fd762f7d/src/qraft/run_preparation.py#L131
[Q-cr]: https://github.com/Jairomcarmona/siestaflow/blob/4d996ea7c580e5638e470bbf32624c88fd762f7d/src/qraft/execution/capability_runtime.py#L249
[Q-cc2]: https://github.com/Jairomcarmona/siestaflow/blob/4d996ea7c580e5638e470bbf32624c88fd762f7d/src/qraft/execution/canonical_controller.py#L32
[Q-cc166]: https://github.com/Jairomcarmona/siestaflow/blob/4d996ea7c580e5638e470bbf32624c88fd762f7d/src/qraft/execution/canonical_controller.py#L166
[Q-reg]: https://github.com/Jairomcarmona/siestaflow/blob/4d996ea7c580e5638e470bbf32624c88fd762f7d/src/qraft/contracts/plugins.py#L124
[Q-sig]: https://github.com/Jairomcarmona/siestaflow/blob/4d996ea7c580e5638e470bbf32624c88fd762f7d/src/qraft/execution/slurm_environment.py#L221
[Q-rc]: https://github.com/Jairomcarmona/siestaflow/blob/4d996ea7c580e5638e470bbf32624c88fd762f7d/src/qraft/execution/resource_coordinator.py#L124
[Q-cli1918]: https://github.com/Jairomcarmona/siestaflow/blob/4d996ea7c580e5638e470bbf32624c88fd762f7d/src/qraft/cli.py#L1918
