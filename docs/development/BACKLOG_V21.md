# Backlog de ideas V2.1 con compuertas verificables

Fecha: 2026-10-11. Estado: **propuesta de Manuel y Claude, sin aprobar ni asignar**. No modifica el plan V2.1, los ADR, `contracts/`, `app/` ni `platform/`, y no reparte trabajo a Codex: cada idea necesita un ticket aprobado por Manuel antes de construirse.

Origen: hilo de comparación con Mat3ra y de revisión de qué se publica con DFT. Evidencia de viabilidad por archivo de SIESTA: [BACKLOG_V21_VIABILIDAD.md](BACKLOG_V21_VIABILIDAD.md).

## Regla de compuertas

Si existe una duda lógica sin resolver, no se procede. El estado de cada idea vive en [`backlog_gates.json`](backlog_gates.json) y lo comprueba `node scripts/verify-backlog-gates.mjs` (también tiene autoprueba).

| Estado | Condición para entrar |
|---|---|
| PROPUESTO | Está en el backlog |
| PREPARADO | Todas sus **compuertas de entrada** cumplidas, cada una con evidencia (ticket aprobado, decisión, contrato revisado) |
| EN_CONSTRUCCION | Además, **todas sus dudas lógicas RESUELTAS**, cada una con evidencia reproducible |
| BLOQUEADO | Apareció una duda nueva o falló una compuerta; lleva motivo y la idea no avanza |
| VERIFICADO | Todas sus **compuertas de salida** con evidencia (pruebas que fallan ante errores reales, no solo el caso feliz) |
| ACEPTADO | Manuel lo acepta |

Una *duda lógica* es una afirmación de la que depende el diseño y que no tiene fuente, ejecución o caso de validación. Se registra con cómo se resuelve. Las tolerancias de un caso de validación se declaran antes de ejecutarlo y no se cambian para que pase, como en [WORKING_RULES](WORKING_RULES.md). Si durante la construcción surge una duda nueva, la idea pasa a BLOQUEADO hasta resolverla.

## Ideas

Grupo, idea, dudas que la bloquean y estado de viabilidad (detalle en el anexo). Entrada y salida de cada una están en el JSON.

| # | Idea | Dudas | Viabilidad / tickets del plan |
|---|---|---|---|
| 1 | Modelo de estructura con id estable por átomo y registro de operaciones | | Ahora; contrato nuevo; T-028 |
| 2 | Costuras para subir a la web (API versionada, identidad y proyecto, almacén tras interfaz) | | Ahora; ADR-001/008/010/011, T-016 a T-018 |
| 21 | Compuertas automáticas por campaña (eggbox, base, consistencia de pseudos, caso de validación, no mezclar +U) | DL-13 | Ahora; ADR-009 |
| 3 | Editor manual en el navegador más ASE y pymatgen en el servicio | DL-06 | Ola; T-016, T-028 |
| 4 | Vista única de propiedades; constructor de slabs, defectos e interfaces | | Ola; T-028, T-029 |
| 5 | Notebooks y Drive (carpeta sincronizada primero) | | Después; T-051 |
| 6 | VPS y dominio | | Después; T-018 a T-020, P9 |
| 7 | MCP para proponer moléculas | | Después; tras T-051 |
| 8 | Exportador de datos de graficación y ejes editables | | Ola; T-034 |
| 9 | Importar carpetas por contenido y campañas | | Ola; T-033, T-052 |
| 11 | Preflight de `.fdf` en flujo libre | | Ola; T-030 |
| 12 | Todo gráfico es un portal | | Ola; T-033 |
| 13 | Deslizador sobre una campaña | | Ola; T-037 |
| 14 | Comparar dos corridas en vistas enlazadas | | Ola; T-034 |
| 15 | Fatbands, zona de Brillouin y función de onda; ε(ω) por pares de banda y k | DL-08, DL-09 | Ola; T-036 |
| 16 | Masa efectiva, absorción y Tauc con ventana editable | DL-07 | Ola; P6 |
| 17 | Bader, ELF, RDG/NCI, COHP | DL-03, DL-04, DL-09, DL-11 | Ola / validar |
| 18 | Centro de productos finales (figura, datos, tabla, métodos) | | Ola; T-034, T-052 |
| 10 | Campañas nuevas: formación y defectos, superficie, relajación, NEB, interfaces, elásticas, MD, STM | DL-05, DL-15 | Ver anexo; defectos cargados y offsets con hueco |
| 19 | Priorización por demanda | DL-12 | Después; requiere entrevistas |
| 20 | Termodinámica y catálisis (formación, casco, T y p finitas, adsorción, CHE, volcán) | DL-01, DL-02, DL-13, DL-14 | Ola; P6 a P8 |

## Registro de dudas lógicas

El texto completo (afirmación, cómo se verifica, estado y evidencia) está en el JSON. Todas están **ABIERTAS** salvo DL-01 y DL-09:

DL-01 átomos fantasma (BSSE) (RESUELTA: manual + corrida) · DL-02 referencia de `.VH` y Fermi · DL-03 densidad con core para Bader · DL-04 ELF propio · DL-05 constante dieléctrica estática (cargas de Born) · DL-06 ASE en Pyodide · DL-07 error de Kramers-Kronig · DL-08 suma de `.contrib.EPSIMG` · DL-09 API de COHP en sisl (RESUELTA: existe como métodos, ver JSON; falta fijar versión y probar sobre fixture) · DL-10 DOI del informe externo · DL-11 licencia de Bader · DL-12 demanda de usuarios · DL-13 capacidades de la versión fijada de SIESTA · DL-14 termodinámica del gas · DL-15 offsets de banda por potencial promedio.

## Límites

- La verificación de compuertas comprueba que el estado declarado sea coherente con la evidencia escrita; no valida la ciencia. La ciencia la validan los casos de referencia de cada idea.
- Los costos y plazos mencionados en el hilo eran estimaciones y no están aquí.
- Esta verificación no está conectada a `scripts/verify.mjs` ni a CI: añadirla es una decisión de Manuel, y `verify.mjs` es un archivo compartido que solo recibe líneas añadidas.
