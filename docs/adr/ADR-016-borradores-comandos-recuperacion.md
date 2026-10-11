# ADR-016: borradores, comandos tipados, revisión del agregado, recuperación de efectos y CSRF tras recarga

Estado: **aceptado** el 2026-10-11 (aclaraciones C3 pedidas por la Ola 2). Enmienda [ADR-007](ADR-007-controlador-unico-reconciliacion-idempotencia.md) (recuperación) y [ADR-008](ADR-008-servicio-local-ssh-autorizacion.md) (sesión); aplica [ADR-002](ADR-002-aprender-produccion-procedencia.md) §2 a la API.
Fecha: 2026-10-11. Fuente: pendientes de Codex en [TRASPASO.md](../reviews/TRASPASO.md) (X6a, X7a, X8) y [REGISTRO_DEUDA.md](../reviews/REGISTRO_DEUDA.md) fila X8.

## Contexto

La Ola 2 implementó validadores, operaciones durables, ArtifactStore, la API `/api/v1` y el doble build sin cambiar contratos. Dejó cinco dudas de contrato que bloquean trabajo:

1. **T-014:** no hay schema ni endpoint para crear o persistir un borrador; `learn/promote.js` produce los registros pero no puede guardarlos.
2. Los payloads de `CREATE_CAMPAIGN`, `CREATE_PLAN`, `PREPARE_PACKAGE`, `CREATE_RESUME_PLAN`, `RECONCILE_RUN` y `VALIDATE_INPUT` son `object` abierto: no hay semántica que implementar.
3. `RunProjection.source_revision` no dice qué relación tiene con `target.expected_revision` de las mutaciones sobre un run.
4. Tras una caída, una operación queda en `OUTCOME_UNKNOWN` sin datos para construir un `SubmissionReceipt` (paquete, perfil, intento), y la tabla solo acepta ese recibo para salir.
5. Tras recargar la página la cookie permite leer, pero el token CSRF vivía solo en memoria y no hay forma contractual de recuperarlo.

## Decisión

### 1. Borradores (T-014)

- `Draft` es un agregado propio (`schemas/draft.schema.json`, envelope `dftlab.draft`) con `revision` desde 1. Lleva `origin` (`LEARNING_PROMOTION`, `USER_IMPORT`, `USER_AUTHORED`), `purpose` (`EXPLORATORY` u `OPERATIONAL`, nunca `EDUCATIONAL`), `provenance_state` (`PARTIAL` o `UNKNOWN`, nunca `VERIFIED`), `scientific_assessment: NOT_EVALUATED`, la estructura `{structure_id, revision}` y `intent_id` o `null`. Así T-014 muestra origen, finalidad y calidad sin inferirlas.
- API, síncrona y sin procesador, como `createProject`:
  - `POST /projects/{project_id}/drafts` (`createDraft`, cuerpo `draft-create-request`) → 201 `DraftBundle`; repetición 200; otra carga con la misma clave 409.
  - `GET /projects/{project_id}/drafts` (`listDrafts`) → última revisión de cada borrador.
  - `GET /drafts/{draft_id}` (`getDraft`) → `DraftBundle`.
  - `POST /drafts/{draft_id}/revisions` (`reviseDraft`, cuerpo `draft-revision-request` con `expected_revision`) → 201 con la revisión nueva; 412 si la revisión cambió.
- **El servidor asigna todas las identidades.** El cliente manda contenido: la estructura sin `structure_id`/`revision`/`parent_revision` y, opcionalmente, una plantilla de intent con los payloads de `PhysicalModel` y `NumericalPolicy`. El servidor crea `StructureRevision`, `PhysicalModel`, `NumericalPolicy` y `RunIntent` nuevos, deriva `provenance_state` (`PARTIAL` si el origen es Aprender o un artefacto verificado; si no, `UNKNOWN`) y sella los envelopes. Los IDs que hoy genera `promote.js` son locales y no viajan.
- **Promoción explícita:** `LEARNING_PROMOTION` nace `EXPLORATORY`; pasar a `OPERATIONAL` es una revisión explícita. `exported_kind: STRUCTURE` no lleva plantilla; `TEMPLATE` la exige. La promoción copia y nunca enlaza ni modifica el `LearningDataset`.
- **Revisar crea identidades nuevas:** una estructura cambiada es una `StructureRevision` con `parent_revision`; si hay plantilla y cambia cualquier cosa de la que depende, el `RunIntent` es nuevo. Los registros anteriores no se tocan.
- Crear o revisar un borrador **no envía nada**, no crea campañas ni runs y no cambia `Project.revision`.
- La creación de `PhysicalModel`/`NumericalPolicy` sueltos no tiene endpoint propio: nacen dentro de un borrador.

