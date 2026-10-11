# Mediciones del bloque H: recursos y rendimiento

Fecha: 2026-10-11. Base: `main` @ `0851268` (A–G fusionados) más la rama del bloque H. Son mediciones, no pruebas de aprobado/fallo: dependen de la máquina y deben repetirse en el equipo de uso antes de decisiones finas.

**Entorno:** contenedor Linux, Intel Xeon 2.10 GHz × 4, Node 22.22.0, Chromium 141.0.7390.37 de Playwright 1.56.1 con WebGL por SwiftShader (sin GPU), `dist/dftlab.html` desde `file://` con la red bloqueada. Con GPU real el coste de render 3D será menor; el de cálculo en JS no cambia.

**Datos representativos:** los de la propia aplicación (ejemplos de Postproceso, bandas y funciones de onda del Si, fonones del Si, átomo de Xe en Kohn–Sham) y salidas reales de SIESTA 5.4.2 de `corridas/*.tar.gz` (`dens`: `h2o.RHO` 4.9 MB con malla 108³; `espin`: `fm_u4.PDOS` 4.1 MB; `conv`: `k_14.EIG`/`.out`; `solv2`: `ordern_4.out`).

**Reproducir:**

```
cd app && npm ci && node scripts/build.mjs
node tests/perf/measure_views.mjs              # navegador: tareas largas y montón JS
node --expose-gc tests/perf/measure_parsers.mjs   # Node: lectores y mallas (mediana de 5)
```

## Bloqueo del hilo principal en navegador

Tarea larga = más de 50 ms sin ceder el hilo (PerformanceObserver `longtask`). TBT = Σ(duración − 50 ms) dentro de la acción y 1.2–2.5 s posteriores. «duración» es lo que tarda la acción en cumplir su condición de espera (cambio de pantalla, selector o texto); en `#ks` el cálculo inicial corre en un temporizador justo después, por eso su duración es corta y su TBT alto. Con la rama H:

| acción | tareas largas | máx (ms) | TBT (ms) | duración (ms) |
|---|---:|---:|---:|---:|
| montar #ks | 1 | 907 | 857 | 22 |
| montar #pseudos | 0 | 0 | 0 | 47 |
| montar #xc | 0 | 0 | 0 | 40 |
| montar #base | 0 | 0 | 0 | 25 |
| montar #scf | 0 | 0 | 0 | 26 |
| montar #solvers | 0 | 0 | 0 | 21 |
| montar #bandas | 1 | 68 | 18 | 110 |
| montar #dftu | 0 | 0 | 0 | 24 |
| montar #densidad | 0 | 0 | 0 | 80 |
| montar #potencial | 0 | 0 | 0 | 33 |
| montar #espin | 0 | 0 | 0 | 57 |
| montar #lectura | 1 | 58 | 8 | 68 |
| montar #fonones | 1 | 320 | 270 | 409 |
| montar #fuerzas | 2 | 82 | 42 | 149 |
| montar #beyond | 0 | 0 | 0 | 34 |
| montar #estructura | 1 | 64 | 14 | 94 |
| montar #calc | 0 | 0 | 0 | 27 |
| montar #post | 0 | 0 | 0 | 7 |
| ks: resolver Xe (Z = 54) | 2 | 2036 | 3942 | 4108 |
| bandas: clic en una banda (función de onda, isosuperficie) | 1 | 245 | 195 | 249 |
| post: ejemplo relajación Si₈ | 1 | 51 | 1 | 115 |
| post: ejemplo Fe bcc con espín | 1 | 83 | 33 | 191 |
| densidad: leer h2o.RHO (4.9 MB, 108³) | 0 | 0 | 0 | 52 |

## Lectores y mallas (Node, mismo motor V8)

| operación | mediana (ms) | máx (ms) | Δheap (MB) |
|---|---:|---:|---:|
| parseGrid h2o.RHO (4.89 MB) | 27.5 | 30.6 | 0.1 |
| parseGrid si.RHO (0.85 MB) | 0.8 | 10.5 | 0.0 |
| fm_u4.PDOS (4.12 MB) | 32.3 | 44.2 | 0.2 |
| k_14.EIG (0.66 MB) | 6.4 | 8.5 | 1.0 |
| k_14.out (0.39 MB) | 12.9 | 21.5 | 0.8 |
| ordern_4.out (0.19 MB) | 13.5 | 15.9 | -0.0 |
| h2o.out (0.03 MB) | 2.3 | 3.1 | -0.1 |
| planarAverage h2o.RHO (malla 108×108×108) | 3.3 | 7.3 | 0.0 |
| planeSlice h2o.RHO 200×200 | 9.9 | 26.0 | 0.0 |
| isoSurface h2o.RHO (108×108×108, 10 % del máximo) | 176.6 | 186.9 | 2.9 |

## Memoria

Montón JS tras recolección forzada (CDP), en `#inicio`:

| momento | antes de H (`0851268`) | con H |
|---|---:|---:|
| carga inicial | 15.8 | 15.8 |
| tras recorrer las 18 pantallas | 22.0 | 21.6 |
| tras 3 recorridos más | 20.5 | 20.1 |

El montón JS no crece con la navegación ni antes ni después de H: las fugas confirmadas no estaban en objetos JS sino en recursos del navegador fuera del montón, medidos en `app/tests/ui/browser_resources.mjs` (en `0851268`: tras recorrer las pantallas y 5 ciclos por las cuatro vistas 3D quedaban 16 contextos WebGL vivos de 32 creados, el aviso «Too many active WebGL contexts. Oldest context will be lost» y 147 lienzos desconectados aún observados por `ResizeObserver`; barrer ε₂ en Bandas pasaba de 358 a 682 buffers WebGL. Con H: 0 contextos vivos fuera de pantalla, 0 observados desconectados y buffers estables).

## Decisión sobre Web Workers

- **No se introduce ningún worker en esta estabilización.** Solo una acción supera claramente el umbral de respuesta: resolver un átomo pesado en Kohn–Sham (Xe: una tarea de ~2 s y TBT ~3.9 s; el montaje de `#ks`, que resuelve el Si por omisión, ~0.9 s). Es un cálculo educativo puro (`physics/`), sin DOM, y es el **candidato** a moverse a un worker en un bloque posterior, tras medir en el equipo de uso: la vista ya muestra «Calculando…» y desactiva el botón mientras corre.
- Fonones (~0.3 s al montar, diagonalización del `.FC` incluida) y la isosuperficie de una función de onda en Bandas (~0.25 s) quedan por debajo de medio segundo: no justifican hoy la complejidad de un worker.
- La lectura de archivos reales (hasta ~5 MB) cuesta decenas de milisegundos; `isoSurface` sobre una malla 108³ cuesta 0.13–0.26 s, pero la aplicación no la ejecuta hoy sobre mallas de usuario (solo sobre las funciones de onda empaquetadas, 0.25 s).
- No medido: mallas de usuario mayores (p. ej. 200³ o con espín), equipos modestos o móviles, y GPU real.
