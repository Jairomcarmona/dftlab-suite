# Reparto del plan V2.1 entre Codex y Claude

Fecha: 2026-10-11. Estado: **propuesta**, pendiente de aprobación de Manuel. No inicia la migración.

Base: `main` @ `777b181` (estabilización A–H fusionada), [plan V2.1](../../PLAN_IMPLEMENTACION_CLAUDE_CODE.md), [propuesta maestra](../../PROPUESTA_MAESTRA_DFTLAB_V2.md) §19–20 y [reglas compartidas](WORKING_RULES.md).

## 1. Criterio

Se mantiene lo que funcionó en A–H: una rama y un PR por bloque, fusión solo con CI verde en Windows y Linux, cada agente escribe solo su sección de `REGISTRO_DEUDA.md` y `TRASPASO.md`, y nunca dos agentes en la misma carpeta o rama. Lo que va en paralelo lo decide el árbol de archivos: dos bloques corren a la vez solo si no comparten carpeta dueña.

El reparto sigue lo que cada entorno puede comprobar:

| | Codex (carpeta local Windows/WSL) | Claude (hilos en la nube, Linux) |
|---|---|---|
| Ve | Windows nativo, WSL2, motores instalados y ejecutables, claves SSH y clúster de Manuel, el equipo de uso | Linux limpio, Chromium/Playwright, `sshd` local de prueba, fuente de QRAFT y HubbardFlow en GitHub (solo lectura); varios hilos a la vez |
| No ve | Varios bloques a la vez en la misma carpeta | Windows, el clúster real, SIESTA; no puede empujar a los repositorios de los motores |
| Por tanto | Empaquetado/instalación, SSH/terminal real, cambios upstream en los motores, worker WSL/SLURM, mediciones en el equipo de uso | Inventario de API de los motores, contratos, ADR, frontend, núcleo de la plataforma contra fixtures |

Comprobado con `git ls-remote` el 2026-10-11: QRAFT @ `4d996ea` es la punta de `main` en `Jairomcarmona/siestaflow`, y HubbardFlow @ `e508f47` es la punta de `codex/hubbardflow-rename` en `Jairomcarmona/SIESTAFLOW_HUBBARD_RESPONSE_BACKBONE`. Ambos son públicos, así que Claude lee la fuente fijada; los cambios upstream que falten los hace Codex en esos repositorios.

## 2. Dueño de cada carpeta

| Carpeta o archivo | Dueño | Nota |
|---|---|---|
| `docs/adr/` (ADR-001…012), `ARQUITECTURA.md` | Claude | ADR-014 sigue siendo de Codex |
| `docs/inventory/` (nuevo) | Claude | T-001/T-002 |
| `contracts/` (schemas, fixtures, openapi, events) | Claude | Codex consume; cambios por PR de Claude |
| `docs/compatibility/` (nuevo) | Claude | T-009 |
| `engine-versions.lock.json` (nuevo) | Codex | T-010: requiere construir e instalar las distribuciones |
| `app/dftlab/static/js/**`, `app/scripts/build.mjs`, `app/tests/**` | Claude | Codex no edita `app/` durante P2 |
| `platform/pyproject.toml`, lock, launcher, `deployment/` | Codex | Empaquetado y arranque (T-016 parte, T-057) |
| `platform/src/dftlab_platform/{domain,application,api,infrastructure/storage}` | Claude | T-017/T-018 |
| `platform/src/dftlab_platform/infrastructure/ssh/`, `schedulers/`, `integrations/` | Codex | T-019…T-023 |
| `tools/reference-env/`, `.github/workflows/ci.yml`, `python-references.yml` | Codex | Cada área nueva crea su propio workflow; no se edita el del otro |

Archivos compartidos, con regla fija:

- `REGISTRO_DEUDA.md`, `TRASPASO.md`, `README.md`: una sección por bloque; en el resumen de pendientes, una línea por bloque.
- `scripts/verify.mjs`, `app/scripts/test-browser.mjs`: solo se añaden líneas, no se reordenan.
- `app/package.json` y su lock: un solo PR abierto a la vez cambia dependencias; el lock se regenera con `npm`, nunca a mano.
- Quien fusiona segundo trae `main` con merge commit; no se rebasa ni se fuerza la rama del otro.

## 3. Orden por olas

