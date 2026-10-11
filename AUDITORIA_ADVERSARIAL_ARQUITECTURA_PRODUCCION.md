# Revisión adversarial: arquitectura DFT Lab y construcción de producción

Fecha: 10 de octubre de 2026. Alcance: propuesta V2, backlog, recomendación Git/GitHub y evidencia del código disponible. Resultado: correcciones incorporadas a la propuesta **V2.1**, aún pendiente de implementación.

**Dictamen:** mantener un repositorio de plataforma, ramas cortas y motores independientes es adecuado para este proyecto. La arquitectura de un backend modular con workers científicos separados también es adecuada. Sin embargo, la propuesta V2 no era suficientemente precisa para declarar una construcción de producción: faltaban mecanismos ejecutables y había tareas esenciales de distribución/recuperación situadas demasiado tarde. GitHub, los directorios y los diagramas son medios; la condición de producción depende de contratos aplicados, paquetes probados, controles de ejecución y evidencia de recuperación.

No existe una arquitectura universalmente mejor. Esta recomendación responde a tus condiciones: frontend existente, distribución offline, Windows local, SSH/nube/HPC, dos motores en evolución y futuro web multiusuario. No recomiendo una reescritura ni dividir cada herramienta en un microservicio. Recomiendo endurecer y comprobar las fronteras que ya se propusieron.

Documentos revisados: [propuesta maestra](PROPUESTA_MAESTRA_DFTLAB_V2.md), [plan de implementación](PLAN_IMPLEMENTACION_CLAUDE_CODE.md), [revisión del código](ANALISIS_TECNICO.md) e [integración de motores](INTEGRACION_DFTLAB_QRAFT_HUBBARDFLOW.md). Las referencias a secciones V2 describen la propuesta anterior a este endurecimiento.

## 1. Método y límites

Se formularon escenarios que falsarían las garantías: dos envíos concurrentes, pérdida de ack, lease vencido con proceso vivo, cancelación tardía, actualización del entorno después de preflight, modificación manual de archivos, backup de datos en escritura, migración con jobs activos y PR que ejecuta código con credenciales HPC.

Se contrastaron con los contratos y fases existentes. Se comprobó que esta carpeta no tiene Git y que existe `app/package-lock.json`; no hay pipeline `.github` ni backend operativo de plataforma. Se revisaron el build y metadatos de empaquetado QRAFT del commit fijado. No se ejecutaron ataques reales, nuevos cálculos SIESTA ni pruebas de infraestructura. Esta es una revisión de diseño y preparación de release, no un pentest ni una certificación de producción.

Prioridad: **P1** bloquea un release operativo que pretenda la garantía afectada; **P2** requiere solución durante la construcción de los cimientos. No se usa P0 ni se afirma que los escenarios ya ocurrieron. Cada hallazgo distingue una omisión del diseño de un defecto implementado.

## 2. Hallazgos

### A-01 — P1: controles de primera distribución pospuestos a P10

**Evidencia:** P3/P4 permiten servicio y cálculo real, pero T-053/T-054 concentran instalación limpia, SBOM/licencias y backup/restore en P10. §18.4 exige algunos de esos gates por release; el backlog no concreta su primera entrega.

**Escenario:** una laptop se actualiza después de un run real; el instalador usa un paquete o perfil diferente y no existe un restore comprobado de sus operaciones. El usuario pierde la capacidad de recuperar el estado anterior aunque el código esté en GitHub.

**Corrección:** instalación/release manifest mínimo desde P1/P3; backup consistente, restore y reconciliación antes del primer cálculo operativo P4. P10 amplía los targets y endurece, no inicia esas obligaciones. Seguridad y operabilidad son criterios de todas las fases.

**Aceptación:** instalar el artefacto de CI en un entorno limpio, ejecutar el caso del alcance publicado, restaurar en otra instancia y reconciliar un trabajo activo sin reenviarlo por desconocimiento.

### A-02 — P1: contratos descritos, pero faltan guardas ejecutables de lifecycle

**Evidencia:** §5 define schemas a crear y §13 enumera dimensiones/recuperación. No fija una tabla de comandos, precondiciones y conflictos de la operación de plataforma. Los estados nativos deben conservarse, pero esa conservación no define las carreras del servicio.

