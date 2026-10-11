# DFT Lab: arquitectura y contrato para los módulos

Este documento es el contrato que siguen todos los hilos que construyan un módulo de DFT Lab. Si algo aquí contradice a `PLAN_DFT_App.md` o a `MAPA_DE_CONTENIDOS.md`, manda este archivo: esos dos son anteriores a la decisión de que la app no ejecuta SIESTA.

Estado al 11 de octubre de 2026: se adoptan los ADR-001…012 de la arquitectura V2.1 (§0). Las secciones 1–10 describen la aplicación actual y siguen vigentes salvo donde §0 indica lo contrario. Versión publicada del frontend: https://claude.ai/artifact/C6hF2LuPiau6mkVUrf3GKD

---

## 0. Arquitectura V2.1: decisiones adoptadas

La [propuesta maestra V2.1](PROPUESTA_MAESTRA_DFTLAB_V2.md) y su [plan](PLAN_IMPLEMENTACION_CLAUDE_CODE.md) definen el destino; los ADR de [`docs/adr/`](docs/adr/README.md) fijan las decisiones. **Adoptar un ADR no implementa nada:** cada decisión indica sus tickets pendientes. Los schemas y la OpenAPI de `contracts/` (Ola 1) serán la definición ejecutable; este archivo es la entrada al contrato vigente.

| ADR | Decisión |
|---|---|
| [001](docs/adr/ADR-001-frontend-modular-dos-builds.md) | Frontend modular; build portátil y operativo desde una fuente; cálculo externo |
| [002](docs/adr/ADR-002-aprender-produccion-procedencia.md) | Aprender y producción separados; promoción explícita a borrador; origen/finalidad/procedencia/evaluación |
| [003](docs/adr/ADR-003-autoridades-qraft-hubbardflow-plataforma.md) | QRAFT dueño del runtime; HubbardFlow de LR-U; plataforma de operaciones e identidad |
| [004](docs/adr/ADR-004-contratos-versionados-adaptadores.md) | Contratos JSON Schema/OpenAPI versionados; adaptadores sobre API pública |
| [005](docs/adr/ADR-005-locks-nativos-canonicos-db-indices.md) | Locks y journals nativos canónicos; DB con operaciones e índices reconstruibles |
| [006](docs/adr/ADR-006-hubbard-hf1-hf2.md) | Hubbard HF-1 primero; HF-2 tras contrato upstream |
| [007](docs/adr/ADR-007-controlador-unico-reconciliacion-idempotencia.md) | Un controlador por run, reconciliación, idempotencia, `UNKNOWN` visible |
| [008](docs/adr/ADR-008-servicio-local-ssh-autorizacion.md) | Servicio local seguro, SSH/terminal y autorización por recurso |
| [009](docs/adr/ADR-009-politicas-gates-cientificos.md) | Políticas y gates científicos versionados; evidencia antes de calificación |
| [010](docs/adr/ADR-010-almacen-retencion-sqlite-postgres.md) | ArtifactStore, retención y reproducción; SQLite local, PostgreSQL web |
| [011](docs/adr/ADR-011-despliegues-por-target-workers-fijados.md) | Despliegue por target; workers fijados durante cada campaña |
| [012](docs/adr/ADR-012-releases-migraciones-catalogo-capabilities.md) | Releases compatibles, migraciones y catálogo de capabilities probado |

ADR-013 (React y TypeScript) sigue **propuesto**; ADR-014 (entorno Python de referencias) es independiente de V2.1. [ADR-015](docs/adr/ADR-015-hubbardflow-capa-privada-bajo-qraft.md): HubbardFlow es una capa obligatoria bajo QRAFT, mantenida en un repositorio privado aparte y sin redistribución pública. Los ADR-003, 004, 006, 007 y 012 tienen puntos marcados «pendiente C2» que esperan el inventario de API de los motores (`docs/compatibility/`); la asignación de autoridad no depende de ese inventario.

### 0.1 Dos builds de una fuente (ADR-001)

| Build | Uso | Servicio |
|---|---|---|
| Portátil, `dist/dftlab.html` | Aprender, preparar, leer y exportar offline (lo que existe hoy) | No; lo remoto queda oculto |
| Operativo | Lo anterior más Campañas, Remoto y Proyectos | Servicio en loopback (después, web autenticado) |

No se duplican pantallas. El navegador sigue sin ejecutar SIESTA; enviar un cálculo es una acción explícita contra la API, nunca un efecto de montaje.

### 0.2 Capas y dependencias

| Capa | Dónde | Puede depender de |
|---|---|---|
| Presentación | `js/views/`, `core/` (DOM, charts, visor) | Aplicación frontend, módulos puros |
| Aplicación frontend | `js/application/`, `js/sdk/` (destino) | Contratos y SDK; nunca SSH ni scheduler |
| Módulos puros | `js/siesta/`, `js/crystal/`, `js/physics/` | Nada de DOM ni de framework |
| Servicio de plataforma | `platform/` (destino, Codex X2) | Puertos abstractos y contratos; dominio sin HTTP/SSH/DB |
| Integración científica | `platform/.../integrations/` | Solo API pública de QRAFT y HubbardFlow |
| Dominio científico | Repositorios de QRAFT y HubbardFlow | Sin cambios desde la plataforma |

