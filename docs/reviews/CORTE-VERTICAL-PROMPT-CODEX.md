# Prompt único para Codex: corte vertical (primer cálculo real desde la plataforma)

Pega esto tal cual. Seguimiento en [issue #110](https://github.com/Jairomcarmona/dftlab-suite/issues/110). Todo lo científico y de contrato está decidido en los documentos de abajo; no preguntes diseño. Modelo previsto: Sol 6.1 con razonamiento medio.

## 0. Antes de hacer nada (en este orden)

1. En `dftlab-suite`: `git fetch origin && git checkout main && git pull --ff-only origin main`. En `siestaflow` (QRAFT), lo mismo. Si `git pull` no es un avance rápido, para y avisa en #110: tu copia local tiene trabajo que no está en `main`.
2. Lee `AGENTS.md` y `docs/development/WORKING_RULES.md` completos, y di en tu **primer comentario de #110** que los leíste y qué SHA de `main` de cada repositorio estás usando. Si no abres los archivos, esta es la regla completa:

> **Pocos PR (regla fija de todo el proyecto).** El avance diario va en comentarios del issue de seguimiento o en notas no versionadas, no en un PR por paso. `docs/reviews/TRASPASO.md` se actualiza una vez por etapa cerrada, dentro del PR de código de esa etapa. Nunca se abre un PR documental solo para anotar que otro PR se fusionó. Los arreglos de código relacionados van en un solo PR.

3. **Comprueba el estado real en GitHub antes de planear** (este prompt y tu memoria pueden estar atrasados; **gana GitHub** y anotas la diferencia en #110). Confirma, con enlace o SHA:
   - que el PR [#109](https://github.com/Jairomcarmona/dftlab-suite/pull/109) (ADR-019) está fusionado y que `docs/adr/ADR-019-lectura-de-agregados-productos-admision-y-finalizacion.md` dice **Aceptado**. **Si no, esta es la única espera permitida:** comenta en #110 qué falta y espera a que Manuel lo acepte; no empieces por tu cuenta;
   - el `main` de ambos repositorios (al preparar este prompt, 2026-10-14: `siestaflow` `377e429`, que es el pin vigente de `engine-versions.lock.json`; `dftlab-suite` es el `main` posterior a #109);
   - que no hay PR abiertos de otro agente que toquen `platform/src/dftlab_platform/service.py`, `storage.py`, `authoring.py`, `submissions.py` o `app/dftlab/static/js/application/`.
4. Después de esto, consulta GitHub cada vez que vayas a abrir, rebasar o fusionar.

## 1. Objetivo

Manuel decidió (2026-10-14) congelar P8, P9 y P10 y hacer pasar **un cálculo real pequeño de Si por la ruta completa**: navegador, servicio, admisión, SLURM en WSL, SIESTA, evidencia y resultado. Hoy las piezas existen por separado y se calificaron con arneses (`deployment/local/qualify_*.py`, trabajo 440), pero **ninguna base de la plataforma tiene una fila `RUN`**: ningún cálculo ha pasado por la API y la interfaz. Este bloque lo cierra.

**Criterio de éxito, en palabras de usuario.** Manuel arranca la plataforma con un comando, abre el navegador y, sin editar archivos ni SQL: elige el ejemplo de Si, lo promueve a borrador, lo valida, crea campaña, plan y paquete, lo envía, ve el estado del run con sus cuatro dimensiones (scheduler, ejecución, integridad, ciencia) y la evidencia, y al terminar ve el resultado con la etiqueta de que la ciencia **no está establecida**. Recarga la página y todo sigue ahí. El mismo flujo se puede repetir.

**Qué se acredita y qué no.** Una ejecución del flujo completo con SIESTA 5.4.2 real en el perfil de WSL ya calificado. No se acredita validez física, ni ninguna capability sube de `CONTRACT_TESTED`, ni se ofrece reanudación (`platform_resume_enabled` queda en `false`), ni HF-1, ni otros workflows.

## 2. Alcance y PR (dos PR de código, y una tercera etapa condicional)

| Etapa | PR | Contenido | Termina cuando |
|---|---|---|---|
| A | P-6 plataforma | Servicio: consumir ADR-019, cablear el flujo completo en el servicio local instalado y la corrida real por HTTP (sección 3.2) | CI verde, wheel instalado y corrida real de 3.4 |
| B | P-7 plataforma | Interfaz del flujo completo en el shell operativo y guía de uso (sección 3.3) | CI verde, prueba de navegador y corrida real desde el navegador |
| C | (condicional) EOS | Mismo flujo con el EOS de Si, solo si la sección 3.5 dice que se puede sin contrato nuevo | Igual que A y B, o parar con una nota |

Rama corta por PR, desde `origin/main`, nunca reutilizando ramas fusionadas. `TRASPASO.md` se actualiza **una vez** dentro de P-6 y **una vez** dentro de P-7 con la sección «Corte vertical (Codex)». Cero PR documentales. La guía de uso (3.3) viaja dentro de P-7.

**Fuera de este bloque, no lo toques:** HubbardFlow; HF-1 y la reanudación por la plataforma; T-041 a T-044; P9 y P10; T-032 a T-034; #30 (WebSocket de terminal; el terminal no entra); `baseline-v1`, tolerancias, goldens, vectores, oráculos y ADR aceptados; el SIESTA, SLURM y Open MPI del sitio, sus permisos y configuración; los trabajos ajenos en SLURM; las ramas de otros agentes.

## 3. Qué hacer

### 3.1 Primero, el diagnóstico (un comentario en #110, no un PR)

Antes de escribir código, mide el hueco real y pégalo en #110 en una tabla de una línea por pieza: *existe y está cableada en el servicio / existe pero solo en el arnés / falta*. Como mínimo: handlers de authoring (`authoring.py`) y la receta `dftlab.siesta.single-derived@0.1.0` de `deployment/local/qualify_native_handlers.py`; perfil `wsl-slurm-openmpi-installed-qualification` rev1; probe de runtime vigente (`runtime_probe.py`, caduca); presupuesto (`budgets.py`); pasarela de envío (`submissions.py`); puerto SLURM; worker nativo; colector de evidencia terminal (`terminal_evidence.py`); proyección del run con cuatro dimensiones; finalización; lectura de resultados; las siete lecturas de ADR-019. Con eso, ordena tu trabajo. Si una pieza del arnés **no se puede** cablear sin cambiar un contrato público, para esa parte y pregunta (sección 5).

### 3.2 P-6: el servicio

1. **ADR-019 completo**, tal cual está: las siete lecturas (`listCampaigns`, `getCampaign`, `listPlans`, `getPlan`, `listRuns`, `listOperations`, `getValidationReceipt`) con la paginación y la ausencia de oráculo entre owners; el resultado tipado de las operaciones (`product_refs` directo o `receipt`); la admisión que rechaza con `AdmissionReceipt` `REJECTED`, `runtime_probe_ref` y `reservation` nulos, y `409 ADMISSION_REJECTED`; `FinalizationReceipt.unproduced_outputs`. Las **pruebas exigidas** del ADR son pruebas tuyas, con esos nombres de caso. La unidad de reserva es `allocated_cpu_second`.
2. **Un modo local de ejecución, explícito y apagado por omisión.** Una opción del lanzador (`--local-run` o equivalente, la eliges) registra: los handlers de authoring con la receta `dftlab.siesta.single-derived@0.1.0` y el perfil WSL/SLURM ya calificado; el procesador con la pasarela de envío y el puerto SLURM; el worker nativo; el colector de evidencia terminal; el probe fresco bajo demanda; y la cuenta de presupuesto del operador. Sin la opción, el servicio queda como hoy: sin capabilities de ejecución. Con la opción, tampoco se publica una capability de ejecución en `listCapabilities`: la receta y el perfil local admiten con finalidad `EXPLORATORY` o rechazan con motivos. La interfaz muestra el recibo sin depender del catálogo ni añadir campos públicos.
3. **Presupuesto sin tocar SQL.** Un comando del lanzador (por ejemplo `dftlab-platform budget add --cpu-seconds N --project P`) registra la cuenta de presupuesto del operador local. Sin cuenta vigente, `SUBMIT_RUN` se rechaza con el recibo de ADR-019 §3, y esa es una prueba.
4. **Del envío al resultado por HTTP.** `SUBMIT_RUN` → admisión (`ADMITTED`, `EXPLORATORY`, reserva en `allocated_cpu_second`, `EffectIntent` antes del `sbatch`) → job → run con su proyección → evidencia terminal positiva (el colector de T-026a, con el firmante registrado; **no** cola vacía ni código de salida 0 como prueba) → finalización → artefactos y resultado original de QRAFT guardados sin reinterpretar. `getRun` devuelve las cuatro dimensiones con fuente y antigüedad; `listRuns` lo lista; `getArtifact` y `getArtifactContent` sirven los archivos con su SHA-256.
5. **Caminos de fallo honestos**, cada uno con prueba: probe vencido, presupuesto agotado o ausente, SLURM inalcanzable, job fallido, finalización con salidas no producidas (`unproduced_outputs`, nunca `PUBLISHED`), y reinicio del servicio a mitad de un run (el run se reconcilia, no se reenvía). Un `OUTCOME_UNKNOWN` se muestra como tal.
6. **Contratos.** No cambies `contracts/`. Si necesitas un campo público que ADR-019 y los schemas no tienen, para esa parte y pregunta. Los fixtures y la cuenta de `test_contracts.py` ya están al día en `main`.

### 3.3 P-7: la interfaz

Todo en el shell operativo (`app/dftlab/static/js/application/`), sin React (ADR-013 sigue propuesto), con los validadores generados del SDK y sin `eval` bajo el CSP operativo. El build portátil sin servicio no cambia.

1. **Flujo en pantalla**, en este orden y con el estado de cada paso visible: promover el ejemplo de Si a borrador (`learn/promote.js` ya existe) → validar → crear campaña → crear plan → preparar paquete → elegir perfil y enviar → página del run → página del resultado. Cada paso usa la operación de la API, espera su `OperationRecord` y descubre su producto con `product_refs` o `receipt`, como dice ADR-019.
2. **Recarga y regreso.** Tras recargar, la lista de campañas, planes, runs y operaciones del proyecto sale de la API (`list*`), no de caché del cliente. Una operación en curso se retoma por `getOperation`.
3. **Página del run.** Las cuatro dimensiones con su fuente y antigüedad, los eventos del run, la evidencia (artefactos con SHA-256 y descarga), y los estados `UNKNOWN`/`OUTCOME_UNKNOWN` mostrados como tales. Para HF-1 y reanudación no se muestra ninguna acción (`platform_resume_enabled` es `false`).
4. **Página del resultado.** Muestra los campos que el resultado original de QRAFT contiene (estado técnico, convergencia del SCF, energía si la trae) y la etiqueta de la ciencia (`NOT_ESTABLISHED` y por qué). No recalcules física ni muestres un valor que QRAFT no entregó. Sin frases en español dentro de módulos de modelo (R7): códigos en el modelo y diccionario de textos en la vista.
5. **Guía de uso** dentro del PR (`docs/development/PRIMER_CALCULO.md`): el comando para arrancar, cómo registrar el presupuesto, la URL, los pasos de la pantalla, dónde quedan los datos, cómo detener y cómo reiniciar tras un corte. Debe poder seguirla Manuel sin leer código.
6. **Prueba de navegador** (Playwright, el patrón de `app/tests/ui/`): el flujo completo contra el servicio con el puerto SLURM de fixture, con recarga a mitad; y una captura del flujo real de 3.4. Los recursos del navegador (lienzos, observadores) se liberan como en `browser_resources.mjs`.
7. **Cierra los límites de #105** con lo que este flujo produce: tras el primer run real, (a) muestra en #110 que la base tiene ahora filas `resources.kind = RUN` (consulta de solo lectura), y (b) que `lru-view.js` construye su modelo sobre la lectura real de `getRun` de ese run sin error y con la salida que corresponde (el veredicto, no un vector nuevo). No añadas vectores ni cambies los existentes.

### 3.4 La corrida real (A y B)

Las pruebas de CI no ejecutan SIESTA. Además, en WSL, con el sitio tal como está (SLURM 23.11.4, Open MPI 4.1.6, SIESTA MPI 5.4.2 en `/home/jmc/.local/siesta-5.4.2-openmpi/bin/siesta`, SHA-256 `aaa9a2e45a41b12f3aad52ca4fca7c25b1cc6afd3aff2a0c7fe145b1bd9f18ce`):

- Ejecuta el flujo de 3.2 por HTTP con un script de calificación en `deployment/local/` (en el estilo de los `qualify_*.py`) y, tras P-7, el mismo flujo desde el navegador. Es **Si pequeño**, el caso de 3.2, el mismo del trabajo 440 (cuatro rangos MPI, un hilo, un nodo). Solo envías **tus propios** trabajos: ninguno ajeno, sin cambiar permisos, configuración ni binarios del sitio, sin reenviar por un timeout.
- Pega en #110: el comando, el `run_id`, el job de SLURM, los SHA-256 de la entrada, el resultado original y los artefactos, el JSON de `getRun` (con su SHA-256), la consulta `RUN` de 3.3.7 y el tiempo total. Recibos nuevos en `deployment/local/evidence/` sin tocar los anteriores.
- El resultado se registra como `NUMERICAL_CANDIDATE` y comprobación de tubería. **Ninguna capability pasa de `CONTRACT_TESTED`.**
- Si el entorno real no se puede ejecutar desde donde trabajas, haz todo el ensayo en seco posible, pega la salida y di exactamente qué falta. No lo marques verificado.

### 3.5 Etapa C: EOS de Si (solo si se puede sin contrato nuevo)

Cuando A y B estén fusionadas y la corrida real de Si funcione, evalúa en #110 (un comentario) si el EOS de Si (`docs/scientific-protocols/WF-EOS.md`, `qraft.protocols.eos.EosProtocol`, U-Q10/U-Q11 en el QRAFT fijado) se puede expresar como una receta del mismo flujo (campaña con un SCF por volumen más el análisis BM3 que ya hace QRAFT) **sin** cambiar el contrato público de la plataforma ni de `qraft.api`. Si se puede: impleméntalo como PR aparte con el mismo patrón (receta, interfaz mínima de curva y ajuste, corrida real y tabla de energías), registrando que EOS real queda limitado a Si/PBE/SZP. Si necesita un export nuevo de QRAFT, un schema, un campo público o un cambio de política: **para la etapa C**, deja el comentario con la causa y `archivo:línea`, y cierra el bloque con A y B. No inventes diseño.

## 4. Reglas permanentes del proyecto (R1 a R12 de #99) que siguen vigentes

Completas en [#99](https://github.com/Jairomcarmona/dftlab-suite/issues/99); aquí las que tocan este bloque.

| Regla | Qué significa en el corte |
|---|---|
| R1 | Los documentos nativos de QRAFT (plan, paquete, resultado, políticas) se guardan con su identidad y digest originales; nunca se recalcula un digest nativo con JSON del frontend. |
| R3 | La plataforma importa **solo** de `qraft.api`. Si falta algo, no lo busques en módulos internos. |
| R4 | El lock privado e inmutable del entorno de worker no se toca. |
| R7 | Sin frases en español en el código de modelos: claves y códigos. |
| R9 | No se fabrica un estado que no existe: ningún `platform_resume_enabled` en `true`, ninguna capability promovida, ninguna certificación por código de salida 0, ningún `UNKNOWN` presentado como éxito. |
| R12 | Un solo cambio de pin por PR y solo a un commit ya fusionado; este bloque no debería necesitar ninguno. |

## 5. Cuándo parar y cuándo seguir

Paras solo por física, contrato o una decisión de Manuel. **No pares en cada duda: junta las que tengas en un solo comentario de #110** con la pregunta en una línea, las opciones y tu recomendación, y sigue con lo independiente.

| Situación | Qué haces |
|---|---|
| ADR-019, un schema o un fixture te parece contradictorio con algo ya construido | Para esa parte, comenta con `archivo:línea` y la evidencia, y sigue con lo independiente. No rediseñes ni toques `contracts/`. |
| Necesitas un campo, enum, código o schema **públicos** que ADR-019 y los schemas no nombran | Para esa parte y pregunta en #110. |
| La ficha o el ADR no dicen cómo nombrar una función, un módulo o una opción de línea de comandos | Elige el nombre que use el código vecino y anótalo en el PR. No es contrato. |
| Una prueba existente falla por tu cambio | Arregla el código. No la saltes, no la marques `xfail`, no cambies su tolerancia. |
| CI falla en algo que no toca tu diff | Reproduce en `main`. Si es igual en `main`, un solo re-run; si persiste, comenta el nombre del check y la causa y sigue con lo independiente. |
| CI falla y no sabes por qué | Lee el log completo del job antes de tocar nada; arregla la causa raíz. Nunca un commit vacío ni cerrar y reabrir el PR. |
| Algo del sitio real falla o se comporta distinto (SLURM, el worker, el probe, el colector terminal) | No cambies la configuración del sitio ni reenvíes por un timeout. Conserva la evidencia, comenta qué ves y qué falta, y sigue con lo que no dependa. |
| Una pregunta de física o de convención | Pide revisión a `validador_cientifico`. **APROBADO** y dentro de lo escrito: sigue. **RECHAZADO:** corrige. **REQUIERE_DECISIÓN_DE_MANUEL:** para y pregunta. |
| El hash de un pseudo, wheel, SIESTA o fixture no coincide con lo anotado | Para: puede ser un archivo alterado. Pregunta en #110. |

**Fusión.** Manuel autorizó, de forma acotada y solo para los PR de este bloque (A, B y, si procede, C), que los fusiones **si se cumplen las tres a la vez**: los cinco checks requeridos en verde sobre la punta exacta (`Verify (ubuntu-24.04)`, `Verify (windows-2022)`, `Platform installed wheel` en ambos sistemas y `Regenerate references (ubuntu-24.04)`), el validador científico con **APROBADO** para el diff de esa etapa (cuando el diff toque física o lectura de resultados), y la corrida real de 3.4 pegada en #110 para esa etapa. Anota en #110 el SHA fusionado. La autorización no cubre nada fuera del bloque, ni pins, ni protección de ramas, ni cambiar permisos de GitHub.

## 6. Cierre

Al terminar, un último comentario en #110 con la tabla de PR (enlace, SHA fusionado, CI), la corrida real (run, job, hashes, tiempo), la prueba de que la base tiene ahora una fila `RUN`, lo que quedó parado y por qué, y **lo que este bloque no acredita**: validez física del Si (ninguna capability pasa de `CONTRACT_TESTED`), reanudación y HF-1 (siguen sin ofrecerse), cancelación y reanudación desde la interfaz, cualquier otro target distinto de WSL/SLURM local, y multiusuario.

No cierres #110 ni los issues #93 y #105: los cierra Manuel.
