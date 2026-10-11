# ADR-015: HubbardFlow como capa obligatoria bajo QRAFT; código reutilizable sin restricción de licencia

Estado: **aceptado** el 2026-10-11 por decisión de Manuel. Enmienda [ADR-011](ADR-011-despliegues-por-target-workers-fijados.md) y [ADR-012](ADR-012-releases-migraciones-catalogo-capabilities.md) en lo que toca a HubbardFlow.
Fecha: 2026-10-11. Relacionado: [ADR-003](ADR-003-autoridades-qraft-hubbardflow-plataforma.md), [ADR-006](ADR-006-hubbard-hf1-hf2.md), [inventario de HubbardFlow](../compatibility/HUBBARDFLOW_e508f47.md) (U-H0…U-H3).

## Contexto

El inventario C2 encontró que HubbardFlow no tiene `LICENSE` (U-H0) y lo trató como bloqueo para distribuirlo. Manuel aclaró el 2026-10-11 que QRAFT y HubbardFlow son suyos, igual que la plataforma: no hay fricción de licencias y su código puede reutilizarse como convenga técnicamente. La plataforma **necesita** la lógica de HubbardFlow: el workflow LR-U es uno de los cuatro prioritarios y vive en el producto, no como extra opcional.

Comprobado el 2026-10-11 con la API de GitHub: `Jairomcarmona/dftlab-suite` es **privado**.

## Decisión

1. **HubbardFlow es una capa obligatoria de la plataforma**, situada bajo QRAFT: una capability de QRAFT encapsula la campaña HubbardFlow (modo HF-1 de [ADR-006](ADR-006-hubbard-hf1-hf2.md)). QRAFT controla la tarea exterior y los recursos; HubbardFlow decide la ciencia LR-U dentro. Toda instalación operativa de la plataforma lo incluye.
2. **La licencia no condiciona el diseño.** Los tres proyectos son de Manuel; se puede mover, reutilizar o adaptar código entre ellos. Empaquetar HubbardFlow en el wheelhouse o la imagen del worker de la plataforma está permitido. Publicarlo o distribuirlo a terceros es una decisión de producto de Manuel, no un bloqueo técnico.
3. **Paquete separado por criterio técnico.** HubbardFlow sigue como paquete Python propio, en su repositorio (hoy `SIESTAFLOW_HUBBARD_RESPONSE_BACKBONE`), fijado por commit y hash en `engine-versions.lock.json`. No se copia dentro de `dftlab-suite`, por razones de ingeniería y no de licencia: conserva sus baselines científicas y sus pruebas (ADR-003), mantiene una sola definición de cada gate y deja que el motor crezca sin arrastrar la plataforma. Lo que haya que cambiar en el motor para acoplarlo se cambia en su repositorio con sus pruebas.
4. **Interfaz estable.** La plataforma solo usa HubbardFlow a través de la fachada pública que pide el inventario (U-H1: `hubbardflow.api` o `__all__` con `describe_capabilities` versionado; U-H2/U-H3: plan, gates, análisis y estados con `NOT_ESTABLISHED`). Los schemas de esa frontera, del lado de la plataforma, se definen en `contracts/` (Ola 1, C3). Nada de `hubbardflow.domain` interno.
5. **Fixtures y CI.** La CI de PR sigue sin secretos (ADR-011): usa fixtures de contrato. Si el repositorio de HubbardFlow es privado, las pruebas contra el paquete real corren en local o en un workflow aparte con credenciales de solo lectura acotadas.
6. **Orden del trabajo.** El acoplamiento real se implementa en las Olas 2 y 3 (Codex), después de los cambios upstream de QRAFT que exige la ruta canónica (U-Q1, U-Q3) y de la fachada de HubbardFlow (U-H1, U-H2). HF-2 (QRAFT ejecuta los nodos Hubbard uno a uno) sigue siendo posterior y opcional según ADR-006.

## Alternativas

| Opción | Motivo para no adoptarla |
|---|---|
| Dependencia opcional que el usuario instala aparte (primera versión de este ADR) | Manuel la corrigió: LR-U es parte del producto, no un extra. |
| Reescribir o condensar la lógica Hubbard dentro de la plataforma | Permitido por licencia, pero duplicaría la ciencia, perdería las baselines congeladas y crearía una segunda definición de cada gate. |
| Acoplar HF-2 de una vez | Depende de un export de fragmentos que no existe (U-H5) y de los cambios de QRAFT; bloquearía las demás actividades. |

## Consecuencias

- U-H0 deja de bloquear T-010 y el empaquetado: añadir un `LICENSE` queda como tarea de Manuel solo si decide publicar.
- La plataforma operativa incluye HubbardFlow fijado; el build portátil de enseñanza no lo necesita.
- Lo que se «condensa» es la frontera (una fachada pública y schemas), no la ciencia: la plataforma usa el motor completo a través de ella.

## Contratos afectados

`CapabilityDescriptor` (capability Hubbard HF-1), `engine-versions.lock.json` (entrada de HubbardFlow), schemas de la frontera Hubbard en `contracts/`, `CapabilityQualificationRecord`.

## Pruebas exigidas

- Fixtures de contrato de la frontera Hubbard (incluido `NOT_ESTABLISHED`) en la CI de PR, sin el paquete real.
- Workflow aparte con el paquete real fijado: la capability HF-1 recorre la ruta canónica (ADR-012).

## Migración

Nada que migrar: aún no hay `platform/` con HubbardFlow.