Las reglas de imports se verificarán en CI. QRAFT y HubbardFlow no se copian al repositorio. HubbardFlow se fija por commit desde su repositorio privado (ADR-015).

### 0.3 ViewScope (ADR-001)

El router ya crea un ámbito por montaje (`core/lifecycle.js`, `createViewScope`, bloque B) y lo pasa como `render(el, view)`. Ese ámbito es el `ViewScope` de V2.1: T-012 lo amplía con workers y disposables, y T-013 añade stores por proyecto/área en lugar de estado compartido entre vistas. Tras cada `await`, una vista comprueba `view.alive`.

### 0.4 Servicio y autoridad (ADR-003, 005, 007, 008)

- **Quién decide qué:** QRAFT ejecuta (locks, intentos, journal); HubbardFlow decide LR-U (plan, gates, análisis); la plataforma administra proyectos, operaciones, identidad, conexiones y archivos. La plataforma no guarda otro DAG.
- **Estado:** los locks y journals nativos son canónicos; la DB guarda operaciones e índices reconstruibles. Cuatro dimensiones: scheduler, ejecución, integridad y evaluación científica.
- **Operaciones:** 202 + operation ID, idempotency key, intención persistida antes del efecto, envío reconciliable (`SUBMISSION_UNKNOWN`), un controlador por run con fencing, cancelar es una solicitud.
- **Servicio local:** loopback con Host/Origin, bootstrap de un uso, cookie HttpOnly y CSRF; sin acceso desde `file://`. La terminal SSH es una capacidad privilegiada explícita, no el mecanismo de ejecución.

### 0.5 Qué cambia en las secciones siguientes

- §1 se conserva íntegra (rigor, idioma, defaults físicos, navegador sin SIESTA). En el build operativo la app además coordina ejecución externa a través del servicio.
- §3: las vistas reciben `render(el, view)`; registrar suscripciones con `view.onTheme` en vez de `onTheme` global.
- §8 queda **sustituida por [ADR-008](docs/adr/ADR-008-servicio-local-ssh-autorizacion.md)**: no hay token impreso ni `session.run('sbatch …')` como forma de lanzar trabajos; la fachada `remote` se conserva.
- `ARQUITECTURA.md` §§1–10 sigue siendo el contrato de los módulos actuales hasta que cada ticket migre su parte.

## 1. Decisiones ya tomadas (no se reabren)

- **La interfaz web no ejecuta SIESTA.** SIESTA corre donde el usuario quiera (laptop o clúster). La app hace tres cosas:
  - enseña con datos de corridas reales ya hechas;
  - **lee** archivos de salida que el usuario arrastra (drag-and-drop o selector);
  - **exporta** archivos: `.fdf`, scripts de clúster (SLURM, PBS, SGE o local), estructura (CIF, XYZ, extXYZ, POSCAR, fdf), figuras (SVG, PNG), datos (CSV, JSON), hook de Lua e informes en Markdown.
- **Funciona en dos modos con el mismo código:**
  - un solo HTML autocontenido que se abre desde `file://`, sin red, en una laptop;
  - servido desde un servidor estático.
- **Es un curso formal, no un juego.** Hay teoría, gráficas, herramientas y calculadoras, sin cuestionarios. Cada gráfica sale de un cálculo real con su procedencia: versión, fdf, pseudos y mallas.
- **Valores por defecto de la física:**
  - base DZP;
  - SIESTA 5.4.2;
  - en v1 no hay SOC, espín no colineal, híbridos ni GW, salvo como texto conceptual.
- **Idioma:** español, con el término en inglés la primera vez que aparece, por ejemplo "mezcla (mixing)".
- **El código vive en** `/mnt/project-files/DFT_App/app/`.
- **Rigor:** todo número que se muestre está medido o citado.
  - Si una explicación es una inferencia, el texto lo dice.
  - Si un resultado no coincide con la literatura (por ejemplo, U lineal en NiO = 13.8 eV), se muestra igual y se explica.

## 2. Estructura del código

