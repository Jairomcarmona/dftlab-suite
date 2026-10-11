# Revisión técnica externa de DFT Lab (10 de octubre de 2026)

> **Procedencia.** Texto recibido de Manuel (Jairo) el 2026-10-11, elaborado con Codex sobre una copia local de Windows de `DFT_App` **anterior** a la creación de este repositorio. Se conserva sin editar el contenido técnico, solo con este encabezado. Es **evidencia y deuda técnica reconocida**, no una descripción verificada de `main`.
> Contraste con el commit actual, estado de cada hallazgo y diferencias entre la copia externa y `main`: [REGISTRO_DEUDA.md](REGISTRO_DEUDA.md).
> Los scripts y resultados de navegador de la revisión quedaron en `C:/Users/Jairo/.codex/tmp/dftlab-audit-20261010/` (no disponibles aquí); las reproducciones relevantes se convierten en pruebas del repositorio.

---

**Fecha:** 10 de octubre de 2026. Revisión del código y los archivos disponibles en esta copia local.

**Dictamen.** DFT Lab es una herramienta educativa y de trabajo científico con una base modular aprovechable, lectores bien contrastados y una distribución portátil funcional. Compila y sus pantallas funcionan al abrirlas individualmente. Sin embargo, hay defectos reproducibles de navegación, validación e integración del postproceso que conviene resolver antes de ampliar funcionalidades. El mayor problema arquitectónico es el ciclo de vida de las vistas y la integración de los datos, no el hecho de entregar un HTML único.

Esta revisión no modifica la fuente de la aplicación. Se regeneraron los dos HTML de `app/dist/` para verificar la compilación. Las pruebas adicionales se ejecutaron desde una carpeta temporal externa; no se instalaron dependencias ni se ejecutaron cálculos SIESTA.

## 1. Qué hace realmente la herramienta

La aplicación tiene tres funciones principales:

- Enseñar DFT mediante teoría, gráficas de corridas guardadas, comparaciones y controles interactivos.
- Preparar cálculos externos: importar estructuras, analizar simetría y generar entradas `.fdf`, caminos k y scripts para SLURM, PBS, SGE o ejecución local.
- Leer resultados de SIESTA en el navegador y exportar figuras, datos, estructuras e informes.

El registro contiene **19 pantallas**: portada, **15 capítulos**, dos herramientas y una pantalla de postproceso. Los capítulos cubren Kohn–Sham, pseudopotenciales, intercambio y correlación, convergencia de base/malla/k, SCF, solucionadores, bandas/DOS/óptica, DFT+U, densidad, potencial y función trabajo, espín, lectura del `.out`, fonones, fuerzas y métodos más allá de DFT.

La interfaz **no ejecuta SIESTA**. Sí realiza cálculos numéricos propios: Kohn–Sham radial atómico, análisis cristalográfico mediante WebAssembly, caminos k, propiedades derivadas de espectros, ajustes y diagonalización de matrices dinámicas de fonones. Es importante conservar esta distinción en la documentación.

La terminal SSH está descrita como ampliación futura; `remote/index.js` es un contrato vacío con `available: false`. No hay backend operativo ni sistema de trabajos remotos en esta versión.

## 2. Arquitectura observada

```text
index.html
  └─ main.js: navegación por hash y montaje/destrucción
      └─ views/registry.js: registro de las 19 pantallas
          ├─ views/*.js: composición de interfaz y parte de la lógica
          ├─ core/: DOM, temas, gráficos, SVG y visualización 3D
          ├─ siesta/: detección, lectores y análisis de resultados
          ├─ crystal/: formatos, simetría, caminos k y Brillouin
          ├─ physics/: átomo radial y fonones
          ├─ tools/fdfgen.js: entradas y scripts de trabajo
          └─ data/*.json: resultados empaquetados

scripts/build.mjs + esbuild
  ├─ dist/dftlab.html
  └─ dist/dftlab_artifact.html

scripts/dftlab_pack.py: preproceso externo con sisl/numpy
corridas/: archivos originales comprimidos y algunos generadores
```