### 2. Payloads y target por acción

`OperationRequest` fija ahora `target.kind` por acción y el payload de cada una (`$defs` del schema):

| Acción | Target | Payload |
|---|---|---|
| `VALIDATE_INPUT` | PROJECT | `{draft: {draft_id, revision}}` → `ValidationReceipt` |
| `CREATE_CAMPAIGN` | PROJECT | `{name, drafts: [{draft_id, revision}]}` (1–256) |
| `CREATE_PLAN` | CAMPAIGN | `{draft, intent_id, validation_receipt_id}`: QRAFT resuelve y bloquea el plan, con la capa Hubbard cuando el modelo la pide (ADR-015) |
| `PREPARE_PACKAGE` | PLAN | `{expected_plan_digest}` (digest nativo del lock) y `profile_ref` obligatorio; digest distinto → 412 |
| `SUBMIT_RUN` | PLAN | sin cambios |
| `CANCEL_RUN` | RUN | sin cambios |
| `CREATE_RESUME_PLAN` | RUN | `{from_attempt_id, reason}` |
| `EXECUTE_RESUME_PLAN` | RESUME_PLAN | sin cambios |
| `RECONCILE_RUN` | RUN | `{operation_id}`: `null` = intento actual, o la operación `OUTCOME_UNKNOWN` que se quiere resolver |

Validar el schema **no admite un efecto**: los handlers siguen respondiendo `ENGINE_UNAVAILABLE` hasta que los adaptadores de la Ola 3 se califiquen. El payload de `VALIDATE_INPUT` es normativo para clientes ya, pero el schema todavía no lo exige: las pruebas genéricas de almacenamiento de X6 usan esa acción con payload vacío. Ver Migración.

### 3. Revisión del agregado

- `target.expected_revision` es la revisión del agregado destino (Project, Campaign, Plan, Run, ResumePlan). Aceptar una operación sobre ese agregado la incrementa en la misma transacción, como ya hace X6 con el proyecto.
- `RunProjection.source_revision` **es** la revisión autoritativa del agregado Run, la misma que compara `expected_revision`. `getRun` devuelve la vigente: si la proyección va atrasada, el servicio la actualiza o responde con la del agregado.
- Las observaciones (scheduler, ficheros, eventos del motor) no cambian la revisión: avanzan `snapshot_cursor` y `observed_at`. Los cambios internos del controlador (nuevo intento, generación de autoridad) tampoco; se protegen con `authority_generation`.
- Crear o revisar un borrador cambia solo la revisión del borrador.

### 4. Recuperación de `OUTCOME_UNKNOWN`

Cada acción tiene una clase de efecto (`effect_classes` en `transitions/operation-transitions.json`; `check-contracts.mjs` comprueba que cubren todas las acciones):

- **LOCAL_ATOMIC** (`VALIDATE_INPUT`, `CREATE_CAMPAIGN`, `CREATE_PLAN`, `PREPARE_PACKAGE`, `CREATE_RESUME_PLAN`): el producto y la transición a `SUCCEEDED` se confirman en una transacción. Tras una caída, la recuperación exclusiva busca el producto por `operation_id` y resuelve con `OperationResolutionReceipt` `LOCAL_EFFECT_ABSENT` (FAILED) o `LOCAL_EFFECT_COMMITTED` (SUCCEEDED).
- **EXTERNAL_IDEMPOTENT** (`CANCEL_RUN`, `RECONCILE_RUN`): repetir es seguro. Se resuelve con `IDEMPOTENT_EFFECT_UNCONFIRMED` (FAILED) y el cliente repite con clave nueva; el estado del run lo dice la proyección.
- **EXTERNAL_SUBMISSION** (`SUBMIT_RUN`, `EXECUTE_RESUME_PLAN`): antes de llamar al scheduler el procesador confirma un **`EffectIntent`** (`schemas/effect-intent.schema.json`) con intento, token, paquete, perfil, scheduler y generación de autoridad. Sin `EffectIntent` el efecto no pudo empezar: `NO_EFFECT_INTENT` (FAILED). Con `EffectIntent` se construye el `SubmissionReceipt SUBMISSION_UNKNOWN` desde sus campos y solo `RECONCILED_FOUND` o `RECONCILED_ABSENT_WITH_EVIDENCE` lo resuelven. Nunca se reenvía a ciegas.

