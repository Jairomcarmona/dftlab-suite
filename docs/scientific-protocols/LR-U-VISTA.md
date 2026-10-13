# Ficha de entrada: modelo de vista de LR-U (T-039, depende de T-038 y de ADR-017 Adenda 12)

Estado: **lista para aceptar** (2026-10-13). Dueño: la plataforma. HubbardFlow y QRAFT siguen siendo dueños de la semántica científica ([ADR-003](../adr/ADR-003-autoridades-qraft-hubbardflow-plataforma.md)); esta ficha fija **qué muestra y qué permite** la interfaz sobre una corrida LR-U sin reinterpretarla. Vectores: [`lru-view.cases.json`](vectors/lru-view.cases.json) (22 casos), oráculo [`lru-view-oracle.mjs`](vectors/lru-view-oracle.mjs), constructor independiente [`build_lru_view_cases.py`](vectors/build/build_lru_view_cases.py).

## Qué es y dónde vive

Una función pura, sin DOM y sin red, de las lecturas que la plataforma ya tiene (`run-projection`, `assessment-record`, `resume-plan`, intentos y la admisión de generaciones de ADR-017 Adenda 12) a un modelo de vista: titular, tono, estado científico, acciones permitidas con su motivo, plan de reanudación, datos conservados, mapa de intentos y avisos. La interfaz solo pinta ese modelo.

- Módulo: `app/dftlab/static/js/application/lru-view.js` (ES, sin dependencias, como `draft-panel.js`), con las mismas reglas del oráculo. Panel: `application/lru-panel.js`, que llama al módulo y pinta con `core/ui.js` y `core/escape.js`. React/TypeScript (ADR-013) está propuesto y no se adopta aquí; el módulo no depende de ningún framework.
- Los textos de la interfaz salen de los códigos de abajo (`headline`, `banners`, `resume_reason`); el modelo nunca lleva frases.

## Reglas

| # | Regla |
|---|---|
| V-1 | El estado científico sale solo de `dimensions.science` y de las evaluaciones con autoridad del protocolo. Que el proceso termine con código 0 o que la ejecución sea `COMPLETED` no lo establece. Si la proyección dice `PASS` y alguna evaluación no, se muestra `NOT_ESTABLISHED` con el aviso `SCIENCE_PROJECTION_INCONSISTENT`. |
| V-2 | Un valor nativo desconocido se muestra tal cual y nunca como `PASS` ([`native-status-projection.json`](../../contracts/vocabularies/native-status-projection.json)). El modelo transporta `native_status` sin traducir. |
| V-3 | «Usar el resultado» solo si la ejecución terminó, la ciencia es `PASS`, la integridad está `VERIFIED` y no hay avisos `DM_REFERENCE_MISSING` ni `SCIENCE_PROJECTION_INCONSISTENT`. Una integridad `ALTERED`, `MISSING` o `INCOMPLETE` da `INTEGRITY_PROBLEM` aunque la ciencia diga `PASS`. |
| V-4 | Cancelar solo mientras la ejecución está en cola enviada, corriendo o recolectando y sin cancelación pedida. Con la cancelación pedida el titular es `CANCELLING` hasta que la ejecución llegue a `CANCELLED`, `INTERRUPTED`, `FAILED` o `COMPLETED`; un scheduler en `CANCELLED` con el controlador aún corriendo es `CANCELLING` con el aviso `EVIDENCE_PENDING`. Nunca se dice «cancelado» antes de la evidencia del motor. |
| V-5 | Reanudar exige, en este orden, ejecución `INTERRUPTED` o `CANCELLED` (con `FAILED` se muestra `EXECUTION_FAILED`), `platform_resume_enabled`, plan de reanudación, plan no caducado, política igual a la del run, cadena de intentos contigua y admisión `ADMIT`. La primera condición que falla da el motivo; con la admisión rechazada el motivo es el de ADR-017 L.5. |
| V-6 | `platform_resume_enabled` es `false` hasta que Manuel lo active tras repetir la calificación Q por la plataforma (ADR-017 L.10, issue #93). Mientras sea `false`, HF-1 no se ofrece como reanudable (`PLATFORM_RESUME_NOT_QUALIFIED`). |
| V-7 | Un envío sin resultado conocido (`SUBMISSION_UNKNOWN` o ejecución `UNKNOWN`) da `OUTCOME_UNKNOWN` con el aviso `RECONCILE_REQUIRED` y ninguna acción. |
| V-8 | El mapa de intentos lista todos, ordenados por generación, con el estado y el intento anterior de cada uno; el último es el actual. Una cadena no contigua da `ATTEMPT_CHAIN_BROKEN`, conserva todos los intentos y bloquea reanudar. |
| V-9 | Cada respuesta (`bare` o `screened`) se muestra por separado con su estado nativo, su estado de pasaporte, su referencia de DM y su precisión; nunca se fusionan. Una respuesta `screened` sin referencia de DM da `DM_REFERENCE_MISSING`. |
| V-10 | Se conservan y muestran el digest del plan y todos los digests de política tal como los trae el run. Si los del plan de reanudación difieren, aviso `POLICY_CHANGED` y no se reanuda. |

## Entradas

`projection` (scheduler, execution, integrity, science: solo el valor), `cancel_requested`, `platform_resume_enabled`, `admission` (`decision`, `reason`) o `null`, `resume_plan` (`plan_revision`, `from_attempt_id`, `expired`, `policy_digests`, `nodes` con `reuse`, `invalid`, `pending`, `seed_candidates`) o `null`, `run` (`plan_digest`, `policy_digests`), `responses` (`kind`, `native_status`, `passport_state`, `dm_reference`, `precision`) y `attempts` (`attempt_id`, `generation`, `state`, `previous_attempt_id`). Todo sale de campos que los contratos ya tienen.

## Vectores (22)

Cola y cancelación (`lru-queued`, `-prepared`, `-running`, `-cancelling`, `-cancel-evidence-pending`); reanudación (`-cancelled-resumable`, `-interrupted-resumable`, `-resume-not-qualified`, `-resume-no-plan`, `-resume-expired`, `-resume-policy-changed`, `-resume-refused`, `-failed`); ciencia (`-completed-exit0-not-established`, `-completed-pass`, `-completed-pass-altered`, `-completed-pass-inconsistent`, `-completed-pass-no-dm`, `-completed-fail`); y `-unknown`, `-attempt-chain-broken`, `-three-attempts`. Los exigidos por el plan: cancelación durante actividad interna (V-4), interrupción y reanudación (V-5, V-8) y el caso técnicamente exitoso con ciencia no establecida (V-1, `lru-completed-exit0-not-established`).

## Caso real

La corrida real del NiO de ADR-017 Adenda 4 (C0 y Q1 a Q6), cuando Manuel la ejecute, alimenta tres vectores `lru-real-*` con las lecturas reales de la plataforma; hasta entonces T-039 no pasa de `CONTRACT_TESTED`. El módulo se prueba hoy con los 22 vectores sintéticos; no se afirma que la interfaz esté calificada con una corrida real.

## Lo que no hace

No cambia contratos ni schemas, no decide la ciencia, no reinterpreta estados nativos, no traduce `NOT_ESTABLISHED` a «fallo» ni a «éxito» y no lanza nada por sí mismo: cada botón emite una acción explícita con su identificador idempotente (ADR-013).
