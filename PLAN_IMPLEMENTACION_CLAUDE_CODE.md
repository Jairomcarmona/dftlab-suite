# DFT Lab V2: plan de implementación para Claude Code

Fecha: 10 de octubre de 2026. Estado: backlog propuesto, no implementación ejecutada. Versión: 2.1, tras revisión adversarial.

Este plan ejecuta [PROPUESTA_MAESTRA_DFTLAB_V2.md](PROPUESTA_MAESTRA_DFTLAB_V2.md). Su matriz R-01…R-50 define el alcance completo; este archivo lo convierte en tareas, dependencias y evidencias. Los cuatro estudios, los cuatro workflows prioritarios, las extensiones científicas y los despliegues tienen entregables explícitos.

La [auditoría adversarial](AUDITORIA_ADVERSARIAL_ARQUITECTURA_PRODUCCION.md) añade T-055…T-062 y adelanta instalación, CI seguro, recibos de operación y restore. §18 de este backlog y §25 del maestro precisan esos gates antes del primer release operativo. T-001…T-054 conservan sus IDs y alcance; T-053/T-054 amplían después los controles que comienzan desde P1/P3.

## 1. Reglas operativas para la implementación

1. Conservar el frontend y evolucionarlo por componentes. El HTML único es un formato de distribución, no el lugar donde escribir toda la aplicación.
2. Adoptar los ADR y actualizar `ARQUITECTURA.md` antes de introducir contratos incompatibles. Conservar las decisiones vigentes de rigor científico y navegador sin SIESTA.
3. QRAFT ejecuta; HubbardFlow define LR-U; la plataforma administra proyectos, operaciones, conexiones, archivos y permisos. No construir un tercer runtime ni duplicar gates científicos.
4. Trabajar con referencias exactas. QRAFT: `4d996ea7c580e5638e470bbf32624c88fd762f7d`. HubbardFlow: `e508f47aff1c6243deabb12915063b6b9d899d65`, observado en `codex/hubbardflow-rename`. Verificar versiones/origen instalados; un cambio crea nueva matriz de compatibilidad.
5. Leer las instrucciones de cada motor y preservar sus baselines científicas congeladas. Las APIs faltantes se desarrollan upstream; no importar privados ni copiar código de los motores a DFT Lab.
6. Toda capability nueva recorre registry, serialización, compiler, package, runtime, validación, cancelación y resume. Un botón o un schema aislado no constituye soporte.
7. Mantener aprendizaje, draft, plan resuelto, package, run, attempt y resultado como entidades distintas. Ninguna importación ni cambio de tema envía un job.
8. Guardar originales y evidencia. Nunca cambiar locks antiguos, corregir resultados históricos en sitio o degradar parámetros científicos para hacer pasar una prueba.
9. Añadir pruebas proporcionales al comportamiento cambiado, empezando por el reproducer. No repetir indiscriminadamente todas las suites por cambios de documentación.
10. Registrar avances y límites. Si falta un contrato/caso científico/sitio, crear un ticket preciso y publicar la capability como pendiente; no inventar su funcionamiento.

La lectura inicial comprende `ARQUITECTURA.md`, `ANALISIS_TECNICO.md`, `EVALUACION_ARQUITECTURA.md`, `INTEGRACION_DFTLAB_QRAFT_HUBBARDFLOW.md`, los dos documentos V2.1, la auditoría adversarial y las instrucciones aplicables de los motores. No sustituir esta lectura por reconstruir el diseño desde el prompt.

## 2. Artefactos permanentes del desarrollo

| Artefacto propuesto | Contenido | Dueño |
|---|---|---|
| `docs/adr/` | ADR-001…012 y decisiones posteriores | Plataforma y consumidores afectados |
| `contracts/` | Schemas, API, eventos, native refs y compatibilidad | Plataforma/adaptadores |
| `contracts/fixtures/` | Ejemplos positivos/negativos, hashes y estados científicos | Productores y consumidores |
| `docs/capabilities/` | Matriz por operación/motor/versión/sitio y evidencia | Integración científica |
| `docs/requirements/` | R-01…42, G-01…09, S-01…08, tickets y estado | Producto/ingeniería |
| `docs/deployment/` | Local Windows/WSL/Linux, SSH/HPC, web y K8s | Operación |
| `docs/scientific-protocols/` | Semántica, políticas, gates, referencias, fixtures y alcance | Responsables científicos |
| `tests/fixtures/` | Casos de ingesta, ejecución, fallos, seguridad y ciencia | Componente correspondiente |
| Manifest de versiones | Commit/distribución/hashes de motores, adaptadores y worker | Release |
| Guías de instalación y recuperación | Arranque, actualización, respaldo, restore y reconcile | Operación |

Son rutas destino; no se afirma que ya existan. Elegir nombres finales en P1 y mantener enlaces coherentes. No guardar secretos ni datasets grandes en fixtures sin una política de almacenamiento/licencia.

## 3. P0: baseline y correcciones previas

