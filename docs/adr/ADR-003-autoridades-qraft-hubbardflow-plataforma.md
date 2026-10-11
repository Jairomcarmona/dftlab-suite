# ADR-003: QRAFT dueño del runtime, HubbardFlow dueño de LR-U, plataforma dueña de operaciones e identidad

Estado: **aceptado** el 2026-10-11 (T-007). Los puntos marcados «pendiente C2» esperan el inventario de API de los motores (T-009, `docs/compatibility/`).
Fecha: 2026-10-11. Fuente: [propuesta maestra](../../PROPUESTA_MAESTRA_DFTLAB_V2.md) §2 (reglas 3 y 7), §5.1, §7, §8.1, §19.2.

## Contexto

Hay tres componentes con lógica de ejecución o ciencia: QRAFT (`Jairomcarmona/siestaflow@4d996ea`, compositor, locks, runtime, intentos), HubbardFlow (`Jairomcarmona/SIESTAFLOW_HUBBARD_RESPONSE_BACKBONE@e508f47`, planes LR, políticas, gates y análisis) y la plataforma DFT Lab nueva. Sin una asignación clara, la plataforma tendería a crear un tercer DAG o a reimplementar gates.

## Decisión

| Contrato | Autoridad única |
|---|---|
| WorkflowDefinition/CompiledWorkflow, `workflow.lock.json`, `run.lock.json`, intentos, journal, runtime | QRAFT |
| Plan LR, políticas, observaciones, gates y certificación Hubbard (`U_scalar_charge`) | HubbardFlow |
| UI, proyecto, revisión, operación, origen, identidad, permisos, conexiones, archivos | Plataforma DFT Lab |
| Formatos SIESTA y capacidades del ejecutable | Adaptador SIESTA con versión explícita |
| Dataset visual y lectura offline | Lectores DFT Lab, sin autoridad de certificación |

1. La plataforma **no almacena otro DAG** ni lanza nodos por su cuenta. Sus tablas son operaciones, proyectos e índices/proyecciones (ADR-005).
2. La plataforma envuelve contratos nativos por referencia (`NativeContractRef`) y no redefine sus enums, digests ni decisiones.
3. HubbardFlow decide inventario, subespacios, perturbaciones, gates y análisis; QRAFT decide ejecución, recursos y vida de intentos en el ámbito asignado; el adaptador traduce y conserva evidencia, sin inventar ciencia.
4. En la ruta SLURM inicial, `SchedulerGateway` envía, observa y cancela la allocation del controlador; QRAFT decide nodos y recursos dentro de ella.
5. Los cambios de API necesarios se hacen **upstream** con fixture de consumidor y se fijan por commit/versión; no se copia código de los motores ni se importan nombres privados.

## Pendiente del inventario C2

- Qué objeto de QRAFT es el punto público para componer, compilar, preparar y ejecutar (la propuesta cita `RunPreparer` y `CompiledWorkflowRuntime`; confirmar que son públicos en `4d996ea`).
- Quién conserva cada lock nativo y dónde guarda la plataforma su proyección (T-009 lo exige explícitamente).
- Qué export de HubbardFlow sirve hoy para `resolve_plan` y cuáles de las ocho operaciones del adaptador (§8.3) faltan upstream.

Estos puntos no cambian la asignación de autoridad; solo fijan por qué interfaz se ejerce.

## Alternativas

| Opción | Motivo para no adoptarla |
|---|---|
| DAG propio de la plataforma con manifiesto nuevo | Compite con QRAFT; impide un resume verificable (§22). |
| Fork o vendoring de los motores en `platform/` | Pierde el mecanismo de actualización y sus pruebas propias. |
| Gates científicos replicados en JS/Python de plataforma | Dos definiciones de cada decisión científica (regla 3 de §2). |

## Consecuencias

- La plataforma depende de la API pública de dos repositorios externos; cada versión forma una matriz de compatibilidad (ADR-012).
- Una función que el motor no expone queda pendiente hasta el cambio upstream (bloque X3 de Codex).

## Contratos afectados

`NativeContractRef`, `RunProjection`, `CapabilityDescriptor` (T-008), puertos `CampaignAuthoring`, `ScientificProtocol`, `SchedulerGateway` (T-009), `engine-versions.lock.json` (T-010).

## Pruebas exigidas

- Regla de imports en CI: el adaptador no importa módulos privados de QRAFT/HubbardFlow.
- Fixture de contrato: un lock nativo pasa por la plataforma y sale con el mismo digest y bytes.
- Ninguna tabla de plataforma reproduce dependencias del DAG (revisión de schema).

## Migración

No hay código actual que migrar. Los launchers PBS/SGE de `tools/fdfgen.js` siguen como exportación; la ejecución administrada pasa por QRAFT (P4).
