# HubbardFlow @ `e508f47`: API pública real

Fuente: [`Jairomcarmona/SIESTAFLOW_HUBBARD_RESPONSE_BACKBONE@e508f47aff1c6243deabb12915063b6b9d899d65`][H] (punta de `codex/hubbardflow-rename`, 2026-10-09; no es `main`, que está en `bc2d1d0`). Distribución `hubbardflow` 0.1.2, import `hubbardflow`; dependencias `numpy>=1.20,<2` y `jsonschema>=4,<5`; sin `requires-python` (ruff apunta a py312). Leído el 2026-10-11 sin modificar el repositorio.

[H]: https://github.com/Jairomcarmona/SIESTAFLOW_HUBBARD_RESPONSE_BACKBONE/blob/e508f47aff1c6243deabb12915063b6b9d899d65

## 1. Qué declara público el propio motor

No hay una política de API pública escrita como la de QRAFT. Lo que existe:

- **Sin licencia.** El repositorio no tiene `LICENSE`; solo `docs/LICENSE_OPTIONS.md` y marcadores en `CITATION.cff`/`codemeta.json` ([`CONTRIBUTING.md`][H-contrib]). Ser público en GitHub no concede permiso de redistribución: la plataforma no puede empaquetarlo en una distribución hasta que Manuel elija licencia (U-H0).
- **CLI** ([`src/hubbardflow/cli.py:226`][H-cli]), declarada «public interface» en [`docs/PLAN_INTEGRACION_GLOBAL_DAG_U_POLINOMICO.md`][H-plan]: `init`, `run`, `resume`, `status`, `stop`, `report`, más `plan`, `submit`, `reference` ([`product_cli.py:106`][H-pcli]) y `audit-fdf`, `projector-check`. `status` y `stop` imprimen JSON (`sort_keys`, sin schema). `_init`, `_worker`, `_status`, etc. son privados.
- **Python con `__all__`:** solo `hubbardflow.execution` («Public execution contracts», [`execution/__init__.py`][H-exec]: `GenericDagExecutor`, `NodeExecutor`, `NodeReceipt`, `NodeState`, `may_start`, `may_analyze`, `ExecutionProfile`, `SlurmEnvironment`, lanzadores Hydra/MPI, `CommandFactory`, `LocalSubprocessExecutor`, `SlurmAllocationExecutor`, `OutputValidator`) y `hubbardflow.siesta_backend` ([`siesta_backend/__init__.py`][H-sb]: admisión de backend, `SiestaCommandFactory`, `SiestaOutputValidator`, perfil bare 5.4.2, `NativeBareTraceProvider`). `hubbardflow.domain` no exporta nada: todo el dominio científico es, formalmente, interno.
- **Schemas JSON:** 64 schemas en [`schemas/`][H-schemas] (campaign, identity, response, results, workflow, `u_certificate.v1`, `response_tokens.v1`, …), generados por `generate_schemas.py`. No hay política escrita de versión/compatibilidad para ellos.

## 2. Identidad y digests nativos

- `ResolvedPerturbationPlan.digest` = SHA-256 de `json.dumps(to_mapping(), sort_keys=True, separators=(",", ":"), allow_nan=False)` ([`domain/perturbation_plan.py:445`][H-pp445]). **Diferencia con QRAFT:** aquí `ensure_ascii` queda en `True`. Ambos digests deben conservarse con su algoritmo; la plataforma no los recalcula ni los unifica.
- `dag_digest(LRDag)` fija la identidad del checkpoint ([`execution/generic_executor.py:49`][H-dd]); un cambio de plan invalida el checkpoint.
- `ResponseRunIdentity.digest` y `qualify_response_reuse` ([`domain/response_reuse.py:162`][H-reuse]) gobiernan la reutilización; ausencia de valores físicos ⇒ `NOT_ESTABLISHED`, nunca reutilización.

