# Instalación local de la base de platform/ (X2)

Esto acredita empaquetado, importación y ciclo de un proceso vacío. No hay API HTTP, cálculo real, DAG de plataforma, persistencia, SQLite, sesión, CSRF, SSH ni workers. T-057 empieza con una instalación de wheel fuera del checkout; la instalación operativa completa requiere las entregas posteriores. HubbardFlow será obligatorio bajo QRAFT en el runtime operativo conforme al ADR-015, conservando un paquete externo fijado, pero aún no hay integración científica.

## Compilar y calificar desde fuente

Usar CPython **3.12.10** y uv **0.11.14**. Los requisitos del build están fijados en `platform/uv.lock`, separado del entorno de referencias científicas F.

```powershell
uv python install 3.12.10
uv sync --project platform --locked --python 3.12.10
uv run --project platform --locked python -X utf8 deployment/local/qualify_platform.py
```

El script genera un wheel, sdist, logs y `report.json` en `runtime/platform-qualification/`. Exige directorio de salida nuevo; para otra ejecución usar `--output runtime/platform-qualification-2`. Instala únicamente ese wheel (`--no-index --no-deps`) en un venv temporal fuera del repositorio, elimina `PYTHONPATH` y ejecuta las pruebas copiadas con Python `-I`. Comprueba versión, procedencia de importación, entry point, arranque exclusivo, estado, parada idempotente y reinicio. Verifica que las fuentes no cambiaron. La CI propia repite exactamente esta calificación en Windows 2022 y Ubuntu 24.04, sin secretos ni paquetes reales de motores.

En WSL usar **un entorno diferente del `.venv` nativo Windows**:

```bash
export UV_PROJECT_ENVIRONMENT="$PWD/runtime/platform-venv-wsl"
uv sync --project platform --locked --python 3.12.10
uv run --project platform --locked python -X utf8 deployment/local/qualify_platform.py --output runtime/platform-qualification-wsl
```

Si el worktree fue creado por Git de Windows, sus rutas `.git` pueden no ser legibles para Git Linux. Se puede pasar `--source-commit SHA_COMPLETO_LEIDO_CON_GIT_WINDOWS` para la procedencia. Ese modo registra el SHA como aportado y `source_tree_dirty: null`; **no** declara un checkout limpio y sigue verificando los hashes de los archivos reales. Los jobs CI usan Git directamente y no ese override. Desde un checkout Git Linux normal no hace falta.

## Instalar el artefacto sin checkout ni PYTHONPATH

Descargar el wheel del artefacto CI y su informe, o copiar el generado arriba. Verificar su SHA-256 contra el `report.json` de **esa ejecución y target**. El wheel no depende de `app/` ni de una copia de fuente.

Windows PowerShell, desde una carpeta ajena al repositorio:

```powershell
Get-FileHash .\dftlab_platform-0.1.0.dev0-py3-none-any.whl -Algorithm SHA256
uv venv --python 3.12.10 .venv
uv pip install --python .venv\Scripts\python.exe --no-index --no-deps .\dftlab_platform-0.1.0.dev0-py3-none-any.whl
.\.venv\Scripts\dftlab-platform.exe start --state-dir .\launcher-state
.\.venv\Scripts\dftlab-platform.exe status --state-dir .\launcher-state
.\.venv\Scripts\dftlab-platform.exe stop --state-dir .\launcher-state
```

Linux/WSL, también fuera del repositorio:

```bash
sha256sum dftlab_platform-0.1.0.dev0-py3-none-any.whl
uv venv --python 3.12.10 .venv
uv pip install --python .venv/bin/python --no-index --no-deps ./dftlab_platform-0.1.0.dev0-py3-none-any.whl
.venv/bin/dftlab-platform start --state-dir ./launcher-state
.venv/bin/dftlab-platform status --state-dir ./launcher-state
.venv/bin/dftlab-platform stop --state-dir ./launcher-state
```

El resultado JSON siempre incluye `scope: process-placeholder`. No hay `/health` de un servicio ni endpoints de negocio. Una reserva abandonada no se roba: `start` falla y `status` informa starting/unknown; la recuperación operativa se diseñará en X6/X7. No borrar archivos de una instancia mientras pueda estar viva ni reutilizar este lease para jobs. El esqueleto no mantiene autoridad de ejecución.

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
