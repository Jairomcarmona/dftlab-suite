# ADR-004: contratos públicos versionados y adaptadores, sin APIs privadas

Estado: **aceptado** el 2026-10-11 (T-007). La lista de APIs de motor disponibles queda pendiente del inventario C2 (T-009).
Fecha: 2026-10-11. Fuente: [propuesta maestra](../../PROPUESTA_MAESTRA_DFTLAB_V2.md) §5.2, §5.4–5.5, §6.1–6.2, §25.2.

## Contexto

Frontend JS, servicio Python, CLI y motores deben intercambiar datos sin reinterpretarlos. Hoy los únicos formatos comunes son los JSON de `js/data/` y `.dftlab.json`, sin schema ejecutable ni versión. Los tipos de TypeScript o Pydantic no validan datos externos por sí solos.

## Decisión

1. **Schemas de plataforma** en `contracts/` con JSON Schema 2020-12; **API** en OpenAPI 3.1 (dialecto que soporte el toolchain fijado). Son la definición ejecutable; los ADR y los documentos solo los explican.
2. **Envelope común:** `schema_id`, `schema_version`, `record_id`, `project_id`, `producer` (paquete, versión, commit, algoritmo), `created_at`, `payload`, `native_contract_refs`, `integrity`.
3. **SemVer** para APIs y paquetes públicos. Añadir un valor a un enum se evalúa como cambio de contrato. Los consumidores tratan un valor desconocido de forma segura: nunca lo colapsan en `PASS` ni en éxito.
4. Requests, registros persistidos y mensajes de worker tienen schemas distintos. Estado, owner, digest verificado y autoridad nunca se aceptan del cliente como hechos.
5. **Serialización:** sin NaN/Infinity en JSON; ausente = `null` + motivo, nunca cero; enteros fuera del rango seguro de JS, decimales exactos y tokens de certificación viajan como strings tipados. Arrays grandes van en artefactos con metadata de dtype/shape/unidades.
6. **Hashes:** se conservan los digests nativos con su algoritmo original; nunca se recanonicaliza un lock existente. Para envelopes nuevos compartidos JS/Python se fija una canonicalización con fixtures comunes (JCS es candidata; decisión en C3, T-008).
7. **Adaptadores:** la plataforma habla con cada motor solo a través de su API pública fijada por commit. Una función que falte se pide upstream.
8. Errores HTTP con Problem Details (RFC 9457) y código estable; un rechazo científico es un assessment, no un error HTTP.
9. Schemas, SDK y reglas de imports se ejecutan en CI con fixtures válidos e inválidos.

## Pendiente del inventario C2

Qué parte de las operaciones del adaptador Hubbard (§8.3) y de la ruta QRAFT (§7) existe como API pública en los commits fijados, y qué cambios upstream corresponden a cada repositorio.

## Alternativas

| Opción | Motivo para no adoptarla |
|---|---|
| Tipos solo en código (TS/Pydantic) sin schema compartido | No validan en runtime entre lenguajes; divergen. |
| Protobuf/gRPC | Coste de toolchain en el HTML portátil; JSON Schema basta para el volumen actual. |
| Importar internos de los motores «temporalmente» | Rompe con cada cambio upstream y oculta la API que falta. |

## Consecuencias

- Cada cambio de contrato pasa por PR en `contracts/` (dueño Claude según el reparto; Codex propone por issue o PR pequeño).
- Los validadores JS y Python (X5) se generan o prueban contra los mismos fixtures.

## Contratos afectados

Todos los de §5.5 y §25.3 (T-008, T-056), OpenAPI/eventos (T-011).

## Pruebas exigidas

- Fixtures válidos e inválidos por schema, ejecutados por los validadores JS y Python.
- Fixture con un enum futuro: tratamiento seguro, sin `PASS`.
- Fixture con terminación técnica exitosa y `NOT_ESTABLISHED`.
- Round-trip de un documento nativo sin alterar bytes ni digest.

## Migración

`.dftlab.json` y los JSON de datos actuales siguen leyéndose; cuando reciban schema, un migrador crea una representación nueva enlazada sin reescribir la original.
