# Prompt único para Codex, v5: C0-r3 con la campaña inicializada en su raíz final

Pega esto tal cual. Sustituye a los prompts 1 a 5. Todo está resuelto en [ADR-017 Adenda 11](../adr/ADR-017-tarea-controladora-qraft-hf1.md#adenda-11-2026-10-13-issue-70-j2-corregida-para-local_wsl-en-hubbardflow-013), [Adenda 10](../adr/ADR-017-tarea-controladora-qraft-hf1.md#adenda-10-2026-10-12-issue-70-c0-r2-dio-no_numerical_u-la-campaña-se-inicializa-en-su-raíz-final), la [Adenda 9](../adr/ADR-017-tarea-controladora-qraft-hf1.md#adenda-9-2026-10-12-issue-70-c0-falló-por-state-without-an-owner-la-plataforma-prepara-el-estado-después-de-que-qraft-lo-reclama) y la [Adenda 8](../adr/ADR-017-tarea-controladora-qraft-hf1.md#adenda-8-2026-10-12-issue-70-receta-hf-1-registrada-recorrido-completo-de-c0-a-q6-y-arnés-especificado). No preguntes diseño.

## Antes de hacer nada: lee las reglas del proyecto

Lee `AGENTS.md` y `docs/development/WORKING_RULES.md` completos, y cita en tu **primer comentario de #70** que los leíste. Ya se rompió la regla de pocos PR varias veces; si no abres los archivos, esta es la regla completa:

> **Pocos PR (regla fija de todo el proyecto).** El avance diario va en comentarios del issue de seguimiento (#70) o en notas no versionadas, no en un PR por paso. `docs/reviews/TRASPASO.md` se actualiza una vez por etapa cerrada, dentro del PR de código de esa etapa, o en un único PR al cerrar un bloque. Nunca se abre un PR documental solo para anotar que otro PR se fusionó. Los arreglos de código relacionados van en un solo PR.

En esta tarea eso significa: cero PR documentales, y como máximo un PR de código si G.4 te obliga.

## Qué cambió

v5 se detuvo con razón: con `local_wsl`, HubbardFlow 0.1.3 ignora `campaign_root` y crea la campaña en `wsl.workspace_root/<nombre>`. **Manuel aprobó** (2026-10-13) la solución: una copia del perfil por corrida que solo difiere en `wsl.workspace_root` (Adenda 11 K.2). No es una edición del perfil privado ni un cambio de pin o contrato; no vuelvas a parar por esto.

El `NO_NUMERICAL_U` de C0-r2 no era un dato faltante ni ciencia: el PSML de NiLR0 sí estaba en el inventario. HubbardFlow escribe en `lr_config.json` rutas absolutas de la raíz donde inicializa la campaña, y al observar las convierte en relativas a la raíz donde corre. La campaña de C0-r2 se inicializó en una raíz y se ejecutó en otra, así que la ruta quedó absoluta y fuera del inventario. Ahora **el arnés inicializa la campaña en la raíz final** (Adenda 10 J.2), y la plataforma lo comprueba antes de lanzar (`final_root_findings`). QRAFT y HubbardFlow no cambian. El wheel debe reconstruirse.

## Recorrido por etapas (todas cerradas)

| Etapa | Estado |
|---|---|
| Preflight y wheel | ok (Adenda 9 I.5) |
| Inicializar campaña | cerrado: en su raíz final con perfil derivado (J.2, K.2) |
| Admisión y estado vacío | cerrado (Adenda 9) |
| Entrada tras el reclamo | cerrado (comprueba J.3) |
| C0-r3, observación | cerrado: ruta relativa en el inventario |
| Salida del job exterior | cerrado: J.4 |
| Q1 a Q6 | cerrado: campaña nueva, reanudación en sitio |
| Veredicto | ok (D.3, D.6) |

## Pasos

1. **Actualizar.** `git pull --ff-only origin main`, reconstruir el wheel desde la copia limpia, instalarlo en el venv aislado y pasar `test_hf1*.py` y `test_authoring.py` instalados. Confirma `dftlab-hf1-controller` en el `bin` del venv y que `from dftlab_platform.hf1_bundle import final_root_findings` importa.
2. **Preflight**, una ejecución por versión corregida del código (Adenda 7 G.4), más `controller_profile_findings` con el perfil exterior (tarea de **1800 s**).
3. **Arnés.** Corrige el de C0-r2 con J.2 y J.4:
   - Por cada corrida (C0-r3 y Q): elige `R` nueva y ya resuelta con `realpath`; `S = R/controller-state/<task_id>`; crea `R/controller-state`; **deriva una copia del perfil privado cambiando solo `wsl.workspace_root = str(R/controller-state)`** (el archivo privado no se edita); `initialize_campaign(fdf_path=…, lr_config_path=…, profile_path=<copia>, name=<task_id>, pointer_path=<fuera de S>)` **sin `campaign_root`** (HubbardFlow lo ignora con `local_wsl`); comprueba que la raíz devuelta es `S` y los siete hashes de D.2; comprime el contenido de `S` en el ZIP (solo los archivos declarados y `campaign.v2.json`; `profile_sha256` es el de la copia); `final_root_findings(bundle, S)` debe ser `[]`; **borra `S` y `R/controller-state/.siestaflow`**; autoría y empaquetado; **extrae el paquete en `R`** (no en `extracted/<run_id>`) y no muevas ni copies `R` después.
   - El guion `sbatch` guarda la evidencia en un `trap EXIT`, escribe el artefacto del observador de forma incremental y sale con el código del runtime de QRAFT; un fallo del observador se anota como evidencia.
   - `--dry-run`: ejecuta `initialize_campaign` de verdad con el wheel instalado en una `R` de ensayo y la borra entera; debe devolver `S` y `final_root_findings == []`, sin `sbatch`. Los fallos son defectos de arnés (G.4).
4. **Antes de relanzar**, lee `slurm-<job>.out/.err` y el stderr del observador de C0-r2 y clasifica la salida `1:0` en el informe. No borres, muevas ni edites nada de C0-r1 ni de C0-r2.
5. **C0-r3, corrida nueva**: `run_id`, claves, raíz, estado, campaña y job nuevos. Factory con `max_seconds = 1800`, `grace_seconds = 10`; nodo `IDLE` primero, sonda nueva y `sbatch` seguidos; si tu job queda `PENDING` 120 s, cancela solo ese job y repite (máximo 2). Antes de SIESTA guarda como evidencia que `owner.json` existe y que los archivos del paquete tienen `mtime` posterior. Compara `U_scalar_charge` por sitio con D.3 (NiLR0 6.864267700049239, NiLR1 6.864387475210124, tolerancia 0.020 eV).
6. **Q (opción A de F.4)** con H.4 y H.5: `runtime.pid` antes de `exec`, vigilante por `key.node_id`, `SIGTERM` y `SIGKILL` solo al PID del runtime, copia fresca de `state.sqlite` por intento, `RunInspector().resume(...)` como plan de solo lectura, `sbatch --no-requeue` nuevo con sonda nueva, `wsl --shutdown` y munge/SLURM según F.5. Q parte de otra corrida nueva, con su propia `R` y campaña; los intentos 2 y 3 reutilizan `R` y `S` en sitio.
7. **Veredicto** de D.6 con la evidencia de H.5.6. **Ningún PR documental**: el informe de C0-r3 y de Q va en comentarios de #70 y #10. `TRASPASO.md` se actualiza **una sola vez**, al cerrar HF-1, y solo dentro de un PR de código si G.4 te obliga a abrir uno; si no hay PR de código, deja la nota en #70 y yo la paso. Si el navegador no deja adjuntar archivos locales, anota la ruta y el SHA-256 del ZIP de evidencia en #70 y #10. Cierra el seguimiento en siestaflow #10 y dftlab-suite #70.

## Regla de PR (de Manuel)

Pocos PR, y Manuel ya se quejó de que son demasiados. **No abras ningún PR documental.** El avance vivo va en comentarios de #70. Los arreglos de código relacionados (G.4) van en un solo PR. `TRASPASO.md` solo se toca una vez, en ese PR de código o al cerrar HF-1.

## Nunca

Tocar un job que no creaste. Editar entradas, el archivo del perfil privado (la copia derivada de la Adenda 11 sí), fórmulas, gates, tolerancias, contratos o pins. Reescribir `lr_config.json` o cualquier archivo de la campaña a mano. Cambiar la semántica de autoridad, cancelación o propiedad de procesos. Modificar QRAFT o HubbardFlow. Escribir un `owner.json` o cualquier archivo en el estado antes del reclamo de QRAFT. Mover o copiar `R` tras inicializar. Declarar `PASS` sin D.6. Relanzar un nodo asentado.

## Paradas permitidas (y solo estas)

- Un fallo fuera de las clases de G.4, o un error al que ya aplicaste 2 arreglos.
- Una causa en QRAFT o HubbardFlow que no se pueda resolver desde la plataforma (Adenda 9 I.7): un solo comentario en #70 con la causa y la línea del código.
- E.3.2 por debajo de 1800 s después de subir la allocation a 7200 s.
- `FAIL` o `INCONCLUSIVE` de D.6, o que Q4 consuma un intento.
- Contraseña de `sudo` no disponible al reiniciar SLURM tras `wsl --shutdown`.
- Lo que Manuel decida en #70 (opción B de F.4).
