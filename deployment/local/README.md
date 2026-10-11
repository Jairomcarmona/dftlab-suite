# Instalación local de platform/ (Ola 2)

La distribución instalada contiene API /api/v1, identidad/proyectos, operaciones y artefactos SQLite, sesión/CSRF, cliente operativo y procesador independiente. Conserva el HTML portátil offline. No acredita cálculo real ni SSH/HPC; HubbardFlow es obligatorio bajo QRAFT y sin restricción de licencia (ADR-015). T-057 queda calificado para esta base instalada, no para la integración científica de Ola 3.

## Compilar y calificar desde fuente

Usar Node **24.18.0**, CPython **3.12.10** y uv **0.11.14**. Desde una copia limpia, en `app/` ejecutar `npm ci`, `npm run build` y `npm run browser:install`; volver a la raíz. Los requisitos del build están fijados en `platform/uv.lock`, separado del entorno de referencias científicas F. Python exige el manifest de activos generado; no depende de un dist versionado.

```powershell
uv python install 3.12.10
uv sync --project platform --locked --python 3.12.10
$env:REQUIRE_OPERATIVE_BROWSER = '1'
uv run --project platform --locked python -X utf8 deployment/local/qualify_platform.py
```

El script genera un wheel, sdist, logs y `report.json` en `runtime/platform-qualification/`. Exige directorio de salida nuevo; para otra ejecución usar `--output runtime/platform-qualification-2`. Instala únicamente ese wheel (`--no-index --no-deps`) en un venv temporal fuera del repositorio, elimina `PYTHONPATH` y ejecuta las pruebas copiadas con Python `-I`. Comprueba versión, procedencia de importación, entry point, arranque exclusivo, estado, parada idempotente y reinicio. Verifica que las fuentes no cambiaron. La CI propia repite exactamente esta calificación en Windows 2022 y Ubuntu 24.04, sin secretos ni paquetes reales de motores.

En WSL usar **un entorno diferente del `.venv` nativo Windows**:

```bash
export UV_PROJECT_ENVIRONMENT="$PWD/runtime/platform-venv-wsl"
export REQUIRE_OPERATIVE_BROWSER=1
uv sync --project platform --locked --python 3.12.10
uv run --project platform --locked python -X utf8 deployment/local/qualify_platform.py --output runtime/platform-qualification-wsl
```

Si el worktree fue creado por Git de Windows, sus rutas `.git` pueden no ser legibles para Git Linux. Se puede pasar `--source-commit SHA_COMPLETO_LEIDO_CON_GIT_WINDOWS` para la procedencia. Ese modo registra el SHA como aportado y `source_tree_dirty: null`; **no** declara un checkout limpio y sigue verificando los hashes de los archivos reales. Los jobs CI usan Git directamente y no ese override. Desde un checkout Git Linux normal no hace falta.

## Instalar el artefacto sin checkout ni PYTHONPATH

Descargar wheel, `runtime-requirements.txt` y report.json del artefacto CI, o copiar los generados arriba. Verificar ambos SHA-256 contra el informe de **esa ejecución y target**. El wheel incorpora contratos y activos operativos; no necesita Node, app/ ni checkout en el equipo consumidor. Instalar primero las dependencias con hashes (requiere acceso al índice Python, o un wheelhouse previamente preparado) y después el wheel local sin resolver dependencias.

Windows PowerShell, desde una carpeta ajena al repositorio:

```powershell
Get-FileHash .\dftlab_platform-0.1.0.dev0-py3-none-any.whl -Algorithm SHA256
uv venv --python 3.12.10 .venv
uv pip install --python .venv\Scripts\python.exe --require-hashes -r .\runtime-requirements.txt
uv pip install --python .venv\Scripts\python.exe --no-index --no-deps .\dftlab_platform-0.1.0.dev0-py3-none-any.whl
.\.venv\Scripts\dftlab-platform.exe start --state-dir .\launcher-state
.\.venv\Scripts\dftlab-platform.exe status --state-dir .\launcher-state
.\.venv\Scripts\dftlab-platform.exe stop --state-dir .\launcher-state
```

Linux/WSL, también fuera del repositorio:

