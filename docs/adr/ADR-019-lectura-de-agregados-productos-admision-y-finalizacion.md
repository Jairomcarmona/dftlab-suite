# ADR-019: lectura de campañas, planes, runs y operaciones; productos tipados; admisión sin reserva; salidas no producidas

Estado: **propuesto** el 2026-10-14 por Claude, pendiente de aceptación de Manuel. Resuelve [#35](https://github.com/Jairomcarmona/dftlab-suite/issues/35), [#31](https://github.com/Jairomcarmona/dftlab-suite/issues/31), [#47](https://github.com/Jairomcarmona/dftlab-suite/issues/47) y [#44](https://github.com/Jairomcarmona/dftlab-suite/issues/44). Amplía [ADR-016](ADR-016-borradores-comandos-recuperacion.md) y la admisión de ADR-010. No resuelve [#30](https://github.com/Jairomcarmona/dftlab-suite/issues/30) (protocolo del WebSocket de terminal): no está en el camino del primer cálculo real de la plataforma.

## Contexto

La plataforma ya crea borradores, valida, crea campañas y planes y prepara paquetes, pero un cliente que recarga la página no puede encontrar lo que creó: la API solo conoce `getOperation` y `getRun` por un ID que el cliente ya tenga, y el resultado de una operación es un objeto abierto. Codex dejó la campaña, el plan y el paquete como productos privados del servicio ([`local_effects.py`](../../platform/src/dftlab_platform/local_effects.py)) y detuvo la integración de interfaz y resultados hasta que el contrato lo defina. Tres dudas más bloquean el primer envío real: qué responde la admisión cuando todavía no hay presupuesto ni probe (#47), un payload de `VALIDATE_INPUT` que el schema aún no exige (#31) y cómo se finaliza un run al que le faltan salidas que nunca existieron (#44).

## Decisión

### 1. Productos tipados y lectura autoritativa (#35)

- **`OperationRecord.result` es un producto tipado por acción.** Para las cinco acciones locales, en `SUCCEEDED`, `result = {product_refs: [{kind, id, revision}]}` con exactamente un producto cuyo `kind` fija la acción: `VALIDATE_INPUT → VALIDATION_RECEIPT`, `CREATE_CAMPAIGN → CAMPAIGN`, `CREATE_PLAN → PLAN`, `PREPARE_PACKAGE → PACKAGE`, `CREATE_RESUME_PLAN → RESUME_PLAN`. El resto de acciones conserva su resultado actual (`SUBMIT_RUN` se descubre con `listRuns` y `getRun`). El resultado es una referencia: el producto se lee por su propio GET y la operación no duplica su contenido.
- **Dos agregados nuevos de lectura**, ambos envelopes inmutables por revisión: `Campaign` (`campaign.schema.json`: `campaign_id`, `revision`, `name`, `drafts[]`) y `Plan` (`plan.schema.json`: `plan_id`, `campaign_id`, `revision`, `draft`, `intent_id`, `validation_receipt_id`). **El plan no copia ni recalcula digests nativos:** su único `NativeContractRef` viaja en `native_contract_refs[0]` y `expected_plan_digest` de `PREPARE_PACKAGE` es el `digest` de ese ref. El paquete se lee como `ArtifactRecord` con `getArtifact` (su `artifact_id` es el `id` del producto); el recibo de validación, con `getValidationReceipt`; el run, con `getRun`; el plan de reanudación, con `getResumePlan`.
- **Siete lecturas nuevas**, todas del owner del proyecto y con `404` igual para un recurso ajeno o inexistente, como `getRun`: `listCampaigns`, `getCampaign`, `listPlans` (por campaña), `getPlan`, `listRuns`, `listOperations` (filtros `action` y `state`) y `getValidationReceipt`.
- **Paginación común:** `limit` 1–200 (50 por omisión) y `cursor` opaco; respuesta `{items, next_cursor}` con `next_cursor: null` en la última página. Orden estable de creación ascendente `(created_at, id)`: sin duplicados ni saltos aunque se creen recursos entre páginas. Cursor mal formado: `422`; fuera de retención: `410 CURSOR_EXPIRED` (el código ya existe, ahora también para listas).
- **Lectura tras escritura:** cuando `getOperation` devuelve `SUCCEEDED`, el producto de su `result` es legible por su GET en la misma sesión. Una caché del cliente nunca es autoridad.
- **La revisión de un agregado** (`Campaign.revision`, `Plan.revision`) es la que compara `target.expected_revision` (ADR-016 §3). Estas lecturas devuelven la vigente.

### 2. Payload de `VALIDATE_INPUT` obligatorio (#31)

`operation-request.schema.json` exige `validate_input_payload` (`{draft: {draft_id, revision}}`) cuando `action = VALIDATE_INPUT`, como ya hacen las demás acciones. Payload vacío, sin revisión o con propiedades extra se rechazan. El servidor ya lo exigía; esto alinea el contrato.

### 3. Admisión cuando todavía no hay presupuesto ni probe (#47)

- **Siempre hay `AdmissionReceipt`.** Un rechazo previo a la reserva no es un Problem sin recibo: es un `AdmissionReceipt` con `decision = REJECTED`, `runtime_probe_ref = null`, `reservation = null` y al menos un motivo, devuelto con `409 ADMISSION_REJECTED` (el código ya decía que «el recibo lleva los motivos»). Un `ADMITTED` exige probe y reserva reales. Un fallo que impide formar siquiera el recibo (plan o paquete inexistente, digest distinto) sigue siendo `404`/`412`/`422`.
- **El presupuesto no es un recurso público en 0.1.** Es configuración privada del operador, ligada al perfil; el cliente no elige. `OperationRequest.budget_ref` debe ser `null` (el schema lo exige). `reservation.budget_ref` es el identificador opaco que el servidor resolvió desde el perfil.
- **Unidad:** `reservation.amount.unit = "cpu-hour"`: CPU **cargadas** de la asignación (`AllocTRES` `cpu`) por el límite de tiempo, en horas. No son rangos MPI ni horas de facturación, y no se convierten entre sí. El caso WSL de #52 (4 rangos pedidos, 8 CPU asignadas) reserva 8 CPU.
- **Ciclo de la reserva** (reservar, consumir, liberar) vive en el `BudgetPort` privado, con SQLite atómico y sin API paralela. La reserva se libera solo con evidencia terminal del efecto. Una desconexión, un `CANCEL_REQUESTED` o el vencimiento del recibo **no** liberan la reserva de un efecto `SUBMISSION_UNKNOWN` o vivo.
- Sin presupuesto o sin perfil calificado la respuesta es el rechazo del primer punto: nunca se inventa un probe, una reserva ni una conversión de coste.

### 4. Salidas requeridas que nunca se produjeron (#44)

`FinalizationReceipt` gana `unproduced_outputs[]` (obligatorio, puede ser vacío): cada elemento es `{port, reason, native_ref}` con `reason ∈ {NEVER_PRODUCED, INTERRUPTED_BEFORE_WRITE, PRODUCER_REPORTED_ABSENT}` y `native_ref` opcional. `expected_artifacts` solo lista artefactos que el productor ya declaró con hash, y pasa a poder estar vacío mientras exista al menos una salida no producida. `missing` conserva su sentido: artefactos declarados con hash que no se verificaron. **No se inventa SHA ni se registra un blob vacío.** `PUBLISHED` exige `missing` y `unproduced_outputs` vacíos; finalizar sin nada esperado ni nada no producido es inválido.

### 5. Fuera de alcance

El WebSocket de terminal (#30), la API pública de presupuestos y cualquier consulta de resultados científicos más allá de `getRun`, `getArtifact` y el recibo de validación.

## Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| Incrustar el producto completo en `result` | Duplica contenido, hace crecer `OperationRecord` y deja dos fuentes de la misma verdad. |
| Un `Problem` sin recibo para el rechazo previo a reserva | El código `ADMISSION_REJECTED` ya prometía un recibo; dos formas de rechazar obligan al cliente a manejar ambas. |
| API pública de presupuestos ahora | Sin caso de uso: un usuario local no negocia presupuesto. Se difiere hasta P9. |
| Campos opcionales en `ArtifactRef` para salidas no producidas | Debilita la referencia para todos; una referencia sin hash no identifica nada. |
| Copiar el digest nativo en el payload del plan | Dos fuentes para el digest; invita a recalcularlo. |

## Consecuencias

- Un cliente que recarga puede descubrir campañas, planes, runs y operaciones del proyecto y continuar el flujo hasta el run.
- Los consumidores (`service.py`, escritores de `FinalizationReceipt` y `AdmissionReceipt`, SDK) deben migrarse en el mismo PR que consuma el contrato; el servicio no abre capabilities nuevas por esto.
- Cambios de contrato, todos aditivos o estrictos en una minor 0.1.x: `operation-request` (payload y `budget_ref`), `operation-record` (ramas de `result`), `admission-receipt` (probe y reserva anulables en rechazo, unidad), `finalization-receipt` (`unproduced_outputs`), schemas `campaign` y `plan`, siete operaciones de OpenAPI y 21 fixtures.

## Pruebas exigidas al consumidor

- Cada lectura con dos owners: el ajeno recibe `404` idéntico al inexistente.
- Paginación: `limit` 1, 50 y 200; `limit` 0 y 201 rechazados; recorrer todas las páginas no repite ni omite; crear un recurso entre páginas no rompe el orden; cursor malformado `422`, cursor fuera de retención `410`.
- Lectura tras escritura: `CREATE_CAMPAIGN`/`CREATE_PLAN` terminados y su producto legible por el GET correspondiente; `Campaign.revision` y `Plan.revision` coinciden con `expected_revision` de la siguiente operación.
- Un plan leído conserva byte a byte el `NativeContractRef` del lock; ningún digest nativo se recalcula.
- Admisión: sin probe vigente y sin presupuesto devuelve `409 ADMISSION_REJECTED` con recibo `REJECTED`, `runtime_probe_ref` y `reservation` nulos y motivos; no se crea reserva ni `EffectIntent`.
- Reserva: cancelar, desconectar o vencer el recibo no libera la reserva de un efecto `SUBMISSION_UNKNOWN`; solo la evidencia terminal.
- Finalización: un run interrumpido antes de escribir `siesta.out` produce un recibo `FAILED_VERIFICATION` con `unproduced_outputs` y sin SHA inventado; nunca `PUBLISHED`.

## Contratos afectados

Nuevos: `campaign`, `plan`. Cambiados: `operation-request`, `operation-record`, `admission-receipt`, `finalization-receipt`, `openapi/dftlab-api.v1.json` (siete GET, cuatro páginas), `errors/error-codes.json` (`CURSOR_EXPIRED` también para listas) y los fixtures de `contracts/fixtures/` (campaign, plan, operation-record, operation-request, admission-receipt, finalization-receipt).
