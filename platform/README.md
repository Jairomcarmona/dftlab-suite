# Platform: contratos instalados y base local

## Contratos instalados (Ola 2, X5)

El wheel incluye los bytes originales de `contracts/`; el build falla si faltan.
La reconstrucción del sdist debe producir el mismo wheel en el mismo target.
`dftlab_platform.contracts.Contracts` valida JSON Schema 2020-12 y los schemas
inline de OpenAPI sin descargar referencias. JCS solo se aplica a envelopes
de plataforma y requests; los digests nativos se conservan sin recalcular.
El estado de un consumidor no concede certificación científica ni ejecución.

Tras `npm ci` y `npm run build` en app/, desde la raíz `uv sync --project platform --locked` y
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

## Artefactos (Ola 2, X6b)

`artifacts.ArtifactStore` y `ArtifactIndex` separan contenido y metadatos.
`LocalArtifactStore` guarda bytes en staging/blobs privados;
`SQLiteArtifactIndex` usa una migración propia versionada en la misma DB.
Los únicos nombres de disco son UUID generados por el servicio. El contrato
recibe IDs opacos, SHA-256, tipo y tamaño, nunca rutas del host ni URLs.

La subida admite chunks consecutivos de hasta 8 MiB y reintentos exactos del
rango ya confirmado. Tras crash descarta la cola no confirmada. Commit verifica
tamaño/hash, persiste COMMITTING antes del rename atómico y solo publica el
ArtifactRecord después. Repetir commit recupera un rename o una publicación
de índice interrumpidos. Hash incorrecto, enlace o contenido alterado fallan.
Stream verifica antes de entregar y lee bloques de 1 MiB, con rango acotado.

Límites locales configurables: 1 GiB por archivo, 32 uploads abiertos por owner
y 4 GiB reservados por owner (incluye originales publicados). Expiry de staging
24 h; una finalización ya iniciada sigue recuperable después. No se extraen
ZIP/tar, ni se ejecutan importaciones. Los originales son ESSENTIAL; no hay GC
que pueda borrarlos como caché. Retención/GC por runs y FinalizationReceipt del
conjunto científico completo se califican en T-060/Ola 3, no por este upload.

## API y sesión (Ola 2, X7a)

`service.create_app` recibe Repository, ArtifactStore, ReadModels, Sessions y
LocalSettings. FastAPI transporta los contratos originales; no genera una
segunda versión con Pydantic ni acepta modelos más permisivos. Los errores
son Problem RFC 9457 sin valores importados, paths ni tracebacks secretos.
FastAPI 0.143.0 / Uvicorn 0.54.0 y Pydantic transitivo están fijados en uv.lock.

Todas las rutas de cliente son `/api/v1` bajo el base_path configurado.
Health es público. Bootstrap de un uso/caducidad establece cookie HttpOnly,
SameSite=Strict y devuelve CSRF; tokens solo en memoria, sin HTTP issuer, query,
logs ni localStorage. Host/Origin exactos, incluido puerto; `null`, DNS rebinding,
cookies duplicadas, CSRF de otra sesión y compresión se rechazan. Loopback HTTP
usa cookie sin Secure; un despliegue TLS/web requiere su adapter/configuración
propia y cookie Secure, no exponer esta configuración local a la red.

Proyectos, operaciones de lectura, artefactos y replay autorizan owner/proyecto.
ReadModels es un puerto de índices reconstruibles; el adapter SQLite conserva
las cuatro dimensiones y refs nativas, valida CAS y no sustituye journals.
Callbacks/eventos antiguos nunca escriben una proyección por sí mismos.
Replay máximo 500 eventos / 8 MiB; evento individual 256 KiB; JSON/chunks
acotados. SSE entrega replay finito; no aloja ejecutores ni autoridad en sockets.

Los comandos científicos devuelven ENGINE_UNAVAILABLE hasta aclarar payloads
de C3 y calificar adapters Ola 3. Capabilities devuelve []: no acredita motores
instalados en este wheel ni EXECUTION. QRAFT requiere HubbardFlow bajo él,
sin restricción de licencia (ADR-015). Terminal/WS no se ofrecen hasta X9.
El launcher sigue X7b antes de usar el servicio instalado con acceso local.

## Runtime instalado (Ola 2, X7b)

## Distribución operativa y portátil (Ola 2, X8)

Desde una copia limpia: instalar Node 24.18.0; en `app/`, `npm ci` y
`npm run build`. Después, desde la raíz, `uv sync --project platform --locked
--python 3.12.10` y la calificación instalada documentada en deployment/local/.
El build de Python falla si faltan los activos operativos; el sdist los conserva
para reconstruirse sin Node ni checkout. No se versiona dist/.

