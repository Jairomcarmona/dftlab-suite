# ADR-001: frontend modular, portátil y operativo desde una fuente; cálculo externo

Estado: **aceptado** el 2026-10-11 (T-007, reparto V2.1 aprobado por Manuel). Implementación pendiente: T-012…T-015.
Fecha: 2026-10-11. Fuente: [propuesta maestra](../../PROPUESTA_MAESTRA_DFTLAB_V2.md) §2, §3.1, §4.2–4.3, §16.1.

## Contexto

DFT Lab es hoy un frontend de módulos ES compilado con esbuild en un HTML autónomo (`dist/dftlab.html`, ~12 MB) que enseña, lee salidas de SIESTA y exporta inputs. La regla vigente de [ARQUITECTURA.md](../../ARQUITECTURA.md) §1 es que el navegador no ejecuta SIESTA. V2.1 añade campañas, terminal y ejecución remota, que necesitan un servicio. El riesgo es acabar con dos frontends divergentes (portátil y operativo) o con el navegador como autoridad de ejecución.

El bloque B ya introdujo `core/lifecycle.js` (ámbito por montaje, `render(el, view)`, liberación al navegar) y el bloque H la liberación de recursos 3D y gráficos; son la base del `ViewScope`.

## Decisión

1. **Una sola fuente de frontend** (`app/dftlab/static/js/`) con dos distribuciones del build:
   - **portátil** (`dftlab.html`): aprender, preparar, leer y exportar sin red ni servicio; se conserva tal como está;
   - **operativa**: activos separados, CSP, SDK y carga por demanda, servida por el servicio local en loopback (y después por el servicio web). El grupo Remoto/Campañas solo aparece tras un handshake autenticado.
2. **El navegador no ejecuta SIESTA ni decide ejecución.** Los numerics propios del frontend (Kohn–Sham radial, FC, mallas) siguen permitidos con alcance declarado. Enviar un cálculo es siempre una acción explícita que llama a la API con clave de idempotencia (ADR-007); nunca un efecto de montaje, importación o cambio de tema.
3. **Capas del frontend:** presentación → aplicación frontend (casos de uso, view models) → SDK/contratos. Lectores, geometría y numerics (`siesta/`, `crystal/`, `physics/`) quedan como módulos puros sin DOM. Ninguna vista importa SSH, scheduler ni WebSocket directamente; usan el SDK.
4. **Ciclo de vida:** cada vista recibe un `ViewScope` (evolución de `core/lifecycle.js`) que posee AbortController, suscripciones, listeners, workers, timers y disposables. Se mantiene el adaptador `mount/destroy` para las vistas actuales.
5. Cálculos pesados que bloqueen la UI pasan a workers cancelables, con límites y versión de algoritmo en el resultado, cuando una medición lo justifique (ver H en `MEDICIONES_H.md`).
6. La elección de framework de UI no se decide aquí; sigue en [ADR-013](ADR-013-react-typescript-ui.md) (propuesto). Este ADR es válido con módulos ES o con React.

## Alternativas

| Opción | Motivo para no adoptarla |
|---|---|
| Dos frontends (portátil y operativo) | Duplica pantallas y diverge; la propuesta exige una fuente. |
| Solo build operativo, abandonar el HTML portátil | Rompe el uso offline en laptop y la enseñanza sin servicio. |
| Ejecutar SIESTA en el navegador (WASM) | No hay build fiable de SIESTA; mezcla enseñanza con autoridad de ejecución. |
| Reescritura completa de la UI | Riesgo alto de regresión; no requerida para separar capas. |

## Consecuencias

- El build gana un segundo target y una prueba de que el portátil sigue sin red (ya existe una para ambos HTML desde F).
- Las vistas operativas dependen del SDK y del servicio; sin servicio quedan ocultas, no rotas.
- Las reglas de imports se vuelven verificables en CI (§25.2): `learn/` no importa comandos de ejecución; los módulos puros no importan DOM.

## Contratos afectados

Contrato de módulo de [ARQUITECTURA.md](../../ARQUITECTURA.md) §3 (se amplía con `ViewScope`), `js/remote/index.js` (fachada compatible, ADR-008), build `app/scripts/build.mjs` (segundo target), SDK JS (T-011).

## Pruebas exigidas

- Portátil abierto desde `file://` sin red: las 19 vistas cargan y exportan (prueba offline existente, ampliada).
- Navegación entre vistas: ninguna respuesta async ni callback de la vista anterior escribe en la nueva (`browser_lifecycle.mjs`).
- Regla de imports en CI: un import prohibido hace fallar el check.
- Ninguna vista ni prueba unitaria envía un trabajo real.

## Migración

Incremental por vista (T-012 ViewScope, T-013 stores por proyecto/área, T-014 promoción a borrador, T-015 doble build). Cada paso mantiene las suites actuales en verde y el portátil funcional; reversión por PR.