```bash
sha256sum dftlab_platform-0.1.0.dev0-py3-none-any.whl
uv venv --python 3.12.10 .venv
uv pip install --python .venv/bin/python --require-hashes -r ./runtime-requirements.txt
uv pip install --python .venv/bin/python --no-index --no-deps ./dftlab_platform-0.1.0.dev0-py3-none-any.whl
.venv/bin/dftlab-platform start --state-dir ./launcher-state
.venv/bin/dftlab-platform status --state-dir ./launcher-state
.venv/bin/dftlab-platform stop --state-dir ./launcher-state
```

El resultado JSON incluye `scope: local-api` y una URL loopback sin credenciales. Abrirla, o usar `start --open`, y seleccionar access.json del directorio de estado privado antes de 120 s. La URL sirve el cliente y /api/v1; el puerto y --base-path son configurables por el launcher. Una reserva abandonada no se roba: start falla; recover-local exige locks de API/procesador libres y conserva DB/artefactos. El lease local no concede autoridad sobre jobs remotos. Reiniciar invalida sesiones y emite un bootstrap nuevo; tras recargar el navegador la cookie permite leer, pero editar exige acceso nuevo porque CSRF no se persiste.

## T-010: paquetes de motores realmente instalados

La tabla y los informes iniciales siguientes conservan la evidencia histórica de Ola 0. Para los pins actualizados de Ola 1, consultar `engine-versions.lock.json` y la sección de integración al final. No reutilizar los hashes de un commit anterior para comprobar otro.

`engine-versions.lock.json` es un **borrador de procedencia**, no un release operativo ni un catálogo de capabilities acreditadas. Fija:

| Motor | Repositorio/commit | Distribución / versión | Rol futuro |
|---|---|---|---|
| QRAFT | `Jairomcarmona/siestaflow` main @ `4d996ea7c580e5638e470bbf32624c88fd762f7d` | `qraft-hpc` / 0.2.0 | Autoridad exterior de tareas y recursos; requiere ruta pública canónica. |
| HubbardFlow | `Jairomcarmona/SIESTAFLOW_HUBBARD_RESPONSE_BACKBONE` codex/hubbardflow-rename @ `e508f47aff1c6243deabb12915063b6b9d899d65` | `hubbardflow` / 0.1.2 | Capa científica obligatoria debajo de QRAFT en HF-1; requiere fachada pública. |

Los informes locales en `evidence/` muestran archivos fuente, wheels instalados, hashes, versiones del entorno, importación pública y CLI `--help`. Ambos paquetes pasan esos probes en Windows 11 x64 y WSL2/Linux x86_64. Ningún resultado científico, control de procesos QRAFT, gate LR-U, ejecución SIESTA/MPI/SLURM ni cooperación HF-1 ha sido probado por ellos. Esos campos quedan `PENDING` en el lock.

El primer intento de extracción completa de HubbardFlow falló por rutas largas de resultados archivados en Windows. El probe usa los **inputs de distribución**: `src/`, pyproject y metadatos de packaging/README/licencia, conservando sus bytes. No extrae campañas/resultados que no forman parte del wheel; sí conserva el hash SHA-256 del tar.gz completo. No realiza checkout ni modifica los repositorios de motores. La extracción usa el filtro seguro `data` de Python.

Para reproducir el probe (no es instalación operativa):

```powershell
uv sync --project deployment/local/engine-probe --locked --python 3.12.10
uv run --project deployment/local/engine-probe --locked python -X utf8 deployment/local/probe_engines.py --output runtime/engine-probe-new
```

En WSL definir antes `UV_PROJECT_ENVIRONMENT="$PWD/runtime/engine-venv-wsl"`. El entorno de probe fija NumPy **1.26.4**, PyYAML **6.0.2**, jsonschema **4.23.0**, setuptools **80.9.0** y wheel **0.45.1**, con transitivos/hashes en su propio lock. No usar `tools/reference-env`: F usa NumPy 2.2.6 y HubbardFlow requiere `<2`. `uv sync` elimina instalaciones de motores ajenas a ese lock de dependencias; el script las reconstruye e instala cada vez. No tratar este venv de prueba como runtime de producción.

Los hashes de wheels son por target: aquí Windows y WSL producen archivos diferentes incluso con la misma versión de código/dependencias. No se promete identidad de ZIP entre sistemas; los tar.gz fuente sí coinciden en las dos pruebas. El SHA de `RECORD` identifica lo instalado en el entorno observado, incluidas rutas/scripts, y tampoco es un hash portátil de una release. El probe comprueba los hashes ya registrados antes de reinstalar y registra cualquier discrepancia como fallo, sin cambiar el lock automáticamente.

