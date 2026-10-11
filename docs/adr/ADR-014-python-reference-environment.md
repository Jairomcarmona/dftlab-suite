# ADR-014: entorno aislado para regenerar referencias

Estado: implementado en `codex/entorno-python`, pendiente de revisión e integración.
Fecha: 2026-10-11. Alcance: bloque F, sólo referencias de pruebas existentes.

## Contexto

Las suites frontend ya consumen referencias versionadas en Windows y Linux. Sus
cuatro generadores Python no tenían un contrato de instalación fijado. Regenerar
en el árbol de fuentes podría sustituir silenciosamente los datos que sirven de
oráculo. El build/frontend no necesita Python y debe conservar esa independencia.

## Decisión

Crear un proyecto uv no empaquetado en `tools/reference-env`, con CPython 3.12.10,
uv 0.11.14, dependencias directas exactas y lock transitivo con hashes. Calificar
Linux x86_64 con binarios publicados y prohibir builds fuente implícitos. Windows
usa WSL2; la CI frontend sigue ejecutándose en Windows y Linux.

Ejecutar los generadores originales en una copia temporal y comprobar sus nuevas
referencias con las suites Node existentes, sin modificar tolerancias. Exportar
informe, hashes, referencias y logs a un destino nuevo ignorado; nunca promoverlos
automáticamente. Un workflow independiente instala desde el lock y conserva la
evidencia. Los fallos no se convierten en omisiones con éxito.

## Alternativas

| Opción | Motivo para no adoptarla aquí |
| --- | --- |
| pip con sólo versiones directas | No fija transitivas ni hashes; hace falta otro contrato de bloqueo. |
| Conda/compilación nativa Windows | Amplía herramientas C/Fortran y distribución binaria fuera del alcance; sisl 0.16.4 no tiene wheel Windows. Puede evaluarse por separado. |
| Cambiar sisl o reescribir generadores | Introduce otra referencia científica y más cambios que el entorno solicitado. |
| Regenerar sobre fixtures seguidos por Git | Confunde actualización del oráculo con calificación de entorno y puede ocultar regresiones. |

## Consecuencias y evidencia

Hay una instalación Python opcional y otra puerta CI, sin dependencias Python
en npm. Linux/WSL2 requieren red inicial y Node Linux 24.18.0. La instalación
nativa Windows de sisl 0.16.4 falla por incompatibilidad del build fuente con
scikit-build-core actual; Linux dispone de wheel cp312. spglib 2.7.0 y seekpath
2.2.2 coinciden con los metadatos cristalográficos originales. La calificación y
sus SHA/CI quedan registrados en la sección F de
[REGISTRO_DEUDA](../reviews/REGISTRO_DEUDA.md) y
[TRASPASO](../reviews/TRASPASO.md).

El lock permite reconstruir el árbol de paquetes; no certifica identidad binaria
entre sistemas/BLAS ni ejecución SIESTA/HPC. Cualquier actualización requiere
recalificación. [Guía operativa](../development/PYTHON_REFERENCES.md).
