# ADR-015: HubbardFlow como capa obligatoria y privada bajo QRAFT

Estado: **aceptado** el 2026-10-11 por decisión de Manuel. Enmienda [ADR-011](ADR-011-despliegues-por-target-workers-fijados.md) y [ADR-012](ADR-012-releases-migraciones-catalogo-capabilities.md) en lo que toca a la distribución de HubbardFlow.
Fecha: 2026-10-11. Relacionado: [ADR-003](ADR-003-autoridades-qraft-hubbardflow-plataforma.md), [ADR-006](ADR-006-hubbard-hf1-hf2.md), [inventario de HubbardFlow](../compatibility/HUBBARDFLOW_e508f47.md) (U-H0…U-H3).

## Contexto

El inventario C2 encontró que HubbardFlow no tiene `LICENSE` (U-H0), lo que impedía redistribuirlo. Manuel no quiere decidir la licencia todavía porque el proyecto seguirá creciendo, pero la plataforma **sí necesita** su lógica: el workflow LR-U es uno de los cuatro prioritarios y debe vivir en el producto, no como extra opcional.

Comprobado el 2026-10-11 con la API de GitHub: `Jairomcarmona/dftlab-suite` es **privado**.

## Decisión

1. **HubbardFlow es una capa obligatoria de la plataforma**, situada bajo QRAFT: una capability de QRAFT encapsula la campaña HubbardFlow (modo HF-1 de [ADR-006](ADR-006-hubbard-hf1-hf2.md)). QRAFT controla la tarea exterior y los recursos; HubbardFlow decide la ciencia LR-U dentro. Toda instalación operativa de la plataforma lo incluye.
2. **Código privado y separado.** La lógica se mantiene en un paquete Python propio de Manuel, en un repositorio privado (el actual `SIESTAFLOW_HUBBARD_RESPONSE_BACKBONE` u otro que lo sustituya), versionado y fijado por commit y hash en `engine-versions.lock.json`. No se copia dentro de `dftlab-suite`: aunque este repositorio es privado hoy, mantenerlo aparte conserva sus baselines científicas y sus pruebas (ADR-003) y permite que siga creciendo sin arrastrar la plataforma.
3. **Sin redistribución fuera de Manuel.** HubbardFlow no se publica en PyPI ni en repositorios, instaladores o imágenes públicos. Los artefactos de la plataforma que lo incluyan (wheelhouse, imagen de worker) son privados y se despliegan solo en entornos que Manuel controla. Por eso la licencia puede esperar; elegir una es requisito antes de cualquier distribución a terceros.
4. **Interfaz estable.** La plataforma solo usa HubbardFlow a través de la fachada pública que pide el inventario (U-H1: `hubbardflow.api` o `__all__` con `describe_capabilities` versionado; U-H2/U-H3: plan, gates, análisis y estados con `NOT_ESTABLISHED`). Los schemas de esa frontera, del lado de la plataforma, se definen en `contracts/` (Ola 1, C3). Nada de `hubbardflow.domain` interno.
5. **Fixtures y CI.** La CI de PR sigue sin secretos (ADR-011): usa fixtures de contrato sin código de HubbardFlow. Las pruebas contra el paquete real corren en local o en un workflow aparte con credenciales de solo lectura acotadas. Las salidas de HubbardFlow versionadas como fixtures se limitan a lo necesario.
6. **Orden del trabajo.** El acoplamiento real se implementa en las Olas 2 y 3 (Codex), después de los cambios upstream de QRAFT que exige la ruta canónica (U-Q1, U-Q3) y de la fachada de HubbardFlow (U-H1, U-H2). HF-2 (QRAFT ejecuta los nodos Hubbard uno a uno) sigue siendo posterior y opcional según ADR-006.

## Alternativas

| Opción | Motivo para no adoptarla |
|---|---|
| Dependencia opcional que el usuario instala aparte (primera versión de este ADR) | Manuel la corrigió: LR-U es parte del producto, no un extra. |
| Copiar la lógica dentro de `dftlab-suite` | Duplica el motor, pierde sus baselines y pruebas, y mezcla su ciclo de vida con el de la plataforma. |
| Elegir licencia y publicar ahora | Manuel prefiere esperar mientras el proyecto crece. |
| Acoplar HF-2 de una vez | Depende de un export de fragmentos que no existe (U-H5) y de los cambios de QRAFT; bloquearía las demás actividades. |

## Consecuencias

- U-H0 deja de bloquear T-010 para uso interno; la entrada de HubbardFlow en el lock es privada (sin URL pública de descarga).
- Instalar la plataforma operativa requiere acceso al repositorio privado de HubbardFlow; el build portátil de enseñanza no lo necesita.
- Si `dftlab-suite` se hiciera público o se distribuyera a terceros, primero hay que decidir la licencia de HubbardFlow o excluirlo de esa distribución.

## Contratos afectados

`CapabilityDescriptor` (capability Hubbard HF-1), `engine-versions.lock.json` (entrada privada), schemas de la frontera Hubbard en `contracts/`, `CapabilityQualificationRecord`.

## Pruebas exigidas

- Fixtures de contrato de la frontera Hubbard (incluido `NOT_ESTABLISHED`) en la CI de PR, sin el paquete real.
- Workflow aparte con el paquete real fijado: la capability HF-1 recorre la ruta canónica (ADR-012).
- Ningún artefacto público contiene archivos de HubbardFlow.

## Migración

Nada que migrar: aún no hay `platform/` con HubbardFlow.
