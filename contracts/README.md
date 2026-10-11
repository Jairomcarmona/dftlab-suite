# Contratos de plataforma (C3: T-008, T-011, T-056)

Definición ejecutable de los datos y la API de la plataforma DFT Lab. Los [ADR](../docs/adr/README.md) explican las decisiones y el [inventario de motores](../docs/compatibility/README.md) fija qué existe en QRAFT y HubbardFlow; aquí está lo que se valida. **Es diseño: no hay servicio que lo implemente todavía** (Olas 2 y 3, Codex).

Dueño: Claude ([reparto V2.1](../docs/development/REPARTO_V21.md)). Codex propone cambios por issue o PR pequeño.

## Contenido

| Carpeta | Qué hay |
|---|---|
| `schemas/` | JSON Schema 2020-12. `defs` (tipos comunes), `envelope`, referencias (`artifact-ref`, `native-contract-ref`), entidades T-008, recibos T-056, `event-record`, `problem` y `hubbard-layer-message` |
| `fixtures/` | Un caso válido y al menos uno inválido por schema; `manifest.json` dice schema, resultado esperado, regla y, cuando importa, cómo debe tratarlo el consumidor (`consumer`) |
| `fixtures/canonicalization/` | Entradas y salida JCS esperada, comunes a JS y Python |
| `fixtures/native-digests/` | El mismo documento con los dos algoritmos nativos (QRAFT y HubbardFlow) |
| `openapi/dftlab-api.v1.json` | OpenAPI 3.1 de la API `/api/v1` (T-011) |
| `transitions/operation-transitions.json` | Estados, transiciones, prohibiciones y carreras de `OperationRecord` (§25.2) |
| `vocabularies/` | Proyección de estados nativos al pasaporte y algoritmos de digest nativos |
| `errors/error-codes.json` | Códigos estables de Problem Details |
| `scripts/` | `check-contracts.mjs` (estructural, sin dependencias, en `scripts/verify.mjs`) y `validate_fixtures.py` (validación completa con `jsonschema`) |

Entidades de T-008: StructureRevision, SpeciesDefinition, PhysicalModel, NumericalPolicy, RunIntent, ArtifactRecord, ArtifactRef, NativeContractRef, ResultDataset, AssessmentRecord, LearningDataset, OperationRequest, OperationRecord, RunProjection, ResumePlan, ValidationReceipt, AnalysisResult, EventRecord y CapabilityDescriptor. Recibos de T-056/§25.3–25.4: AdmissionReceipt, ControllerAuthorityRecord, SubmissionReceipt, RuntimeProbeReceipt, FinalizationReceipt, RecoveryCheckpoint y CapabilityQualificationRecord. Aclaraciones de la Ola 2 ([ADR-016](../docs/adr/ADR-016-borradores-comandos-recuperacion.md)): Draft con DraftCreateRequest y DraftRevisionRequest, EffectIntent y OperationResolutionReceipt. Cada archivo se llama `<nombre-en-kebab>.schema.json`.

## Reglas

**Envelope.** Todo registro persistido es un envelope (ADR-004 §2) con `schema_id = dftlab.<nombre>` y su `payload`. Campos de primer nivel desconocidos se rechazan; las extensiones van en `extensions` con clave namespaced (ADR-012 §4). Las peticiones (`OperationRequest`), los eventos (`EventRecord`), los errores (`Problem`) y los mensajes de la capa Hubbard tienen schemas propios, no son envelopes.

**Integridad (decisión C3 de ADR-004 §6).** `integrity.digest` es el SHA-256 de la forma **JCS (RFC 8785)** del envelope sin el miembro `integrity`. JCS solo se aplica a envelopes nuevos de plataforma; los digests nativos se guardan con su algoritmo (`native_digest.algorithm`) y nunca se recalculan. Los límites numéricos de JCS no afectan porque los valores exactos viajan como strings. `UNVERIFIED` con `digest: null` es válido e impide presentar el registro como evidencia íntegra.