`RUNNING → OUTCOME_UNKNOWN` en la recuperación sigue siendo correcto y conservador; lo nuevo es la evidencia para salir. Las salidas a FAILED por esta vía llevan el error `OPERATION_INTERRUPTED` (409): repetir con clave nueva es seguro. La clave antigua se conserva con su resultado.

### 5. CSRF tras recargar

`GET /api/v1/session` (`getSession`) devuelve `{principal_id, csrf_token, expires_at}` usando solo la cookie. Devuelve el mismo token ligado a la sesión, sin rotarlo, para que varias pestañas sigan funcionando. Exige Host exacto; si llega `Origin` debe ser exacto y si llega `Sec-Fetch-Site` debe ser `same-origin`. Responde con `Cache-Control: no-store` y el token nunca se registra. El cliente sigue sin guardar el token en `localStorage`; tras recargar lo pide aquí. No hay endpoint de renovación del bootstrap: una sesión caducada exige un bootstrap nativo nuevo.

## Alternativas

| Opción | Motivo para no adoptarla |
|---|---|
| Borrador como `OperationRequest` (`CREATE_DRAFT`) por el procesador | No tiene efecto externo; el outbox añade estados y latencia sin protección extra. Proyectos y subidas ya son síncronos. |
| Aceptar IDs del cliente (`promote.js`) | Contradice que el servidor deriva identidad y autoridad; colisiones e identidades falsificadas. |
| Endpoints separados para `PhysicalModel`/`NumericalPolicy` | Más superficie sin caso de uso hoy; el borrador los crea juntos y de forma atómica. |
| Ampliar `SubmissionReceipt` con campos opcionales | Debilita el recibo para todos los casos; el `EffectIntent` hace que los datos existan siempre que el efecto pudo empezar. |
| Reencolar automáticamente (`RUNNING → PENDING`) | Requiere reclamar el outbox y nuevas guardas; resolver a FAILED y repetir con clave nueva da el mismo resultado sin ambigüedad. |
| Persistir el CSRF en `sessionStorage` | Lo expone a cualquier script de la página; la cookie HttpOnly ya identifica la sesión. |

## Consecuencias

- T-014 puede terminar: `promote.js` envía contenido a `createDraft` y muestra el `DraftBundle`.
- Los comandos científicos tienen semántica tipada, pero siguen cerrados hasta calificar los adaptadores (Ola 3).
- El procesador debe escribir un `EffectIntent` antes de cada envío y la recuperación debe emitir `OperationResolutionReceipt`.
- La guarda de X6 que exige `result.receipt` para salir de `OUTCOME_UNKNOWN` debe aceptar también `OperationResolutionReceipt` según la clase.

## Contratos afectados

Nuevos: `draft`, `draft-create-request`, `draft-revision-request`, `effect-intent`, `operation-resolution-receipt`. Cambiados: `operation-request` (target y payload por acción), `transitions/operation-transitions.json` (`effect_classes`, evidencia), `errors/error-codes.json` (`OPERATION_INTERRUPTED`), OpenAPI (`getSession`, `createDraft`, `listDrafts`, `getDraft`, `reviseDraft`, `DraftBundle`; descripciones de `getRun` y mutaciones de run). Todos siguen en `0.1.x`.

## Pruebas exigidas

- Fixtures válidos e inválidos de cada schema nuevo y de los payloads tipados (`fixtures/manifest.json`), incluidos: borrador nunca `VERIFIED` ni `PASS`, promoción desde Aprender nunca operativa al nacer, el cliente no fija `structure_id`, plan sin `ValidationReceipt` rechazado, `EffectIntent` solo para envíos, un envío con hallazgo local rechazado.
- Servicio: crear/repetir/409/revisar/412 de borradores con dos owners; `Project.revision` sin cambios al crear un borrador.
- Recuperación: caída antes y después del `EffectIntent`; un envío con `EffectIntent` no sale por `OperationResolutionReceipt`.
- Sesión: recarga → `getSession` → mutación con CSRF; `Sec-Fetch-Site: cross-site` y `Origin` ajeno rechazados; sin token en logs.

## Migración

1. Este cambio es aditivo para el código actual: los endpoints nuevos responden por la ruta genérica hasta implementarse, y ninguna prueba existente usa las acciones cuyo payload se exige ahora.
2. Codex cambia las pruebas genéricas de X6 que usan `VALIDATE_INPUT` con `payload: {}` o `{"other": true}` a payloads válidos según `$defs/validate_input_payload` (válidos también hoy).
3. Después, un PR de contratos añade la condición que exige ese payload, sin otro cambio.
