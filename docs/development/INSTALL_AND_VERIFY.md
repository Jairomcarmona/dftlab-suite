# Instalación y verificación desde una copia limpia (bloque F)

## Requisitos

- Git y Node.js **24.18.0**, la versión fijada en CI y declarada en `app/package.json`.
- Acceso a GitHub para clonar este repositorio privado.
- Red durante la instalación de npm y la descarga inicial de Chromium. La ejecución del HTML portable no requiere red.
- No se requiere Python, una instalación global de Playwright, `NODE_PATH` ni dependencias en `/opt/run` para compilar, probar o servir esta aplicación.

Desde un directorio que no contenga otra copia con trabajo pendiente:

```sh
git clone https://github.com/Jairomcarmona/dftlab-suite.git
cd dftlab-suite
git fetch origin --tags
node scripts/verify-original-baseline.mjs
cd app
npm ci
npm run browser:install
npm test
```

Para evaluar una rama de un PR, seleccionarla después de clonar y antes de `npm ci`. Los worktrees tienen su propia instalación de dependencias: ejecutar allí `npm ci` también. No copiar `node_modules` desde otra plataforma.

En Linux que aún no tenga las bibliotecas del navegador, sustituir `npm run browser:install` por:

```sh
npx --no-install playwright install --with-deps chromium
```

Ese comando puede requerir privilegios del sistema para instalar paquetes de Linux. La CI de Ubuntu lo ejecuta en su runner; Windows sólo necesita la descarga del navegador. La CLI es la del paquete local fijado, no una descarga implícita de la última versión de Playwright.

## Comandos

Ejecutar desde `app/`:

| Comando | Alcance |
| --- | --- |
| `npm test` | Puerta completa: referencias científicas existentes, pruebas Node de A/E/B, build, servidor Node y las cuatro suites de navegador. |
| `npm run test:node` | Referencias, pruebas Node, build y servidor; **no** acredita navegador ni offline. |
| `npm run test:browser` | A/E, ciclo de vida B, dos HTML offline y los tres modos de carga Moyo; requiere build previo. |
| `npm run build` | Genera las dos variantes HTML con esbuild local. |
| `npm run serve` | Vista previa en `http://127.0.0.1:8000/`, después del build. |
| `npm run serve -- --port 8080` | Vista previa con otro puerto. Ctrl+C detiene el servidor. |

`serve` entrega sólo los dos HTML compilados, acepta GET/HEAD y escucha en loopback. No es un servidor de producción ni da acceso a fuentes o carpetas de trabajo.

## Dependencias y calidad

`app/package-lock.json` fija el árbol npm con hashes de integridad. esbuild permanece en 0.25.10. Playwright se fija en **1.56.1**, la versión usada en la verificación del bloque B, y su CLI selecciona Chromium **141.0.7390.37, revisión 1194**. No se realizó una actualización general de herramientas. Si falta Playwright o Chromium, las suites de navegador fallan; no se permite una omisión con exit 0. `REQUIRE_BROWSER=1` queda explícito en CI por compatibilidad con el contrato del traspaso.

Las suites se ejecutan secuencialmente. El runner limita cada script de navegador a 120 segundos; cada job CI tiene 15 minutos. Chromium utiliza SwiftShader en estas pruebas para disponer de WebGL en runners sin GPU; esto verifica funcionalidad, no rendimiento gráfico de hardware real.

La CI hace checkout limpio, `npm ci`, instalación de Chromium, verificación del manifiesto y `npm test` en Windows 2022 y Ubuntu 24.04. Los HTML se conservan como artefactos durante 14 días. `app/dist/` continúa ignorado por Git.

## Qué significa la verificación offline

`browser_offline.mjs` copia **un único HTML cada vez** a una carpeta temporal vacía y lo abre desde `file://` en un contexto nuevo con red deshabilitada. Rechaza solicitudes de assets vecinos o de red. Comprueba grupo espacial 227 del ejemplo de Si mediante WASM inline, camino cF2, montaje del visor WebGL y descarga de un `.fdf` con geometría y BandLines. Repite el caso con `dftlab.html` y `dftlab_artifact.html`; falla ante errores de página o consola.

El build elimina únicamente los enlaces opcionales a Google Fonts/preconnect de la plantilla para evitar solicitudes de red del entregable. Se usan los fallbacks tipográficos de sistema ya existentes en CSS. No se modificaron la plantilla fuente, las vistas, el router, vendor ni algoritmos científicos. Los tres avisos heredados de `import.meta` en el bundle IIFE permanecen: las rutas inline usadas por el HTML se prueban; el smoke independiente prueba fetch/inline/global sobre los módulos ES servidos.

Las regresiones A/E y B también recorren el HTML compilado sin red. El smoke Moyo usa un servidor HTTP local para comprobar explícitamente la ruta fetch; no debe confundirse ese caso con una prueba offline.

## Límites

Estas pruebas no ejecutan SIESTA ni certifican los motores HPC. Las referencias Python ya versionadas se consumen sin regenerarlas ni alterar tolerancias. Fijar y validar el entorno Python para **regenerar** referencias sigue pendiente en el registro F y no es requisito del build/frontend de esta entrega. Los bloques C/D, G y H se trabajan aparte.
