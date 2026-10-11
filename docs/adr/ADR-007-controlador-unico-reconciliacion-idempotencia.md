# ADR-007: exclusión entre controladores, reconciliación e idempotencia; incertidumbre visible

Estado: **aceptado** el 2026-10-11 (T-007). Dónde se comprueba el token de fencing dentro de QRAFT queda pendiente del inventario C2 (T-009).
Fecha: 2026-10-11. Fuente: [propuesta maestra](../../PROPUESTA_MAESTRA_DFTLAB_V2.md) §6.1, §13.2–13.6, §25.2–25.4.

## Contexto

Un envío a SLURM puede aceptarse y perder la respuesta; la laptop puede apagarse; dos procesos de API pueden intentar controlar el mismo run. El RLock interno de QRAFT no excluye dos procesos. La red no ofrece exactly-once.

## Decisión

1. **Idempotencia de comandos:** toda mutación lleva idempotency key, ámbito owner/proyecto, hash de request y precondición de revisión. Misma clave y payload devuelven la misma operación; misma clave con payload distinto es conflicto. Las claves se retienen al menos mientras la operación tenga efectos vivos y su ventana de recuperación.
2. **Intención persistida antes del efecto:** la API persiste la intención y devuelve 202 con operation ID; el procesamiento usa outbox o mecanismo transaccional equivalente. Una cola, si se añade, transporta IDs, no autoridad.
3. **Envío reconciliable:** cada intento lleva un attempt token. Si se pierde la confirmación, el estado es `SUBMISSION_UNKNOWN` y se reconcilia por token, usuario, clúster y contexto. **Nunca se reenvía a ciegas** un envío ambiguo; un timeout o una consulta vacía no autorizan reenviar.
4. **Un controlador por run:** owner/lease con generación (`ControllerAuthorityRecord`) y token de fencing comprobado **donde se lanzan o publican tareas**, no solo en la DB. Si el sitio o el motor no pueden comprobar fencing, el takeover automático queda deshabilitado hasta tener evidencia de terminación del controlador anterior o intervención explícita.
5. **Cancelar es una solicitud:** termina solo al observar evidencia; se comprueba que no queden launchers huérfanos. Las carreras de §25.2 (cancel tardío, cancel antes de confirmar submit, dos resume, callback viejo) tienen reglas fijas en la tabla de transiciones de operaciones, con compare-and-set.
6. **Incertidumbre visible:** perder SSH es estado remoto incierto, no trabajo fallido. La UI muestra `UNKNOWN` cuando corresponde; una operación exitosa con run desconocido se muestra como tal.
7. **Diagnóstico con evidencia:** SIGSEGV no prueba OOM, salida truncada no prueba apagón, timeout no prueba salud científica. Los reintentos están limitados por política, presupuesto y tipo de fallo, y nunca cambian el protocolo en silencio.

## Pendiente del inventario C2

Si QRAFT @ `4d996ea` ofrece un punto donde comprobar generación/token antes de lanzar o publicar, o si hace falta un cambio upstream (X3). Mientras no exista, rige la política conservadora del punto 4.

## Alternativas

| Opción | Motivo para no adoptarla |
|---|---|
| Reintentar el submit tras timeout | Puede duplicar trabajos y costes. |
| Lease solo en DB | No impide que un controlador remoto viejo siga lanzando. |
| Ocultar estados inciertos tras un «fallido» | Lleva a reenvíos y a borrar trabajo vivo. |

## Consecuencias

- Hay estados `UNKNOWN` visibles y operaciones de reconciliación manual en la UI.
- Cada perfil de sitio declara qué evidencia admite para fencing y terminación.

## Contratos afectados

`OperationRequest`, `OperationRecord`, `SubmissionReceipt`, `ControllerAuthorityRecord`, `ResumePlan`, `EventRecord`; OpenAPI de runs, cancel y resume (T-008, T-011, T-056).

## Pruebas exigidas (inyección de fallos, §18.3)

- Ack de submit perdido tras aceptación del scheduler: sin duplicado.
- Reinicio de API/worker durante staging, publicación y polling: recupera o declara incertidumbre sin perder intentos.
- Dos controladores y pérdida de lease: el dueño vencido no lanza ni publica.
- Misma clave simultánea: una sola `OperationRecord`.

## Migración

Nada que migrar. Se implementa en P3 (operaciones durables) y P4 (submit/cancel/resume reales).