Vocabularios que la plataforma debe transportar sin colapsar: `PlanStatus` (`READY`, `REVIEW`, `NOT_ESTABLISHED`, `FAIL`) y `PlanReason`; `NodeState` (`MATERIALIZED`, `RUNNING`, `VALIDATED`, `FAILED_EXECUTION`, `FAILED_OUTPUT_VALIDATION`, `FAILED_SCIENCE`, `BLOCKED`) ([`execution/dag_contract.py:7`][H-ns]); estado numérico del análisis (`NUMERICAL_CANDIDATE`, `NUMERICAL_CANDIDATE_SENSITIVE`, `NUMERICAL_CANDIDATE_UNASSESSED`, [`domain/lr_analysis_v2.py:939`][H-lr939]); `ReuseStatus`; y `CERTIFIED`/`CERTIFIED_WITH_FALLBACK` de [`domain/u_certification.py`][H-uc], que certifican el **intervalo de la inversa** (aritmética exacta), no la validez científica de U. La UI no debe presentar ese `CERTIFIED` como «U certificado».

## 3. Contrato §8.3 del adaptador frente al código

| Operación §8.3 | Lo más cercano en el commit | Estatus | Hueco |
|---|---|---|---|
| `describe_capabilities` | `BackendCapabilities` / `LRPhysicsRequest` ([`domain/capabilities.py:44`][H-cap]); admisión SIESTA 5.4.2 en `siesta_backend` | Parcial; dominio interno | U-H1: descriptor de versiones, modos (HF-1), políticas fixed-grid/adaptativa |
| `resolve_plan` | `resolve_perturbation_plan(inventory, coverage, response_protocol, *, source_fdf_sha256, alpha_strategy, planner_version, backend_identity, tau_u_ev, …)` ([`domain/perturbation_planner.py:40`][H-rpp]); CLI `plan` congela el plan | Existe; dominio interno; CLI pública | U-H2: hacerlo público con entrada serializable (hoy recibe objetos de dominio ya construidos) |
| `export_fragment` | `LRDag`/`LRDagNode` (tipo, dependencias, perturbación, nivel SCF, padre DM; [`execution/lr_dag.py:38`][H-dag]) | No existe export | U-H5 (solo HF-2): puertos, artefactos y evidencia por nodo; equivalencia de identidades |
| `prepare_node` | `SiestaCommandFactory`, `FdfBuilder` (públicos en `siesta_backend`); `CampaignRunner` prepara internamente | Parcial | U-H5 (HF-2) |
| `validate_observation` | `validate_observation(Observation, RunIdentity)` ([`domain/observation_provenance.py:83`][H-vo]); selección bare/screened en `Siesta542BarePolicyV1` ([`siesta_backend/observation_selector.py`][H-sel]); `SiestaOutputValidator` público | Existe; parte interna | U-H2 |
| `evaluate_gate` | `qualify_state_gate(reference, column_id, mode, points)` ([`domain/state_gate_eval.py:351`][H-sg]); gates de alpha/shadow/release como nodos del DAG | Existe; interno | U-H2 |
| `analyze` | `analyze_verified_lr(observations, policy, …) -> dict` ([`domain/lr_analysis_v2.py:662`][H-an]); `certify_u_matrices`; CLI `report` | Existe; interno; salida `dict` sin schema propio | U-H2, U-H3 |
| `check_resume` | `GenericDagExecutor` + checkpoint ligado a `dag_digest`; `CampaignStore.archive_orphaned_attempts`; `qualify_response_reuse`; CLI `resume` | Existe dentro del worker; no como consulta sin efectos | U-H4 |

Ejecución: `GenericDagExecutor.advance` avanza **en serie** y se detiene en el primer fallo terminal ([`generic_executor.py:124`][H-ge]). `stop` escribe `.siestaflow/stop-request.json` y el worker para de forma cooperativa; `status` lee `.siestaflow/worker-state.json` ([`execution/campaign_runner.py:2178`][H-cs]). Puede ejecutar dentro de una allocation SLURM existente (`SlurmAllocationExecutor`, `SlurmEnvironment`), lo que hace viable HF-1.

Semántica: [`domain/hubbard_parameter_semantics.py:22`][H-sem] exige evidencia de derivación para tratar el resultado como `Ueff_Dudarev`; el producto LR es `U_scalar_charge`.