**Depende de:** copia actual e informes. **Cubre:** R-01/02/23/24/37/40.

Se incorpora también T-055: baseline Git/CI sin privilegios. Es un entregable de P0, no un trabajo para después de la expansión funcional.

| Ticket | Trabajo concreto | Aceptación |
|---|---|---|
| T-001 | Inventariar vistas, lectores, calculadoras, formatos, exports y datasets; identificar fuente/build/original | Matriz con archivo, consumidor, prueba y conservación; los conteos concuerdan con código |
| T-002 | Registrar baseline de build/suites/entorno y revisión de fuentes | Comandos reproducibles y fallos conocidos separados de regresiones |
| T-003 | Corregir navegación XC→Inicio→tema y observadores abandonados | Reproducer pasa; callbacks de vista desmontada no escriben en otra vista |
| T-004 | Corregir render `.dftlab.json`, RHO binario y asociación EIG/KP | Datos se visualizan; ingesta en distinto orden produce la misma asociación |
| T-005 | Corregir escape de metadatos y atributos derivados de archivos | Payloads de prueba aparecen como texto o se rechazan; no ejecutan HTML/JS |
| T-006 | Corregir runner cristalográfico Windows con URLs ESM correctas | Suites originales corren sin adaptación en memoria; mismo alcance Linux |

Comandos actuales, ejecutados desde `app/`:

```powershell
npm run build
node tests/siesta/run_tests.mjs
node tests/siesta/run_rho_tests.mjs
node tests/siesta/run_outnotes_tests.mjs
node tests/siesta/run_fc_tests.mjs
node tests/crystal/run_tests.mjs
```

No cambiar tests o tolerancias para ocultar errores. El número de comprobaciones puede aumentar. Verificar navegación real, archivos y temas además de abrir pantallas individualmente. Los scripts de Linux que no funcionen en PowerShell se adaptan explícitamente, sin asumir un entorno remoto.

## 4. P1: contratos, ADR y fronteras de los motores

**Depende de:** inventario P0. **Cubre:** R-03/04/05/06/13/30/40/42.

Se incorporan T-056, inicio de T-057 y diseño de T-059/T-061/T-062: schemas/guardas/imports, manifest de release, confianza/admisión, calificación por combinación y escenarios de calidad.

| Ticket | Trabajo concreto | Aceptación |
|---|---|---|
| T-007 | Adoptar ADR-001…012 y actualizar contrato de módulos/capas | `ARQUITECTURA.md` explica dual build, ViewScope, servicio y autoridad; decisiones anteriores migradas |
| T-008 | Schemas del envelope y entidades de plataforma | StructureRevision, SpeciesDefinition, PhysicalModel, NumericalPolicy, RunIntent, ArtifactRecord/Ref, NativeContractRef, ResultDataset, AssessmentRecord, LearningDataset, OperationRequest/Record, RunProjection, ResumePlan, ValidationReceipt, AnalysisResult, EventRecord y CapabilityDescriptor; fixtures JS/Python válidos/inválidos |
| T-009 | Interfaces públicas y mapping de contratos nativos | Ports tipados; digests/estados/planes científicos no se regeneran ni simplifican |
| T-010 | Version lock, distribución y catálogo de capabilities | Dependencias por target, hashes y dist names; API informa lo realmente instalado/probado |
| T-011 | OpenAPI/eventos/SDK inicial y reglas de evolución | Error estructurado, idempotencia, revisión optimista, cursor/replay y compatibilidad de consumidores |

Antes de cerrar T-009 documentar exactamente qué API pública ofrece cada commit, cuáles faltan y qué cambio corresponde a cada repositorio. Las firmas propuestas en la arquitectura son **contratos a implementar**, no métodos ya disponibles. Definir quién conserva el lock nativo y quién guarda su proyección.

El primer fixture de resultado debe contener terminación técnica exitosa y veredicto científico `NOT_ESTABLISHED`; el SDK/UI lo presenta sin convertirlo en certificado. Otro fixture contiene un campo enum futuro y verifica tratamiento seguro, sin colapsarlo en `PASS`.

## 5. P2: separación del frontend y distribuciones

**Depende de:** P0/P1. **Cubre:** R-01/02/03/04/23/25/37.

| Ticket | Trabajo concreto | Aceptación |
|---|---|---|
| T-012 | ViewScope y adaptación gradual de mount/destroy/onTheme | Dispose cancela async/listeners/workers/timers; API vieja tiene wrapper migrable |
| T-013 | Stores por área/proyecto y utilidades puras compartidas | Aprender y producción no comparten estado mutable; cambiar proyecto invalida respuestas del anterior |
| T-014 | Promover ejemplo/importación a draft explícito | Origen/purpose/calidad visibles; revisión genera otra identidad; no run implícito |
| T-015 | Build portátil offline y build operativo servido | Misma fuente/lectores; portable conserva preparación/post y web carga recursos por demanda |