## Pendientes y contratos de entrada

X5/X6/X7 implementarán los contratos ya publicados por C3: validación efectiva, API, operaciones durables, ArtifactStore/SQLite, sesión, Origin/CSRF y recuperación. X2 no introduce contratos alternativos de negocio. El JSON del launcher es diagnóstico efímero de packaging y se reemplazará/versionará cuando llegue T-016. U-Q1/U-Q3 y U-H1/U-H2/U-H3 preceden al acoplamiento real; HF-1 requiere la calificación por target/capability/runtime de ADR-012. T-057 completo exige instalar el release operativo real y sus recursos, no solo este wheel vacío.

## Ola 1: fronteras públicas de los motores (X3)

Ola 2 X7b sustituye el proceso de prueba por API loopback y procesador separados.
Después de instalar el wheel: `dftlab-platform start --state-dir <ruta-local>`;
consultar `status`, detener con `stop`. Un base path opcional se pasa al arranque
con `--base-path /lab`. Seleccionar el `access.json` privado en el cliente X8;
caduca en 120 s y no debe copiarse al navegador mediante URL ni persistencia.
Si un crash deja la reserva, `recover-local` exige ambos locks libres y conserva
SQLite/artefactos. No usar directorios compartidos/NFS. El wheel no instala motores
ni acredita ejecución científica. La calificación instalada prueba el ciclo HTTP,
reinicio, identidad estable, sesión revocada y rechazo de reparación con API viva.

El lock actualizado fija commits fusionados en las ramas de integración de cada motor. Conserva `DRAFT_NOT_AN_OPERATIONAL_RELEASE`: disponer de una API pública y de consumidores CI no acredita una ejecución SIESTA, MPI, SSH, SLURM ni HF-1 real. Los informes `evidence/*_ola1.json` separan instalación, API importada y CLI de esas calificaciones pendientes. Los informes de Ola 0 permanecen intactos.

- **QRAFT:** importar `qraft.api` (`API_VERSION = "1.0"`). Es la ruta de composición, compilación, preparación, inspección y controlador canónico. Para compilar un mapping con el mismo digest que un archivo, aportar sus `source_bytes` originales; el motor verifica que describen el mismo mapping. Sin esos bytes, la representación JSON canónica declarada define una identidad distinta. Los locks antiguos no se recanonicalizan.
- **HubbardFlow:** importar `hubbardflow.api` (`API_VERSION = "1.0.0"`). Sus seis operaciones públicas devuelven resultados congelados y serializables; `get_schema()` recupera los schemas empaquetados. Estados futuros se conservan y no se convierten a PASS. Un resultado numérico no acredita validez física; `check_resume()` es una consulta pura y no concede reutilización por hashes coincidentes.
- **Autoridad QRAFT:** el callback de generación se comprueba antes de lanzar/publicar y la pérdida de autoridad queda enclavada. Es un punto de integración, sin garantía atómica de lease distribuido. El servicio/ejecutor posterior debe imponer la generación en el destino. No habilitar múltiples controladores basándose solo en ese callback.
- **Eventos:** UUID de stream, secuencia y cursor nativos persistentes. Los registros legacy se adoptan sin reescribir sus bytes; identidad perdida, truncado y JSON inválido se rechazan. El adaptador posterior relacionará este cursor con el contrato de eventos de plataforma; no debe inventar otro orden autoritativo.
- **Resume de scheduler:** exige evidencia firmada, vinculada a run/locks/asignación/job/cluster/usuario, caducidad y ausencia de asignación activa, mediante un verificador confiable. La afirmación booleana legacy no es evidencia admisible para reconciliación automática. El verificador real, su confianza y la consulta del scheduler quedan para la integración operativa.
- **Capabilities:** `qraft.integration` describe modos, destinos, cancel/resume y referencias de prueba mediante tipos versionados. Es declaración, no calificación ni autorización. El JSON del CLI QRAFT es diagnóstico no contractual; los consumidores usan la API pública y sus contratos nativos.

El adaptador de Olas 2/3 debe resolver los ArtifactRefs de C3 y traducirlos a records nativos sin duplicar el DAG ni las decisiones científicas. En particular, el backend estructurado de C3 y el identificador string nativo de HubbardFlow necesitan un codec explícito. HF-2/U-H5 permanece diferido; la licencia no cambia.