```
DFT_App/
  ARQUITECTURA.md          este contrato
  PLAN_DFT_App.md          plan original (histórico)
  MAPA_DE_CONTENIDOS.md    temario completo (fuente de ideas para módulos)
  corridas/*.tar.gz        entradas, scripts y salidas de texto de TODAS las corridas SIESTA usadas
  app/
    package.json           solo esbuild 0.25.10 (npm i); todo lo demás está en vendor/
    scripts/build.mjs      genera dist/dftlab.html (autocontenido) y dist/dftlab_artifact.html
    scripts/dftlab_pack.py TSHS/HSX → JSON con sisl (corre donde está la corrida, no en la app)
    tests/siesta/          node run_tests.mjs  (341 pruebas de los lectores; además run_rho_tests, run_outnotes_tests y run_fc_tests)
    tests/crystal/         node run_tests.mjs  (371 pruebas de simetría, k-path y formatos)
    dist/                  salida del build; dftlab.html es el entregable
    dftlab/data/pseudos/   biblioteca ONCVPSP (lda, pbe, inputs, outputs, validation)
    dftlab/static/
      index.html           cascarón; build.mjs le incrusta CSS y JS
      css/app.css          tokens de color y componentes compartidos
      css/views/<id>.css   estilos propios de una sección (build.mjs los concatena)
      vendor/              bibliotecas de terceros, NUNCA se editan: three/ (r128 + OrbitControls), moyo/ (simetría, wasm)
      js/
        main.js            barra lateral + router por hash (#id)
        core/ui.js         $, $$, css(token), alpha, fmt, esc, el, seg, download, downloadText, toast, onTheme, panel
        core/chart.js      chart(canvas,cfg) y exportBar(canvas,nombre) → SVG/PNG/CSV
        core/svgctx.js     contexto 2D que escribe SVG (lo usa exportBar)
        core/three-view.js visor 3D (estructura, zona de Brillouin)
        core/scene.js      cellScene(cell) → átomos y enlaces para el visor
        siesta/            lectores de TODOS los archivos de SIESTA (ver siesta/README.md)
        crystal/           simetría (usa vendor/moyo), seekpath, zona de Brillouin, formatos (ver crystal/README.md)
        physics/atom.js    solucionador Kohn–Sham atómico radial (LDA), validado contra PySCF
        tools/fdfgen.js    siestaInput(), bandLinesFor(), jobScript(): generador de .fdf y scripts
        data/*.json        datos empaquetados de corridas reales (sección 5)
        views/*.js         un archivo por pantalla
        views/registry.js  orden y grupos de la barra lateral
        remote/index.js    punto de extensión para la futura terminal SSH (vacío, ver §8)
```

### Reglas de desacoplamiento (verificadas el 10 oct 2026)

- **Un archivo por sección:** `views/<id>.js` (el más grande, postproc, pesa 32 KB) y, si necesita estilos propios, `css/views/<id>.css`. Para tocar una sección solo se abren esos dos archivos.
- **Datos fuera del código:** todo resultado de cálculo vive en `js/data/*.json` y se importa con `import D from '../data/x.json'`. Ninguna vista contiene arreglos numéricos largos; solo constantes pequeñas citadas (valores experimentales, tablas de referencia de unas pocas filas). Los JSON se generan con scripts guardados en `corridas/` y no se editan a mano.
- **Bibliotecas fuera del código editable:** `vendor/` no depende de `node_modules`; el build solo necesita esbuild.
- **Un solo HTML al final:** `scripts/build.mjs` junta JS, CSS y JSON en `dist/dftlab.html`.
- Un módulo nuevo que rompa estas reglas no se integra.

## 3. Contrato de un módulo (una pantalla)

> Desde el bloque B el router llama `render(el, view)` con un ámbito de vista (`core/lifecycle.js`); el ejemplo de abajo muestra la forma histórica `mount(root)`. Ver §0.3.

Un módulo nuevo es **un archivo** `js/views/<id>.js`, **opcionalmente un JSON** en `js/data/` y **una línea** en `views/registry.js`. No toca otros archivos salvo `css/app.css`, y solo para añadir clases nuevas al final.

```js
// js/views/ejemplo.js
import { $, $$, css, alpha, fmt, onTheme, downloadText, seg } from '../core/ui.js';
import { chart, exportBar } from '../core/chart.js';
import D from '../data/ejemplo.json';          // el build lo incrusta

export function mount(root){                   // root = <main id="view">, ya vacío
  root.innerHTML = `
  <div class="pghead"><div>
    <div class="kicker">Aprender · N</div><h1>Título</h1>
    <p class="lede">Una o dos frases con el resultado principal y sus números.</p>
  </div></div>
  <div class="pgrid">
    <article class="panel theory sticky">…teoría con <h3>, <p>, <div class="eq">, <p class="src">referencias</p></article>
    <div class="charts">
      <section class="panel wide"><div class="ph"><h2>Gráfica</h2></div>
        <div class="pb"><canvas data-export="nombre_archivo" id="cv1" style="height:300px"></canvas>
        <div class="readout" id="rd1"></div><p class="note">Qué se ve y por qué.</p></div></section>
      …
    </div>
  </div>
  <footer class="prov">Procedencia: código, versión, funcional, base, mallas, pseudos, referencias experimentales.</footer>`;
  $$('canvas[data-export]',root).forEach(cv=>cv.closest('.panel').querySelector('.ph').append(exportBar(cv,cv.dataset.export)));
  const draw=()=>{ chart($('#cv1',root),{ /* cfg */ }); };
  onTheme(draw); draw();                       // redibuja al cambiar de tema
}
export function destroy(){ /* solo si hay timers, workers o visor 3D */ }
```

En `registry.js`:

```js
{id:'ejemplo', group:'learn'|'tools'|'post', num:'N', title:'Título corto', render:ejemplo.mount, destroy:ejemplo.destroy, desc:'Una frase para la portada.'}
```

### API de `chart(canvas, cfg)`

