# Registro de decisiones de arquitectura (ADR)

Cada ADR tiene estado, contexto, decisión, alternativas, consecuencias, contratos afectados, pruebas y migración. Un ADR aceptado fija el diseño; no afirma que esté implementado. Los puntos «pendiente C2» esperan el inventario de API de QRAFT y HubbardFlow en `docs/compatibility/` (T-009).

| ADR | Título | Estado |
|---|---|---|
| [001](ADR-001-frontend-modular-dos-builds.md) | Frontend modular, portátil y operativo desde una fuente | Aceptado |
| [002](ADR-002-aprender-produccion-procedencia.md) | Aprender y producción, promoción explícita y procedencia | Aceptado |
| [003](ADR-003-autoridades-qraft-hubbardflow-plataforma.md) | Autoridades: QRAFT, HubbardFlow y plataforma | Aceptado; pendiente C2 |
| [004](ADR-004-contratos-versionados-adaptadores.md) | Contratos versionados y adaptadores | Aceptado; pendiente C2 |
| [005](ADR-005-locks-nativos-canonicos-db-indices.md) | Locks nativos canónicos; DB de operaciones e índices | Aceptado |
| [006](ADR-006-hubbard-hf1-hf2.md) | Hubbard HF-1 y HF-2 | Aceptado; pendiente C2 |
| [007](ADR-007-controlador-unico-reconciliacion-idempotencia.md) | Controlador único, reconciliación e idempotencia | Aceptado; pendiente C2 |
| [008](ADR-008-servicio-local-ssh-autorizacion.md) | Servicio local, SSH y autorización | Aceptado |
| [009](ADR-009-politicas-gates-cientificos.md) | Políticas y gates científicos versionados | Aceptado |
| [010](ADR-010-almacen-retencion-sqlite-postgres.md) | Almacén, retención, SQLite y PostgreSQL | Aceptado |
| [011](ADR-011-despliegues-por-target-workers-fijados.md) | Despliegues por target y workers fijados | Aceptado |
| [012](ADR-012-releases-migraciones-catalogo-capabilities.md) | Releases, migraciones y catálogo de capabilities | Aceptado; pendiente C2 |
| [013](ADR-013-react-typescript-ui.md) | Interfaz con React y TypeScript | Propuesto |
| [014](ADR-014-python-reference-environment.md) | Entorno aislado para regenerar referencias | Implementado (bloque F) |

Fuente: [propuesta maestra V2.1](../../PROPUESTA_MAESTRA_DFTLAB_V2.md) §19.1. Resumen operativo en [ARQUITECTURA.md](../../ARQUITECTURA.md) §0.