Para autoría desde una distribución instalada, usar `qraft.api.RunPreparer()` sin `repository_root`. Una ruta explícita selecciona el árbol legacy `src/qraft` y falla si falta; no cae silenciosamente al paquete instalado. La CLI legacy conserva sus invocaciones con `Path.cwd()` y no queda acreditada como autoría sin checkout. El paquete generado contiene el runtime de allocation y el cierre de imports del controlador, no el SDK completo `qraft.api`. Su consumidor aislado prepara/inspecciona el paquete, verifica ZIP y bindings nativos y deniega autoridad antes de ejecutar tareas. La preparación instalada registra procedencia Git desconocida como `null`; el adaptador debe adjuntar commit/distribución/hash del lock de motores, sin inventar un SHA desde el directorio actual.

Para repetir la instalación, usar los comandos del probe anteriores con un nuevo directorio de salida y el lock actual. Cuando contiene `public_api`, el probe comprueba también su versión y símbolos públicos con Python `-I`, fuera del checkout. Cualquier fallo de importación, API o CLI produce exit distinto de cero. Sigue usando CPython 3.12.10/uv 0.11.14 y el entorno separado de NumPy 1.26.4; no instalar estos motores en el entorno de referencias F.

En Ola 1 los motores se instalan en un venv temporal físicamente fuera del repositorio, con dependencias exportadas del lock y exigencia de hashes. El entorno del worktree se usa solo para construir. El consumidor verifica que el módulo procede del venv y queda fuera de la raíz de fuente; se elimina `PYTHONPATH`. En los informes históricos de Ola 0, `installed_outside_checkout` comprobaba importación del wheel y ejecución desde una carpeta temporal, aunque el venv de dependencias podía estar dentro del worktree. Esos informes no se reinterpretan como prueba de la ubicación física que ahora se exige.


## Calificación local de authoring/package (T-022b)

El wheel/sdist de platform lleva engine-versions.lock.json byte por byte. PinnedEngines exige los dos motores: comprueba SHA-256/tamaño de wheels, versión instalada, fuentes/recursos, API/símbolos y que el módulo importado proceda de esa instalación. Esta comprobación no es un sandbox frente a un usuario que pueda modificar el intérprete o sus caches; el entorno instalado debe administrarse privadamente. No constituye calificación de ejecución ni de ciencia.

El extra engines añade NumPy 1.26.4 y PyYAML 6.0.2 al lock de platform. Los motores no se resuelven por nombre/version de PyPI: se instalan por los wheels/hash de engine-versions.lock.json. La CI usa fixtures y no instala QRAFT/HubbardFlow.

Para repetir la prueba local, primero generar/calificar el wheel de platform con qualify_platform.py. Preparar un wheelhouse que contenga los dos wheels del target con sus hashes registrados, y un perfil nativo SLURM explícito para el sitio, sin credenciales. Desde la raíz:

```powershell
uv run --project platform --frozen python deployment/local/qualify_engines.py --wheelhouse runtime/wheelhouse --platform-wheel runtime/platform-qualification/artifacts/dftlab_platform-0.1.0.dev0-py3-none-any.whl --profile runtime/qualification/profile.json --pseudo app/tests/siesta/fixtures/pseudo/Si_lda_oncv.psml --output runtime/native-authoring-new
```

La salida debe ser una carpeta nueva en runtime/ ignorado. El script instala platform y ambos motores en un consumidor temporal físicamente fuera del checkout, sin PYTHONPATH, con dependencias exportadas del lock y hashes; uv pip check comprueba compatibilidad. El driver usa Python -I y solo las fachadas públicas: compone dos tareas Si (single point y dependencia de DM), compila, prepara e inspecciona. Conserva por separado los digests nativos y hashes de archivos/ZIP. Exporta evidencia privada y elimina solo el consumidor temporal creado por el script; no modifica SIESTA/SLURM ni trabajos del usuario. Nunca llama al scheduler ni ejecuta SIESTA.

El caso tiene parámetros explícitos de fixture, no defaults universales ni tolerancias de validación científica. REVIEW (UNKNOWN_LABEL/UNDECLARED_GOVERNED_VALUE) se conserva; el reporte dice NOT_ESTABLISHED y execution_performed=false. Esto verifica la distribución/API/authoring/package, no los gates T-022 runtime/T-023/T-059…062. No habilitar comandos HTTP ni anunciar una capability con este reporte.