- **Ejes:**
  - `xlim`, `ylim` como `[a, b]`;
  - `logx` y `logy`;
  - `xlabel`, `ylabel`;
  - `xticks` como `[{x, label}]` (por ejemplo, etiquetas de puntos k);
  - `yticksStep`.
- **Series:** `series: [{d: [[x,y],…], color, width, dash, label, fill: y0, fillAlpha}]`. Con `legend: true` aparece la leyenda; solo entran las series que tienen `label`.
- **Anotaciones:**
  - `shade: [{x0, x1, y0, y1, color, label}]`;
  - `vlines` y `hlines`: `[{x|y, label, color, dash}]`;
  - `points: [{x, y, color, r, label, align}]`.
- **Lectura con el cursor:** `read: x => html` y `readEl`. Cuando `x == null`, la función devuelve el texto por defecto. Para desactivarla, `nohover: true`.
- **Exportación:** `exportBar(cv, nombre)` añade los botones SVG, PNG y CSV. El CSV sale de las `series`.

### Reglas de interfaz

- **Colores:** siempre con `css('--token')`, nunca con literales.
  - Tokens: `--bg`, `--panel`, `--panel-2`, `--ink`, `--muted`, `--faint`, `--line`, `--accent`, `--accent-soft`, `--ok`, `--warn`, `--bad`, `--up`, `--dn`.
  - Orbitales: `--orb-s`, `--orb-p`, `--orb-d`, `--orb-f`.
  - Otros: `--psi-pos`, `--psi-neg`, `--gapfill`, `--e1`.
  - Familias tipográficas: `--f-ui` (IBM Plex Sans), `--f-data` (Plex Mono), `--f-eq` (Plex Serif), `--f-label` (Plex Sans Condensed).
- **Clases ya hechas:**
  - estructura: `pghead`, `kicker`, `lede`, `pgrid`, `panel`, `panel wide`, `theory sticky`, `charts`, `ph`, `pb`;
  - contenido: `eq`, `note`, `src`, `readout`, `sw` (muestra de color), `seg` (botones segmentados, con `seg(container, valor, onChange)`);
  - controles y tablas: `btnrow`, `tiny`, `sl` (deslizador con `<output>`), `tbl`, `kv` (`<dl>`), `code`, `split2` (2 columnas, 1 en móvil), `callout warn`, `drop`, `prov`.
- **Ancho:** todo funciona a 400 px de ancho y en tema claro y oscuro, sin scroll horizontal del body.
- **Prueba con capturas** (Playwright):

  ```
  PW=$(npm root -g)/playwright node /opt/run/apptest/shot.js dist/dftlab.html <id> 1440 light
  PW=$(npm root -g)/playwright node /opt/run/apptest/shot.js dist/dftlab.html <id> 400 dark
  ```

  El script imprime `scrollWidth` y los errores de consola. Ambos deben quedar limpios. `/opt/run` no persiste entre contenedores: si falta, el script cabe en 15 líneas (abrir `file://…#id`, esperar 1.5 s, `screenshot fullPage`).
- **Tipografía del texto:** las unidades y los símbolos van en Unicode o HTML (`μ<sub>B</sub>`, `Å⁻¹`, `χ₀`), nunca en LaTeX.
- **Descargas:** se usa `downloadText(texto, nombre)` o `download(blob, nombre)`. En el artifact publicado las descargas están bloqueadas por el sandbox. En `dist/dftlab.html` funcionan.

## 4. Formatos de datos comunes entre módulos

Todos en eV y Å, salvo que se diga otra cosa. Las funciones radiales se dan en Bohr y Ry.

| Qué | Forma | Quién la produce o consume |
|---|---|---|
| **Estructura** (cell) | `{lattice: [[a],[b],[c]] filas en Å, positions: [[f]] fraccionarias, numbers: [Z], labels?, types?}` | `crystal/*`, `scene.js`, `fdfgen.js`, `estructura.js`, `postproc.js` |
| **Salida .out** | `parseOut(text)`: species, steps[] con scf[], energías finales, poblaciones de Mulliken, fuerzas, tiempos, advertencias. El esquema completo está en `siesta/README.md`. | postproc y cualquier módulo que lea un .out |
| **Bandas** | `parseBands`: `{x (1/Å), E[k][banda] o [espín][k][banda], fermi, ticks, labels}` | bands, postproc, calc (masa efectiva) |
| **EIG + KP** | `parseEIG` → `analyzeGap(e)` = `{gap, type: 'direct'\|'indirect', vbm, cbm}` | DFT+U, postproc |
| **PDOS** | `parsePDOS` → `{energy, fermi, nspin, orbitals[]}`; agrupar con `groupPDOS(p, ['species','l'], 'up'\|'down')` | DFT+U, postproc |
| **SCF grabado** | `scf_runs.json`: `runs[{id, system, method, weight, history, cols, iters[[…]], final, converged, fdf}]`, `lua[{it, Etot, Ekin, Exc, dD, dH, …}]` | scf.js |
| **Lua en vivo** | `live.jsonl`: una línea JSON por iteración con claves en minúscula (`e.total`, …) en Ry, escrita por el hook `LUA_HOOK` de `scf.js` | postproc (sección Lua) |
| **Malla de SIESTA** | `parseGrid(buf, nombre)` (`siesta/rho.js`): `.RHO`, `.DRHO`, `.VH`, `.VT`… → `{cell (Å), mesh, nspin, data[espín] Float32Array (ix + nx·(iy + ny·iz)), units, volume}`; `planeSlice`, `lineProfile`, `planarAverage`, `sampleFrac`, `gridIntegral`. Pruebas: `node tests/siesta/run_rho_tests.mjs` | densidad (y futuro potencial electrostático) |
| **Constantes de fuerza** | `parseFC(text, {nAtoms?})` (`siesta/fc.js`) → `{nAtoms, displ, nDisplaced, blocks}`; `fcRows(fc, first)` promedia ±Δu → filas Φ (eV/Å²). `physics/phonon.js`: `phononModel({superCell, n, masses, phi, asr, ws})`, `frequencies(M, q)` (THz), `pathFromSegments`, `dispersion`, `phononDOS`. Pruebas: `node tests/siesta/run_fc_tests.mjs` | fonones |
| **Archivo empaquetado** | `*.dftlab.json` de `scripts/dftlab_pack.py` (H, S y orbitales para bandas o funciones de onda en el navegador) | `siesta/pack.js: unpackDftlab` |

