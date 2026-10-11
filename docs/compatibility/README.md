# Compatibilidad con los motores (T-009)

Fecha: 2026-10-11. Dueño: Claude (bloque C2 de [`REPARTO_V21.md`](../development/REPARTO_V21.md)). Solo documentación: no hay código de integración ni cambios en los motores.

Este directorio responde, para cada commit fijado, qué API pública ofrece hoy, qué falta y qué cambio corresponde a cada repositorio. Las firmas de la [propuesta maestra](../../PROPUESTA_MAESTRA_DFTLAB_V2.md) §6.3 y §8.3 son **contratos a implementar**; aquí se indica cuáles ya existen y con qué estatus.

| Motor | Commit fijado | Inventario |
|---|---|---|
| QRAFT HPC (`qraft-hpc` 0.2.0) | `Jairomcarmona/siestaflow@4d996ea` (`main`) | [QRAFT_4d996ea.md](QRAFT_4d996ea.md) |
| HubbardFlow (`hubbardflow` 0.1.2) | `Jairomcarmona/SIESTAFLOW_HUBBARD_RESPONSE_BACKBONE@e508f47` (`codex/hubbardflow-rename`) | [HUBBARDFLOW_e508f47.md](HUBBARDFLOW_e508f47.md) |

## Conclusiones

1. **QRAFT tiene una frontera pública clara, pero la ruta canónica no está en ella.** Son públicos `qraft.__all__`, los 13 contratos de Core Contracts 1.0 y la CLI estable (`init/check/run/status/resume/results/examples`). `WorkflowComposer`, `WorkflowCompiler`, `RunPreparer`, `CompiledWorkflowRuntime` y `CanonicalController` son internos, y sus comandos CLI son experimentales y están marcados como deprecados. Hoy el adaptador T-022 solo podría usar la CLI experimental o nombres internos; ninguna de las dos opciones cumple §19.2.
2. **HubbardFlow tiene la ciencia de §8.3 casi completa, pero sin frontera pública ni licencia.** Existen plan con digest, validación de observaciones, gates, análisis y reutilización, pero en `hubbardflow.domain` sin `__all__`. Solo `execution` y `siesta_backend` declaran exportaciones. El repositorio no tiene `LICENSE`.
3. **HF-1 no es posible sin cambios en los dos lados.** QRAFT registra en el controlador solo SIESTA y el comando genérico, y §8.4 descarta el comando genérico para la ciencia Hubbard. Hacen falta U-Q3 en QRAFT y U-H1…U-H4 en HubbardFlow.
4. **Cancelar y reconciliar es trabajo de la plataforma.** Ningún motor hace `sbatch`/`scancel`. QRAFT para con `SIGUSR1`/`SIGTERM` y reanuda si el llamador afirma que el job anterior terminó. HubbardFlow para con un archivo de solicitud. SchedulerGateway es dueño del submit, observe, cancel y reconcile, como dice §6.3.
5. **Hay dos algoritmos de digest distintos y ambos se conservan.** QRAFT usa `ensure_ascii=False` y HubbardFlow el valor por defecto `True`, los dos con `sort_keys` y separadores compactos. La plataforma guarda el digest nativo tal cual y no lo recalcula con JCS ni con el otro motor.

## Quién conserva el lock nativo y quién su proyección

| Documento | Lo escribe y conserva | La plataforma guarda |
|---|---|---|
| `workflow.lock.json` (`siestaflow.workflow-lock@1.0`) | QRAFT, escritura atómica | `ArtifactRecord` con los bytes originales y `NativeContractRef` (motor, distribución, commit, contrato, `content_sha256`) |
| `run.lock.json` y paquete del controlador | QRAFT `RunPreparer` | `ArtifactRecord` del zip y del lock, más una proyección indexable; nunca una copia editable |
| Journal y eventos del runtime (`state/workflow_runtime.journal.jsonl`, `evidence/workflow_events.jsonl`) | QRAFT en el host de ejecución | `RunProjection` y `EventRecord` que referencian el evento nativo; no lo sustituyen |
| Plan resuelto, checkpoint (`dag_digest`) y análisis de HubbardFlow | HubbardFlow en el directorio de campaña | `NativeContractRef` con su digest y `AssessmentRecord` con el estado nativo intacto |

La regla es la misma en todos los casos: el original es del motor, y la plataforma guarda referencia, digest verificado y proyección. Una migración crea un archivo nuevo enlazado al original.

## Cambios upstream para la Ola 1 (Codex)

Por orden de bloqueo: **U-H0** (licencia y rama de HubbardFlow, decisión de Manuel), **U-Q1** (ruta canónica pública en QRAFT), **U-H1/U-H2** (fachada pública de HubbardFlow), **U-Q3** (extensión pública del preparador y del controlador), **U-H3** (schemas de análisis y estado con `NOT_ESTABLISHED`), y después U-Q7 (fencing, antes de varios workers), U-Q2, U-Q4, U-Q5, U-Q8, U-H4, U-Q6 y U-H6. U-H5 (export de fragmentos) es solo para HF-2. Tras la calificación HF-1 contra QRAFT `41043ed` se añadieron **U-Q9** (tarea `controller`) y **U-H7** (modo controlador de HubbardFlow), que bloquean HF-1 juntos ([ADR-017](../adr/ADR-017-tarea-controladora-qraft-hf1.md)). El detalle está en la sección 5 de cada inventario. Cada cambio lleva un fixture de consumidor y se fija por commit nuevo en `engine-versions.lock.json` (T-010).

## Respuesta a los puntos «pendiente C2» de los ADR

Los ADR los mantiene su propio bloque; aquí solo queda la respuesta para que C3 o C1 cierren esos puntos.

| ADR | Pregunta | Respuesta del inventario |
|---|---|---|
| 003 | ¿Son públicos `RunPreparer` y `CompiledWorkflowRuntime`? ¿Quién conserva cada lock? ¿Qué sirve hoy para `resolve_plan`? | No: son internos (U-Q1). Locks: tabla de arriba. `resolve_perturbation_plan` existe en `hubbardflow.domain` (interno, U-H2); la CLI `hubbardflow plan` es la vía pública hoy |
| 004 | ¿Qué parte de §7 y §8.3 es API pública? | QRAFT: contratos y CLI estable, no la ruta §7. HubbardFlow: ninguna de las ocho operaciones como Python público; ver la tabla §3 de su inventario |
| 006 | ¿Qué API permite HF-1 (entrada, salida, cancelación, resume)? ¿Qué falta para HF-2? | Solo la CLI: `init`/`run`/`resume`/`status`/`stop`/`report`, con `stop` cooperativo por archivo y estado en `.siestaflow/worker-state.json`. Faltan U-Q3 y U-H1…U-H4. HF-2 necesita U-H5 |
| 007 | ¿Dónde comprobar el token de fencing en QRAFT? | No existe. Sigue la política conservadora del ADR hasta U-Q7 |
| 012 | ¿Cómo se corresponde `CapabilityDescriptor` con el registro de QRAFT? | Coinciden ID namespaced, versión, contratos y `engine`. Modos/targets, cancel/resume y pruebas no tienen campo (U-Q8). El estado de catálogo (`DESIGNED`…) es de la plataforma |

## Límites

Lectura estática del código y la documentación de cada commit. La CLI de QRAFT se ejecutó solo con `--help` y sin instalar el paquete; no se ejecutaron las suites de los motores ni cálculos. Las afirmaciones sobre comportamiento en tiempo de ejecución (cancelación, reanudación, SLURM) vienen del código, no de una prueba.