Codex lleva una cola en serie (una carpeta aislada por rama, como en F). Claude abre como máximo tres hilos a la vez, cada uno con carpeta dueña distinta.

**Ola 0: cierre de P0 y arranque de P1 (todo en paralelo)**

| Bloque | Quién | Tickets | Archivos |
|---|---|---|---|
| C1 | Claude | T-001 inventario y T-002 baseline; marca T-003…T-006 como cubiertos por A–H con su evidencia | `docs/inventory/` |
| C2 | Claude | T-007: ADR-001…012 y actualización de `ARQUITECTURA.md` | `docs/adr/`, `ARQUITECTURA.md` |
| C0 | Claude | T-009: API pública real de QRAFT y HubbardFlow en los commits fijados y lista de lo que falta upstream | `docs/compatibility/` |
| X1 | Codex | Esqueleto `platform/` (pyproject, uv lock, launcher start/status/stop, workflow propio), T-010 borrador del lock de versiones con distribuciones instaladas en Windows/WSL, comienzo de T-057 | `platform/` raíz, `deployment/local/`, `engine-versions.lock.json` |

**Ola 1: contratos (depende de C2; NativeContractRef depende de C0)**

| Bloque | Quién | Tickets | Archivos |
|---|---|---|---|
| C3 | Claude | T-008 + T-056: schemas ejecutables con validación JS y Python, fixtures válidos/inválidos, `NOT_ESTABLISHED` y enum futuro | `contracts/schemas/`, `contracts/fixtures/` |
| X2 | Codex | Cambios upstream en QRAFT/HubbardFlow que C0 identifique como necesarios, cada uno en su repositorio y con fixture de consumidor | repositorios de los motores |
| C4 | Claude | T-011 OpenAPI, eventos, errores, idempotencia y cursor (tras C3) | `contracts/openapi/`, `contracts/events/` |

**Ola 2: P2 y P3 en paralelo (tras C3 y X1)**

| Bloque | Quién | Tickets | Archivos |
|---|---|---|---|
| C5 | Claude | T-012 ViewScope (envoltorio de `core/lifecycle.js`) y T-013 stores | `core/`, `main.js`, `views/` |
| C6 | Claude | T-015 build portátil y operativo | `app/scripts/` |
| C7 | Claude | T-017 operaciones durables y ArtifactStore SQLite; luego T-018 sesión/origen/CSRF/paths | `platform/.../{domain,application,api,storage}` |
| X3 | Codex | T-019 perfiles SSH/agent/known_hosts en Windows y WSL; T-020 PTY; T-021 transferencias contra el host real | `infrastructure/ssh/` |
| C8 | Claude | T-014 promoción a draft (tras C5) | `views/`, `application/` del frontend |

**Ola 3: P4, primera ruta completa**

| Bloque | Quién | Tickets |
|---|---|---|
| X4 | Codex | T-022 adaptador QRAFT y T-023 worker WSL/SLURM con un SIESTA real pequeño |
| C9 | Claude | T-024/T-025 submit durable, reconciliación, lease/fencing contra scheduler fixture; T-058 y T-060 |
| C10 | Claude | T-026 cancel/retry/resume y eventos en la UI; vista xterm sobre el backend de X3 |
| X5 | Codex | T-059 runtime probe y T-062 mediciones en el equipo de uso (incluye decidir el worker de Kohn–Sham pendiente de H) |

El gate P4 se cierra solo con X4 y C9 fusionados y el escenario de §7 del plan ejecutado por Codex en el sitio real. P5 (lectores, G-01…09, S-01…08) puede empezar tras C5 en hilos de Claude, uno por lector o subtarea.

## 4. Modelo para cada hilo de Claude

Opus 5.5 medio cuando el bloque fija un contrato, una decisión de arquitectura, concurrencia o seguridad: C0, C2, C3, C4, C5, C7, C9 y luego T-030 (preflight).

Sonnet 5.5 medio cuando el contrato ya está fijado y el trabajo es enumerar o aplicar: C1, C6, C8, C10 y las subtareas de P5 por lector o por G/S.

## 5. Fuera de este reparto

Kubernetes, HF-2, web multiusuario (P9) y P10 no se asignan hasta cerrar P4. La protección de `main` sigue bloqueada por el plan de GitHub (ver README); mientras tanto Manuel autoriza cada fusión, como en A–H.
