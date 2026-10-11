# ADR-013: interfaz operativa con React y TypeScript

Estado: **propuesto**, sin migración ni dependencias React añadidas por este bootstrap.
Fecha: 2026-10-10.

## Contexto

El frontend actual usa módulos ES y esbuild para producir HTML autónomo. La suite prevista agrega proyectos, campañas, múltiples estudios, formularios científicos, gráficas y monitoreo. El usuario prioriza instalación local, terminal SSH y HPC, con evolución posible a web. Se necesita mantener resultados verificables y capacidad de migrar sin perder funcionalidades.

## Propuesta

Adoptar React y TypeScript para la interfaz operativa mediante migración gradual. Conservar el frontend actual como aplicación funcional durante la transición. Empezar con una vista de proyectos y estado de campañas y un formulario representativo; comparar mantenibilidad, accesibilidad, rendimiento y compatibilidad con escritorio y navegador antes de extender la decisión.

React facilita composición y ciclo de vida explícito en vistas complejas; TypeScript estricto ayuda a detectar incompatibilidades durante desarrollo. Los tipos no validan datos externos: API, importaciones y eventos necesitan validación de esquema en runtime. Esta elección no garantiza disponibilidad, escalabilidad de HPC ni precisión científica.

Extraer lectores, geometría, modelos y cálculos reutilizables a módulos sin DOM ni dependencia React. Mantener motores Python y adaptadores de ejecución fuera del frontend. Integrar visualizadores Three.js, Moyo y terminal mediante adaptadores con montaje y limpieza definidos; impedir listeners, procesos o conexiones duplicados.

No enviar cálculos desde efectos de montaje. El envío debe corresponder a una acción explícita y un comando con identificador idempotente validado por el backend. Los componentes pueden desmontarse, reintentarse o recargarse sin duplicar trabajos. Los límites de error de React cubren errores de renderizado; la pérdida de SSH, fallos async y recuperación del ejecutor exigen mecanismos propios.

Para la primera vista, preferir cliente SPA con rutas y contratos independientes del alojamiento. Elegir un framework con SSR solamente si aparecen necesidades concretas de producto; no condiciona la ejecución científica. Una SPA servida estáticamente no es automáticamente un HTML autónomo: Vite, rutas, chunks, workers y WASM deben probarse específicamente si se conserva el modo `file://` y offline.

## Alternativas

| Opción | Evaluación |
| --- | --- |
| Mantener módulos ES para toda la suite | Menor migración inicial; exige sostener convenciones propias para estado y ciclo de vida al crecer la UI. Sigue siendo válida para módulos simples o educativos. |
| React + TypeScript gradual | Ecosistema y composición adecuados a vistas operativas extensas; requiere disciplina de estado, limpieza y pruebas, sin reescribir ciencia. Recomendación inicial. |
| Reescritura completa de UI y ciencia | Riesgo alto de regresiones y pérdida de trazabilidad; no justificada por cambiar de framework. |

## Condiciones para adoptar

1. Inventario de las vistas y módulos actuales y criterios de equivalencia por funcionalidad, incluyendo importaciones y exportaciones.
2. Piloto sin pérdida funcional, con uso de teclado, carga y errores observables y medición con datasets representativos.
3. Datos grandes fuera de actualizaciones masivas de estado React: workers para procesamiento, paginación/virtualización y límites de memoria medidos.
4. Recarga y reconexión sin duplicar envíos; backend autoritativo y estado de dominio separado del estado visual.
5. Verificación de instalación local y modo web. Si se mantiene HTML offline, prueba automatizada específica para assets y capacidades; no prometerlo por configuración de build.
6. Versiones fijadas, contratos compatibles y rollback del piloto antes de migrar más vistas.

La cantidad de código que se cambiará debe salir del inventario, no de un porcentaje supuesto. Cambiarán componentes y coordinación de la UI; parsers, algoritmos, referencias científicas y motores se reutilizan según su independencia y pruebas.

## Relación con producción

La tolerancia a fallos de la plataforma depende principalmente de persistencia durable, aislamiento de trabajos, reconciliación con scheduler, política de reintentos, checkpoints, finalización verificable y control de admisión. La capacidad masiva depende de cuotas, workers, almacenamiento, consultas y límites de recursos. React mejora la organización del cliente; esos mecanismos corresponden a contratos y backend V2.1.

## Fuentes

- [React: integración gradual en un proyecto existente](https://react.dev/learn/add-react-to-an-existing-project).
- [React: ciclo de vida y limpieza de efectos](https://react.dev/reference/react/useEffect).
- [React: alcance de los límites de error](https://react.dev/reference/react/Component).
- [TypeScript: strict](https://www.typescriptlang.org/tsconfig/strict.html).
- [Vite: build y base pública](https://vite.dev/guide/build).