Los componentes de teoría permanecen en learn; la configuración operativa no depende de DOM de un capítulo. Los plots y viewers reciben modelos de datos y lifecycle. Los estilos de vista permanecen encapsulados; no rediseñar globalmente `app.css` como condición para integrar un motor.

Verificar 15 capítulos, herramientas, exports y post en portátil; controles de cálculo muestran disponibilidad real del servicio. Permitir consultar el estado remoto desconectado sin presentar una terminal como disponible. Una ejecución completada puede reutilizarse en aprendizaje conservando procedencia y evaluación originales.

## 6. P3: plataforma local, archivos y SSH

**Depende de:** P1; UI depende de P2. **Cubre:** R-04/26/27/28/30/33/37/40.

T-057/T-059/T-060 requieren instalación/identidad/receipts/checkpoint desde esta fase. Antes de ofrecer cálculo administrado se demuestra restore/reconcile con T-058/T-062 en P4.

| Ticket | Trabajo concreto | Aceptación |
|---|---|---|
| T-016 | Servicio modular FastAPI, launcher y configuración validada | Start/status/stop/health; una instancia local autorizada; no handlers ejecutando campañas largas |
| T-017 | Proyectos, revisiones, operaciones durables y ArtifactStore local | SQLite fuera de NFS, staging/commit, índices reconstruibles y restart con estado conservado |
| T-018 | Sesión local/origin/host/CSRF/WS y aislamiento de paths | Origen ajeno rechazado; secretos fuera de UI/storage; descarga verifica permisos |
| T-019 | Perfiles SSH/agent/config/known_hosts/jump host | connect(profile) crea Session independiente; fallo de host key no se ignora; MFA soportado se declara |
| T-020 | xterm/fit y PTY/resize/señales/cierre | Dos terminales no se mezclan; cierre termina sesión, no job batch; reconexión no reenvía comandos |
| T-021 | Transferencias streaming, hashes, partial/resume y límites | Subir/descargar sin RAM total; archivo parcial o mutable no se promueve; rutas/archives seguros |

Mantener fachada `remote` para consumidores existentes. `available` significa servicio accesible, no permiso global para ejecutar ni certificado del sitio. La vía manual `run(command)` es privilegiada y separada de campañas estructuradas. En web se decide explícitamente si esa terminal existe para un rol/proyecto/sitio.

La implementación de SSH nunca solicita al navegador entregar una clave privada. Probar variantes de autenticación disponibles realmente en Windows/WSL y en los hosts objetivo, con estados de fallo comprensibles. No prometer soporte de cualquier configuración OpenSSH porque exista un campo `config`.

## 7. P4: primera ruta completa con QRAFT

**Depende de:** P1/P2/P3. **Cubre:** R-05/11/28/29/30/31/32/33/34/39/42.

Los gates T-057…T-062 del alcance publicado bloquean la salida operativa P4. Un pipeline verde por fuente o un lease sin enforcement remoto no los satisface.

| Ticket | Trabajo concreto | Aceptación |
|---|---|---|
| T-022 | Adaptador QRAFT authoring→compiler→package→runtime | Single point y operación derivada pasan cadena completa; mismas identidades/evidencia del motor |
| T-023 | Worker Linux/WSL y perfil SLURM/nube SSH inicial | Ejecutable, MPI/threads, módulos y filesystem validados; caso SIESTA real pequeño |
| T-024 | Durable submit/outbox/idempotencia/reconcile | Caída tras aceptación no duplica trabajo; job identity estable y UNKNOWN explícito |
| T-025 | Ownership/lease/fencing y publicación protegida | Segundo controlador rechazado; propietario vencido no puede lanzar/publicar; garantías por sitio |
| T-026 | Cancel/retry/resume/forense y eventos UI | Cancel confirmado separado de solicitud; recibo nativo de reuse; intentos conservados y replay |
| T-027 | Pasaporte/telemetría/budget admission inicial | Resultado separa scheduler/ejecución/integridad/ciencia; costos/límites según perfil, no cifras inventadas |

El gate P4 requiere demostrar:

1. Un draft válido genera plan/locks/package; no se recalculan digests nativos con JSON del frontend.
2. Un intento se ejecuta, produce observación y artefactos íntegros, y la UI muestra su evidencia.
3. Una campaña interrumpida se reconcilia y reanuda sin reutilizar entradas modificadas ni duplicar controladores.
4. Cancelar no deja procesos descendientes bajo el alcance admitido del executor.
5. Cerrar terminal/navegador no mata un job batch; apagar la laptop tiene la consecuencia declarada para el tipo de controlador.

No usar `BackgroundTasks` o una promesa HTTP en memoria como almacenamiento durable. Las pruebas con scheduler fixture y con SLURM real son entregables separados. Un export `submit.sh` válido es valioso, pero no demuestra ejecución administrada.

## 8. P5: toda la suite de preparación, validación y post

**Depende de:** contratos P1 y frontend P2; operación usa P4. **Cubre:** R-07…16/23/24/25/34/37.