En la observación local WSL, sbatch --test-only aceptó partition=local/account=default/qos=normal. QRAFT exige siesta_executable sin slash al renderizar el script; el perfil observado usa siesta con PATH explícito a la instalación MPI existente. El worker debe verificar cuál ejecutable resuelve, su hash/version/build y MPI/threads antes de ejecutar, mediante RuntimeProbeReceipt. No trasladar este perfil a otro sitio como configuración válida por defecto.

### Observación local del worker SLURM (T-023a)

`qualify_runtime_probe.py` se ejecuta explícitamente con Python POSIX 3.12.10,
instalando el wheel de platform en un venv externo y usando `python -I`.
No envía trabajos ni lanza MPI. En WSL el directorio nuevo de evidencia debe
estar en el filesystem Linux privado, no bajo `/mnt/c`.

```sh
/path/to/installed/venv/bin/python -I deployment/local/qualify_runtime_probe.py \
  --config /private/operator-probe.json \
  --profile-bytes /private/original-profile.json \
  --output /private/new-probe-evidence
```

La configuración pertenece al operador y nunca se acepta como comando HTTP.
Tiene exactamente `project_id`, `profile_id`, `revision`, `partition`, `node`,
`ranks`, `threads_per_rank`, `memory_mb`, y los pins `executable`, `mpi`, `sinfo`,
`scontrol`, `sbatch`. Cada pin contiene `path` absoluto y `sha256` de los bytes
resueltos; `mpi` es null para serial con un único rank. La calificación local
actual observa una partición con un solo nodo IDLE; no interpreta hostlists
remotos ni modifica SLURM. No ejecuta module commands; cualquier perfil que
los necesite requiere una calificación posterior.

Se preserva el nombre de invocación de aliases verificados como mpirun/orterun.
Se comprueban los pins antes de ejecutar diagnósticos y al terminar; cada
comando tiene límites de tiempo y salida, sin shell ni stdin. Se prueba
almacenamiento privado local, fsync de archivo/directorio y renombrado. Los
recibos usan el schema original RuntimeProbeReceipt y caducan en 15 minutos.
Los detalles y hashes se conservan en evidencia privada, sin publicarlos en CI.

El hash del perfil correlaciona bytes, **no valida su política nativa**. Ranks
son la reserva solicitada; `MPI_RANK_EXECUTION` permanece NOT_ESTABLISHED hasta
una ejecución real. Una observación de binarios no verifica librerías dinámicas,
no es un sandbox frente al propio operador, no acredita resultados científicos
y no habilita listCapabilities/admisión. T-023 sigue abierto hasta el worker,
el envío durable, fencing y una corrida real calificada. Los tests de CI usan
pins sintéticos y un puerto de diagnósticos; no requieren motores ni scheduler.

### Handlers tipados sobre artefactos (T-022c)

`AuthoringHandlers` se registra explícitamente en un `Processor`. El servicio
predeterminado conserva las operaciones científicas deshabilitadas y ninguna
capability de ejecución. Las cuatro acciones originales conservan los payloads
C3 y confirman producto, operación, evento y outbox mediante `complete_local`.
El borrador se lee por su revisión histórica autorizada. El snapshot, fuentes,
reportes nativos, lock y ZIP se verifican y persisten antes de confirmar SQL;
los artefactos huérfanos de una interrupción se conservan para recuperación.

`QraftArtifactAuthoring` acepta recetas y perfiles registrados por el operador.
Sus entradas son referencias de artefactos del mismo owner/proyecto; las rutas
relativas se materializan solo en scratch privado creado por el adaptador.
QRAFT posee compilación, gramática/preflight, digests y preparación/inspección.
El módulo público `qraft.contracts` de la instalación fijada serializa los
reportes originales; se conserva cada `REVIEW`, diagnóstico y digest nativo.
La metadata extensible del lock contiene la vinculación a snapshot y fuentes
para reconstruir el paquete sin depender del editor ni de archivos del checkout.
No se inventan consultas/productos HTTP: su contrato espera C3, issue #35.

Para probar esta integración instalada sin ejecutar motores de cálculo:

```powershell
uv run --project platform --frozen python deployment/local/qualify_engines.py --case handlers --wheelhouse runtime/wheelhouse --platform-wheel runtime/platform-qualification/artifacts/dftlab_platform-0.1.0.dev0-py3-none-any.whl --profile runtime/qualification/profile.json --pseudo app/tests/siesta/fixtures/pseudo/Si_lda_oncv.psml --output runtime/native-handlers-new
```

El driver crea un borrador `USER_AUTHORED/EXPLORATORY` específico de Si, con
modelo y parámetros explícitos, y ejecuta VALIDATE_INPUT, CREATE_CAMPAIGN,
CREATE_PLAN y PREPARE_PACKAGE. Conserva operaciones, snapshot, fuentes y
reportes originales en `evidence/` además del lock y ZIP. Es una receta local
acotada, no un traductor general ni un default científico. En Windows y WSL
se instalan ambos motores por los hashes de sus respectivos targets, siempre
en un consumidor externo y con Python `-I`; en WSL usar Python 3.12.10 y uv
0.11.14 ya instalados. No necesita SIESTA ni SLURM para autoría/preparación.

El nuevo caso usa `SCF.DM.Tolerance 1.e-5`: el manual oficial de [SIESTA 5.4](https://docs.siesta-project.org/projects/siesta/en/5.4/reference/siesta.html#convergence-criteria)
confirma la etiqueta canónica y compatibilidad con `DM.Tolerance`. El registro
fijado de QRAFT reconoce la primera. Cambia la etiqueta, conserva exactamente
el valor y los reportes `REVIEW` anteriores; no modifica tolerancias de gates
ni acredita convergencia/ciencia. El resultado conserva `NOT_ESTABLISHED`.
Runtime, admisión, fencing, SLURM real y recuperación/restore siguen sujetos a
sus pruebas separadas; no habilitar capabilities a partir de esta evidencia.
### Autoridad local y publicación transaccional (T-025a)

`LocalAuthorityManager` mantiene un lock del kernel por proyecto/run durante
la vida completa del controlador, incluido su shutdown. `SQLiteAuthorityStore`
implementa el puerto `AuthorityStore`; guarda el ControllerAuthorityRecord
original, autoriza owner/proyecto y comprueba identidad exacta, generación,
expiración UTC y reloj interno. El guard añade deadline monotónico y pérdida
sticky. Heartbeat, callback y publicación están serializados dentro del proceso.

El callback se puede conectar al `authority_check` público fijado de QRAFT;
comprueba generación y vincula el primer fingerprint nativo opaco del
controlador registrado, sin recalcularlo. El lock se mantiene fuera del
callback. `publish(writer)` exige un escritor SQL interno de confianza: verifica
antes y después en la misma transacción y revierte si la autoridad cambia o
vence durante la escritura. Los bytes se preparan/fsync antes; archivos/eventos
brutos del motor no pasan a ser publicación autoritativa por existir.

Este bloque califica solamente la base local con fixtures y procesos de prueba.
El recibo usa SITE_LOCK/checked_at=NONE y automatic_takeover=DISABLED: no afirma
haber comprobado el controlador real donde lanza/publica ni ofrece un endpoint.
Un registro existente, incluso vencido o tras caída de proceso, impide adquirir
otro controlador. Cerrar el guard libera el kernel, conserva la identidad SQL
y no demuestra que hayan terminado MPI, launchers o jobs. No borrar lockfiles
ni retirar leases para desbloquear un run. Terminación verificada y recuperación
explícita quedan para los bloques de runtime/restore; no se habilita takeover.

Todas las instancias del mismo store deben usar el mismo directorio privado de
locks local. No usar SQLite/locks bajo /mnt/c, NFS/SSHFS/SMB para el worker WSL.
Este mecanismo no anuncia fencing distribuido en sitios remotos. La CI prueba
rechazo de un segundo proceso, caída real, lease vencida, generación vieja,
rollback por expiración durante publicación y concurrencia con heartbeat,
sin motores, scheduler o datos del usuario.

### Gateway de envío durable (T-024a / T-058a)

`DurableSubmissions` es un puerto interno para un adaptador de sitio calificado;
no se registra en el servicio predeterminado ni sustituye preparación/admisión.
Usa EffectIntent y SubmissionReceipt originales. El adaptador registrado posee
paquete/perfil verificados, argv administrado, observaciones privadas y prueba
de correlación completa por token, usuario, clúster y contexto del paquete.
Esta base no ejecuta sbatch ni acredita que exista ese adaptador calificado.

`SQLiteSubmissionLedger` reserva un native run_id único y su attempt token en
la misma transacción FULL/WAL que EffectIntent, bajo claim/revisión originales.
Después confirma DISPATCH_STARTED antes de llamar al scheduler exactamente una
vez. No es una promesa de exactly-once remota: un crash puede dejar el envío
incierto. Se conserva UNKNOWN y no se vuelve a entrar al puerto submit, aun
con timeout o consulta vacía. Otro comando para el mismo paquete/run se rechaza
antes de confirmar su intent/reserva; preparar otro paquete crea otro RunID.
Resume/retry requieren el flujo explícito y evidencia terminal, todavía pendiente.

Un ack ACCEPTED verificado queda duradero antes de cerrar la Operation; si se
pierde el commit de la operación, ese ack confirma que ocurrió el submit y se
reconcilia como RECONCILED_FOUND sin cambiar la identidad del job. No establece
su estado actual, terminación, integridad de resultados ni ciencia. Sin ack, el
puerto de solo lectura debe probar la presencia; None conserva UNKNOWN. RESERVED
tras una caída conserva incertidumbre: no se fabrica ausencia desde una DB que
podría proceder de restore. Los seis campos del intent y las referencias nativas
se preservan; generaciones/paquetes ajenos, inputs mutados y recibos inválidos
no confirman éxito. El retiro/restore y evidencia positiva de ausencia quedan
para recuperación calificada, nunca se inferirán de una cola vacía.

La CI usa un scheduler sintético y procesos de prueba que mueren con os._exit
antes de intent, después del commit y después de un efecto externo simulado.
Comprueba persistencia, exclusión concurrente, rollback de reserva duplicada,
ack perdido y reconciliación sin reenvío. No presenta estos tests como caídas
SLURM reales, SIESTA convergente o fencing del controlador nativo.

### Puerto local SLURM y diagnóstico real (T-024b / T-058b)

`SlurmSchedulerPort` requiere un sitio registrado por el operador, pins de
sbatch/scontrol/squeue, identidad POSIX, paquete/script verificados y escritor
privado de evidencias. Cada observación acotada se conserva como ArtifactRef
original con hash. Se correlacionan clúster, usuario/UID, token, JobName,
WorkDir, Command y SubmitTime observado en UTC. Un único gate durable
`SQLiteSubmissionLedger.enter_rpc` comprueba claim activo y confirma la entrada
antes del RPC; una segunda entrada se rechaza incluso después de una caída.
Errores/ack ambiguo o cola vacía conservan incertidumbre, sin reenvío.

Solo para esta laptop WSL local, con reloj y sitio compartidos. No acredita
historia terminal, arrays, sitios remotos ni ausencia tras restore. El script
del worker puede estar junto al paquete nativo para conservar su manifiesto
original, pero debe ser registrado/verificado por el operador; nunca se recibe
una ruta de ejecución del cliente HTTP. No se habilitan endpoints/capabilities.

`qualify_slurm_gateway.py` es un diagnóstico **explícito**, fuera de tests/CI.
Desde un consumidor WSL Linux privado con Python 3.12.10, instalar el wheel de
platform y ambos wheels fijados del target WSL: exportar dependencias con
`uv export --project platform --frozen --no-dev --no-emit-project --extra engines`,
instalarlas con `uv pip install --require-hashes -r ...`, luego los tres wheels
con `--no-index --no-deps` y comprobar `uv pip check`. Ejecutar con Python `-I`,
sin PYTHONPATH ni checkout en sys.path. No reinstalar/configurar SIESTA/SLURM.

El JSON privado `--config` contiene exactamente `sbatch`, `scontrol`, `squeue`
(cada uno `{path, sha256}` observado del binario instalado), `cluster`,
`remote_user`, `uid`, `partition`, `account` y `qos`, aprobados por el operador.
El directorio `--output` debe ser nuevo y privado sobre Linux local; conservar
DB, artefactos, logs y resultado. No versionar configuración/evidencia real.

```sh
/ruta/consumidor/bin/python -I /ruta/qualify_slurm_gateway.py --config /ruta/site.json --wheelhouse /ruta/wheelhouse-wsl --output /home/usuario/.local/state/dftlab-qualification/caso-nuevo
```

El harness crea un PLAN sintético solo para diagnóstico del scheduler, no una
campaña científica admitida. Prueba muerte de proceso antes del intent, tras
su commit y después de aceptación real antes de guardar el ack. Solo los dos
últimos casos con RPC lanzan jobs: un CPU, 128 MB, límite de un minuto y sleep
de 30 segundos; sin MPI/SIESTA. Después de perder el ack, solo consulta por
token/contexto. Si no puede demostrar el job, falla y conserva UNKNOWN: no
reenvía. El recibo forense de inyección no se usa como prueba de reconciliación.
Se conservan NOT_ESTABLISHED y la separación submit/lifecycle/science. Este
diagnóstico no cierra P4, ni acredita admisión, controlador nativo, terminal,
fencing nativo, checkpoint/restore o calificación científica.

### Host de controlador instalado y Si real (T-023b / T-025b)

`NativeWorker` es un proceso dedicado dentro de la reserva, separado del API.
Recibe un `RegisteredNativeRun` interno de confianza con identidades/digests
nativos originales, probe vigente del mismo proyecto/perfil y callbacks
obligatorios que verifican bytes del paquete y correlación con la allocation.
Estos callbacks no son parámetros de HTTP. No se registra en el servicio
predeterminado ni sustituye la admisión. Ambos motores instalados son necesarios.

Inspecciona mediante la fachada QRAFT fijada, valida run/workflow/profile y
mantiene el lock local durante `CanonicalController.from_file(...).run()`.
El heartbeat renueva la autoridad; perderlo pide shutdown, impide publicar y
conserva la identidad SQL. Generación/fingerprint se verifican por el callback
nativo. El puerto de publicación prepara/fsync los bytes originales mediante
el serializador público y ejecuta solo el writer SQL en `authority.publish`.
Resultado técnico y decisiones científicas nativas permanecen intactos;
el resumen conserva `NOT_ESTABLISHED`. No hay takeover automático ni resume.

Para calificación explícita, `qualify_native_runtime.py` exige consumidor WSL
externo instalado con el procedimiento de hashes anterior y Python 3.12.10
`-I`. Reutiliza SIESTA/SLURM existentes. El config privado añade a las claves
del diagnóstico `siesta`, `mpi`, `sinfo` (pins `{path, sha256}`) y `node` observado.
El perfil nativo es una identidad/revisión nueva: el caso local pide un nodo,
cuatro ranks, un thread/rank, 512 MB, diez minutos y una tarea simultánea,
sin módulos. Su environment contiene exactamente PATH, QRAFT_PYTHON del
consumidor instalado, OMP_NUM_THREADS=1, OPENBLAS_NUM_THREADS=1 y MKL_NUM_THREADS=1.
No cambiar el perfil anterior ni la física/tolerancias para repetir el caso.

```sh
/ruta/consumidor/bin/python -I /ruta/qualify_native_runtime.py --config /ruta/site.json --wheelhouse /ruta/wheelhouse-wsl --profile /ruta/perfil-nuevo.json --pseudo /ruta/Si_lda_oncv.psml --output /home/usuario/.local/state/dftlab-qualification/caso-nuevo
```

El driver crea un borrador USER_AUTHORED/EXPLORATORY de Si con el protocolo
exacto anterior, pasa las cuatro operaciones de autoría y prepara el ZIP nativo.
Verifica entradas seguras y bytes de todas sus entradas antes y después; no
modifica el paquete. Un script hermano conserva las directivas SBATCH nativas
y llama al worker instalado. EffectIntent y entrada RPC preceden a sbatch;
workflow/run NativeContractRefs originales atraviesan el recibo. Un probe
fresco antecede al envío. Una segunda adquisición de autoridad en proceso
separado debe ser rechazada mientras el primer worker está activo.

Se ejecutan single point y derivada con transferencia de DM mediante el DAG
nativo; no se implementa un segundo scheduler. Se retienen stdout/stderr,
manifiestos, archivos/eventos nativos, perfil, SQLite, hashes, recibos y reporte
incluso si falla; un timeout nunca reenvía. El original incluye NOT_EVALUATED y
PROVISIONAL_UNTIL_REAL_OUTPUT_IMPORTED donde los emite QRAFT: no se sustituyen
por validación científica. Los límites de archivos/tamaño son política acotada
del harness, no SLA medido. Esta prueba no acredita terminal, acceso remoto,
restore/resume, finalización completa, admisión, calificación científica ni P4.