La clasificación adecuada es **aplicación frontend modular con empaquetado monolítico**. Hay separación real entre lectores, cristalografía, física, componentes y vistas. El HTML final único es una decisión de distribución que facilita el uso desde `file://`; no implica que toda la fuente tenga que ser un archivo.

La modularización todavía es parcial. Algunas vistas mezclan teoría, controles, cálculos, presentación, carga de archivos y exportación. `forces.js` pesa unos 51 KB, `density.js` 34 KB y `postproc.js` 32 KB. `outnotes.js`, con unos 79 KB, concentra reglas de interpretación del `.out`. El tamaño por sí solo no es un defecto; sí indica dónde conviene definir límites internos claros.

Mediciones de la copia analizada:

| Elemento | Resultado |
|---|---:|
| JavaScript propio bajo `static/js/` | 50 archivos, unas 10 928 líneas |
| JSON de datos empaquetados | 16 archivos, 10 678 665 bytes |
| HTML principal compilado | 12 569 636 bytes, 12.57 MB decimales |
| Datos de funciones de onda | 4.30 MB |
| Biblioteca de pseudopotenciales empaquetada | 3.87 MB |

Los dos últimos datos representan aproximadamente el 65 % del tamaño del HTML. Todas las vistas se importan de manera estática desde el registro, de modo que la carga inicial incluye los datos de las pantallas que todavía no se han visitado.

## 3. Verificación realizada

Entorno: Windows, Node.js 24.18.0, npm 11.16.0 y Chrome instalado en el equipo. Se utilizó Playwright del runtime disponible para automatizar las comprobaciones, sin añadirlo al proyecto.

| Verificación | Resultado |
|---|---|
| `npm run build` | Correcto; genera los dos HTML |
| Lectores SIESTA, `run_tests.mjs` | 341 comprobaciones pasan |
| Mallas binarias, `run_rho_tests.mjs` | 81 comprobaciones pasan |
| Lectura anotada, `run_outnotes_tests.mjs` | 26 comprobaciones pasan |
| `.FC` y fonones, `run_fc_tests.mjs` | 101 comprobaciones pasan |
| Cristalografía, ejecución original en Windows | Falla antes de ejecutar casos por rutas ESM |
| Cristalografía, adaptación de rutas en memoria | 371/371 estructuras y 71/71 formatos pasan |
| Apertura individual de las 19 pantallas a 1440 px/claro | 19/19, sin excepciones ni desbordamiento horizontal del documento |
| Apertura individual de las 19 pantallas a 400 px/oscuro | 19/19, sin excepciones ni desbordamiento horizontal del documento |
| Navegar XC → Inicio → cambiar tema | Excepción reproducida |
| Cargar paquete `.dftlab.json` en postproceso | Reconocido, sin visualización |
| Cargar `.RHO` en postproceso | Error de lectura reproducido |
| Cargar `.EIG` y después `.KP` | Asociación incompleta reproducida |
| Escape de metadatos de `.out` y atributos | Inserción de HTML/atributos reproducida con marcadores inocuos |

Las aperturas se hicieron desde el HTML compilado con solicitudes HTTP/HTTPS bloqueadas. La funcionalidad inicial y el visor 3D funcionaron sin red. Cada apertura intentó obtener la hoja de fuentes de Google; el navegador usó tipografías alternativas.

El test de navegador existente en `tests/crystal/browser_smoke.mjs` se omite con código de salida 0 cuando no encuentra Playwright instalado en el proyecto. Las comprobaciones adicionales descritas aquí sí se ejecutaron, pero no equivalen a integrar ese test en el proyecto ni a comprobar sus tres modalidades de carga WASM.

La compilación emite tres advertencias por `import.meta` en formato IIFE, dentro del loader/glue de moyo. Las vistas actuales usan inicialización inline y funcionaron en el HTML probado. Esto valida ese camino, no todos los caminos alternativos del loader.

## 4. Hallazgos prioritarios

