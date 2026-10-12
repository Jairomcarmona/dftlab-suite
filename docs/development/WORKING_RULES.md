# Reglas compartidas de desarrollo

Estas reglas son la referencia común para Claude Code y otros colaboradores.

## Estado y límites

Leer el README, `ARQUITECTURA.md` para la aplicación actual y la propuesta maestra V2.1 y su backlog para la evolución. Una propuesta documentada no es una capacidad implementada. Registrar decisiones nuevas en ADR con estado, alternativas, consecuencias y evidencia. No imponer reorganizaciones masivas para simular avance.

Conservar `baseline-v1` y su manifiesto histórico. Trabajar sobre la copia de este repositorio; no modificar por defecto el directorio de origen de la migración. Reutilizar lectores y lógica científica antes de sustituirlos. Mantener unidades, convenciones, pseudopotenciales, validez física, procedencia y parámetros de convergencia explícitos. No cambiar tolerancias para hacer pasar una prueba.

## Capas y contratos

- La interfaz organiza interacción y visualización. No posee el estado autoritativo de campañas, credenciales SSH ni reglas científicas de validación.
- Aprendizaje y simulaciones didácticas tienen procedencia y capacidades distintas de cálculos reales; un resultado educativo no se presenta como cálculo validado.
- API y aplicación validan comandos y autorización. El dominio científico y los adaptadores de motores permanecen independientes de React, DOM y framework web.
- El ejecutor posee una sola autoridad sobre cada trabajo. Reintentos, reconciliación, cancelación y finalización deben seguir los contratos V2.1; un DAG por sí solo no asegura recuperación.
- Incorporar motores externos por versión/commit y adaptador, sin duplicar sus planificadores ni copiar su fuente dentro de componentes de UI.

## Cambios y verificación

Usar ramas cortas por cambio y PR contra `main`; explicar problema, resultado, contratos afectados, verificación y límites. Una migración se hace por módulos con equivalencia observable y posibilidad de reversión. No actualizar dependencias o motores indiscriminadamente.

**Pocos PR (regla fija de todo el proyecto).** El avance diario se registra en comentarios del issue de seguimiento o en notas no versionadas, no con un PR por paso. `docs/reviews/TRASPASO.md` se actualiza una vez por etapa cerrada, dentro del PR de código de esa etapa, o en un único PR al cerrar un bloque. Nunca se abre un PR documental solo para anotar que otro PR se fusionó. Los arreglos de código relacionados van en un solo PR.

Para esta base: `cd app && npm ci`, luego desde la raíz `node scripts/verify-original-baseline.mjs` y `node scripts/verify.mjs`. CI verifica Windows y Linux. Agregar pruebas que evalúen fallos reales o requisitos cuando cambie comportamiento; no duplicar la implementación en las pruebas.

Los cálculos HPC, licencias y pruebas de instalación de los motores requieren validación propia; esta CI frontend no los acredita. Identificar claramente comprobaciones pendientes. No enviar trabajos reales al cargar una vista, montar un componente o ejecutar pruebas unitarias.

## Idioma y textos de la interfaz

El proyecto se escribe en español y se migrará a inglés al cerrar P4 (contratos y ADR congelados). Para que esa migración sea traducir archivos y no reescribir código:

- Todo texto nuevo visible para el usuario (etiquetas, avisos, mensajes de error, texto didáctico) va en un catálogo de cadenas por idioma y se referencia por clave. No se escribe en español dentro de la lógica, de las plantillas HTML ni de las pruebas.
- Las pruebas comparan claves, códigos de error o datos, nunca la frase en español.
- Identificadores, nombres de campos, códigos de error y enums van en inglés (`NOT_ESTABLISHED`, `RunIntent`).
- Los textos existentes se mueven al catálogo cuando se toca su módulo; no se hace una migración masiva previa.
- Los registros internos (ADR aceptados, `TRASPASO.md`, `REGISTRO_DEUDA.md`, auditorías, fichas científicas) pueden quedar en español.
- El catálogo y su mecanismo de carga los define un ADR antes del primer uso; hasta entonces, no inventar uno por módulo.

## Datos y secretos

No versionar claves, tokens, `.env`, credenciales de clúster ni resultados privados. Credenciales fuera de contratos, logs y exportaciones. Mantener datos de prueba pequeños y con procedencia documentada; nuevos resultados voluminosos deben tener una política de almacenamiento y referencias, no incorporarse automáticamente a Git.

No cambiar privacidad, licencia, publicación o protección de ramas silenciosamente. La revisión inicial de secretos no constituye una garantía permanente; revisar cada incorporación de material externo.