| Ticket | Trabajo concreto | Aceptación |
|---|---|---|
| T-028 | Estudio cristalográfico G-01…09 | Formatos, simetría, celdas, supercelda, slab, constraints, k-path/BZ, distancias y export con atom-map |
| T-029 | Estudio de corridas S-01…08 | Presets tienen RunIntent/protocolo, FDF efectivo, archivos requeridos y capability, sin dibujar DAG obligatorio |
| T-030 | Preflight por cuatro capas y auditoría graduada | Includes/precedencia/formatos conforme SIESTA; unknowns explícitos; diff y auditoría estructurada |
| T-031 | Pseudopotenciales y bundles completos | Especies/aliases/funcional/licencia/hash; biblioteca externa; 30 elementos×2 no anunciados como 60 |
| T-032 | Diseñador/registry de campañas y calculadoras | Plantillas tipadas; composición sin UI-specific engine logic; inventario actual conservado |
| T-033 | Postprocesador común, loaders y análisis por identidad | Todos los formatos del inventario T-001; binarios/texto/pack; multiarchivo y campañas con etiquetas iguales |
| T-034 | Comparación/export, previews/worker y límites de tamaño | Figuras/datos/estructuras/informe con unidades/referencias/procedencia; original no sustituido por preview |

Desglosar T-028 en nueve subtareas G-01…09 y T-029 en ocho S-01…08. Desglosar T-033 por cada lector y vista de análisis inventariados, conservando su test/fixture. No cerrar un ticket agrupado con un único caso feliz.

El estudio de campañas permite diseñar/exportar las cuatro plantillas en P5; la calificación operativa de EOS/bandas llega en P6 y Hubbard/superficies en P7. No etiquetar esas plantillas como runtime verified antes de los respectivos gates.

Los presets de moléculas/carga/dipolo y superceldas dependen del problema y ejecutable. `0.6 Å`, `500 Ry`, `0.35`, `16 Å` y Gamma-only no se transforman en leyes universales. El modo experto puede aceptar una advertencia de política; no puede convertir un pseudo inexistente, un path fuera del proyecto o un checkpoint incompatible en evidencia válida.

## 9. P6: EOS, estados, convergencia y electrónica

**Depende de:** P4/P5 y protocolos versionados. **Cubre:** R-17/18/21/25/39.

| Ticket | Trabajo concreto | Aceptación |
|---|---|---|
| T-035 | WF-EOS: relajación→volúmenes→SCF→BM3→evaluación | Factor lineal = factor de volumen elevado a 1/3; comparabilidad y ajuste/incertidumbre; refinamiento crea otra revisión |
| T-036 | WF-ELECTRONIC: SCF/bandas/PDOS/fat bands/masas | K transforms, DM/pseudos, proyectores, spin, Fermi, sampling y direccionalidad; ejecutor usa protocolo SIESTA real |
| T-037 | Campañas de convergencia y selección de estados | Sampling/políticas/budgets, perfiles provisionales/aceptados, comparación de ramas y límites del mínimo obtenido |

Los analizadores se separan de las vistas y producen AnalysisResult con input refs/política/versión. Probar datasets sintéticos o controlados para propiedades matemáticas y casos SIESTA reales para protocolo completo. Evitar que el validador asigne gap global a un camino k insuficiente o un tensor de masas a una curvatura unidimensional.

Las decisiones adaptativas generan acciones permitidas y nuevos planes resueltos, no mutaciones del lock anterior. Puede existir intervención explícita prevista por un protocolo; la plataforma debe representar `REVIEW`/pausa sin perder evidencias. No introducir revisión humana de cada operación rutinaria si el contrato no la requiere.

## 10. P7: Hubbard HF-1 y superficies

**Depende de:** P1/P4/P5 y contrato del protocolo Hubbard; las dependencias concretas adicionales se declaran por ticket. No requiere terminar EOS o masas de P6. **Cubre:** R-06/09/19/20/29/31/32/39.

| Ticket | Trabajo concreto | Aceptación |
|---|---|---|
| T-038 | Plugin HF-1 encapsulado y puente de evidencias | QRAFT controla tarea exterior; Hubbard controla campaña interior; recursos/allocation y subprocesos definidos |
| T-039 | LR-U, UI de observaciones/gates y resume/cancel compuesto | Preserva plan, policy hashes, bare/screened, referencia DM, precisión, estados científicos y mapas de intentos |
| T-040 | WF-SURFACE: slabs, convergencia y función de trabajo | Normal arbitraria, mesetas/caras, opciones SIESTA correctas, potencial y referencia; bulk solo donde científicamente necesario |

T-038 exige una prueba que trace un intento interno hasta el run exterior, evitando dos schedulers lanzando el mismo trabajo o oversubscription dentro de la reserva. T-039 exige cancelación durante actividad interna, interrupción/reanudación y un caso técnico exitoso pero científico no establecido. Un proceso Hubbard que termina con exit 0 no constituye el gate científico.