Prioridad alta: corregir antes de ampliar flujos de uso. Prioridad media: resolver al estabilizar el producto. Prioridad baja: mejora de distribución o mantenimiento.

### A. Alta: la calculadora puede bloquear la pestaña al editar un campo

**Ubicación:** `app/dftlab/static/js/views/calc.js:26`, `:113` y `:117`.

`fftGood(n)` no tiene protección frente a cero o valores no finitos. Cuando `n = 0`, el bucle `while (m % p === 0)` divide cero por el factor indefinidamente. Con `NaN` o `Infinity`, la búsqueda exterior tampoco termina.

Los inputs disparan el cálculo en cada evento `input`. Borrar el valor de una longitud convierte el campo vacío en cero; borrar `MeshCutoff` produce un espaciado infinito y un tamaño de malla cero. Por tanto, el caso puede aparecer durante una edición normal, sin un archivo extraño.

**Evidencia:** ejecuté la función extraída bajo un límite de 100 ms. `fftGood(1)` devuelve 1; con `0`, `NaN` e `Infinity`, las tres ejecuciones exceden el límite. No fue necesario congelar la pestaña del usuario para comprobarlo.

**Corrección:** validar entradas completas, positivas y finitas antes del cálculo; comprobar que la celda sea no singular; limitar los tamaños; hacer que `fftGood` rechace valores fuera de su dominio. Mientras un campo está vacío, mostrar estado de edición en vez de ejecutar el cálculo.

### B. Alta: los callbacks de vistas anteriores permanecen activos

**Ubicación:** `app/dftlab/static/js/core/ui.js:48`, `app/dftlab/static/js/main.js:18`, `views/xc.js:207`, `views/postproc.js:253`, `views/phonons.js:289`.

`onTheme` registra un listener de `matchMedia` y un `MutationObserver` y no devuelve una función para liberarlos. Las vistas los crean cada vez que se montan. El router vacía el contenido del mismo elemento `#view`; ese elemento sigue conectado al documento, por lo que `root.isConnected` no identifica si una vista sigue vigente.

**Reproducción:** abrir `#xc`, navegar a `#inicio` y pulsar Tema. Chrome registra `Cannot read properties of null (reading 'innerHTML')`: se ejecuta el callback de XC cuando sus nodos ya no existen.

Además de errores visibles, las suscripciones retienen closures y datos. Algunas vistas pueden reconstruir gráficos o visores antiguos al recibir el cambio de tema. El problema debe corregirse en la API compartida, no mediante defensas aisladas en cada selector.

**Corrección:** introducir un contexto de vista con callbacks de limpieza; hacer que `onTheme` devuelva un desuscriptor; destruirlo al navegar; usar un contenedor distinto por montaje o un identificador de vigencia. Registrar también la cancelación de timers, frames y lecturas asíncronas.

### C. Alta: el resultado del postproceso depende del orden de carga EIG/KP

**Ubicación:** `app/dftlab/static/js/views/postproc.js:54`, `:58` y `:60`.

Si el `.KP` ya está cargado, se añade al parseo de un nuevo `.EIG`. Si el `.EIG` se cargó primero, al añadir `.KP` se parsea únicamente el archivo nuevo y el `.EIG` existente conserva los pesos uniformes y no recibe las coordenadas k.

**Evidencia:** cargando el fixture de Si y después su `.KP`, el informe JSON conserva `weightsFromKP: false` y `kpoints: null`. Con pesos no uniformes sintéticos válidos, el primer peso almacenado queda en `0.00390625` cuando debería ser `0.005`. El lector puro `parseEIG` sí obtiene el valor correcto al recibir ambos contenidos.

El fixture original de Si tiene pesos uniformes, por lo que allí no cambia numéricamente la DOS; aun así se pierden las coordenadas. Con una malla de pesos distintos, la DOS y las integraciones pueden cambiar. Es un defecto de integración de la interfaz, no del lector aislado.

**Corrección:** mantener un conjunto de archivos por corrida y recalcular las asociaciones cuando se agregue, sustituya o elimine un archivo dependiente. Probar ambos órdenes y la carga conjunta.