Un único frontend produce los HTML portátiles offline y `dist/operative/` ESM
con módulos por demanda. Wheel/sdist solo incluyen los archivos declarados por
el manifest SHA-256; el servicio verifica sus hashes y sirve esa allowlist,
incluido un base path como /lab/. No sirve source, manifest, tokens, DB ni chunks
viejos. CSP permite WASM y prohíbe eval JavaScript/scripts inline; se conserva
style-src unsafe-inline por los estilos actuales, sin ampliar script-src.

`start --open` abre el cliente; seleccionar access.json del directorio privado
antes de 120 s. La sesión habilita Proyectos y campañas tras handshake, con
edición por API /api/v1 e idempotencia. No hay controles de ejecución mientras
capabilities no acrediten motores. Recargar conserva lectura por cookie pero
no persiste CSRF: reiniciar el launcher emite un acceso nuevo para editar.

La costura pura `learn/promote.js` exporta nueva StructureRevision/RunIntent,
IDs nuevos, EXPLORATORY y procedencia learning separada, sin mutar dataset,
certificar resultados ni enviar requests. La persistencia/interfaz de promoción
T-014 está bloqueada por la ausencia de un contrato de creación de drafts en C3;
no se inventa otro endpoint ni se considera completo ese ticket.

La CI califica el wheel fuera del checkout y, en navegador real Windows/Linux,
las 19 vistas, módulos lazy, CSP, autenticación, proyectos, reinicio y base paths.
Las pruebas portátiles recorren también las 19 vistas sin servicio ni red.

## Uso del runtime instalado

`dftlab-platform start|status|stop --state-dir <directorio-local>` inicia la
API loopback en puerto libre y un procesador durable separado. Admite
`--base-path /lab` y `start --open`. Los dos entry points explícitos son
`dftlab-platform-api` y `dftlab-platform-processor`. No ejecutan campañas:
el procesador no registra todavía handlers científicos.

El propietario y sus proyectos sobreviven al reinicio en SQLite. Cada arranque
emite un bootstrap nuevo, de un uso y 120 s, en `access.json` privado; seleccionar
ese archivo en el cliente operativo de X8. La URL pública y status nunca llevan
credenciales. Reiniciar invalida las sesiones anteriores. En Linux el directorio
tiene modo 0700; en Windows una DACL protegida concede acceso solo al usuario.

Los guard locks del sistema operativo acreditan exclusión de API/procesador;
un heartbeat viejo nunca permite tomar autoridad. Stop es cooperativo y espera
ambos procesos; Windows espera el handle capturado sin terminar procesos por PID.
`recover-local` solo repara una reserva abandonada cuando ambos guard locks están
libres. Conserva DB/artefactos y no concede derechos sobre jobs remotos. Una salida
incierta mantiene la reserva. Fallos del monitor detienen la API supervisada.

## Base de proceso anterior (Ola 0, X2; registro histórico)

Distribución `dftlab-platform` / paquete `dftlab_platform`, CPython 3.12.10 y uv 0.11.14 fijados, con dependencias de validación y build bloqueadas. En X5 todavía no hay campañas, sesiones, CSRF, SQLite ni API HTTP. El entry point `dftlab-platform start|status|stop` conserva por ahora el proceso de prueba de X2.

`start` reserva una instancia mediante creación exclusiva de `launcher.lock`; el hijo actualiza un heartbeat efímero. `status` informa stopped/starting/running/unknown. `stop` pide salida cooperativa a la instancia identificada, sin señales por PID ni matar procesos ajenos. Arrancar dos veces falla. Si hay una reserva abandonada, no se toma control ni se elimina automáticamente: se registra unknown/starting y la recuperación queda pendiente de X6/X7. Estos archivos **no son operaciones durables ni autoridad sobre ningún job**.

El directorio por usuario es `%LOCALAPPDATA%/DFTLabPlatform/launcher` en Windows o `$XDG_STATE_HOME/dftlab-platform/launcher` en Linux (por defecto `~/.local/state`). Las pruebas usan un directorio temporal explícito. No hay puertos, credenciales ni conexión SSH. Los permisos POSIX se crean restringidos; no se promete una política ACL ni aislamiento de usuarios operativos en este esqueleto.

La instalación de entrega es desde wheel en un entorno limpio, fuera del checkout y sin `PYTHONPATH`, según [deployment/local/README.md](../deployment/local/README.md). La CI Windows/Linux prueba el **wheel instalado**, no `src/` importado por accidente. El sdist se incluye para reconstrucción; los motores se califican aparte, no forman parte de este wheel vacío. HubbardFlow será obligatorio bajo QRAFT en el runtime operativo (ADR-015); su integración no queda implementada aquí.