El caso LR usa una baseline y un protocolo permitidos por HubbardFlow; no se alteran amplitudes/inversión/criterios para alcanzar un valor esperado. El resumen distingue U scalar charge, U/J/U_eff y semántica del Hamiltoniano. La plataforma presenta cobertura y límites; la certificación pertenece al motor/política.

P7 cierra la operación de los cuatro workflows prioritarios. Registrar qué sistemas, parámetros y entorno se calificaron, sin anunciar validez universal de sus defaults.

## 11. P8: integración fina y ampliaciones científicas

**Depende de:** P7; algunos analizadores pueden avanzar antes. **Cubre:** R-06/21/22/39/42.

| Ticket | Trabajo concreto | Aceptación |
|---|---|---|
| T-041 | HF-2: fragmentos/callbacks públicos desde Hubbard | QRAFT único executor de nodos; Hubbard conserva decisiones/observaciones; equivalencia con HF-1 para casos permitidos |
| T-042 | Fonones periódicos operativos | Supercelda/desplazamientos/FC/masses/q-path/DOS/ASR/convergencia y modos imaginarios según política |
| T-043 | Óptica operativa | Capacidades, bandas vacías/malla/smearing/polarización/unidades/normalización y evidencia del cálculo |
| T-044 | Exploración magnética operativa | Configuraciones y restricciones admitidas, comparación homogénea, metástabilidad y mínimo entre estados ensayados |

HF-2 requiere releases de motores/adaptador específicas; no convertir campañas HF-1 activas en HF-2. Comparar análisis y gates para fixtures que compartan la misma política/semántica. Si QRAFT no representa una decisión adaptativa requerida, ampliar su contrato upstream o conservar esa capability en HF-1 hasta resolverlo.

No implementar SOC/no colineal/híbridos/GW por inferencia del capítulo educativo. Cualquier nueva familia solicita un protocolo, capability, schemas y caso calificado. Las tres extensiones T-042…044 sí son parte del destino previsto y no se eliminan del backlog por ser posteriores al primer release.

## 12. P9: web multiusuario y escalado controlado

**Depende de:** ruta P4 calificada y controles base T-055…T-062. La operación de cada workflow web requiere su gate P6/P7/P8; construir infraestructura web no requiere completar todas esas funciones. No necesita esperar HF-2. **Cubre:** R-29/30/35/37/39/40/42.

| Ticket | Trabajo concreto | Aceptación |
|---|---|---|
| T-045 | Identidad/OIDC y ACL por proyecto/operación/archivo/terminal | Roles y revocación; un usuario no consulta ni descarga evidencia de otro |
| T-046 | PostgreSQL, store compartido y migraciones | API/local usan interfaces equivalentes; índices reconstruibles; backup/restore y migración ensayados |
| T-047 | Workers/cola/outbox/leases y afinidad de versión | Varias APIs no crean dos controladores; retry de delivery no duplica efecto; runs activos conservan motor |
| T-048 | Quotas, observabilidad, límites y pruebas de carga | Backpressure/budgets por sitio/proyecto; archivos grandes y fan-out; capacidad publicada tras medir |

La cola se elige por requisitos de entrega, operación y volumen. No fijar Redis/RabbitMQ/NATS u otro producto solo para parecer moderno. La semántica de ownership e idempotencia permanece en el contrato y debe sobrevivir un cambio de broker.

SQLite→PostgreSQL es migración de almacenamiento, no migración de autoridad del DAG. S3-compatible u otro ArtifactStore conserva verificación de bytes, permisos y publicación. Los workflows y locks se mantienen iguales aunque el API tenga diez réplicas; la arquitectura no presupone que diez réplicas aceleran un SCF.

## 13. P10: targets adicionales, interoperabilidad y distribución

**Depende de:** P4/P8/P9 para la release completa. Algunas tareas avanzan antes. **Cubre:** R-25/33/34/36/38/40/41.

T-053/T-054 extienden a más targets el pipeline, instalación y restore iniciados en T-057/T-060. Las releases parciales cumplen esos controles desde su primera distribución; no esperan a P10.

| Ticket | Trabajo concreto | Aceptación |
|---|---|---|
| T-049 | Executor PBS; export SGE conservado; SGE operativo si se adopta | Matriz explícita; submit/reconcile/cancel/resume probados por scheduler; no confundir script con adapter |
| T-050 | Kubernetes Jobs, recursos/secrets/RBAC/volumes y MPI declarado | Control plane separado; jobs idempotentes; shutdown/recovery; ensayo MPI/ABI si se anuncia |
| T-051 | CLI/SDK/notebook y plugin SDK documentado | Mismos servicios/contratos que UI; auth scoped; ejemplos reproducibles sin internos de motores |
| T-052 | Exportar/reproducir/publicar bundles | Inputs efectivos, locks, versiones/políticas/artefactos/quality; PROV/RO-Crate; sin secretos ni referencias inaccesibles inadvertidas |
| T-053 | Distribuciones, locks/wheelhouse/SBOM/licencias y actualización | Instalación limpia local/web/HPC target; distribución real de ambos motores probada; no paquete `qraft` ajeno |
| T-054 | Backup/restore, migraciones, incidentes y release matrix | Restore en instancia limpia; rollback de aplicación compatible; jobs activos reconciliados; soporte y límites documentados |

