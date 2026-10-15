# P-7: único run real enviado desde navegador

- Código de plataforma: `ec2ae09a446f7f6b966dec1f49bde7bb327a028c`; wheel `90f4d5e3158e7b919cdbc117e95643e6a248745bfdb49734658b7c6b607d72d9`, instalado fuera del checkout.
- Proyecto `513700c8-095a-48fe-832f-80ae9c16eb03`; operación `0f72d9e8-107d-4e7f-b4d0-bd3c436e5b7e`; run `42ac02f3-7069-4507-ba3a-ef273a553278`; job SLURM `460`.
- Cuenta única `5ce444c1-a49c-4549-b423-335038ba4137`: capacidad 480 `allocated_cpu_second`, vencimiento `2026-10-16T06:27:26.832091Z`, una reserva de 480 y un despacho. No se volvió a enviar.
- Perfil nuevo de dos minutos: `1f3742c9c66f918c53381194fdbbdb27e4a10c26bac65182a6faaa7be3abb223`. `setup.json`, `start.json` y `history-preflight.json` registran copia nueva, SHA antes del arranque, `DFTLAB_PROFILE`, wheel y consulta al job 440 por el adaptador. El perfil v2 de diez minutos conserva `fcd98dca...d7b1e8`.

## Ejecución y continuación de lectura

Se ejecutó una sola vez:

```powershell
node deployment/local/qualify_local_run_browser.mjs --state-dir /home/jmc/.local/state/dftlab-platform/si-browser-p7-480-20261015 --access-file /home/jmc/.local/state/dftlab-platform/si-browser-p7-480-20261015/access.json --output-dir deployment/local/evidence/si-browser-p7-authorized-480-20261015 --cpu-seconds 480 --python /home/jmc/.local/state/dftlab-qualification/p7-browser-ec2ae09-20261015/venv/bin/python --timeout-ms 120000
```

El navegador promovió la plantilla, validó, creó campaña y plan, recargó entre plan y paquete, preparó el paquete y solicitó el envío. `browser-local-run.json` conserva el resultado `FAILED_NO_RESUBMIT`: el arnés esperó la admisión antes de abrir el enlace de la página del run, donde la interfaz obtiene ese artefacto. El envío ya había terminado `SUCCEEDED`; el job 460 completó en ocho segundos y el servicio finalizó a `2026-10-15T06:27:42.394775Z`, con evidencia terminal firmada y recibo `PUBLISHED`. La espera de 120 segundos del arnés no es tiempo del cálculo.

La continuación fue exclusivamente de lectura del mismo run mediante `read_existing_run_browser.mjs`. El primer intento reutilizó un bootstrap de un solo uso y no inició sesión; el segundo encontró una carrera del arnés al comprobar la captura antes de llegar la respuesta de contenido. Ambos informes fallidos se conservan en los directorios `si-browser-p7-run460-readonly-20261015` y `si-browser-p7-run460-final-20261015`. Se corrigió el arnés para esperar la respuesta concreta; no se cambiaron límites ni pruebas de producto. Se reinició solo este servicio ya finalizado para emitir un bootstrap nuevo; no se alteró el mecanismo de seguridad ni se repitió el cálculo.

Las lecturas `si-browser-p7-run460-final2-20261015` y `si-browser-p7-run460-final3-20261015` pasan con cero solicitudes mutadoras de la aplicación y cero errores, antes y después de recargar. Ambas obtienen `getRun` HTTP 200 con SHA-256 `fcce55e0bfb4049a8675d69a72f5e92308cdf62b33128017b69b30ee299f3c19`. `final3` incluye capturas de la visión general y de la finalización visible. El arnés de envío se corrigió para abrir el run antes de esperar su admisión; no se volvió a ejecutar sobre otro cálculo.

## Evidencia y límites

`database-readonly.json` usa SQLite en `mode=ro`: una fila `resources.kind=RUN`, una cuenta, una reserva y un despacho. `operations.json` es un resumen público explícitamente redactado de las cinco operaciones `SUCCEEDED`: omite el recibo de envío anidado y su token de correlación; no se presenta como OperationRecord/SubmissionReceipt nativo ni conserva sus sellos. Los registros autoritativos de la base/API permanecen intactos. `lru-view-verdict.json` construye el modelo con la respuesta real `getRun`: `COMPLETED_SCIENCE_NOT_ESTABLISHED`, sin reanudación ni uso científico del resultado. No son vectores nuevos.

`recipe-comparison.json` confirma que los dos FDF del paquete tienen los mismos bytes que los de 459. `artifacts-index.json` verifica hashes/tamaños de los 35 artefactos del proyecto; los JSON y el paquete se copian en `public-artifacts`. Las matrices de densidad quedan guardadas en el servicio con sus hashes, sin duplicarlas en Git. La lectura del navegador verificó admisión, resultado nativo, finalización y evidencia terminal firmada. No se exportan tokens, cookies, bases SQLite ni la clave del firmante.

Limitaciones aceptadas en #110: la regla reserva CPU pedidas (`1×4×120=480`) aunque SLURM asignó ocho, y dos contenidos comparten `profile_id`/revisión 1; el SHA de cada run los distingue. No se cambia aquí la regla ni el contrato. Ciencia `NOT_ESTABLISHED`, capability de ejecución sin publicar, reanudación/HF-1 deshabilitadas. 457/458 siguen no verificados y 459 conserva su evidencia.