Un módulo nuevo que necesite un formato que no está aquí:

1. agrega el lector en `siesta/` con su prueba en `tests/siesta/`;
2. documenta el formato en `siesta/README.md`;
3. añade su fila a esta tabla.

## 5. Datos reales ya calculados

Todos los JSON están en `app/dftlab/static/js/data/`. Las entradas y salidas originales están en `DFT_App/corridas/<carpeta>.tar.gz`, empaquetadas con `tar czf`; contienen fdf, scripts, `.out`, `.EIG`, `.bands`, pseudos y tiempos.

| Datos | Sistema y corridas | Usado en |
|---|---|---|
| `si_lda.json`, `si_wf.json` | Si LDA DZP: bandas con carácter orbital, DOS, ε(ω), zona de Brillouin, funciones de onda | 7 Bandas, DOS y óptica |
| `pseudo_xc.json` | pseudos ONCV de Si y C en LDA y PBE (con un ejemplo de fantasma), mapa de xc, EOS del Si y curvas del grafito | 2 Pseudopotenciales, 3 Intercambio y correlación |
| `conv.json` (`corridas/conv`) | 135 corridas de Si: base SZ…TZP, EnergyShift 5–500 meV, MeshCutoff y eggbox, malla k | 4 Base, malla y puntos k |
| `scf_runs.json` (`scf`, `mg`, `lua`) | 8 mezcladores en Si, 4 en un slab de Mg, términos de energía por iteración desde Lua | 5 Ciclo autoconsistente |
| `solvers.json` (`solv2`) | Si SZ con Γ, de 8 a 1000 átomos: diagonalización, OMM y orden N (este último hasta 512), más un barrido de `ON.RcLWF` | 6 Diagonalización y orden N |
| `nio.json` (`nio`) | NiO AFM-II PBE+U con U = 0, 2, 4, 6, 8 y 13.8 eV (con 13.8: gap 3.56 eV, μ 1.89 μB): gap, momento y PDOS. U lineal de Cococcioni en celdas de 4, 8 y 16 átomos = 13.8 eV, convergido en tamaño | 8 DFT+U |
| `examples.json` | ejemplos de Fe con espín y de relajación de Si8 para la pantalla de postproceso | Mis archivos de SIESTA |
| `rho.json` (`rho`) | Si, MgO (base SZ–TZP) y H₂O (SZ–TZP), LDA: planos de ρ y Δρ, perfiles de enlace, cargas Mulliken/Hirshfeld/Voronoi, dipolo del agua desde la malla | 9 Densidad y cargas |
| `potencial.json` (`wf`) | 29 láminas LDA/DZP: Al(111) 3–9 capas, Al(100), Al(110), Mg(0001) 3–9 capas, vacío 10–26 Å, base SZ–TZP, MeshCutoff, constante de red, PAO.EnergyShift; Φ = V_vac − E_F, Δ y μ. Al(111) 9 capas: 3.98 eV con base por defecto, 4.26 con EnergyShift 5 meV (exp. 4.24–4.26); Mg(0001) 3.34 (exp. 3.84), no convergido en el alcance de los orbitales | 10 Potencial y función trabajo |
| `espin.json` (`espin` + AFM de `nio`) | Fe bcc FM y NM en PBE/DZP: 8 parámetros de red, bandas Γ–H–N–Γ–P–H y PDOS en a = 2.866 Å; NiO FM con U = 0–13.8 eV frente a las AFM de la sección 8: ΔE, momentos, gaps y PDOS. Fe: a₀ FM 2.834 Å, μ 2.30 μB, E_NM − E_FM = 551 meV; NiO U = 8: ΔE = 139 meV/celda. Generador `corridas/espin_gen_json.mjs` | 11 Espín y magnetismo |
| `si_fonones.json` (`fonones`) | Si LDA/DZP, supercelda 2×2×2 de 16 átomos con a = 5.396 Å (mínimo propio), k 4×4×4 centrada en Γ, MD.FCDispl 0.02 Å, los 2 átomos de la base desplazados (13 SCF, 19 min). Guarda el .FC y el .fdf; la página diagonaliza. Γ óptico 15.64 THz (exp. 15.53), TA(X) 4.02 (exp. 4.49), error medio 3.2 % en Γ, X y L. Con la malla k desplazada la degeneración TA en X se rompe (4.02/4.12 THz), se muestra en la teoría. Generador `corridas/fonones_gen_json.mjs` | 13 Fonones |
| `fuerzas.json` (`fuerzas`) | LDA, DZP. H₂O en caja de 10 Å: 13 longitudes O–H con DZP/300 Ry, DZP/60 Ry y SZ/300 Ry (F de SIESTA frente a −dE/dr de 5 puntos: ≤ 3 meV/Å; con 3 puntos 65 meV/Å por truncamiento); traslación egg-box con 60 y 300 Ry (60 Ry: 118 meV y 1.78 eV/Å de fuerza neta); DM.Tolerance 10⁻¹…10⁻⁷ con `SCF.H.Converge false`; relajaciones CG (16 pasos), Broyden (10) y FIRE (27) desde la misma geometría: O–H 0.994 Å, 104.4° (exp. 0.9572 Å, 104.52°). Si: vacancia en supercelda cúbica de 64 átomos, a = 5.396 Å, k 2×2×2, CG 12 pasos y 66 min: E_f 3.74 eV sin relajar y 3.47 relajada (exp. 3.6 ± 0.2), vecinos 0.26 Å hacia el hueco, casi T_d. E(a) de 11 puntos con estrés (DZP/300, DZP/100, SZ/300): a₀ 5.3955 Å de E(V) frente a 5.3956 Å con P = 0; celda variable desde 5.60 Å llega a 5.3964 Å en 10 pasos (un paso se cizalla). Generador `corridas/fuerzas_gen_json.mjs` | 14 Fuerzas, estrés y relajación |
| `beyond_dft.json` | Sin cálculo propio: 15 gaps de la Tabla IV de Fuchs et al., PRB 76, 115109 (2007) (HSE03, G₀W₀, GW₀, GW, exp.) y 5 gaps de la Tabla 1 de Lucero, Henderson y Scuseria, arXiv:1111.4515 (LSDA, PBEsol, TPSS, HSE), más las Tablas II–III de Fuchs (punto de partida de G₀W₀). Cada columna lleva su fuente; los datos se leyeron en los preprints, no de memoria. No hay columna PBE: ninguna fuente leída la lista (PBEsol sí). No verificado: la referencia de revista de Lucero et al. y las referencias de la lista escritas de memoria (marcado en la propia página) | 15 Más allá de DFT |
| `pseudo_lib.json` + `data/pseudos/` (`corridas/pslib_val`) | biblioteca ONCVPSP de 30 elementos en LDA y PBE (curvas, pruebas, .psml comprimidos) y ecuaciones de estado de 10 sólidos con SIESTA | 2 Pseudopotenciales |