**Serialización.** Sin NaN/Infinity. Ausente = `null` + `absent_reason`, nunca cero (`defs#quantity`). Decimales exactos y tokens de certificación como `decimal_string`; enteros fuera del rango seguro de JS como `big_int_string`. Arrays grandes van en artefactos con `dtype`, `shape`, `dimension_order`, orden de bytes y unidad.

**Versiones.** Todos los schemas están en `0.1.x`. Hasta `1.0.0` una minor puede romper, como QRAFT 0.x; un validador acepta solo su minor y rechaza las demás con diagnóstico (no se migra en sitio). `1.0.0` se fija cuando X5 y X6 implementen y prueben contra estos fixtures. Añadir un valor a un enum de plataforma sube la versión.

**Enums desconocidos.** Los enums de plataforma son cerrados: un valor nuevo con otra versión se rechaza al validar, y la UI en modo lectura lo muestra como `UNKNOWN`, nunca como `PASS` (fixture `assessment-record/invalid/platform-future-enum`). Los estados nativos viajan en `native_status` con vocabulario abierto; un valor no listado en `vocabularies/native-status-projection.json` se proyecta como `NOT_ESTABLISHED` (fixture `assessment-record/valid/native-future-enum`). Un tipo de evento desconocido valida y se ignora.

**Autoridad del cliente.** El servidor deriva owner, estado, digest verificado y autoridad: `OperationRequest` los rechaza por schema. Una `ArtifactRef` no lleva rutas, URLs ni credenciales; `ArtifactRecord.locator_id` es opaco.

**Mutaciones.** Toda acción con posible efecto de `/api/v1` lleva un `OperationRequest` con `idempotency_key` (16–128) y `target.expected_revision`, y devuelve 202 con la `OperationRecord`. Misma clave y cuerpo: 200 con la misma operación. Misma clave con otro `request_hash` (SHA-256 de la forma JCS del cuerpo): 409 `IDEMPOTENCY_KEY_REUSED`. Revisión distinta: 412 `REVISION_CONFLICT`. Mientras una operación tenga efectos vivos su clave no caduca. Un envío con ack perdido deja la operación en `OUTCOME_UNKNOWN` y el recibo en `SUBMISSION_UNKNOWN`; nunca se reenvía a ciegas. Las mutaciones locales sin efecto externo (proyectos, subidas y borradores) llevan su propio cuerpo con `idempotency_key`, responden 201/200 con el recurso y no pasan por el procesador.

**Comandos.** `target.kind` y el payload están fijados por acción (`operation-request.schema.json#/$defs`). Pasar el schema no admite un efecto: sin adaptador calificado el servidor responde `ENGINE_UNAVAILABLE`. El payload de `VALIDATE_INPUT` (`validate_input_payload`) es normativo para clientes y el schema lo exigirá tras la migración de ADR-016.

**Revisión.** `target.expected_revision` es la revisión del agregado destino; aceptar una operación la incrementa. `RunProjection.source_revision` es esa misma revisión del run; las observaciones avanzan `snapshot_cursor` sin cambiarla.

**Recuperación.** Cada acción tiene una clase de efecto (`transitions/operation-transitions.json#effect_classes`). Un envío confirma un `EffectIntent` antes de llamar al scheduler, así que el `SubmissionReceipt SUBMISSION_UNKNOWN` siempre tiene datos; sin `EffectIntent`, o en efectos locales o idempotentes, `OUTCOME_UNKNOWN` se resuelve con `OperationResolutionReceipt` y el error `OPERATION_INTERRUPTED`.

**Eventos.** `sequence` empieza en 1 y es monótona por `stream_id`; los consumidores deduplican por `event_id`. `GET /runs/{id}/events?after=<cursor>` en JSON o SSE; si el cursor caducó, 410 `CURSOR_EXPIRED` y el cliente reanuda desde `snapshot_cursor` de `GET /runs/{id}`. Los eventos de plataforma referencian el evento nativo (`native_event`); no lo sustituyen.

**Estado de un run.** `RunProjection` tiene cuatro dimensiones (scheduler, ejecución, integridad, ciencia), cada una con fuente y `observed_at`; sin observación el valor es `UNKNOWN`. Terminar no es certificar: el fixture `run-projection/valid/completed-not-established` tiene ejecución `COMPLETED`, integridad `VERIFIED` y ciencia `NOT_ESTABLISHED`.