**Escenario:** `cancel` llega cuando el ejecutable ya terminó; `resume` llega dos veces; un callback atrasado publica el resultado de un attempt anterior como si fuera el actual.

**Corrección:** schemas ejecutables, tabla de transiciones de operaciones, compare-and-set de revisión y recibos enlazados a attempt/owner/generation. El servicio define su operación; QRAFT/Hubbard mantienen las transiciones y decisiones científicas propias. La proyección nunca emite una transición científica por sí sola.

**Aceptación:** cancelación tardía conserva la terminación observada y registra solicitud sin efecto; callbacks viejos no reemplazan el intento vigente; resume exige recibo/precondiciones aún válidos.

### A-03 — P1: falta cerrar la frontera de confianza de la terminal

**Evidencia:** §6.4 ofrece `run(command)` manual privilegiado y §15 da permisos por recurso. Falta explicar cómo convive una shell libre con archivos y budgets de campañas administradas en el mismo usuario remoto.

**Escenario:** desde la terminal se modifica un input, pseudo o output activo; también se puede ejecutar `sbatch` fuera de la admisión de la plataforma. Las garantías de integridad y presupuesto no se pueden extender automáticamente a esas acciones.

**Corrección:** declarar modo de confianza del sitio. Una shell con el mismo UID no es técnicamente read-only sobre los archivos que ese UID puede escribir. Ofrecer acceso de observación mediante API/SFTP restringidos o cuenta/namespace realmente separado cuando se necesite aislamiento; mantener la terminal libre como modo privilegiado explícito. Toda intervención manual detectada invalida recibos dependientes y exige nueva revisión/verificación. Registrar el alcance del control presupuestario.

**Aceptación:** un cambio de archivos bloquea reuse/finalización correspondiente; el catálogo indica si existe aislamiento real o confianza en el usuario. Jobs externos a la plataforma no aparecen como sometidos a sus budgets. Hashes no se presentan como prueba contra un administrador del host capaz de modificar toda la evidencia.

### A-04 — P1: idempotencia HTTP no completa la exclusión remota

**Evidencia:** §13.2/13.3 reconoce ack perdido, UNKNOWN y fencing. El mecanismo donde el worker remoto comprueba owner/generation todavía no está especificado. La ausencia de un job en una consulta no demuestra que no fue aceptado.

**Escenario:** un controlador remoto continúa tras vencer su lease y otro se inicia; ambos pueden ejecutar. O el gateway reenvía un submit cuando el scheduler aún no indexó el primero.

**Corrección:** `ControllerAuthorityRecord` y recibos de submit/probe asociados a attempt token, perfil, ejecución y generation. Comprobar autoridad en los puntos efectivos de lanzar/publicar; si no hay fencing nativo, mantener takeover conservador hasta probar terminación del owner previo. Definir la evidencia que permite volver a enviar, por scheduler/sitio. Timeout y lease expiry no bastan.

**Aceptación:** una prueba suspende al controller A, renueva/toma autoridad B bajo el mecanismo admitido y reanuda A: A no puede producir efectos autorizados. Si el sitio no puede demostrarlo, takeover automático se publica como no soportado. Ante ack perdido, la plataforma mantiene ambigüedad en vez de duplicar el efecto.

### A-05 — P1: admisión necesita reserva atómica y evidencia del entorno vigente

**Evidencia:** §6.1 pide permisos/versión/budget; §16 habla de cuotas. No define reserva/liberación concurrente ni el recibo que vincula preflight, paquete y runtime observado.

**Escenario:** dos requests consumen el mismo presupuesto restante. Entre preflight y submit cambia el binario, módulos, perfil, pseudo staged o política de acceso.

**Corrección:** `AdmissionReceipt` con plan/package digest, perfil/revisión, principal, permisos, reserva, límites, runtime probe y caducidad/precondiciones. Reservar de forma transaccional; liberar por reconciliación, no por cierre de UI. Verificar nuevamente las condiciones operativas al lanzar. Los defaults científicos bloqueados no se recalculan; un cambio material exige nuevo prepare/plan según el motor.

**Aceptación:** envíos concurrentes no rebasan la reserva administrada; binario/perfil incompatible exige re-preparación; cambios de permisos revocan admisión; un precio estimado no se interpreta como límite garantizado del proveedor de nube.

### A-06 — P1: falta un punto de finalización consistente de la evidencia