## 4. Lo que falta en QRAFT para HF-1

No hay en QRAFT ninguna capacidad HubbardFlow; el controlador registra solo SIESTA y el comando genérico, y §8.4 descarta envolver la CLI con el comando genérico. HF-1 necesita U-Q3 (QRAFT) y U-H1/U-H3/U-H4 (HubbardFlow).

## 5. Cambios upstream necesarios (Ola 1, Codex)

| ID | Cambio en HubbardFlow | Por qué | Prioridad |
|---|---|---|---|
| U-H0 | Añadir `LICENSE` (decisión de Manuel) y fijar la rama de integración (`codex/hubbardflow-rename` frente a `main`) | Sin licencia no se puede distribuir; el commit fijado no está en `main` | Bloquea T-010 |
| U-H1 | Política de API pública (`docs/PUBLIC_API.md`) y `__all__` o módulo `hubbardflow.api` con `describe_capabilities` versionado | El adaptador no puede depender de `hubbardflow.domain` interno | Bloquea T-022/HF-1 |
| U-H2 | Fachada pública para `resolve_plan`, `validate_observation`, `evaluate_gate` y `analyze` con entradas serializables y salida con schema | Hoy son funciones de dominio internas que reciben objetos construidos por el worker | Bloquea HF-1 |
| U-H3 | Schema versionado del resultado de análisis y del `status` del worker (incluye `NOT_ESTABLISHED` y valores `NUMERICAL_CANDIDATE_*`) y política de compatibilidad de `schemas/` | Fixture `NOT_ESTABLISHED` y enum futuro de T-009/T-056 | Alta |
| U-H4 | `check_resume` sin efectos: compara plan/políticas/archivos/identidades y devuelve qué se reutiliza, sin arrancar el worker | §8.3 y `ResumePlan` §5.5 | Media |
| U-H5 | Export de fragmento por nodo (puertos, artefactos, evidencia, callbacks) | Solo HF-2; no bloquea HF-1 | Posterior |
| U-H6 | Declarar `requires-python` y la compatibilidad NumPy | El lock por target (T-010) necesita rangos explícitos | Baja |

