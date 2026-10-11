# Inventario P0: T-001 y T-002

Esta entrega describe la aplicación existente. No añade capacidades de cálculo, no cambia `app/` ni sus tolerancias y no sustituye las fuentes históricas. [MATRIX.md](MATRIX.md) es la matriz revisable; [inventory.json](inventory.json) conserva hashes, consumidores, pruebas, símbolos y expresiones completas de exportación. [catalogue.mjs](catalogue.mjs) distingue cobertura científica de smoke UI y registra orígenes no demostrados como pendientes.

## T-001: alcance y conservación

El registro tiene **19 vistas** (15 capítulos), **7 paneles de calculadoras**, **23 rutas de lectura SIESTA** (22 entradas del dispatcher más mallas binarias), **6 familias de lectura estructural y 6 formatos de escritura**, **16 datasets / 10 678 665 bytes**. El snapshot actual, regenerado tras X4, tiene **55 JS propios / 11 548 líneas**, **25 módulos científicos** y **52 sitios de llamadas de exportación**. Estos conceptos tienen definiciones distintas: no sumar aliases, llamadas dinámicas y formatos como si fueran una única métrica de capacidades.

El checker lee el registro y las fuentes sin ejecutar módulos DOM; exige correspondencia entre las entradas descubiertas y el catálogo, comprueba la existencia de las pruebas citadas, hashes y matriz regenerada. No acredita cobertura científica de cada símbolo. Si una vista o dataset se añade sin inventariar, o una fuente cambia sin revisión del inventario, falla.

```powershell
node docs/inventory/audit.mjs
# Tras revisar un cambio real de fuente/catálogo:
node docs/inventory/audit.mjs --write
git diff -- docs/inventory/
```

La comprobación funciona también en Linux/WSL con Node 24.18.0, sin npm ni Python. X1 lo verificó localmente. X4 lo añade a `scripts/verify.mjs` y por tanto a `npm test`/CI Windows y Linux; exige regenerar y revisar el inventario al cambiar las fuentes, sin modificar `ci.yml`. Las suites existentes siguen siendo la puerta de comportamiento.

| Capa/artefacto | Fuente conservada | Uso y política |
|---|---|---|
| Aplicación actual | `app/dftlab/static/`, `app/scripts/`, `app/tests/` | Fuente versionada; física/lectores antes de UI nueva. No hay `app/src/` en esta copia. |
| Build | `app/dist/dftlab.html`, `dftlab_artifact.html` | Salidas regenerables offline, **fuera de Git**; hashes por ejecución, no promesa de identidad entre compiladores. |
| Original migrado | `baseline-v1` @ `bd4fa06a11e4c47448adbb17d05fad92f4b7d57b`; manifiesto histórico | 480 archivos / 132 585 346 bytes; se verifica contra Git sin exigir que la fuente actual revierta las correcciones A–H. |
| Material científico original | `corridas/`, `prototipo_v2/`, `pseudo_xc/`, `app/dftlab/data/pseudos/` | Entradas/salidas, seis generadores JS archivados y 23 tar.gz. No ejecutar jobs desde el inventario. Algunas mallas grandes no fueron archivadas: ver `corridas/LEEME.txt`. |
| Referencias de pruebas | `app/tests/siesta/make*_reference.py`, `app/tests/crystal/make_reference.py` | Cuatro generadores calificados por F en Linux/WSL; no regeneran los 16 datasets didácticos. Entorno independiente `tools/reference-env/`. |
| Motores | Repositorios externos fijados por commit | El inventario de API de C2 y el borrador X2 son independientes de este frontend; smoke UI no valida un motor. |

## T-002: baseline reproducible

Base de reparto `f5b37eb7d0309abefc32b6c5d728ba3464699f69`. Se incorporaron por merge las entregas C1/C2/ADR-015/C3 hasta `8ecd845a809a27fc992b3f8ffb9fd7fc1b77d502`. Las fuentes de app son las de A–H; C3 añade la comprobación estática de contratos a `scripts/verify.mjs`.

Versiones frontend: Node **24.18.0**, npm **11.16.0** en la prueba Windows, esbuild **0.25.10**, Playwright **1.56.1**, Chromium **1194**. Python no interviene en `npm test`; la regeneración usa CPython **3.12.10**, uv **0.11.14**, lock F en Linux x86_64/WSL2. No usar ese entorno como entorno de los motores: HubbardFlow actualmente declara NumPy `<2`.

Desde una copia limpia, instalar Node fijado y ejecutar:

```powershell
cd app
npm ci
npm run browser:install
cd ..
node docs/inventory/record-baseline.mjs --output runtime/x1-baseline.json
```

El último comando reproduce manifiesto histórico, `npm ci`, `npm test` completo y auditoría, escribe reporte de versiones, SHA de fuente, logs y hashes de ambos HTML dentro de `runtime/`, y falla si se alteran fuentes. La misma secuencia vale en Linux; para Chromium con dependencias de sistema en CI se usa `npx playwright install --with-deps chromium`. Instrucciones generales en [INSTALL_AND_VERIFY.md](../development/INSTALL_AND_VERIFY.md) y Python en [PYTHON_REFERENCES.md](../development/PYTHON_REFERENCES.md). Para regenerar referencias, usar ese segundo documento; no modificar datasets ni tolerancias.

