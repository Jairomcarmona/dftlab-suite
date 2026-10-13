# Prompt único para Codex: bloque 2 (P5 y P6)

Pega esto tal cual. Seguimiento en [issue #99](https://github.com/Jairomcarmona/dftlab-suite/issues/99). Todo lo científico está decidido en las fichas de `docs/scientific-protocols/`; no preguntes diseño. Modelo previsto: Sol 6.1 con razonamiento medio.

## 0. Antes de hacer nada: reglas del proyecto

Lee `AGENTS.md` y `docs/development/WORKING_RULES.md` completos, y di en tu **primer comentario de #99** que los leíste. Ya se rompió varias veces la regla de pocos PR; si no abres los archivos, esta es la regla completa:

> **Pocos PR (regla fija de todo el proyecto).** El avance diario va en comentarios del issue de seguimiento o en notas no versionadas, no en un PR por paso. `docs/reviews/TRASPASO.md` se actualiza una vez por etapa cerrada, dentro del PR de código de esa etapa, o en un único PR al cerrar un bloque. Nunca se abre un PR documental solo para anotar que otro PR se fusionó. Los arreglos de código relacionados van en un solo PR.

En esta tarea eso significa: **cero PR documentales** y **siete PR de código en total** (cuatro en QRAFT, tres en la plataforma). Un PR por bloque de código relacionado. Si un arreglo pertenece a un PR abierto, va en ese PR.

## 1. Alcance

| Ticket | Ficha (ya aceptada) | Vectores (en `docs/scientific-protocols/vectors/`) | Dueño del código |
|---|---|---|---|
| T-028 solo G-05 y G-06 | `SLABS.md` | `slabs.cases.json`, `slab-oracle.mjs` | plataforma |
| T-029 | `PRESETS.md` | `presets.cases.json`, `presets-oracle.mjs` | plataforma y QRAFT (U-Q14, U-Q15, U-Q16) |
| T-030 | `PREFLIGHT.md` | `preflight.cases.json`, `fdf-oracle.mjs` | QRAFT (U-Q17) y plataforma |
| T-031 | `PSEUDOS.md` | `pseudos.cases.json`, `pseudo-oracle.mjs` | QRAFT (U-Q18) y plataforma |
| T-035 | `WF-EOS.md` | `wf-eos.cases.json`, `eos-oracle.mjs` | QRAFT (U-Q10, U-Q11) y plataforma |
| T-036 gap, fat bands, masas | `WF-ELECTRONIC.md` | `electronic.cases.json`, `electronic-oracle.mjs` | QRAFT (U-Q13) y plataforma |
| T-037 | `README.md` de fichas, último párrafo de T-037 | ninguno | plataforma, solo consumidor (ver 3.3) |

**Fuera de este bloque, no lo toques:** U-Q12 y T-040 (superficies, P7), T-032, T-033 y T-034 (sin ficha; saldrán en otro prompt), el resto de G-01…G-09 de T-028, HubbardFlow (no se toca el repositorio), `baseline-v1`, tolerancias, goldens, ADR aceptados y las ramas de otros agentes. Los casos de `presets.cases.json` que dependen de U-Q14…U-Q16 se muestran `DESIGNED` hasta que ese cambio entre.

Los valores esperados de los vectores salieron de corridas reales de SIESTA 5.4.2 y de cálculos independientes (`vectors/build/`). **Nunca cambies un vector, una tolerancia ni un oráculo para que pase una prueba.**

## 2. Orden de trabajo y PR

QRAFT es el repositorio `Jairomcarmona/siestaflow`; sus ramas parten de su `main` actual, que ya contiene U-Q9 (`c3ecdea`) y la corrección de PR #12. Confírmalo con `git merge-base --is-ancestor c3ecdead645cab840bcd096aba166bfd0c3f173e origin/main` antes de empezar. Rama corta por PR, desde `origin/main` del repositorio correspondiente, nunca reutilizando ramas fusionadas.

| Etapa | PR | Contenido | Termina cuando |
|---|---|---|---|
| 1 | P-1 plataforma | T-028 G-05 y G-06 (slabs y restricciones) y registro de presets T-029 con `protocol_id`, defaults P-6, `RunIntent` y FDF por preset | pasan `slabs.cases.json` y `presets.cases.json` en Python y en el JS de vista previa, y `verify.mjs` en verde |
| 2 | Q-1 QRAFT | U-Q17 y U-Q18 | los fixtures `preflight.cases.json` y `pseudos.cases.json` pasan en QRAFT |
| 3 | Q-2 QRAFT | U-Q14, U-Q15 y U-Q16 | `presets.cases.json` (partes M, P-4/V, F) pasa en QRAFT |
| 4 | Q-3 QRAFT | U-Q10 y U-Q11 | `wf-eos.cases.json` pasa en QRAFT más la corrida real de 3.1 |
| 5 | Q-4 QRAFT | U-Q13 | `electronic.cases.json` pasa en QRAFT más la corrida real de 3.1 |
| 6 | P-2 plataforma | un solo pin de QRAFT al commit fusionado de Q-4; consumidor de T-030, T-031 y quitar `DESIGNED` de S-01, S-03 y S-07 | CI verde y evidencia instalada de 3.2 |
| 7 | P-3 plataforma | consumidor de T-035, T-036 y T-037 | CI verde |

`TRASPASO.md` se actualiza **solo** dentro de P-1, P-2 y P-3, una vez por PR, con la sección «Bloque 2 (Codex)»: rama, SHA, PR, CI, pendientes y siguiente paso. Los PR de QRAFT no tocan `TRASPASO.md`; sus resultados se anotan en #99.

Cada PR de QRAFT sigue la compuerta del plan §19: **copia los JSON de vectores byte a byte** a los fixtures de QRAFT, deja en el README de esa carpeta el SHA de `dftlab-suite` desde el que los copiaste y el SHA-256 de cada archivo, y añade una prueba que falle si el fixture difiere del hash anotado. Las implementaciones se escriben en Python como lo hace QRAFT; los oráculos `.mjs` son la referencia de lectura, no código a copiar.

## 3. Qué hacer en cada etapa

### 3.1 Corridas reales (solo Q-3 y Q-4)

Las pruebas de PR no ejecutan SIESTA. Además, en WSL y con el SIESTA fijado (`/home/jmc/.local/siesta-5.4.2-openmpi/bin/siesta`, SHA-256 `aaa9a2e45a41b12f3aad52ca4fca7c25b1cc6afd3aff2a0c7fe145b1bd9f18ce`, ver `TRASPASO.md`, «Cierre U-Q9»), ejecuta una vez cada caso y comenta en #99 el comando, la salida resumida y los SHA-256 de los resultados:

- **EOS:** Si diamante, PBE, SZP, 6×6×6 desplazada, `MeshCutoff 154 Ry`, factores de volumen 0.94…1.06 de `WF-EOS.md` (generador `si_eos_fdf.py` y sección «Malla y EOS» de [`evidencia-p5-p10/README.md`](evidencia-p5-p10/README.md)), con el protocolo nuevo de QRAFT. El veredicto debe coincidir con el de `wf-eos.cases.json` para la misma tabla.
- **Electrónica:** Si primitivo con `si_bands_fdf.py` (modos `path`, `fat`, `mass`) y el protocolo nuevo. Debe dar el gap indirecto de 0.5562 eV con CBM a 0.847 de Γ-X y las masas m_l = 0.925 y m_t = 0.194 (tolerancias de `electronic.cases.json`). La banda de valencia en Γ es triplemente degenerada: el resultado correcto es `NOT_ESTABLISHED` con `DEGENERATE_EXTREMUM`, no una masa.

### 3.2 Comprobaciones que dependen del entorno real

No basta con leer el código. Para cada una, ejecútala y pega la salida en #99:

1. **Wheel instalado.** Antes de P-2 y de P-3: `git archive` limpio, construir el wheel de la plataforma como en `deployment/local/README.md`, instalarlo en un venv aislado con `python -I` y pasar ahí las pruebas instaladas (`test_hf1*.py` y `test_authoring.py` siguen en verde, más las nuevas del PR).
2. **Pin.** Antes de subir el pin: reconstruir el wheel de QRAFT desde el commit fusionado de Q-4, instalarlo aislado y correr ahí los cuatro fixtures de vectores sobre el paquete instalado. Genera la evidencia de `deployment/local/evidence/` con `deployment/local/qualify_engines.py` en Windows y en WSL, como en el commit `72e584c`.
3. **Windows y Linux.** Las dos CI deben pasar; si algo difiere por sistema (rutas, finales de línea, symlinks), arréglalo en el código, no con `skip`.

### 3.3 Detalles por ticket

- **T-028 (slabs).** Python puro en el servicio (numpy solo opcional), sin pymatgen ni ASE; el JS es solo vista previa y no crea revisiones. Salida: `StructureRevision` con `physical_intent: SLAB` y transformación `SLAB` con atom map, como dice `SLABS.md`, «Implementación».
- **T-029.** El registro de presets decide FDF efectivo, archivos requeridos y capability. Todo FDF que genere debe pasar el validador de QRAFT. Para molécula no puede contener un bloque k distinto de Gamma.
- **T-030.** La plataforma no implementa su propio preflight: llama al validador de QRAFT y guarda sus hallazgos (PREFLIGHT D-6). El único código propio es el frontend: `parseFDF` en `app/dftlab/static/js/crystal/formats.js` pasa a «gana la primera aparición» y debe pasar los vectores de resolución.
- **T-031.** Catálogo con los campos de D-5, alias de D-4 y el texto «30 elementos en LDA (CA-PZ) y PBE» de D-6. La biblioteca propia es propietaria y de uso comercial privado (D-7): ningún bundle que la incluya se marca redistribuible.
- **T-035 y T-036.** La plataforma guarda los resultados de QRAFT con su alcance y su política; no recalcula física. En el frontend, la calculadora (`views/calc.js`) deja de ajustar una masa efectiva a la banda triple de Γ y muestra el motivo de `NOT_ESTABLISHED`.
- **T-037.** Solo consumidor. La plataforma guarda la regla y el informe de convergencia de QRAFT y registra la aceptación humana que convierte un perfil provisional en aceptado. Si lo que QRAFT entrega no cabe en los contratos existentes de `contracts/` (`analysis-result`, `assessment-record`), **no inventes un schema**: aplica la regla de detención de la sección 4 solo a T-037 y sigue con el resto.

## 4. Cuándo parar y cuándo seguir

Paras solo por física, contrato o una decisión de Manuel. Todo lo demás tiene regla escrita:

| Situación | Qué haces |
|---|---|
| Un vector no pasa y la ficha, el oráculo y el vector concuerdan entre sí | Es un error de tu implementación. Corrígela. No toques el vector. |
| Un vector no pasa y el oráculo `.mjs` (`node scripts/check-protocol-vectors.mjs`) también falla contra el mismo vector | Para esa etapa. Abre un issue citando ficha, oráculo y vector con `archivo:línea`, y sigue con la siguiente etapa que no dependa. |
| La ficha no dice cómo nombrar un campo interno, una función o un módulo | Elige el nombre que use el código vecino y anótalo en el PR. No es contrato. |
| Necesitas un campo, `reason`, enum o versión **públicos** que la ficha no nombra, o un schema nuevo | Para esa etapa y pregunta en #99. Los nombres que la ficha sí fija (`PSEUDO_XC_MISMATCH`, `NOT_ESTABLISHED`, `qraft.electronic.policy@1`, etc.) se usan tal cual. |
| Una pregunta concreta de física o de convención | Pide revisión a `validador_cientifico` (`.codex/agents/validador-cientifico.toml`). **APROBADO** y dentro de la ficha: sigue. **RECHAZADO:** corrige. **REQUIERE_DECISIÓN_DE_MANUEL**, o sale de la ficha: para y pregunta. |
| Una prueba existente falla por tu cambio | Arregla el código. No la saltes, no la marques `xfail`, no cambies su tolerancia. |
| CI falla en algo que no toca tu diff | Reproduce en `main`. Si es igual en `main`, un solo re-run; si persiste, comenta el nombre del check y la causa en #99 y sigue con lo que no dependa. |
| CI falla y no sabes por qué | Lee el log completo del job antes de tocar nada; arregla la causa raíz. Nunca un commit vacío ni cerrar y reabrir el PR. |
| El hash de un pseudo, de un wheel o de un fixture no coincide con lo anotado | Para: puede ser un archivo alterado. Pregunta en #99. |

**Fusión y pins.** Manuel autorizó, de forma acotada, que fusiones cada PR de este bloque y subas el pin de QRAFT, **solo si** se cumplen las tres a la vez: los cinco checks requeridos en verde sobre la punta exacta (`Verify (ubuntu-24.04)`, `Verify (windows-2022)`, `Platform installed wheel` en ambos sistemas y `Regenerate references (ubuntu-24.04)`; en QRAFT, todos los checks que su CI marque como requeridos), el validador científico con **APROBADO** para el diff de esa etapa y el pin apuntando a un commit **ya fusionado** del bloque. Anota en #99 el SHA fusionado. Esta autorización no cubre nada fuera de este bloque, ni subir otros pins (HubbardFlow, SIESTA), ni cambiar protección de ramas.

## 5. Cierre

Al terminar P-3, un último comentario en #99 con la tabla de siete PR (enlace, SHA fusionado, CI), las corridas reales de 3.1 con sus hashes, lo que quedó parado y por qué, y **lo que este bloque no acredita**: la ciencia de EOS y bandas solo está calificada para Si con SZP; `capability` de EOS y bandas no pasa de `CONTRACT_TESTED` hasta la calificación de P6, y no se anuncia ningún workflow como verificado en tiempo de ejecución.

No cierres #99: lo cierra Manuel.