**Evidencia:** §14 tiene staging/commit/hash y §6.2 tiene snapshot/cursor. Falta definir cuándo todos los archivos/receipts de un resultado pertenecen al mismo conjunto finalizado.

**Escenario:** la UI reúne energía de attempt A, DM de B y un assessment anterior. Un output crece entre hash y copia; un índice se publica antes del archivo final.

**Corrección:** `FinalizationReceipt` con set de artefactos esperados, snapshots inmutables verificados, refs de locks/attempt/política/validator y cursor nativo. Publicar el manifest/receipt al final y actualizar proyección mediante revisión condicionada; recuperar operaciones parciales por reconciliación. No presupone transacción DB+filesystem+scheduler.

**Aceptación:** matar el proceso en cada punto de publicación deja un conjunto completo o una finalización pendiente detectable. Los previews pueden ser parciales; no habilitan gates que exijan evidencia definitiva.

### A-07 — P1: pruebas por código fuente no acreditan la distribución instalada

**Evidencia:** las verificaciones previas fueron suites seleccionadas; el `pyproject.toml` QRAFT usa `pythonpath = ["src"]`. El lock npm existe, pero el build permite un esbuild alternativo mediante variable o path externo.

**Escenario:** las pruebas pasan con código fuente/fixtures, pero al instalar el wheel faltan datos, entrypoints o handlers. El HTML de una release se construye con un esbuild diferente al que registra el lock.

**Corrección:** probar wheels/sdist y entrypoints en un entorno limpio sin `PYTHONPATH=src`; registrar hashes y dependencias por target. El build de release falla si usa fallback no declarado. Registrar vendor/WASM/datasets/fonts además de dependencias de package manager; generar notices correspondientes.

**Aceptación:** el artefacto publicado, no una reinstalación del checkout, pasa smoke/contratos/fixtures del alcance. Dos builds independientes del mismo target se comparan según política de determinismo documentada; no se exige igualdad de bytes entre plataformas distintas sin comprobarla.

### A-08 — P1: falta el modelo de privilegios de CI

**Evidencia:** recomendar GitHub Actions/build/PR no especifica eventos, runners, permisos, secretos o publicación. No hay pipeline implementado en la copia actual.

**Escenario:** un PR modifica un test o script que corre con una clave SSH o en un runner dentro del HPC. Puede usar esas credenciales y ejecutar fuera del alcance de las pruebas.

