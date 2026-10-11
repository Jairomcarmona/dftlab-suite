# Regeneración reproducible de referencias (bloque F)

Esta herramienta califica los cuatro generadores Python existentes: salidas SIESTA,
mallas RHO/DRHO, constantes de fuerza FC y cristalografía. No ejecuta SIESTA ni
regenera paquetes a partir de Hamiltonianos. El frontend sigue compilando y
probándose sin Python; este entorno es independiente de npm.

## Plataforma y versiones

Plataforma calificada: **Linux x86_64** (CI: Ubuntu 24.04). En Windows usar
**WSL2 con Ubuntu x86_64**, ejecutando todos los comandos dentro de WSL y con
Node Linux. No reutilizar `node_modules` ni entornos virtuales de Windows.

`sisl 0.16.4`, versión documentada por los scripts originales, publica wheels
Linux x86_64 para Python 3.12 pero no Windows. Se comprobó que la compilación
nativa de su distribución fuente falla con scikit-build-core actual. Esta entrega
no introduce una cadena C/Fortran sin calificar ni cambia sisl para ocultarlo.
`no-build = true` prohíbe compilar dependencias implícitamente; plataformas sin
binarios compatibles fallan durante la instalación.

| Herramienta | Versión fijada |
| --- | --- |
| CPython | 3.12.10 |
| uv | 0.11.14 |
| Node (verificación de resultados) | 24.18.0 |
| NumPy / SciPy | 2.2.6 / 1.15.3 |
| ASE | 3.26.0 |
| spglib / seekpath | 2.7.0 / 2.2.2 |
| sisl | 0.16.4 |

`tools/reference-env/.python-version` y `pyproject.toml` fijan intérprete y
dependencias directas. `uv.lock` fija también las transitivas, fuentes PyPI y
hashes de los artefactos. spglib/seekpath corresponden a los metadatos de la
referencia cristalográfica existente. Las versiones elegidas se califican contra
las suites actuales, sin cambiar tolerancias ni generadores científicos.

## Instalación desde una copia limpia

Instalar Git y Node **24.18.0 para Linux**. Para uv usar el instalador oficial de
la versión fijada ([documentación de instalación](https://docs.astral.sh/uv/getting-started/installation/)):

```sh
curl -LsSf https://astral.sh/uv/0.11.14/install.sh -o /tmp/dftlab-install-uv.sh
sh /tmp/dftlab-install-uv.sh
export PATH="$HOME/.local/bin:$PATH"
uv --version
node --version
git clone https://github.com/Jairomcarmona/dftlab-suite.git
cd dftlab-suite
uv python install 3.12.10
uv sync --project tools/reference-env --locked --python 3.12.10
uv run --project tools/reference-env --locked python -X utf8 scripts/regenerate_references.py
```

La primera instalación requiere red. uv crea solamente
`tools/reference-env/.venv`; no instala paquetes en el Python del sistema.
`--locked` falla si el manifiesto y el lockfile discrepan. No usar `uv lock`
para arreglar automáticamente un fallo de CI: una actualización del entorno
requiere un PR y volver a calificar las referencias.

En WSL2 se recomienda clonar dentro del sistema de archivos Linux para evitar
penalizaciones de E/S. Las instrucciones también sirven para una copia existente
sin cambios pendientes; seleccionar la rama deseada antes de instalar.

## Salida y validación

El comando exige el intérprete del entorno aislado, las versiones directas y
Node fijados. Copia los generadores, fixtures y módulos necesarios a una carpeta
temporal nueva; regenera allí y ejecuta seis suites Node contra **esas nuevas
referencias**: lectores, mallas, lectura anotada, FC, importación C/D y
cristalografía. No basta con probar los JSON originales mientras se regeneran otros.

Los resultados se guardan en `runtime/reference-validation/` (ignorado por Git):

- `report.json`: plataforma, versiones, hash del lockfile, hashes de entradas y
  salidas, estado de cada paso y comprobación de fuentes originales intactas.
- `logs/`: salida completa de los cuatro generadores y seis suites.
- `references/`: cuatro JSON generados y fixtures de cristalografía regenerados.

Cada proceso tiene 300 segundos; un fallo o timeout produce exit distinto de cero.
El informe conserva errores y los logs disponibles. Una carpeta existente se
rechaza para conservar evidencia; elegir otra para repetir:

```sh
uv run --project tools/reference-env --locked python -X utf8 scripts/regenerate_references.py --output-dir runtime/reference-validation-2
```

Dentro del repositorio sólo se admiten destinos nuevos bajo `runtime/`; también
puede usarse una carpeta nueva externa. No hay promoción automática de datos.
Para sustituir una referencia versionada hace falta revisar su procedencia y
diff en otro cambio explícito. Las diferencias de SHA respecto a los JSON
originales se registran, no se fuerzan a cero: cambios de formato, versión y BLAS
pueden cambiar bytes. La aceptación numérica la determinan las aserciones y
tolerancias científicas **existentes**, sin relajarlas. Se fija un hilo BLAS/OMP
durante esta calificación; no se certifica identidad binaria entre sistemas.

## CI y límites

`Python references` instala uv y CPython fijados y hace `uv sync --locked` en
Ubuntu 24.04. Regenera y verifica en aislamiento, comprueba `git diff --exit-code`
y conserva evidencia durante 14 días, incluso si falla la calificación.
`Baseline CI` mantiene separadamente npm, Chromium, offline y los JSON originales
en **Windows y Linux**. Ninguna de estas comprobaciones ejecuta cálculos HPC.

Fuentes de los contratos: [proyectos y lockfile de uv](https://docs.astral.sh/uv/guides/projects/),
[integración con GitHub Actions](https://docs.astral.sh/uv/guides/integration/github/),
[artefactos publicados de sisl 0.16.4](https://pypi.org/project/sisl/0.16.4/#files).
