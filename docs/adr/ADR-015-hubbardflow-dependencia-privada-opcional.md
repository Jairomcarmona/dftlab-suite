# ADR-015: HubbardFlow como dependencia privada y opcional, sin redistribución

Estado: **aceptado** el 2026-10-11 por decisión de Manuel. Enmienda [ADR-011](ADR-011-despliegues-por-target-workers-fijados.md) y [ADR-012](ADR-012-releases-migraciones-catalogo-capabilities.md) en lo que toca a HubbardFlow.
Fecha: 2026-10-11. Relacionado: [ADR-003](ADR-003-autoridades-qraft-hubbardflow-plataforma.md), [ADR-006](ADR-006-hubbard-hf1-hf2.md), [inventario de HubbardFlow](../compatibility/HUBBARDFLOW_e508f47.md) (U-H0).

## Contexto

El inventario C2 encontró que HubbardFlow no tiene `LICENSE`: estar en GitHub no concede permiso de redistribución, y U-H0 bloqueaba empaquetarlo (T-010). Manuel no quiere decidir la licencia todavía porque el proyecto seguirá creciendo con otras funciones. Decidió integrarlo de forma privada.

## Decisión

1. **La plataforma no empaqueta ni redistribuye HubbardFlow.** No entra en wheelhouses, imágenes, instaladores, bundles reproducibles ni en `vendor/`, y su código no se copia a este repositorio (ya lo prohibía ADR-003).
2. **Dependencia privada opcional:** quien tenga acceso instala HubbardFlow aparte, desde su repositorio y con sus propias credenciales, en el entorno del worker. La plataforma no guarda credenciales de ese repositorio en contratos, logs ni CI de PR.
3. **La plataforma funciona sin ella.** Sin HubbardFlow instalado, `describe_capabilities` y `GET /api/v1/capabilities` no anuncian el workflow LR-U (o lo anuncian como no instalado) y todo lo demás sigue igual. El adaptador Hubbard se carga solo si el paquete está presente; su ausencia no es un error de arranque.
4. **Versión fijada igualmente:** cuando está instalado, `engine-versions.lock.json` y la evidencia de cada campaña registran commit y hash de la distribución observada, como con QRAFT (ADR-011, ADR-012). La entrada de HubbardFlow en el lock es opcional y marcada privada, sin URL de descarga pública.
5. **CI:** la CI de PR no tiene acceso a HubbardFlow (sin secretos, ADR-011). Las pruebas del adaptador en CI usan fixtures de contrato y dobles de prueba que no contienen código de HubbardFlow. Las pruebas contra el paquete real corren en local o en un workflow separado con credenciales acotadas.
6. **Fixtures derivados:** salidas de HubbardFlow usadas como fixtures en este repositorio se limitan a lo necesario para el contrato y se revisan antes de versionarlas, porque su redistribución tampoco está licenciada.
7. **Bundles reproducibles** de campañas Hubbard declaran HubbardFlow como requisito con su identidad (commit/hash), sin incluirlo (§14.3 de la propuesta ya cubre recursos no distribuibles).

## Alternativas

| Opción | Motivo para no adoptarla |
|---|---|
| Elegir licencia ahora y empaquetar | Manuel prefiere no decidirla mientras el proyecto crece. |
| Copiar el motor dentro de la plataforma | Viola ADR-003 y la falta de licencia. |
| Hacer HubbardFlow obligatorio | Toda instalación necesitaría acceso privado; bloquea la distribución de la plataforma. |

## Consecuencias

- U-H0 deja de bloquear T-010 y la distribución de la plataforma; sigue siendo una decisión de Manuel para cuando quiera publicar HubbardFlow.
- El workflow LR-U (P7) solo está disponible donde alguien instaló HubbardFlow; el catálogo lo muestra.
- Si más adelante HubbardFlow recibe licencia, un ADR nuevo puede sustituir este y permitir empaquetarlo.

## Contratos afectados

`CapabilityDescriptor` (capability ausente o no instalada), `engine-versions.lock.json` (entrada opcional privada), `RuntimeProbeReceipt`, bundle reproducible.

## Pruebas exigidas

- Arranque del servicio y suites sin HubbardFlow instalado: pasan, y el catálogo no ofrece LR-U.
- Con HubbardFlow instalado: el catálogo lo detecta y registra commit/hash.
- Ningún artefacto de distribución contiene archivos de HubbardFlow (comprobación en el build de release).

## Migración

Nada que migrar: aún no hay `platform/` con HubbardFlow.