Si SGE operativo no se adopta, su ticket registra esa decisión y mantiene export validado; no se declara soporte de ejecución. MPI en Kubernetes/HPC requiere calificación propia. La disponibilidad de un PVC o un ejecutable `nompi` no acredita un cálculo distribuido.

La reproducción conserva parámetros y semántica, pero puede generar bytes distintos por paralelismo/hardware; distinguir identidad de inputs, igualdad de archivos y equivalencia de observables según política. FAIR no exige publicar datos privados. Obtener DOI o depositar en repositorio externo es una acción independiente, no un efecto de abrir una vista.

## 14. Contratos y condiciones de cierre por ticket

Cada ticket conserva esta ficha:

```text
ID / título / requisitos R y función G-S-WF
Repositorio y responsable de autoridad
Dependencias y versiones de consumidor/productor
Problema y comportamiento observable esperado
Contratos afectados y estrategia de compatibilidad
Archivos/componentes a modificar
Evidencia y fixtures necesarios; originales preservados
Pruebas pertinentes y condiciones de fallo
Instalación/migración/reversión cuando corresponda
Estado: pendiente | en curso | implementado | verificado | calificado
Resultado, límites y referencia a commit/release
```

El estado de ticket no reemplaza el catálogo de capability. Una implementación puede estar verificada por contratos y aún no calificada científicamente en un sitio. `RUNTIME_VERIFIED` no equivale a `SCIENTIFICALLY_QUALIFIED`.

Para cerrar una fase: todos sus requisitos tienen evidencia o una dependencia pendiente identificada; las pendientes no se contabilizan como completadas. Los tests relevantes pasan y los fallos conocidos siguen visibles; contratos incompatibles tienen migración; documentación y matriz reflejan el comportamiento final. No se exige reescribir módulos educativos no afectados ni crear un microservicio por cada herramienta.

## 15. Orden recomendado de los primeros cambios

El primer lote útil es P0/P1 con T-055/T-056 y manifest/fixtures iniciales de T-057/T-061/T-062. Después se pueden desarrollar P2 y P3 en ramas/componentes separados, manteniendo la integración secuencial de contratos. El siguiente hito demostrable es P4: single point SIESTA desde DFT Lab, terminal con confianza definida, paquete instalado/verificado, restore y resume probados.

No comenzar por Kubernetes, por un editor visual complejo de DAG o por HF-2: primero cerrar la ruta local/HPC y la integración encapsulada. Las funcionalidades científicas se incorporan como fragmentos/protocolos versionados con las mismas herramientas de authoring; después se amplían targets y concurrencia.

Un release intermedio puede incluir funciones de preparación completas y ejecución parcial, siempre que su catálogo sea preciso. La release del destino completo requiere toda la matriz y la definición de terminado del documento maestro. No prometer fechas ni presupuesto sin inspeccionar APIs faltantes, perfiles remotos y casos de calificación.

## 16. Prompt inicial para Claude Code

Copiar este texto junto con los dos documentos V2. Seleccionar la fase que se va a implementar; el prompt inicial se centra en P0/P1.

```text
Implementa la actualización DFT Lab V2.1 según PROPUESTA_MAESTRA_DFTLAB_V2.md
y PLAN_IMPLEMENTACION_CLAUDE_CODE.md. Tienes contexto previo del proyecto;
verifica las fuentes actuales antes de basarte en ese contexto.

Lee AUDITORIA_ADVERSARIAL_ARQUITECTURA_PRODUCCION.md y aplica los gates de
§25 del maestro/§18 del backlog. Instalación, CI seguro, finalización y
restore no esperan a P10. T-055…T-062 son parte de los primeros cimientos.

Empieza por P0 y P1: inventario/baseline, defectos reproducibles, ADR,
actualización de ARQUITECTURA.md y contratos públicos/fixtures. Mantén el
frontend y el build portátil; no hagas una reescritura total. Cada entrega
debe ser concreta y verificable y dejar indicado el siguiente ticket.

QRAFT @4d996ea7c580e5638e470bbf32624c88fd762f7d es autoridad del compositor,
compiler, locks y runtime. HubbardFlow @e508f47aff1c6243deabb12915063b6b9d899d65
es autoridad del protocolo LR-U, políticas, evidencia, gates y análisis.
Lee las instrucciones de ambos motores y respeta sus baselines congeladas.
Las firmas de adaptador propuestas deben validarse/implementarse como API
pública: no asumas que existen y no copies lógica ni dependas de privados.

La plataforma administra proyectos, operaciones durables, autenticación,
SSH, archivos y proyecciones. No crea un tercer DAG ni convierte exit 0 en
éxito científico. Conserva UNKNOWN/NOT_ESTABLISHED/REVIEW, digests, precisión,
inputs efectivos e intentos. Mantén separados aprender/draft/plan/run/result.

No cambies umbrales científicos, amplitudes o políticas para hacer pasar
tests. Los defaults y criterios nuevos pertenecen a protocolos versionados.
Prueba lo que cambies con casos significativos; conserva evidencia original.

Entrega: cambios implementados, contratos afectados, compatibilidad,
verificación ejecutada y límites. Actualiza requisitos R-01…R-50 y tickets.
Si falta una decisión científica o una API upstream, avanza en tareas
independientes y registra el bloqueo preciso; no inventes el resultado.
La ejecución de cálculos reales usa un sitio y presupuesto autorizados para
ese trabajo, no se deduce de la existencia de este plan.
```

