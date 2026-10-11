# ADR-008: servicio local seguro, terminal SSH y autorización por recurso

Estado: **aceptado** el 2026-10-11 (T-007). Sustituye el diseño de puente de [ARQUITECTURA.md](../../ARQUITECTURA.md) §8 (token impreso al arrancar). Implementación pendiente: T-018…T-021.
Fecha: 2026-10-11. Fuente: [propuesta maestra](../../PROPUESTA_MAESTRA_DFTLAB_V2.md) §6.4, §15, §25.5.

## Contexto

El navegador no puede abrir SSH. `ARQUITECTURA.md` §8 planeaba un puente `dftlab_bridge.py` en 127.0.0.1 con un token impreso al arrancar y `session.run('sbatch …')` como forma de lanzar trabajos. Ese diseño deja el token en URL o logs, no verifica origen y convierte la terminal en mecanismo de ejecución.

## Decisión

1. **Servicio local:** bind solo a loopback; Host y Origin verificados exactamente. Loopback no es autenticación.
2. **Sesión:** bootstrap de un solo uso con caducidad que establece la sesión; el token no va en query string, logs ni `localStorage`. Cookies HttpOnly/SameSite (o mecanismo local equivalente probado), CSRF en HTTP y autenticación + Origin en WebSocket. No se autoriza el origen `null`: el HTML `file://` no accede al servicio; el launcher abre la distribución operativa servida (ADR-001).
3. **Identidad desde el modo local:** hay un principal autenticado y owner de proyecto verificable desde P3, aunque haya un solo usuario. Se prueba con dos identidades sintéticas.
4. **SSH:** claves gestionadas por servicio/agente, nunca por la página; verificación de host con known_hosts (nunca `known_hosts=None`); cambios de clave de host se presentan con huella y no se aceptan solos. ProxyJump/MFA solo donde el runtime los soporte y declarados.
5. **Terminal:** xterm.js con PTY, resize, Ctrl-C, reconexión del mismo owner y cierre limpio. Cerrar la terminal no cancela un batch. La terminal libre es **capacidad privilegiada explícita**; no se presenta como read-only ni como contenida por los controles de paths de la API. Se auditan apertura, owner y host lógico, no el contenido.
6. **Ejecución:** los workflows usan `SchedulerGateway` y paquetes declarados (ADR-003/007). `session.run` queda solo como acción manual de terminal, no como mecanismo de DAG. Argumentos por argv/scripts administrados; nunca interpolar texto importado en shell.
7. **Fachada compatible:** se conserva `remote.available` y `connect(hostOrProfile) → Promise<Session>` con `terminal`, `put`, `get`, `run`, `close`; sesiones independientes, sin singleton global. `get` con `ArrayBuffer` solo para archivos pequeños con límite; los grandes usan transferencia por stream.
8. **Web (P9):** autorización por proyecto, campaña, archivo, run, terminal y perfil en cada operación; roles lectura, edición científica, ejecución y administración; sin ssh-agent global compartido; control de hosts permitidos contra SSRF.
9. Modificación manual detectada sobre archivos administrados invalida los recibos afectados.

## Alternativas

| Opción | Motivo para no adoptarla |
|---|---|
| Puente con token impreso (diseño de §8) | Token expuesto; sin CSRF ni verificación de origen. |
| Permitir `file://` (origen `null`) | Cualquier página local podría usar el servicio. |
| Lanzar trabajos con `session.run('sbatch …')` | Sin idempotencia, reconciliación ni evidencia. |

## Consecuencias

- El modo portátil queda sin funciones remotas por diseño.
- Hace falta un launcher con start/status/stop (X2 de Codex).

## Contratos afectados

`js/remote/index.js` (fachada), OpenAPI de sesión/terminal/transferencias (T-011), `AdmissionReceipt`, perfiles de sitio.

## Pruebas exigidas

- API/WS desde otro origen, CSRF, token vencido, origen `null`: rechazados.
- Host key desconocida o cambiada: no se acepta sola.
- Dos identidades sintéticas: sin acceso cruzado en HTTP, WS, replay ni artefactos.
- Cerrar la terminal no cancela un trabajo batch.

## Migración

`js/remote/index.js` está vacío hoy; no hay consumidores que romper. Se implementa en P3 (T-018 sesión, T-019…T-021 SSH, PTY y transferencias).
