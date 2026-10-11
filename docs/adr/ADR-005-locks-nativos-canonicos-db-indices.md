# ADR-005: locks y manifiestos nativos canónicos; la base de datos guarda operaciones e índices reconstruibles

Estado: **aceptado** el 2026-10-11 (T-007). Implementación pendiente: T-016/T-017 (servicio y ArtifactStore), P4.
Fecha: 2026-10-11. Fuente: [propuesta maestra](../../PROPUESTA_MAESTRA_DFTLAB_V2.md) §2 (reglas 6 y 7), §13.1, §14.1, §22.

## Contexto

QRAFT produce `workflow.lock.json`, `run.lock.json`, journals e intentos; HubbardFlow produce planes con digest, observaciones y evidencia. La plataforma necesita consultar estado rápido (listas, filtros, eventos). Si la DB se vuelve autoridad del estado del DAG, habrá dos verdades y el resume dejará de ser verificable.

## Decisión

1. **Los locks, journals y manifiestos nativos son la fuente canónica** de la ejecución y la evidencia. Son inmutables: cambiar una intención crea una revisión; un intento nuevo no borra el anterior.
2. **La DB de plataforma es autoridad solo de lo que es suyo:** proyectos, revisiones, permisos, `OperationRecord`, claves de idempotencia, reservas de admisión y outbox.
3. Todo lo demás en DB es **proyección o índice** (`RunProjection`, catálogos de artefactos) y debe poder **reconstruirse** desde las evidencias nativas y el ArtifactStore. Cada proyección guarda su fuente y el momento de la última observación por dimensión.
4. Cuatro dimensiones de estado sin enum único: scheduler/conectividad, ejecución, integridad y evaluación científica, cada una con su autoridad (§13.1).
5. Los archivos pasan por staging → verificación → commit lógico; la DB solo publica referencias a archivos verificados.
6. No hay transacción distribuida entre DB, filesystem y scheduler; la consistencia se obtiene con recibos y reconciliación (ADR-007).

## Alternativas

| Opción | Motivo para no adoptarla |
|---|---|
| DB como autoridad del DAG y de los intentos | Compite con QRAFT; un fallo de sincronización falsifica el estado. |
| Sin DB, solo leer journals en cada consulta | Lento para listas/eventos y sin lugar para operaciones e idempotencia. |
| `manifest.json` nuevo que controle el DAG | Rechazado en §22: una sola autoridad y resume verificable. |

## Consecuencias

- Hace falta un proceso de reindexado probado (reconstruir proyecciones tras restore o corrupción de índices).
- Una proyección atrasada se muestra con su antigüedad; no se presenta como estado actual.

## Contratos afectados

`OperationRecord`, `RunProjection`, `ArtifactRecord`, `FinalizationReceipt`, `RecoveryCheckpoint` (T-008/T-056).

## Pruebas exigidas

- Borrar los índices y reconstruirlos desde evidencias: mismas proyecciones.
- Un lock nativo nunca se reescribe (hash antes y después de cada operación de plataforma).
- Callback de un intento anterior: se conserva como evidencia histórica y no reemplaza la proyección vigente.

## Migración

No hay DB actual. El primer esquema (SQLite local, ADR-010) nace con esta separación.