## 17. Checklist final de cobertura

- Aprender: 15 capítulos y numerics, datasets reales, temas/navegación/lifecycle/offline.
- Herramientas: G-01…09, S-01…08, preflight guiado/experto, pseudos/bundles, calculadoras y diseñador.
- Campañas: EOS, electrónica, LR-U, superficies; convergencia/estados; fonones/óptica/magnetismo.
- Motores: QRAFT completo, HF-1/HF-2 y APIs públicas; evidencias/gates/locks/versiones nativas.
- Operación: terminal/SSH, staging/transfers, submit/reconcile/cancel/retry/resume, budgets y single owner.
- Post: todos los lectores/formatos actuales, multiarchivo/pack, comparación, previews y exports.
- Despliegue: portátil, local Windows/WSL/Linux, nube/HPC por SSH, SLURM, targets PBS/SGE declarados, web y Kubernetes calificado.
- Sostenibilidad: seguridad/permisos, contratos/SDK/CLI/notebook, pruebas científicas/operativas, observabilidad, backups, migraciones y releases.

Cada elemento debe resolverse con evidencia o figurar explícitamente como pendiente en la cobertura del release. Este criterio evita que la amplitud del proyecto esconda funcionalidades prometidas pero ausentes.

## 18. Tickets de endurecimiento adversarial V2.1

Estos ocho tickets cubren A-01…A-15 del informe y requisitos R-43…R-50. Sus dependencias son por mecanismo y release; no forman una fase tardía P11. Los tests ADV-01…ADV-18 son escenarios por implementar, no evidencia ya obtenida.

| Ticket | Primera fase / requisitos | Entregable y aceptación | Hallazgos / escenarios |
|---|---|---|---|
| T-055 | P0/P1; R-43 | Baseline Git con inventario/ignores específicos, links portátiles, CI sin secretos/HPC, ramas/checks y reglas comunes Claude/Codex; clon limpio compila/prueba sin archivos personales | A-08/12/13; ADV-01/14 |
| T-056 | P1/P2/P4; R-44 | Schemas ejecutables JS/Python, SDK, tablas de comandos/guardas/revisión y checks de imports; rechazar payload inválido/import prohibido y callbacks viejos | A-02/11/12; ADV-03/07/12/18 |
| T-057 | P1/P3/P4; R-45 | Manifest/SBOM/procedencia/notices por release, wheel/entrypoint/datos instalados, build sin fallback oculto; probar exactamente artefacto de CI en entorno limpio y actualización | A-01/07/08; ADV-01/02/14/17 |
| T-058 | P3/P4/P7; R-46 | ControllerAuthorityRecord, SubmissionReceipt y carreras de cancel/resume; comprobar enforcement remoto o bloquear takeover no seguro; conservar UNKNOWN ante evidencia insuficiente | A-02/04; ADV-03/05/06/07/17 |
| T-059 | P1/P3/P4; R-47/49 | AdmissionReceipt/RuntimeProbeReceipt, reservas atómicas, principal/recurso y trust mode de terminal; cambio de entorno/permisos/archivos invalida precondiciones y scope explícito de budgets | A-03/05; ADV-04/08/09/16 |
| T-060 | P3/P4; R-48 | FinalizationReceipt y RecoveryCheckpoint, commit condicionado, backup consistente y recovery mode; kill en cada publicación y restore previo a submit activo sin duplicarlo | A-01/06/10; ADV-05/10/11 |
| T-061 | P1/P4/P7/P8/P9; R-50 | CapabilityQualificationRecord y matriz ejecutable por versión/protocolo/modo/target, con referencias de evidencia; admisión por alcance/operación permitidos, exploración sin certificación heredada y campañas activas fijadas | A-09/15; ADV-02/08/12/13/17 |
| T-062 | P1/P3/P4/P9; R-50 | Escenarios de calidad con targets por perfil y runbooks de incidente/restore/reconcile; medir límites/RPO/RTO sin inventar SLAs; verificar API ante caída remota | A-01/10/14/15; ADV-05/10/11/15/16 |

Subtareas mínimas:

