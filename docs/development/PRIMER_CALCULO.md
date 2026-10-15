# Primer cálculo de Si desde la plataforma local

Esta guía ejecuta la receta fija de Si diamante con SIESTA 5.4.2 en el perfil WSL/SLURM calificado. La ejecución sirve para comprobar el recorrido de la plataforma y se presenta como `NUMERICAL_CANDIDATE`; la ciencia permanece `NOT_ESTABLISHED`.

## Requisitos locales

Ejecuta estos comandos dentro de WSL como el usuario que posee el perfil y la configuración del sitio. El Python seleccionado debe tener instalada la versión de `dftlab-platform` que vas a probar y QRAFT debe resolver desde ese mismo entorno. El directorio de wheels debe contener los wheels fijados de QRAFT y HubbardFlow verificados por `engine-versions.lock.json`.

```bash
export DFTLAB_STATE="$HOME/.local/state/dftlab-platform/si-browser-p7-480-20261015"
export DFTLAB_PYTHON="$HOME/.local/state/dftlab-qualification/p7-browser-ec2ae09-20261015/venv/bin/python"
export DFTLAB_SITE="$HOME/.local/state/dftlab-qualification/t023b-consumer-v1/config.json"
export DFTLAB_PROFILE="$HOME/.local/state/dftlab-platform/si-browser-p7-2min-profile-20261015.json"
export DFTLAB_PSEUDO="/mnt/c/Users/Jairo/Downloads/DFTQUANTUMLAB/dftlab-suite-corte-p6/app/tests/siesta/fixtures/pseudo/Si_lda_oncv.psml"
export DFTLAB_WHEELHOUSE="$HOME/.local/state/dftlab-qualification/p6-pinned-wheelhouse"
```

Esta calificación usa una copia nueva del perfil de dos minutos recuperado de 459: SHA-256 `1f3742c9c66f918c53381194fdbbdb27e4a10c26bac65182a6faaa7be3abb223`, un nodo y cuatro CPU pedidas. Comprueba esa huella con `sha256sum "$DFTLAB_PROFILE"` antes de iniciar el servicio. Conserva intacto el archivo de diez minutos `t060a-authoring-v2/profile.json`; no lo uses con esta cuenta de 480. Cada run guarda el SHA de su perfil, porque ambas copias conservan el mismo `profile_id` y revisión 1.

El iniciador comprueba los archivos, hashes de los ejecutables del sitio, perfil, pseudopotencial y wheels. Si alguna huella no coincide, no habilita la ejecución.

## Historial terminal en WSL

La ruta calificada usa el `wsl.exe` nativo de Windows para ejecutar únicamente `sacct --completion --jobs=<dígitos>` como root, con argv fijo y comprobación del SHA de `wsl.exe` y `sacct` en cada llamada. El resto de las consultas usa el usuario local. No cambies permisos, `wsl.conf` ni la configuración del sitio.

Comprueba `ls /proc/sys/fs/binfmt_misc` y `cat /proc/sys/fs/binfmt_misc/WSLInterop`. Debe indicar `interpreter /init`, `flags: PF`, `offset 0` y `magic 4d5a`. Solo si falta `WSLInterop`, la línea temporal autorizada por Manuel es:

```bash
echo ':WSLInterop:M::MZ::/init:PF' | sudo tee /proc/sys/fs/binfmt_misc/register
```

Repite las dos consultas después. Si los cuatro valores no coinciden, retira la entrada con `echo -1 | sudo tee /proc/sys/fs/binfmt_misc/WSLInterop` y avisa. Este registro se pierde al reiniciar WSL: hay que volver a comprobarlo y repetir la línea si falta. Si no hay sudo sin contraseña en la sesión, debe intervenir Manuel.

Antes de admitir, el servicio prueba la ruta de historial con una consulta de solo lectura al job 440. Si no responde, devuelve `REJECTED` con motivo `ruta de evidencia terminal no disponible`, sin reserva ni job.

## Iniciar el servicio

```bash
"$DFTLAB_PYTHON" -I -m dftlab_platform.launcher start \
  --state-dir "$DFTLAB_STATE" \
  --local-run \
  --site-config "$DFTLAB_SITE" \
  --profile "$DFTLAB_PROFILE" \
  --pseudo "$DFTLAB_PSEUDO" \
  --wheelhouse "$DFTLAB_WHEELHOUSE"
```

El comando imprime un objeto JSON con `status` y `url`. Abre esa URL en el navegador. En **Seleccionar archivo de acceso del iniciador**, elige `$DFTLAB_STATE/access.json`; el archivo solo se guarda mientras el servicio está activo.

