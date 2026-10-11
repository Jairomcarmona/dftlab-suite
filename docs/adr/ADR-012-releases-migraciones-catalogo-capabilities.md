# ADR-012: releases compatibles, migraciones y catálogo de capabilities probado

Estado: **aceptado** el 2026-10-11 (T-007). El mapeo del catálogo al registro nativo de QRAFT queda pendiente del inventario C2 (T-009).
Enmendado por [ADR-015](ADR-015-hubbardflow-capa-privada-bajo-qraft.md): HubbardFlow es capa obligatoria bajo QRAFT, en repositorio privado y sin redistribución pública.
Fecha: 2026-10-11. Fuente: [propuesta maestra](../../PROPUESTA_MAESTRA_DFTLAB_V2.md) §5.4, §7, §16.3, §18.4, §19.2, §25.6–25.7.

## Contexto

Frontend, plataforma, adaptadores y dos motores evolucionan por separado. Una función puede existir en la UI sin poder ejecutarse por la ruta canónica. Hoy no hay catálogo de capabilities ni matriz de compatibilidad.

## Decisión

1. **Catálogo de disponibilidad de plataforma** con estados propios, no enums del runtime: `DESIGNED`, `IMPLEMENTED`, `CONTRACT_TESTED`, `RUNTIME_VERIFIED`, `SCIENTIFICALLY_QUALIFIED`. Una capability puede estar disponible para preview o exportación antes de ser admitida para ejecución. La API (`GET /api/v1/capabilities`) informa lo realmente instalado y probado.
2. **Gate de incorporación:** una capability debe poder describirse, validarse, compilarse, prepararse, transportarse, ejecutarse, recolectarse y recuperarse por la ruta canónica (§7). Si falta una parte, el diagnóstico dice cuál. Importar un módulo no concede capacidad ni permiso; el registro se congela antes de ejecutar.
3. **Releases separadas** de frontend, plataforma, adaptadores y motores, con una **matriz de combinaciones admitidas**. Objetivo inicial: contrato actual y la versión estable anterior donde se haya probado; no se impone N/N−1 a motores que no lo soporten.
4. **Migraciones de datos:** un migrador crea una representación nueva enlazada; nunca reescribe locks ni evidencia original. Campos centrales o versiones incompatibles se rechazan con diagnóstico; extensiones namespaced desconocidas pueden preservarse. DB: expand/migrate/contract con prueba de rollback de aplicación; no se supone seguro un downgrade destructivo.
5. **Deprecaciones** con sustituto, versiones afectadas y ventana de soporte; changelog de incompatibilidades.
6. **Identidad de release:** commit, distribución, hashes de dependencias y de artefactos de build; licencias y permisos de redistribución de motores, bibliotecas, fonts, WASM, datasets y pseudopotenciales. SBOM y procedencia de build desde el primer release distribuido, sin anunciar un nivel SLSA no demostrado.
7. Gates de release (§18.4): lint/tipos, contratos, suites afectadas, builds portátil y operativo, integración; en release, instalación limpia, actualización/restauración, seguridad del servicio y casos científicos del alcance anunciado. Los xfail conservan motivo y responsable.

## Pendiente del inventario C2

Cómo se corresponde `CapabilityDescriptor` con el registro de capabilities de QRAFT @ `4d996ea` (IDs, versión, schemas, modos, cancel/resume) y qué metadatos faltan upstream.

## Alternativas

| Opción | Motivo para no adoptarla |
|---|---|
| Anunciar capabilities por existencia de UI o parser | Promete ejecución que no existe (§23). |
| Versionado único para todo | Acopla ciclos de motores científicos y UI. |
| Migrar datos en sitio | Corrige silenciosamente la historia y rompe digests. |

## Consecuencias

- El README y la UI muestran funciones pendientes como pendientes o no soportadas.
- Cada release carga con su matriz y su manifiesto de procedencia.

## Contratos afectados

`CapabilityDescriptor`, `CapabilityQualificationRecord`, `engine-versions.lock.json`, OpenAPI de capabilities (T-008/T-010/T-011/T-061).

## Pruebas exigidas

- Capability publicada sin recorrer la ruta canónica: el catálogo no la admite para ejecución.
- Migrador: el original queda intacto y enlazado.
- Matriz: una combinación fuera de la matriz se rechaza en admisión.

## Migración

Las funciones actuales (lectores, calculadoras, exportadores) entran al catálogo como `IMPLEMENTED` para su uso offline; ninguna queda admitida para ejecución hasta P4.