## Borradores (T-014)

`POST /projects/{project_id}/drafts` crea un borrador desde Aprender (`LEARNING_PROMOTION`), un artefacto subido (`USER_IMPORT`) o edición propia (`USER_AUTHORED`). El cliente manda contenido; el servidor asigna `draft_id`, `StructureRevision`, `PhysicalModel`, `NumericalPolicy` y `RunIntent`, deriva `provenance_state` (nunca `VERIFIED`) y fija `scientific_assessment: NOT_EVALUATED`. Una promoción desde Aprender nace `EXPLORATORY`. `POST /drafts/{draft_id}/revisions` con `expected_revision` crea identidades nuevas sin tocar las anteriores. Un borrador nunca crea runs ni cambia `Project.revision`. `GET /api/v1/session` devuelve el CSRF de la sesión tras recargar, sin guardarlo en el navegador.

## Capa Hubbard bajo QRAFT

Decisión de Manuel del 2026-10-11: la lógica de HubbardFlow se extrae a un módulo privado de la plataforma, obligatorio, que funciona como capa debajo de QRAFT (el ADR lo registra su propio hilo). `hubbard-layer-message.schema.json` fija la interfaz entre QRAFT y esa capa con las operaciones de §8.3: `describe_capabilities`, `resolve_plan`, `validate_observation`, `evaluate_gate`, `analyze` y `check_resume` con petición y respuesta tipadas; `export_fragment` y `prepare_node` quedan nombradas para HF-2, sin cuerpo fijado. Las entradas son serializables (lo que pedía U-H2), el plan sale como `NativeContractRef` con el digest `hubbardflow.plan-digest-v1` intacto, `analyze` solo produce `U_scalar_charge`, el `CERTIFIED` de la inversa no se proyecta como U certificado y `check_resume` declara `side_effects: NONE` (U-H4).

HF-1 se ejecuta en QRAFT como **tarea controladora** ([ADR-017](../docs/adr/ADR-017-tarea-controladora-qraft-hf1.md)): un proceso sin MPI que reserva nodos completos y lanza dentro sus SIESTA. `CapabilityDescriptor.execution_shape: CONTROLLER` lo declara en el catálogo y obliga a `supports.cancel: COOPERATIVE` y a no afirmar el resume. El descriptor de reserva y el libro de lanzamientos internos son contratos nativos de QRAFT (`qraft.controller-reservation@1.0`, `qraft.controller-inner-ledger@1.0`) que la plataforma guarda por `NativeContractRef` y valida con `qraft-controller-reservation.schema.json` y `qraft-controller-ledger-entry.schema.json` (QRAFT empaqueta copias idénticas). Las reglas del libro (clave estable entre intentos, ningún nodo asentado se relanza, recursos y plazo) son ejecutables: `fixtures/controller-ledger-rules/cases.json` trae los vectores y `check-contracts.mjs` los evalúa. La facturación sale de las CPU que el scheduler asignó al job, no de ranks ni del descriptor (ADR-017 Adenda 1).

## Validar

```bash
node contracts/scripts/check-contracts.mjs          # también lo ejecuta scripts/verify.mjs
python contracts/scripts/validate_fixtures.py       # jsonschema>=4.18; openapi-spec-validator opcional
```

`check-contracts.mjs` comprueba `$schema` y `$id`, que todo `$ref` (schemas y OpenAPI) resuelva, que cada fixture esté en el manifiesto y cada schema tenga casos válidos e inválidos, enteros seguros en los válidos, digests JCS de envelopes `VERIFIED`, la salida JCS y los dos digests nativos, CSRF y Problem en la API, la tabla de transiciones contra `OperationRecord` y que ninguna proyección nativa por defecto dé `PASS`. No valida fixtures contra los schemas: eso lo hace `validate_fixtures.py` y lo harán los validadores JS y Python de X5.

Los digests de los fixtures son sintéticos (SHA-256 de nombres), salvo los de `canonicalization/`, `native-digests/` y el envelope `VERIFIED`.