## Registrar el presupuesto

Después de iniciar sesión, crea un proyecto o selecciona uno existente. En el panel **Primer cálculo local**, copia el ID visible del proyecto. La cuenta autorizada para esta corrida es exactamente `480 allocated_cpu_second`, vence en 24 horas y se usa para un solo run: `1 × 4 × 120 = 480` según la regla de reserva vigente. No aumentes su capacidad ni la reutilices para otro run.

```bash
"$DFTLAB_PYTHON" -I -m dftlab_platform.launcher budget add \
  --state-dir "$DFTLAB_STATE" \
  --project '<ID visible del proyecto>' \
  --cpu-seconds 480 \
  --expires-hours 24
```

Copia el `budget_id` del JSON impreso y pégalo en **Presupuesto local**. La cuenta pertenece al proyecto y no se puede ampliar desde la interfaz. Las limitaciones aceptadas sobre CPU pedidas frente a `AllocTRES` y la identidad compartida de los perfiles constan en [#110](https://github.com/Jairomcarmona/dftlab-suite/issues/110#issuecomment-6185951454); esta guía no cambia el contrato ni la regla de reserva.

## Ejecutar el flujo

En **Primer cálculo local**, sigue los pasos numerados: crea el borrador **Si de la receta local**; valida la entrada; crea la campaña; crea el plan QRAFT; prepara el paquete; selecciona el único perfil WSL/SLURM admitido; y solicita admisión y envío. Esa plantilla usa una celda de diamante de 2.7155 Å, igual a la receta local, y no modifica el fixture compartido de aprendizaje. La pantalla indica el estado de cada paso y muestra el recibo de admisión. `ADMITTED` incluye la finalidad `EXPLORATORY`; `REJECTED` muestra sus motivos antes de cualquier envío.

El catálogo `listCapabilities` no anuncia la ejecución. La receta y el perfil del modo local determinan la admisión según el presupuesto: `ADMITTED` muestra la finalidad `EXPLORATORY` y `REJECTED` muestra sus motivos. La interfaz presenta ese recibo sin depender del catálogo ni añadir campos públicos.

Cuando existe un run, el botón de la lista abre su detalle a pantalla completa y la recarga vuelve a abrir el último run elegido. El detalle muestra la proyección y sus cuatro dimensiones con fuente y hora de observación. Los eventos y artefactos se pueden desplegar; cada artefacto muestra el tipo, el SHA-256 registrado y la acción de descarga. La interfaz comprueba la integridad del registro al mostrarlo y verifica el SHA-256 del contenido al descargarlo. El recibo de admisión y el resultado original de QRAFT se leen automáticamente y se presentan sin modificar; la ciencia sigue `NOT_ESTABLISHED`.

Recargar la página vuelve a consultar campañas, planes, operaciones y runs desde la API. Las operaciones activas se retoman con `getOperation`. `OUTCOME_UNKNOWN` queda visible y requiere revisar la operación; no vuelvas a enviar la misma acción por un timeout.

## Archivos y reinicio

Los datos durables están bajo `$DFTLAB_STATE`: `state.sqlite` contiene los registros de control; `artifacts/` conserva los bytes de evidencia; `runs/` contiene los paquetes y archivos de trabajo; `probe-workspace/` y `authoring/` guardan material de trabajo privado. El iniciador crea el directorio con permisos restringidos. No edites esos archivos ni la base de datos manualmente.

Para detener el servicio de forma cooperativa:

```bash
"$DFTLAB_PYTHON" -I -m dftlab_platform.launcher stop --state-dir "$DFTLAB_STATE"
```

Para reiniciarlo tras un corte, usa el mismo comando `start` y conserva exactamente el mismo `--state-dir`. El servicio recupera los registros existentes y reconcilia los runs; no vuelve a enviar un trabajo cuyo resultado de envío sea incierto. Si `status` informa `unknown`, no inicies una segunda instancia. `recover-local` solo se usa cuando el proceso anterior terminó y el iniciador confirma que los bloqueos locales están libres:

```bash
"$DFTLAB_PYTHON" -I -m dftlab_platform.launcher status --state-dir "$DFTLAB_STATE"
"$DFTLAB_PYTHON" -I -m dftlab_platform.launcher recover-local --state-dir "$DFTLAB_STATE"
```

Tras el reinicio, abre la URL que imprime `start` y selecciona el nuevo `access.json`. La lista del proyecto y la vista del run se reconstruyen desde la API.