- T-055: identificar inputs de build, assets, datasets originales y fixtures; Git baseline y tag histórico; PR checks y permisos; instrucciones comunes; reglas de publicación de artefactos. Verificar protecciones disponibles según plan GitHub.
- T-056: contratos originales/ref mapping; schemas; generación/validación SDK; precondiciones e idempotencia; imports de capas; compatibilidad de enums y replay/snapshot.
- T-057: resolver entornos por target; construir distribuciones; instalar sin checkout/PYTHONPATH; registrar toolchain/vendor; notices; hashes y procedencia; actualización/rollback compatible del alcance inicial.
- T-058: mecanismo de authority por sitio; takeover conservador/fencing real; token de intento/submit evidence; cancel/resume races; retención de idempotencia; callbacks atrasados.
- T-059: autenticación/principal local; dos identidades sintéticas para ACL; reservas y lifecycle; profile/runtime probe; confianza terminal y límites de shell libre; invalidación de recibos.
- T-060: set esperado de artefactos; snapshots finales; native refs/cursor; manifest y commit condicionado; snapshot DB soportado; backup/restore anterior a submit; reconciliación remota antes de nueva admisión.
- T-061: dimensiones contrato/runtime/ciencia/recovery/target; fixtures por combinación; worker/version affinity; admisión desde matriz; sumar nuevas combinaciones sin calificación global implícita.
- T-062: objetivos medibles por escenario/perfil, inicialmente DRAFT; benchmarks/runbooks; targets aceptados antes del release; incidente y restore de ensayo; evitar dependencias artificiales entre módulos científicos.

La evidencia de A-01…A-15 es de diseño y fuentes; su cierre exige ejecutar las pruebas correspondientes. Ninguna marca documental puede promover una capability a producción sin ese cierre. Todos los requisitos funcionales anteriores y baselines científicas permanecen en el plan.

## 19. Auditoría P5–P10 y compuerta de diseño

Añadido el 2026-10-11 tras la [auditoría P5–P10](docs/reviews/2026-10-11-auditoria-p5-p10.md). No cambia IDs ni alcance de los tickets; añade una condición de entrada y dependencias que faltaban. Adoptado por Manuel el 2026-10-11, junto con ADR-018 opción A.

**Compuerta de diseño.** Un ticket que introduce un contrato, una decisión científica o un cambio en más de un repositorio no se asigna a Codex hasta tener:

1. Ficha aceptada (en `docs/scientific-protocols/` si es ciencia, ADR o adenda si es contrato) con decisiones, lo que declara la política y preguntas abiertas cerradas.
2. Vectores ejecutables en `contracts/fixtures/` o en el repositorio dueño, incluidos los casos que deben fallar.
3. Un caso real pequeño (corrida de SIESTA, paquete instalado o salida del motor) que confirme cada supuesto sobre el comportamiento de un programa externo.
4. Orden de repositorios: ficha y vectores, PR upstream que cita el SHA de los vectores, pin en `engine-versions.lock.json`, consumidor en la plataforma.

**Dependencias de entrada añadidas.**

| Ticket | Antes de construir |
|---|---|
| T-028 (G-05, G-06) | [Ficha de slabs](docs/scientific-protocols/SLABS.md) aceptada: celda con a3 ⟂ superficie, terminación, atom map, equivalencia de caras y restricciones ([WF-SURFACE](docs/scientific-protocols/WF-SURFACE.md) S-1) |
| T-029 | [Ficha de presets](docs/scientific-protocols/PRESETS.md) aceptada; S-01, S-03 y S-07 esperan U-Q14, U-Q15 y U-Q16 y se muestran `DESIGNED` hasta entonces |
| T-030 | El validador de QRAFT es el preflight autoritativo; el frontend lo replica con fixtures comunes. [Ficha de preflight](docs/scientific-protocols/PREFLIGHT.md) aceptada y U-Q17 en QRAFT |
| T-035 | [ADR-018](docs/adr/ADR-018-autoridad-protocolos-siesta-eos-electronica-superficie.md) (aceptado, QRAFT), [WF-EOS](docs/scientific-protocols/WF-EOS.md) aceptada, U-Q10 y U-Q11 |
| T-036 (gap, fat bands y masas) | [WF-ELECTRONIC](docs/scientific-protocols/WF-ELECTRONIC.md) aceptada, con su política v1, y U-Q13 en QRAFT |
| T-040 | WF-SURFACE aceptada, U-Q12 y DL-02 con el caso de corrección dipolar |
| T-041 | Criterio de equivalencia HF-1/HF-2 fijado en un ADR antes de U-H5 |
| T-042 | Utilidades (`vibra`, `fcbuild`, `denchar`) en el lock del worker y en el probe de runtime; para moléculas, las frecuencias salen del `.FC` con proyección de Eckart, no de `vibra` (presets F-3) |
| T-047 | U-Q7 (fencing) en QRAFT |
| T-049, T-050 | HF-1 no se anuncia en PBS ni Kubernetes hasta calificar la prueba de muerte del dueño de ADR-017 §7 en ese target |
