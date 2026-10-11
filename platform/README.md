# Platform: contratos instalados y base local

## Contratos instalados (Ola 2, X5)

El wheel incluye los bytes originales de `contracts/`; el build falla si faltan.
La reconstrucción del sdist debe producir el mismo wheel en el mismo target.
`dftlab_platform.contracts.Contracts` valida JSON Schema 2020-12 y los schemas
inline de OpenAPI sin descargar referencias. JCS solo se aplica a envelopes
de plataforma y requests; los digests nativos se conservan sin recalcular.
El estado de un consumidor no concede certificación científica ni ejecución.

Desde la raíz, `uv sync --project platform --locked` y
`uv run --project platform --locked python deployment/local/qualify_platform.py`
construyen e instalan en un entorno temporal externo. Las dependencias de ese
entorno se exportan del lock y se exigen sus hashes. La puerta ejecuta todas
las pruebas instaladas con `-I`, los 89 fixtures y las semánticas de consumidor.
La CI Windows/Linux valida también el OpenAPI completo. No ejecuta motores ni HPC.

El cliente JS usa validadores estáticos generados con AJV (sin eval en runtime).
En `app/`: `npm ci`, `npm run contracts:generate` para regenerar tras un cambio
autorizado de contratos; `npm test` comprueba que los generados coinciden y
ejecuta los mismos fixtures, JCS e integridad. Los contratos siguen en 0.1.x;
esta implementación no cambia su versión ni los schemas de Claude.

## Dominio y persistencia (Ola 2, X6a)

`domain.Repository` es el puerto de identidad, proyectos y operaciones;
`storage.SQLiteRepository` es su adaptador local, con migración versionada,
WAL, foreign keys y transacciones explícitas. No usar NFS/SMB ni compartir
el archivo entre hosts. Cada proyecto tiene un owner persistente. La API y
PostgreSQL podrán usar el mismo puerto; no se ha calificado PostgreSQL aquí.

Aceptar un comando conserva atómicamente request, OperationRecord, outbox,
evento y revisión del agregado. La clave se limita a owner/proyecto y el hash
JCS incluye el request completo. Un reintento idéntico devuelve el mismo ID;
una clave con otro request falla; el CAS de revisión impide dos comandos
distintos sobre la misma revisión. Aceptación no significa éxito del efecto.

El `Processor` consume claims durables fuera de HTTP. Los handlers científicos
no están registrados: faltan adaptadores de Ola 3 y semánticas de payload de
campañas. Un handler ausente produce FAILED con evidencia de no efecto;
una excepción o pérdida de confirmación conserva OUTCOME_UNKNOWN y no reenvía.
`recover()` requiere arranque **exclusivo**, con el procesador anterior detenido;
no toma control de workers vivos. La sesión/launcher que impone esto sigue X7.

`checkpoint()` usa el backup consistente de SQLite. Conserva identidades y
outbox, pero no es aún el RecoveryCheckpoint completo de DB+artefactos+journals
de T-060: no habilita admisión operativa ni acredita recuperación HPC.
Las pruebas instaladas incluyen concurrencia, autorización, rollback,
reconciliación con fixture, callback tardío, corrupción y restauración de DB.

## Base de proceso anterior (Ola 0, X2)

Distribución `dftlab-platform` / paquete `dftlab_platform`, CPython 3.12.10 y uv 0.11.14 fijados, con dependencias de validación y build bloqueadas. En X5 todavía no hay campañas, sesiones, CSRF, SQLite ni API HTTP. El entry point `dftlab-platform start|status|stop` conserva por ahora el proceso de prueba de X2.

`start` reserva una instancia mediante creación exclusiva de `launcher.lock`; el hijo actualiza un heartbeat efímero. `status` informa stopped/starting/running/unknown. `stop` pide salida cooperativa a la instancia identificada, sin señales por PID ni matar procesos ajenos. Arrancar dos veces falla. Si hay una reserva abandonada, no se toma control ni se elimina automáticamente: se registra unknown/starting y la recuperación queda pendiente de X6/X7. Estos archivos **no son operaciones durables ni autoridad sobre ningún job**.

El directorio por usuario es `%LOCALAPPDATA%/DFTLabPlatform/launcher` en Windows o `$XDG_STATE_HOME/dftlab-platform/launcher` en Linux (por defecto `~/.local/state`). Las pruebas usan un directorio temporal explícito. No hay puertos, credenciales ni conexión SSH. Los permisos POSIX se crean restringidos; no se promete una política ACL ni aislamiento de usuarios operativos en este esqueleto.

La instalación de entrega es desde wheel en un entorno limpio, fuera del checkout y sin `PYTHONPATH`, según [deployment/local/README.md](../deployment/local/README.md). La CI Windows/Linux prueba el **wheel instalado**, no `src/` importado por accidente. El sdist se incluye para reconstrucción; los motores se califican aparte, no forman parte de este wheel vacío. HubbardFlow será obligatorio bajo QRAFT en el runtime operativo (ADR-015); su integración no queda implementada aquí.
