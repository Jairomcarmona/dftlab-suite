# ADR-010: almacén por interfaces, retención y reproducción; SQLite local y PostgreSQL web

Estado: **aceptado** el 2026-10-11 (T-007). Implementación pendiente: T-016/T-017 (local), P9 (web), P10 (export).
Fecha: 2026-10-11. Fuente: [propuesta maestra](../../PROPUESTA_MAESTRA_DFTLAB_V2.md) §14, §25.4.

## Contexto

La versión local es prioritaria (laptop + SSH + HPC) y la web vendrá después. Archivos de salida (DM, mallas, `.out`) pueden ser grandes. Hoy el frontend lee archivos en memoria y no hay almacén persistente.

## Decisión

1. **Puerto `ArtifactStore`:** stage, commit, metadata, stream, verify y retention. Implementación local: directorio administrado + scratch remoto; web: almacén de objetos. El dominio no conoce la implementación.
2. **DB por target:** SQLite (WAL) en disco local, propiedad exclusiva del servicio, nunca en NFS ni compartida entre hosts; PostgreSQL con migraciones versionadas en web. El esquema se diseña para ambos desde el principio (sin funciones exclusivas de SQLite en el dominio).
3. **Transferencias:** subida a temporal único, comprobación de tamaño y SHA-256, publicación por rename donde sea atómico; reanudación por rangos con identidad del origen; límites de tamaño, número, expansión de archivos comprimidos y concurrencia; rutas resueltas dentro del workspace del intento, sin escapes ni enlaces no admitidos.
4. **`ArtifactRecord`:** productor, input refs, parser, SHA-256, tamaño, tipo, unidades, integridad, retención y localizador privado. El nombre de archivo no es identidad. SHA-256 prueba integridad, no autenticidad ni permiso.
5. **Finalización:** consolidar artefactos, verificar el conjunto esperado, guardar recibos y publicar el manifest final de forma condicionada; después actualizar índices. Un crash deja una finalización pendiente recuperable (`FinalizationReceipt`).
6. **Retención por clases:** esenciales para reproducir, seeds de recuperación, outputs grandes opcionales, previews, caché. Política por proyecto, declarada al planificar; el GC respeta runs activos, locks y publicaciones. Limpiar caché nunca borra originales.
7. **Backup y restore:** `RecoveryCheckpoint` con snapshot consistente de DB, manifest de artefactos y cursores de journals; restore en modo recuperación que reconcilia antes de reabrir admisión. RPO/RTO se fijan por perfil tras medir.
8. **Reproducción:** bundle con inputs efectivos, pseudos y licencias permitidas, perfil lógico, versiones, outputs esenciales y referencias; si algo no se puede redistribuir se declara. Procedencia compatible con W3C PROV y export RO-Crate (versión fijada en P10).

## Alternativas

| Opción | Motivo para no adoptarla |
|---|---|
| PostgreSQL también en local | Instalación pesada para una laptop; SQLite basta single-owner. |
| SQLite en almacenamiento compartido del clúster | WAL no es seguro en NFS. |
| Guardar resultados grandes en Git | Contradice las reglas de datos del repo. |

## Consecuencias

- Hay que probar migraciones en ambos motores de DB antes de P9.
- El navegador recibe previews o descargas directas; no se carga un DM completo en RAM como única ruta.

## Contratos afectados

`ArtifactRecord`, `ArtifactRef`, `FinalizationReceipt`, `RecoveryCheckpoint`, endpoints `/api/v1/artifacts/...` (T-008/T-011/T-056).

## Pruebas exigidas

- Path traversal, symlinks fuera del workspace, zip/tar bombs: rechazados.
- Kill durante staging y finalización: recuperable, sin artefacto parcial publicado.
- Restore en instancia limpia: identidades, evidencias e índices reconstruidos; operaciones pendientes reconciliadas.

## Migración

Los lectores actuales (`siesta/runset.js`, bloques C/D) siguen funcionando en el portátil sobre archivos del usuario; en el build operativo recibirán artefactos por stream.