**Corrección:** CI de PR sin secretos ni conectividad HPC, permisos mínimos y acciones fijadas por SHA verificado. Integración HPC/release en workflow y runner separados, usando revisión de confianza y artefacto/commit identificados. No ejecutar código no confiable con checkout privilegiado. [Guía de seguridad de GitHub Actions](https://docs.github.com/en/actions/reference/security/secure-use).

**Aceptación:** un PR de prueba no puede leer secretos ni alcanzar el HPC; el workflow privilegiado rechaza origen/artefacto no confiable. La credencial usada en integración tiene alcance limitado al sitio/usuario de ensayo.

### A-09 — P1: un estado global de capability puede ocultar combinaciones no probadas

**Evidencia:** §7 propone estados de catálogo y §18.4 una matriz de versiones. Falta su vínculo ejecutable con perfil/protocolo/modo/solver/MPI y revisión del entorno.

**Escenario:** un plugin calificado con HF-1 y un entorno se usa en HF-2, otro binario o otro filesystem porque ambos muestran el mismo nombre de capability.

**Corrección:** calificación por tupla explícita y por dimensiones independientes: contrato, runtime, ciencia, recuperación y target. `CapabilityQualificationRecord` enlaza fixtures/receipts/versiones/alcance; el AdmissionReceipt comprueba la combinación requerida. Los fingerprints nativos siguen intactos.

**Aceptación:** una combinación no ensayada no hereda `SCIENTIFICALLY_QUALIFIED`; actualizar el catálogo no cambia el worker ni el veredicto de runs activos. La matriz es evaluable por código, no solamente una tabla de Markdown.

Investigar materiales nuevos sigue permitido dentro del protocolo/runtime admitidos, conservando alcance exploratorio y estados no establecidos. La calificación del método/entorno no predice el resultado físico y no se usa para exigir que toda investigación ya tenga resultado certificado.

### A-10 — P1: backup necesita consistencia y tratamiento de trabajos posteriores al snapshot

**Evidencia:** §14.3 exige respaldo/restauración, pero no fija checkpoint/cursor ni recuperación ante DB restaurada más antigua que trabajos aceptados por el scheduler.

**Escenario:** se restaura DB de ayer mientras hay jobs actuales; no existen las nuevas claves de idempotencia y el usuario los envía otra vez. O se copiaron journals/outputs mientras estaban cambiando.

**Corrección:** `RecoveryCheckpoint` con snapshot de DB obtenido por método soportado, conjuntos de artefactos inmutables y cursors/refs de journals nativos. Definir RPO/RTO por tipo de dato/perfil. Arrancar en modo recuperación, reconciliar trabajos/recibos remotos autorizados y conservar incertidumbres antes de reabrir envío.

**Aceptación:** restaurar deliberadamente un checkpoint anterior a un submit, descubrir el intento remoto y evitar duplicación; evidencias posteriores no se borran para cuadrar con la DB restaurada. No exigir RPO=0 sin infraestructura y pruebas que lo soporten.

### A-11 — P2: separación en carpetas no impide dependencias indebidas

**Evidencia:** §3.1 prescribe dirección de imports; no hay prueba que la imponga. Los módulos actuales mezclan responsabilidades y usan helpers compartidos.

**Escenario:** learn importa el SDK de ejecución; un dominio importa AsyncSSH o FastAPI; el frontend reproduce un gate Hubbard para habilitar un job.

**Corrección:** reglas de arquitectura verificadas sobre imports/build, puertos tipados y tests de frontera. El worker puede distribuirse desde el mismo paquete backend con entrypoint separado; la separación física de procesos no exige otro repositorio. Los plugins dinámicos se limitan al registro confiable y se verifican por separado.

**Aceptación:** una dependencia prohibida introducida como fixture hace fallar el check. Aprender no recibe capacidad de ejecutar; dominio no tiene infraestructura. Un test científico confirma que la UI presenta el veredicto del motor sin reemplazarlo.

### A-12 — P2: especificación extensa sin estructura documental canónica

**Evidencia:** documento maestro, contrato actual e informes comparten contenido; existen links absolutos a `C:/Users/Jairo`. `CLAUDE.md` y `AGENTS.md` aún no existen y podrían divergir al escribir dos copias de instrucciones.

**Escenario:** Claude aplica una versión del contrato y Codex otra. Un clon en Linux no puede seguir enlaces. Una implementación actualiza la API, pero el master prompt sigue mostrando la firma anterior.

**Corrección:** después de adopción, `ARQUITECTURA.md` funciona como índice del contrato vigente, docs de arquitectura/ADR como decisiones, schemas/OpenAPI como contratos ejecutables y backlog como estado de trabajo. Los master prompts/revisiones conservan fecha y estado. CLAUDE/AGENTS enlazan las mismas reglas; links de repositorio relativos. Un check detecta referencias rotas y divergencias de schemas/SDK.

**Aceptación:** clonar en otra ruta/OS y ejecutar los comandos documentados; cada contrato tiene una fuente normativa y propietario. No considerar el render de Mermaid una prueba de corrección del diseño.

### A-13 — P2: hay que definir el contenido de la primera baseline Git

**Evidencia:** esta carpeta no tiene historial; contiene app, corridas, prototipos y pruebas exploratorias. El código depende de JSON/vendor/pseudos/fixtures, no solo de `.js`.

**Escenario:** un `.gitignore` genérico omite los datos requeridos y el clon deja de funcionar. O se sube todo, incluyendo archivos temporales, configuraciones del usuario o resultados grandes en expansión.

**Corrección:** inventario de entradas del build y pruebas, política por dataset y manifest de originales; `.gitignore` específico; baseline con fallos conocidos, no etiquetada como producción certificada. Conservar lockfiles y assets necesarios. Builds generados se entregan como artefactos/release; prototipos se archivan con procedencia según decisión del inventario.

**Aceptación:** build/pruebas desde clon limpio sin archivos preexistentes ni rutas personales; revisión de contenido antes del primer push. Un repositorio privado puede necesitar un plan distinto para disponer de protecciones de rama; comprobarlo, sin cambiar a público solo para obtenerlas. [Disponibilidad de protección de ramas](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).

### A-14 — P2: atributos de calidad sin escenarios medibles

**Evidencia:** §16.4 pide benchmark y no inventar SLAs, correctamente. Pero no enumera objetivos operativos mínimos ni responsables/criterios de recuperación del primer release.

**Escenario:** todas las pruebas funcionales pasan, pero reconectar reproduce demasiados eventos, el polling satura el sitio o restaurar tarda más de lo que el usuario puede tolerar.

**Corrección:** escenarios de calidad con estímulo, entorno, respuesta, medida y target por perfil. Priorizar integridad, seguridad, recuperabilidad, compatibilidad y capacidad bajo carga antes de volumen de features. Definir RPO/RTO, límites de memoria/tamaño, polling/backpressure y disponibilidad de API cuando el sitio remoto falla; obtener valores por medición y necesidad del usuario.

**Aceptación:** cada target anunciado está medido; los campos no resueltos aparecen DRAFT y no permiten prometer SLA. Un release piloto puede declarar límites conservadores basados en benchmark.

### A-15 — P2: dependencias científicas artificialmente serializadas

**Evidencia:** el diagrama y P7 dependen de P6 completo. Integrar una campaña LR-U encapsulada o el protocolo de superficies no requiere haber terminado el ajuste BM3 ni las masas de bandas.

**Escenario:** un módulo electrónico atrasado bloquea innecesariamente Hubbard, aunque su motor y protocolo estén listos. Se acumulan ramas largas esperando una fase no relacionada.

**Corrección:** P6/P7 parten de contratos P1 y ruta P4/P5, con dependencias científicas concretas por ticket. Se integran por capability y slices verticales, conservando todos los módulos del alcance final. P9 depende de una ruta operativa calificada y controles de aislamiento; el catálogo indica cuáles workflows están disponibles.

**Aceptación:** HF-1 se puede probar sin el analizador EOS; una release parcial tiene matriz honesta; el destino completo mantiene los cuatro workflows y extensiones previstas.

## 3. Forma estandarizada recomendada

### Documentación y controles

Usar **arc42** como índice de arquitectura: objetivos, restricciones, contexto, estrategia, componentes, runtime, despliegue, conceptos transversales, decisiones, calidad, riesgos y glosario. Es una plantilla adaptable; no exige doce documentos vacíos ni constituye una certificación. [arc42](https://arc42.org/overview/).

Usar **C4** para contexto y contenedores/procesos, con componentes donde aporten valor, más secuencias de submit/resume/cancel/finalize/recovery y despliegue. Un contenedor C4 representa una unidad ejecutable/almacén; no implica adoptar Docker o microservicios. [C4](https://c4model.com/diagrams).

Mantener ADR y contratos ejecutables de plataforma con OpenAPI/JSON Schema, nativos referenciados y SDK generado/verificado. Incorporar prácticas SSDF al ciclo de desarrollo y procedencia de build compatible con el perfil SLSA elegido. No anunciar cumplimiento o nivel SLSA hasta comprobar todos sus requisitos. [NIST SSDF 1.1](https://csrc.nist.gov/pubs/sp/800/218/final), [SLSA 1.2](https://slsa.dev/spec/v1.2/).

La procedencia de build identifica cómo se produjo software; PROV/RO-Crate identifica actividades/datos científicos. Un SBOM no certifica la física y una corrida científica convergida no valida la seguridad del instalador. [Formato de procedencia de build SLSA](https://slsa.dev/spec/v1.2/build-provenance).

### Repositorio y empaquetado

```text
dftlab-suite/
  app/                       frontend actual, builds portátil/servido
  platform/                  paquete dftlab_platform, API y worker por entrypoint
  contracts/                 schemas/API/eventos/fixtures/compatibilidad
  docs/
    architecture/            índice arc42, C4 y escenarios
    adr/                     decisiones adoptadas
    protocols/               alcance y políticas científicas
    quality/                 objetivos, benchmarks y pruebas
    runbooks/                instalación, incidente, restore y reconcile
    compatibility/           matrices y evidencia de calificación
  deployment/                targets y perfiles sin secretos
  .github/                   workflows/plantillas/ownership
  scripts/                   interfaz común de verificación y release
  engine-versions.lock.json  referencias exactas y hashes de distribuciones
  README.md                  instalar, comprobar, desarrollar y límites
  ARQUITECTURA.md            entrada al contrato vigente
  CLAUDE.md / AGENTS.md      instrucciones hacia la misma fuente de reglas
  .gitignore / .gitattributes
```

No crear carpetas vacías para simular completitud. La migración se hace con inventario y commits pequeños, manteniendo assets y funciones. Motores en repositorios independientes, instalados como distribuciones fijadas; cambios coordinados por contratos/compatibilidad. El adaptador puede vivir en el paquete de plataforma mientras no tenga ciclo independiente que justifique otro paquete.

`main` mantiene la baseline integrada; ramas cortas y worktrees aíslan trabajo de Claude/Codex. PR con checks sobre diff más integración de componentes afectados. Releases por alcance probado; tags/release artifacts no se sustituyen silenciosamente. CODEOWNERS puede expresar responsabilidades; no configura por sí solo una revisión obligatoria.

## 4. Escenarios que deben demostrar los cimientos

| ID | Experimento | Criterio de aceptación |
|---|---|---|
| ADV-01 | Clon limpio fuera de la ruta del autor | Build/tests con dependencias declaradas; sin cache ni paths personales |
| ADV-02 | Instalar wheels/artefacto CI sin `PYTHONPATH` | Entry points, datos, schemas y fixtures disponibles |
| ADV-03 | Dos submits simultáneos con misma clave | Una operación; payload distinto produce conflicto |
| ADV-04 | Dos requests distintos contra budget limitado | Reserva atómica; admisión dentro del límite configurado |
| ADV-05 | Perder ack después de aceptación del scheduler | Reconcile por evidencia o UNKNOWN; sin retry ciego |
| ADV-06 | Controller viejo vuelve después de takeover | No lanza/publica autorizado; o takeover rechazado por falta de fencing |
| ADV-07 | Cancel llega después de terminación | Resultado observado preservado; solicitud con efecto/no efecto explícito |
| ADV-08 | Cambiar entorno/pseudo tras preflight | Rechazo o nueva preparación; nada se reinterpreta silenciosamente |
| ADV-09 | Shell manual modifica archivo de campaña | Recibos dependientes inválidos; alcance de confianza visible |
| ADV-10 | Matar servicio durante commit/finalización | Manifest/receipt íntegro o estado pendiente recuperable |
| ADV-11 | Restore previo a un submit aún activo | Recuperación/reconcile antes de admisión; trabajo no duplicado |
| ADV-12 | SDK viejo recibe enum/nueva versión | Tratamiento compatible seguro o rechazo explícito |
| ADV-13 | Caso HF-1 técnico exitoso, ciencia no establecida | Nunca se promueve a certificado; descendientes según gate nativo |
| ADV-14 | PR modifica script e intenta usar secretos/HPC | CI sin esas credenciales/acceso; release en otro contexto |
| ADV-15 | API responde mientras SSH/scheduler están caídos | Estado remoto desconocido, backpressure y targets de API medidos |
| ADV-16 | Cambio de permisos y acceso desde otro principal | HTTP/WS/events/replay/artefactos revocados según política |
| ADV-17 | Actualizar motor/API con run activo | Versión anterior fijada y accesible; no migración científica implícita |
| ADV-18 | Input de learn convertido a draft | Promoción/revisión explícita; sin submit automático |

Son pruebas a implementar, no resultados obtenidos. Se trazan en T-055…T-062 del backlog V2.1 y en los tickets nativos de cada motor que hagan falta.

## 5. Decisión resultante

**Mantener:** un repositorio de plataforma; frontend modular; backend modular con puertos; workers cerca del cálculo; QRAFT/Hubbard como autoridades; distribución portátil y servicio local; web por evolución de infraestructura.

**Corregir:** gates por primer release operativo, schemas/transiciones aplicados, admisión/ownership remotos, frontera de terminal, finalización y backup consistentes, CI sin privilegios de cálculo y prueba de paquetes instalados. Usar arc42/C4/ADR para documentar esos mecanismos y checks para aplicarlos.

**Evitar:** repositorio que solo contiene carpetas bien nombradas, ramas largas por fase, checks verdes basados únicamente en fuente, seguridad pospuesta, un estado global de calificación y un master prompt como única autoridad técnica.

La preparación de producción se obtiene cuando una combinación concreta de software, protocolo y sitio pasa sus escenarios, instalación y recuperación. En esta entrega se corrigió el diseño documental; esos mecanismos todavía deben implementarse y verificarse.