### D. Media: hay lectores que todavía no tienen un flujo gráfico completo

**Ubicación:** `app/dftlab/static/js/views/postproc.js:13`, `:51` y `:194`; `siesta/index.js:117`; `siesta/pack.js`.

Hay dos situaciones diferentes:

- Un `.dftlab.json` se detecta y figura como «leído», pero `refresh()` no usa `unpackDftlab` ni construye sus paneles. Con `si.dftlab.json`, la pantalla muestra «Ninguno de los archivos tiene un lector gráfico todavía». El README del empaquetador describe un uso que no está conectado a esta pantalla.
- Todos los archivos se leen mediante `f.text()`. Al cargar `mgo.RHO`, `parseMany` detecta una malla e intenta pasar ese texto a `parseGrid`, que requiere bytes. La pantalla informa «archivo de malla demasiado corto». Las pantallas específicas de densidad y potencial sí trabajan con `ArrayBuffer`.

**Corrección:** conservar el contenido binario en la capa de importación y elegir texto/bytes según el formato. Para los paquetes, conectar desempaquetado y renderizado o indicar expresamente que la pantalla todavía no los visualiza. Distinguir estados de detección, parseo y visualización.

### E. Media: los archivos importados pueden insertar HTML en la interfaz

**Ubicación:** `app/dftlab/static/js/views/postproc.js:82`, `:95` y `:202`; `core/ui.js:15`.

El resumen inserta `systemLabel` y otros campos de texto dentro de `innerHTML` sin escapar. `esc()` escapa `&`, `<` y `>`, pero no comillas; no es suficiente para interpolar contenido en atributos delimitados por comillas.

**Evidencia:** un `.out` sintético con `reinit: System Label: <b data-audit-label="yes">audit</b>` crea un elemento `<b>` real en el resumen. Un nombre de archivo sintético con comillas también crea un atributo no previsto en el canvas. Las comprobaciones usaron marcadores inocuos y no ejecutaron una carga maliciosa.

Esto permite alterar la interfaz desde un archivo importado y deja superficies para handlers de eventos. En Windows las comillas no forman parte de un nombre normal del sistema de archivos; el caso de metadatos del `.out` sí es aplicable directamente. La solución debe cubrir ambos contextos para mantener la distribución multiplataforma.

**Corrección:** asignar texto con `textContent`, construir atributos mediante la API DOM y mantener separadas las cadenas de contenido de las plantillas de HTML confiables. Revisar también el mensaje de error del router.

### F. Media: el proyecto no tiene todavía una puerta de calidad reproducible

**Ubicación:** `app/tests/crystal/run_tests.mjs:17`, `app/package.json:7`, `app/scripts/build.mjs:8`.

El harness de cristalografía importa rutas absolutas del sistema mediante `import(path.join(...))`. Node en Windows interpreta `C:` como un esquema ESM no admitido. Convertir las rutas con `pathToFileURL` permite ejecutar los 371 casos y 71 formatos, que pasan; hice esa adaptación en memoria sin editar la fuente.

No hay comando agregado `npm test`, configuración CI visible, una política de versión de Node ni dependencias fijadas para regenerar las referencias Python. El smoke test opcional puede terminar correctamente sin ejecutar nada. También hay rutas de fallback de esbuild heredadas del contenedor Linux y `serve` depende de `python3`, que en este equipo corresponde al alias de WindowsApps.

**Corrección:** añadir scripts de verificación, usar URLs ESM portátiles, hacer explícita la ejecución u omisión de pruebas de navegador, fijar herramientas de referencia y validar en Windows/Linux. Conservar el lockfile de npm y preferir `npm ci` en una copia limpia.

### G. Media: las bandas se unen a través de discontinuidades del camino k

**Ubicación:** `app/dftlab/static/js/views/postproc.js:111` y `app/dftlab/static/js/core/chart.js:58`.