Resultado local completo Windows 11 Home 10.0.26200, x64: lectores 341/0, mallas 81/0, notas out 26/0, FC 101/0, importación 75/0, caminos de bandas 32/0, cristalografía 371 estructuras y 71 formatos, calculadora 51/0, escape 15/0, ciclo de vida 21/0, recursos 15/0, build y servidor en verde. Navegador: A/E 24/0, B completo, C/D 33/0, G 22/0, H completo; offline en ambos HTML (file://, red deshabilitada, WASM SG 227, cF2, WebGL y FDF), smoke Moyo fetch/inline/global. C3: 30 schemas, 89 fixtures declarados y 27 operaciones; checker estático 0 fallos, **no equivale a validar todas las instancias JSON Schema**. La CI Linux/Windows de este PR y el job separado de referencias Python se citan en la sección X1 del traspaso.

## Fallos conocidos y regresiones

| Tipo | Estado y evidencia | Acción posterior |
|---|---|---|
| Regresiones en la ejecución registrada | **Ninguna observada** en suites obligatorias; esto no prueba todas las interacciones ni validez científica de cada calculadora. | Una suite que falla bloquea entrega; no ampliar tolerancias. |
| Avisos heredados de build | Tres `empty-import-meta` del vendor Moyo por salida IIFE. La ruta WASM inline pasa offline en ambos HTML. | Resolver al cambiar estrategia de build/vendor con prueba de equivalencia; no ocultar avisos. |
| Cobertura limitada | BM, masa efectiva, smearing, unidades y formación carecen de suite numérica independiente; el átomo KS tiene smoke/perfil de UI, sin oracle científico independiente en esta puerta. Algunos aliases SIESTA no tienen fixture nominal dedicado. | Añadir oracles/fixtures antes de sustituir fórmulas o afirmar certificación. |
| G: ambigüedad de formato | BandPoints no declara cortes; un tramo BandLines de un paso se trata como salto; FDF no se cruza para confirmar el camino. | Preservar limitación explícita y CSV segmentado; ampliar en T-033. |
| H: latencia | Xe tarda ~2 s según [MEDICIONES_H.md](../reviews/MEDICIONES_H.md); falta medir GPU real/equipos modestos/mallas >108³. | T-062 medido en equipo objetivo antes de decidir worker KS. |
| Procedencia incompleta | Generación exacta de varios datasets pendiente; mallas VH/VT grandes de función trabajo no archivadas. `wf` significa función trabajo, no el origen de `si_wf.json`. | Registrar límites; conservar JSON histórico, no inventar un generador. |
| Distribución y cálculo | CI frontend no ejecuta SIESTA, SSH, MPI ni SLURM, ni cualifica HF-1. Fixtures JSON Schema completos pendientes de X5. | Gates separados por target y capability. |

## T-003…T-006: cobertura A–H existente

Los commits siguientes son **commits de fusión comprobados**, no reconstrucciones de ramas. Los documentos históricos A–H conservan su narrativa; esta tabla es el estado contrastado.

| Ticket | Cubierto | PR / commit | Prueba persistente |
|---|---|---|---|
| T-003 navegación XC→inicio→tema, observers | B y H | [#4](https://github.com/Jairomcarmona/dftlab-suite/pull/4) `b691f253425470d9e1a68b7326cf0566813c8d30`; [#9](https://github.com/Jairomcarmona/dftlab-suite/pull/9) `db0a60a717832130bba72c7c968c0d2428a4677d` | `run_lifecycle_tests.mjs`, `browser_lifecycle.mjs`, `run_resources_tests.mjs`, `browser_resources.mjs`; mediciones H separadas. |
| T-004 asociación EIG/KP, RHO bytes, pack | C/D y preservación G | [#6](https://github.com/Jairomcarmona/dftlab-suite/pull/6) `b9de59a3ed452d18cd14146f1ad657e38af4bd56`; [#7](https://github.com/Jairomcarmona/dftlab-suite/pull/7) `08512680abc8e661d6d858f7709127284f4d0d98` | `run_import_tests.mjs` 75, `browser_import.mjs` 33; `run_bands_path_tests.mjs` 32, `browser_bands.mjs` 22. |
| T-005 metadatos/atributos hostiles | E | [#3](https://github.com/Jairomcarmona/dftlab-suite/pull/3) `73dc701f06c685809b330ece596aa993ccb67709` | `run_escape_tests.mjs` 15; `browser_regressions.mjs` incluye ejecución de payloads y nombres hostiles. |
| T-006 runner Windows ESM | Corrección previa + gate F | `e502b717a7813fb217a729c653eb19f925af6530` introdujo `pathToFileURL`; [#5](https://github.com/Jairomcarmona/dftlab-suite/pull/5) `296bb15b9f77e58be716adf6b10c886d8ca83d53`; [#8](https://github.com/Jairomcarmona/dftlab-suite/pull/8) `777b181fb255d30a176d0ed6f5f6ffcee1c8d8df` | `app/tests/crystal/run_tests.mjs` desde checkout Windows/Linux (371/71); referencias regeneradas Linux/WSL con uv lock. F no introdujo la corrección ESM, la conserva/verifica. |

A ya cubre el cuelgue de calculadora: [#2](https://github.com/Jairomcarmona/dftlab-suite/pull/2), `7fe35b0ed2370036cbed2b14b7aad4f7902a8046`, `run_calc_tests.mjs` 51 y `browser_regressions.mjs`. No se reimplementa en Ola 0. Los pendientes G/H y de cobertura no se declaran resueltos por inventariarlos.
