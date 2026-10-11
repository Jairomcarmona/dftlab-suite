# Reparto del plan V2.1 entre Codex y Claude

Fecha: 2026-10-11. Estado: **propuesta**, pendiente de aprobación de Manuel. No inicia la migración.

Base: `main` @ `777b181` (estabilización A–H fusionada), [plan V2.1](../../PLAN_IMPLEMENTACION_CLAUDE_CODE.md), [propuesta maestra](../../PROPUESTA_MAESTRA_DFTLAB_V2.md) §19–20 y [reglas compartidas](WORKING_RULES.md).

## 1. Criterio

El crédito de Claude es el recurso escaso. Por eso Claude hace solo lo que fija el diseño, en pocos hilos cortos con Opus 5.5 medio: los ADR, los contratos y el inventario de la API de los motores. Codex hace todo el volumen de código siguiendo esos documentos. Claude puede revisar los PR de Codex antes de fusionar, con Sonnet 5.5 medio, si Manuel lo pide.

Se mantiene lo que funcionó en A–H: una rama y un PR por bloque, fusión solo con CI verde en Windows y Linux, cada agente escribe solo su sección de `REGISTRO_DEUDA.md` y `TRASPASO.md`, y nunca dos agentes en la misma carpeta o rama. Codex trabaja en una carpeta aislada por rama, como en F; puede llevar dos bloques a la vez solo si no comparten carpeta dueña.

Comprobado con `git ls-remote` el 2026-10-11: QRAFT @ `4d996ea` es la punta de `main` en `Jairomcarmona/siestaflow`, y HubbardFlow @ `e508f47` es la punta de `codex/hubbardflow-rename` en `Jairomcarmona/SIESTAFLOW_HUBBARD_RESPONSE_BACKBONE`. Ambos son públicos: Claude lee la fuente fijada; Codex hace los cambios upstream.

## 2. Dueño de cada carpeta

| Carpeta o archivo | Dueño |
|---|---|
| `docs/adr/` (ADR-001…012), `ARQUITECTURA.md` | Claude |
| `docs/compatibility/` (API pública de los motores, T-009) | Claude |
| `contracts/` (schemas, fixtures, openapi, events) | Claude; Codex propone cambios por issue o PR pequeño revisado por Claude |
| `docs/inventory/`, `engine-versions.lock.json` | Codex |
| `app/**` (frontend, build, pruebas) | Codex |
| `platform/**`, `deployment/**` | Codex |
| `tools/reference-env/`, `.github/workflows/` | Codex |
| Repositorios de QRAFT y HubbardFlow | Codex |

Archivos compartidos: `REGISTRO_DEUDA.md`, `TRASPASO.md` y `README.md` llevan una sección por bloque. `scripts/verify.mjs` y `app/scripts/test-browser.mjs` solo reciben líneas añadidas. El lock de npm se regenera con `npm`, nunca a mano. Quien fusiona segundo trae `main` con merge commit.

## 3. Olas

**Ola 0 (en paralelo; no hay archivos en común)**

| Bloque | Quién | Tickets | Archivos |
|---|---|---|---|
| C1 | Claude | T-007: ADR-001…012 y actualización de `ARQUITECTURA.md` | `docs/adr/`, `ARQUITECTURA.md` |
| C2 | Claude | T-009: API pública real de QRAFT y HubbardFlow en los commits fijados; lista de lo que falta upstream | `docs/compatibility/` |
| X1 | Codex | T-001 inventario y T-002 baseline; marca T-003…T-006 como cubiertos por A–H con su evidencia | `docs/inventory/` |
| X2 | Codex | Esqueleto `platform/` (pyproject, uv lock, launcher start/status/stop, workflow propio), T-010 borrador del lock de versiones, comienzo de T-057 | `platform/` raíz, `deployment/local/`, `engine-versions.lock.json` |

**Ola 1 (contratos; depende de C1 y C2)**

| Bloque | Quién | Tickets | Archivos |
|---|---|---|---|
| C3 | Claude | T-008 + T-056: schemas con fixtures válidos e inválidos, `NOT_ESTABLISHED` y enum futuro; T-011 OpenAPI, eventos, errores, idempotencia y cursor | `contracts/` |
| X3 | Codex | Cambios upstream que C2 marque como necesarios, cada uno con fixture de consumidor | repositorios de los motores |
| X4 | Codex | T-012 ViewScope y T-013 stores (no dependen de los contratos) | `app/dftlab/static/js/` |

**Ola 2 (P2 y P3; todo Codex, sigue los contratos de C3)**

X5 validadores JS y Python de los schemas de `contracts/`; X6 T-016/T-017 servicio, operaciones durables y ArtifactStore SQLite; X7 T-018 sesión, origen, CSRF y paths; X8 T-014 promoción a draft y T-015 doble build; X9 T-019…T-021 SSH, PTY y transferencias contra el host real. X6→X7 van en serie (misma carpeta). X8 va en paralelo con X6 porque toca `app/` y no `platform/`.

**Ola 3 (P4)**

Codex: T-022 adaptador QRAFT, T-023 worker WSL/SLURM con un SIESTA real pequeño, T-024…T-026, T-058…T-060, y T-062 en el equipo de uso (incluye decidir el worker de Kohn–Sham pendiente de H). Claude solo interviene si una carrera de submit, cancel o resume obliga a cambiar un contrato de `contracts/` o un ADR.

P5 (lectores, G-01…09, S-01…08) puede empezar en Codex tras X4. Kubernetes, HF-2, P9 y P10 no se asignan hasta cerrar P4.

## 4. Uso de Claude

- **Opus 5.5 medio:** C1, C2 y C3, uno por hilo. Son los únicos hilos de implementación previstos aquí.
- **Sonnet 5.5 medio, opcional:** revisión de cada PR de Codex antes de fusionar, centrada en conformidad con los ADR y `contracts/`. Un hilo por PR, sin reescribir código; los hallazgos vuelven a Codex.

La protección de `main` sigue bloqueada por el plan de GitHub (ver README); Manuel autoriza cada fusión, como en A–H.