El postproceso convierte cada banda en una serie continua de puntos. El renderer une los puntos finitos consecutivos. No se incorporan cortes de segmentos en saltos como U|K. La propia arquitectura reconoce esta limitación.

La gráfica puede sugerir una continuidad que no corresponde al recorrido físico. No basta con escribir ambas etiquetas en el eje.

**Corrección:** representar segmentos y discontinuidades en el modelo de bandas; dividir las series o insertar separadores explícitos en el dibujo y respetarlos también en la exportación. Para archivos sin información suficiente, pedir o asociar el camino de entrada en vez de inventar cortes.

### H. Media/baja: el cierre de recursos y el cálculo pesado necesitan una política común

**Ubicación:** `core/chart.js:84`, `core/three-view.js:24` y `:29`, `views/ks.js:79`, `views/phonons.js:169`.

Hay `ResizeObserver` de gráficas que no quedan accesibles para una destrucción explícita. El visor 3D detiene su loop, desconecta su observer y llama a `renderer.dispose()`, pero no libera expresamente `OrbitControls`, todos los materiales/texturas ni todas las geometrías de la escena. `clear(g)` libera geometrías de hijos directos y no recorre subárboles ni materiales.

El solver atómico y la DOS de fonones realizan trabajo síncrono en el hilo de interfaz; retrasarlo con `setTimeout` solo cambia cuándo empieza. Los timers tampoco comparten una política de cancelación al salir de la vista. No medí crecimiento de memoria ni el bloqueo máximo en equipos lentos; este hallazgo combina inspección del código y el defecto de vigencia confirmado en B.

**Corrección:** centralizar la destrucción de gráficas y escenas, cancelar tareas pendientes y llevar el trabajo numérico costoso a Web Workers con progreso y cancelación cuando las mediciones lo justifiquen.

## 5. Fortalezas que conviene conservar

- **Lectores desacoplados de la interfaz.** Los módulos SIESTA se pueden ejecutar y comprobar sin navegador; el uso de fixtures reales y referencias de otras bibliotecas es una buena base de validación.
- **Cristalografía con contraste externo amplio.** Los casos incluyen los 230 grupos espaciales, variantes de Bravais y round trips de formatos. La documentación explica diferencias equivalentes de origen o automorfismos en vez de ocultarlas.
- **Pruebas de fonones significativas.** Incluyen referencias NumPy, regla de suma acústica, degeneraciones, simetría q/−q, normalización y un modelo analítico de resortes. Verifican propiedades, no solo que una función devuelva algo.
- **Procedencia científica visible.** Existen entradas/salidas originales comprimidas, generadores y metadatos. Se documentan resultados no convergidos y diferencias frente al experimento.
- **Uso local viable.** Las pantallas probadas funcionan sin acceso de red y los datos del usuario se procesan localmente en los flujos revisados.
- **Presentación consistente.** Temas, gráficos, exportación SVG/PNG/CSV y vista móvil comparten componentes. La captura revisada de estructura confirma una composición legible y una visualización 3D operativa.

## 6. Rigor científico y reproducibilidad

Las pruebas respaldan el comportamiento de los lectores y varios algoritmos; **no certifican por sí solas todas las cifras, explicaciones y referencias del curso**. Esta revisión no repitió las corridas DFT ni verificó los artículos de literatura uno por uno.

La biblioteca contiene 30 elementos por dos funcionales, con inputs/outputs ONCVPSP y validaciones de ecuaciones de estado. Es un activo importante. La afirmación de que cada curva tiene procedencia necesita un contrato uniforme para los JSON: sistema, unidades, versión de SIESTA, funcional, pseudo y hash, base, mallas, tolerancias, estado de convergencia, generador y fuente original.

Hay deuda documental explícita: `beyond.js` identifica referencias no verificadas. La raíz mezcla el plan original, prototipos y la arquitectura vigente. `ARQUITECTURA.md` establece correctamente su precedencia, pero conserva rutas del entorno anterior y remite a `env/siesta-env.tar.gz`, que no está en esta copia. El README de pseudos enumera `validation/fdf/`, tampoco presente como directorio en esta copia. Parte de las entradas puede estar dentro de los archivos comprimidos; conviene indicar cómo localizarla y regenerar cada dato.

