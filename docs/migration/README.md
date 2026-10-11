# Conservación y migración

El repositorio se creó desde `DFT_App_completo`, sin modificar esa carpeta de origen. La copia de trabajo nueva es `dftlab-suite`. La etiqueta anotada `baseline-v1` apunta al commit `bd4fa06a11e4c47448adbb17d05fad92f4b7d57b` y conserva 480 archivos originales, 132 585 346 bytes. Es una referencia de migración, no una versión certificada para producción.

`original-file-manifest.json` registra tamaño y SHA-256 de cada archivo incluido. `node scripts/verify-original-baseline.mjs` verifica los blobs históricos de la etiqueta contra ese manifiesto, incluso cuando el código actual haya cambiado. No compara la implementación futura con el original ni sustituye pruebas científicas.

| Material | Uso durante la migración |
| --- | --- |
| `app/` | Aplicación actual, compilador, módulos, datos y pruebas existentes. |
| `corridas/`, `pruebas/` | Casos y resultados originales; distinguir referencias validadas de exploraciones. |
| `pseudo_xc/` | Material científico conservado; verificar procedencia, licencia y compatibilidad por cálculo. |
| `prototipo_si/`, `prototipo_v2/` | Referencias funcionales, sin incorporarlas automáticamente a producción. |
| Documentos de la raíz | Especificaciones y revisiones previas; algunos enlaces locales históricos requieren actualización al migrar. |

Se excluyeron `.git`, `node_modules`, entornos Python, cachés y `app/dist`. El Git dentro de `app/` no tenía commits. Las salidas científicas `.out`, `.dat` y los archivos de datos comprimidos incluidos no se descartaron como si fueran compilados.

## Secuencia de cambios

1. Mantener la etiqueta original y probar lectores, unidades, convenciones y cristalografía antes de reorganizar módulos.
2. Extraer contratos y lógica científica con dependencias explícitas; conservar referencias numéricas, metadatos de procedencia y criterios de convergencia.
3. Migrar una vista operativa a React y TypeScript, manteniendo una ruta funcional anterior hasta demostrar equivalencia.
4. Integrar cada motor mediante adaptadores y versiones fijadas. Validar primero su instalación aislada y un flujo real; no confundir revisión de fuentes con integración completada.
5. Añadir API, persistencia, reconciliación y workers para local/SSH/HPC; luego verificar recuperación y carga antes de habilitar servicio web multiusuario.

Cambios posteriores a la etiqueta en esta base: corrección del import ESM del runner de cristalografía para Windows, documentación de desarrollo, verificación de conservación y CI. No se han cambiado algoritmos científicos ni sus tolerancias en este bootstrap.