[H-contrib]: https://github.com/Jairomcarmona/SIESTAFLOW_HUBBARD_RESPONSE_BACKBONE/blob/e508f47aff1c6243deabb12915063b6b9d899d65/CONTRIBUTING.md
[H-cli]: https://github.com/Jairomcarmona/SIESTAFLOW_HUBBARD_RESPONSE_BACKBONE/blob/e508f47aff1c6243deabb12915063b6b9d899d65/src/hubbardflow/cli.py#L226
[H-plan]: https://github.com/Jairomcarmona/SIESTAFLOW_HUBBARD_RESPONSE_BACKBONE/blob/e508f47aff1c6243deabb12915063b6b9d899d65/docs/PLAN_INTEGRACION_GLOBAL_DAG_U_POLINOMICO.md
[H-pcli]: https://github.com/Jairomcarmona/SIESTAFLOW_HUBBARD_RESPONSE_BACKBONE/blob/e508f47aff1c6243deabb12915063b6b9d899d65/src/hubbardflow/product_cli.py#L106
[H-exec]: https://github.com/Jairomcarmona/SIESTAFLOW_HUBBARD_RESPONSE_BACKBONE/blob/e508f47aff1c6243deabb12915063b6b9d899d65/src/hubbardflow/execution/__init__.py
[H-sb]: https://github.com/Jairomcarmona/SIESTAFLOW_HUBBARD_RESPONSE_BACKBONE/blob/e508f47aff1c6243deabb12915063b6b9d899d65/src/hubbardflow/siesta_backend/__init__.py
[H-schemas]: https://github.com/Jairomcarmona/SIESTAFLOW_HUBBARD_RESPONSE_BACKBONE/tree/e508f47aff1c6243deabb12915063b6b9d899d65/schemas
[H-pp445]: https://github.com/Jairomcarmona/SIESTAFLOW_HUBBARD_RESPONSE_BACKBONE/blob/e508f47aff1c6243deabb12915063b6b9d899d65/src/hubbardflow/domain/perturbation_plan.py#L445
[H-dd]: https://github.com/Jairomcarmona/SIESTAFLOW_HUBBARD_RESPONSE_BACKBONE/blob/e508f47aff1c6243deabb12915063b6b9d899d65/src/hubbardflow/execution/generic_executor.py#L49
[H-reuse]: https://github.com/Jairomcarmona/SIESTAFLOW_HUBBARD_RESPONSE_BACKBONE/blob/e508f47aff1c6243deabb12915063b6b9d899d65/src/hubbardflow/domain/response_reuse.py#L162
[H-ns]: https://github.com/Jairomcarmona/SIESTAFLOW_HUBBARD_RESPONSE_BACKBONE/blob/e508f47aff1c6243deabb12915063b6b9d899d65/src/hubbardflow/execution/dag_contract.py#L7
[H-lr939]: https://github.com/Jairomcarmona/SIESTAFLOW_HUBBARD_RESPONSE_BACKBONE/blob/e508f47aff1c6243deabb12915063b6b9d899d65/src/hubbardflow/domain/lr_analysis_v2.py#L939
[H-uc]: https://github.com/Jairomcarmona/SIESTAFLOW_HUBBARD_RESPONSE_BACKBONE/blob/e508f47aff1c6243deabb12915063b6b9d899d65/src/hubbardflow/domain/u_certification.py
[H-cap]: https://github.com/Jairomcarmona/SIESTAFLOW_HUBBARD_RESPONSE_BACKBONE/blob/e508f47aff1c6243deabb12915063b6b9d899d65/src/hubbardflow/domain/capabilities.py#L44
[H-rpp]: https://github.com/Jairomcarmona/SIESTAFLOW_HUBBARD_RESPONSE_BACKBONE/blob/e508f47aff1c6243deabb12915063b6b9d899d65/src/hubbardflow/domain/perturbation_planner.py#L40
[H-dag]: https://github.com/Jairomcarmona/SIESTAFLOW_HUBBARD_RESPONSE_BACKBONE/blob/e508f47aff1c6243deabb12915063b6b9d899d65/src/hubbardflow/execution/lr_dag.py#L38
[H-vo]: https://github.com/Jairomcarmona/SIESTAFLOW_HUBBARD_RESPONSE_BACKBONE/blob/e508f47aff1c6243deabb12915063b6b9d899d65/src/hubbardflow/domain/observation_provenance.py#L83
[H-sel]: https://github.com/Jairomcarmona/SIESTAFLOW_HUBBARD_RESPONSE_BACKBONE/blob/e508f47aff1c6243deabb12915063b6b9d899d65/src/hubbardflow/siesta_backend/observation_selector.py
[H-sg]: https://github.com/Jairomcarmona/SIESTAFLOW_HUBBARD_RESPONSE_BACKBONE/blob/e508f47aff1c6243deabb12915063b6b9d899d65/src/hubbardflow/domain/state_gate_eval.py#L351
[H-an]: https://github.com/Jairomcarmona/SIESTAFLOW_HUBBARD_RESPONSE_BACKBONE/blob/e508f47aff1c6243deabb12915063b6b9d899d65/src/hubbardflow/domain/lr_analysis_v2.py#L662
[H-ge]: https://github.com/Jairomcarmona/SIESTAFLOW_HUBBARD_RESPONSE_BACKBONE/blob/e508f47aff1c6243deabb12915063b6b9d899d65/src/hubbardflow/execution/generic_executor.py#L124
[H-cs]: https://github.com/Jairomcarmona/SIESTAFLOW_HUBBARD_RESPONSE_BACKBONE/blob/e508f47aff1c6243deabb12915063b6b9d899d65/src/hubbardflow/execution/campaign_runner.py#L2178
[H-sem]: https://github.com/Jairomcarmona/SIESTAFLOW_HUBBARD_RESPONSE_BACKBONE/blob/e508f47aff1c6243deabb12915063b6b9d899d65/src/hubbardflow/domain/hubbard_parameter_semantics.py#L22