No hace falta añadir SIESTA como dependencia de la aplicación. Sí hace falta distinguir la reproducción del frontend, la regeneración de referencias y la reproducción de las corridas científicas, con sus respectivos requisitos.

## 7. Distribución y estado del repositorio

El empaquetado de 12.57 MB es defendible para uso portátil, pero será costoso en publicación web y hace que cualquier modificación regenere todo el archivo. Conviene conservar el HTML único y ofrecer una segunda salida web con datos/activos separados cuando se mida la necesidad.

El comentario de `build.mjs` anuncia una versión multifichero; el script actual genera dos variantes de HTML. La publicación dividida en `index.html`/`app.js` está descrita en la arquitectura como un proceso manual, sin script propio. Las fuentes siguen referenciadas a Google, de modo que la tipografía exacta no está incluida en el paquete offline.

La raíz de esta copia no tiene `.git`; `app/` sí tiene un repositorio inicializado, pero **sin commits** y con todos los archivos sin seguimiento. No encontré `.gitignore`, CI ni licencia propia de proyecto. Esto describe la copia recibida; no permite inferir si existe un repositorio remoto con historial.

Para trabajo mantenible, definir una raíz de Git que incluya código, documentación y trazabilidad científica; decidir qué datos se versionan; excluir `node_modules` y productos regenerables según la política elegida; crear una base revisada antes de iniciar una refactorización. También conviene conservar avisos y licencias de terceros: el build usa `legalComments: 'none'`.

## 8. Orden recomendado de trabajo

1. **Estabilizar las operaciones actuales.** Evitar el bucle de la calculadora, corregir el ciclo de vida y las asociaciones EIG/KP, y cerrar la inserción de HTML desde archivos. Añadir pruebas pequeñas de estos flujos.
2. **Conectar las capacidades del postproceso.** Separar bytes/texto, renderizar paquetes o declarar su estado, asociar archivos por corrida y representar discontinuidades de bandas.
3. **Reproducir la calidad en una copia limpia.** Comandos de test, URLs portátiles, prueba de navegador obligatoria cuando se publique, dependencias de referencia, Git y documentación de arranque.
4. **Refactorizar de forma incremental.** Extraer lógica numérica y modelos de datos de las vistas más densas; unificar validación y procedencia; introducir workers para tareas medidas como costosas.
5. **Mejorar distribución y añadir remoto cuando corresponda.** Mantener el HTML portable; automatizar una salida web. Implementar el puente SSH como componente separado solo al abordar esa funcionalidad.

No recomiendo empezar migrando toda la interfaz a un framework o dividiendo el producto en microservicios. La arquitectura presente permite corregir los defectos y mejorar sus límites de forma gradual, preservando los lectores, datos, validaciones y modo offline.

## 9. Alcance y límites de la revisión

Se revisaron documentación vigente, estructura, build, router, componentes compartidos, lectores, herramientas de generación, física y los puntos de integración de las vistas. Se ejecutaron las suites disponibles de Node y pruebas de navegador del HTML compilado. Se inspeccionó visualmente una captura completa de la pantalla de estructura.

La prueba de apertura de pantallas es una comprobación inicial, no una validación exhaustiva de todos sus controles. No se comprobaron todos los botones de descarga, todos los formatos/variantes de archivos, accesibilidad completa, todos los navegadores, todos los pares ancho/tema, todos los caminos de carga WASM, ejecución de scripts en clúster ni escalabilidad con sistemas grandes. No se ejecutó el empaquetador Python contra nuevos binarios ni se regeneraron las referencias externas.

Los resultados de navegador y el contraste de cristalografía quedaron guardados para esta sesión en `C:/Users/Jairo/.codex/tmp/dftlab-audit-20261010/`. Las reproducciones y cifras esenciales están recogidas en este informe para que no dependan de conservar esa carpeta temporal.