**Entorno de cálculo:**

- SIESTA 5.4.2 en `/opt/siesta/bin/siesta`. Se corre con `OMP_NUM_THREADS=n siesta x.fdf > x.out`, sin MPI.
- El contenedor tiene 4 núcleos.
- Para el estado actual del entorno, ver la documentación del entorno.

## 6. Módulos

### Hechos

Hecho significa que el módulo está en `registry.js`, compila, no da errores a 1440 y 400 px en tema claro y oscuro, y todas sus gráficas exportan.

| id | Pantalla | Depende de |
|---|---|---|
| inicio | Portada con la lista de secciones | registry |
| ks | 1 Kohn–Sham atómico en vivo (H–Xe) | physics/atom.js |
| pseudos | 2 Pseudopotenciales | pseudo_xc.json, siesta/pseudo.js |
| xc | 3 Intercambio y correlación | pseudo_xc.json |
| base | 4 Base, malla y puntos k | conv.json |
| scf | 5 Ciclo autoconsistente | scf_runs.json |
| solvers | 6 Diagonalización y orden N | solvers.json |
| bandas | 7 Bandas, DOS y óptica | si_lda.json, si_wf.json, three-view |
| dftu | 8 DFT+U en NiO | nio.json |
| densidad | 9 Densidad y cargas | rho.json, siesta/rho.js |
| potencial | 10 Potencial y función trabajo (láminas de Al y Mg, base, vacío, lector .VH/.VT) | potencial.json, siesta/rho.js |
| lectura | 12 Lectura anotada del .out (Fe FM real + .out del usuario; reglas en `siesta/outnotes.js`, pruebas `tests/siesta/run_outnotes_tests.mjs`, datos `out_fe.json` de `corridas/out_gen_json.mjs`) | out_fe.json, siesta/out.js, siesta/outnotes.js |
| fonones | 13 Fonones (Si 2×2×2 por desplazamientos finitos; dispersión, DOS, modo animado 3D, lector .FC del usuario; pruebas `tests/siesta/run_fc_tests.mjs`) | si_fonones.json, siesta/fc.js, physics/phonon.js, three-view |
| espin | 11 Espín y magnetismo (Fe FM/NM, NiO FM/AFM, criterio de Stoner) | espin.json |
| fuerzas | 14 Fuerzas, estrés y relajación (F frente a −dE/dr, egg-box, DM.Tolerance; H₂O con CG/Broyden/FIRE y vacancia del Si en 3D; E(V) con estrés y celda variable; lector de la relajación del usuario, .out o .ANI) | fuerzas.json, siesta/out.js, three-view |
| beyond | 15 Más allá de DFT (escalera de Jacob; gaps de 15 sólidos con LSDA, PBEsol, TPSS, HSE, HSE03, G₀W₀, GW₀ y GW frente al experimento; error medio calculado en la página; punto de partida de G₀W₀; el gap del Si de SIESTA frente a la literatura) | beyond_dft.json, pseudo_xc.json |
| estructura | Estructura y entrada: simetría, BZ, k-path, .fdf, scripts de clúster | crystal/*, fdfgen.js |
| calc | Calculadoras: malla k, Birch–Murnaghan, masa efectiva, smearing, unidades, gas de electrones, energías de formación | si_lda.json |
| post | Mis archivos de SIESTA: lee el .out y otros 15 tipos, exporta figuras, geometría e informe | siesta/*, crystal/* |

### Pendientes sugeridos

Están tomados de `MAPA_DE_CONTENIDOS.md`. Cada uno es un hilo y depende solo de lo ya hecho, salvo donde se indica. Se considera terminado cuando cumple el criterio de "Hechos" y además:

- se calcularon con SIESTA los datos que muestra;
- las corridas se guardaron en `corridas/`;
- su JSON pesa menos de 1 MB.

| Módulo | Contenido | Datos que hay que calcular |
|---|---|---|
| ~~Fuerzas, estrés y relajación~~ | hecho (sección 14) | |
| ~~Densidad y cargas~~ | hecho (sección 9) | |
| ~~Potencial electrostático~~ | hecho (sección 10) | |
| ~~Espín y magnetismo~~ | hecho (sección 11) | |
| ~~Fonones~~ | hecho (sección 13) | |
| ~~Más allá de DFT~~ | hecho (sección 15) | |
| ~~Lectura anotada del .out~~ | hecho (sección 12) | |
| Temario y bitácora | temario de 16 semanas en tres niveles; informe exportable por práctica | ninguno |

### Pendiente técnico de la versión actual

- Ni en PBE: la curva E(a) tiene ~3 meV de ruido que no se va con una tolerancia SCF más estricta; a₀ aproximado y sin B₀. Causa no encontrada.
- Resuelto (bloque G, `docs/reviews/REGISTRO_DEUDA.md`): en postproceso las bandas se cortan en los saltos del camino k declarados por el formato (U|K en BandLines, `A|B` en paquetes). BandPoints no declara tramos y se une en orden.

## 7. Cómo construir y publicar

```
cd /mnt/project-files/DFT_App/app
# sin symlinks en el montaje: npm i en /tmp y DFTLAB_NODE_MODULES=/tmp/x/node_modules
node scripts/build.mjs                       # → dist/dftlab.html (~11.5 MB, incluye los 60 .psml) y dist/dftlab_artifact.html
```

- El build solo necesita esbuild. Si no hay `node_modules`, `build.mjs` lo busca en `/opt/run/tools/node_modules` o en `$DFTLAB_NODE_MODULES`; en un contenedor nuevo basta `npm i` dentro de `app/`.
- Las advertencias de `import.meta` que da moyo son inocuas.
- **Publicación:** se publica `dist/dftlab_artifact.html` como versión nueva del mismo artifact, con `url = https://claude.ai/artifact/C6hF2LuPiau6mkVUrf3GKD`. El entregable para la laptop es `dist/dftlab.html`.
- **Paralelo:** dos hilos no deben editar a la vez `registry.js`, `app.css` ni `build.mjs`; cada sección usa su propio `css/views/<id>.css`. El hilo que añade un módulo hace su cambio en `registry.js` al final, en una sola edición pequeña: relee el archivo justo antes y vuelve a leerlo después para verificar.

## 8. Extensión futura: terminal SSH y conexión al clúster

> **Sustituida por [ADR-008](docs/adr/ADR-008-servicio-local-ssh-autorizacion.md) el 2026-10-11.** Se conserva como registro del diseño anterior; donde difiera, manda el ADR (sesión con bootstrap de un uso, verificación de origen, ejecución por `SchedulerGateway` y no por `session.run`).

Manuel planea añadir una terminal para conectarse por SSH a sus servidores. **No está implementada.** El punto de extensión ya existe:

- **Por qué hace falta un puente.** Un navegador no puede abrir SSH ni TCP. La terminal necesitará un programa local pequeño, `scripts/dftlab_bridge.py` (por ejemplo con asyncssh y websockets), que haga dos cosas:
  - servir `dist/` en `http://127.0.0.1:<puerto>`;
  - traducir WebSocket a SSH, usando `~/.ssh/config` y `ssh-agent`.
- **Dónde queda inactiva.** Abierta desde `file://` o desde el artifact publicado, la app no tiene puente: lo remoto queda oculto y el resto funciona igual.
- **Contrato.** `js/remote/index.js` define `remote.available`, `connect(host)` y una sesión con `terminal(el)`, `put`, `get`, `run` y `close`. Las vistas solo usan ese contrato, nunca el WebSocket directamente.
- **Interfaz.**
  - Un grupo nuevo `remoto` en `registry.js`, con `views/terminal.js`. Esta vista solo se registra si `remote.available` es verdadero.
  - xterm.js va en `vendor/xterm/`.
- **Integración con lo que ya existe:**
  - el `.fdf` y el `.sh` de `tools/fdfgen.js` se envían con `session.put` además de descargarse;
  - `session.run('sbatch …')` lanza el trabajo;
  - los archivos traídos con `session.get` entran a `siesta/index.js` `parseMany()`, igual que al arrastrarlos a «Mis archivos de SIESTA».
- **Seguridad.** Las credenciales y llaves nunca pasan por la página ni por `localStorage`. El puente escucha solo en 127.0.0.1 y pide un token que imprime al arrancar.

## 9. Estado de los módulos nuevos (10 oct 2026)

- **Hechos:** densidad y cargas (9), potencial y función trabajo (10), espín y magnetismo (11), lectura anotada del .out (12), fonones (13), fuerzas, estrés y relajación (14) y más allá de DFT (15, solo literatura: no hay corridas ni generador de JSON; el JSON se copió a mano de las tablas citadas, excepción a la regla de §2 porque son datos de literatura). Cada uno tiene su fila en §5 y §6, sus corridas en `corridas/<nombre>.tar.gz` y su generador de JSON en `corridas/<nombre>_gen_json.mjs`.
- **Pendiente:** «Temario y bitácora» (sin cálculo). Se numera 16 en `registry.js`, grupo `learn`, después de `beyond`. `registry.js` ya tiene la línea de `beyond`; añadir la nueva debajo.
- **Pendiente técnico:** el de §6 (ruido de E(a) del Ni en PBE; el corte de bandas en U|K se resolvió en el bloque G).
- **Modelo por módulo:** Opus 5.5 esfuerzo medio para fonones y fuerzas (física delicada y corridas que depurar); Sonnet 5.5 esfuerzo medio para el resto. Cada módulo va en un hilo nuevo que arranca solo con este documento.
- **Fuerzas (notas para quien lo toque):** `parseOut` no repite coordenadas ni fuerzas por átomo dentro del paso en corridas de un solo punto; el generador las toma de `initialGeometry` y de `o.forces`. Se corrigió `readCell` en `siesta/out.js` para que un .out truncado (una corrida en marcha) no lance error; las 341 pruebas siguen pasando. En SIESTA 5, `DM.Tolerance` sola no controla el SCF: también exige `SCF.H.Tolerance`, por eso el barrido de tolerancia usa `SCF.H.Converge false`. Una corrida reutiliza su propio `.DM` si existe: borrar los `.DM` antes de repetir una corrida o poner `DM.UseSaveDM false`. En fdf, `0 0 0 1` como coordenada hace que SIESTA lea especie 0; usar `0.0 0.0 0.0 1`.

## 10. Entorno de cálculo empaquetado (usar en vez de reinstalar)

Cada hilo corre en un contenedor limpio, sin SIESTA. En vez de instalarlo con conda, descomprime el entorno ya hecho (SIESTA 5.4.2 `nompi`, 116 MB; verificado: corre desde otra ruta y reproduce la energía de Fermi de una corrida previa):

```
mkdir -p /tmp/sie && tar xzf /mnt/project-files/DFT_App/env/siesta-env.tar.gz -C /tmp/sie
export PATH=/tmp/sie/sie/bin:$PATH
OMP_NUM_THREADS=4 siesta x.fdf > x.out        # sin MPI; copia los .psml junto al .fdf
```

Los hilos nuevos deben usar este tar y no reinstalar. Si falta, se recrea con micromamba: `micromamba create -p <dir> -c conda-forge "siesta=5.4.2=nompi_*"`.

- **Build del artifact (10 oct):** `build.mjs` quitaba `<meta…>` también dentro del JS y borraba `<metalnessmap_fragment>` de los shaders de three.js (error de shader en las vistas 3D del artifact publicado). Corregido: las sustituciones del artifact ya no tocan el `<script>`.
- **Publicación dividida (10 oct):** el validador rechaza la página única de 12 MB. Se publica `index.html` (el artifact HTML con `<script src="app.js">`) + `app.js` (el JS del build) con `files`, como nueva versión del mismo artifact.

- **Más allá de DFT (notas para quien lo toque):** estilos en `css/views/beyond.css`, que también define `.ladder`/`.rung`/`.heaven` (la escalera de la pantalla 3 no tenía estilo). Para ampliar la tabla, edita `beyond_dft.json` y añade la fuente en `sources`; la vista calcula los errores medios sola. Publicación: el `index.html` y el `app.js` se obtienen partiendo `dist/dftlab_artifact.html` en su único `<script>`; no hay script que lo haga.
