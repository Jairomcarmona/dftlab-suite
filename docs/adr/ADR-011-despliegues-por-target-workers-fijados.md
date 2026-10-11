# ADR-011: despliegues y empaquetado por target; workers fijados durante cada campaña

Estado: **aceptado** el 2026-10-11 (T-007). Implementación pendiente: X2 (esqueleto `platform/`, launcher, T-057), P3/P4, P9, P10.
Enmendado por [ADR-015](ADR-015-hubbardflow-capa-privada-bajo-qraft.md): HubbardFlow es capa obligatoria bajo QRAFT, en repositorio privado y sin redistribución pública.
Fecha: 2026-10-11. Fuente: [propuesta maestra](../../PROPUESTA_MAESTRA_DFTLAB_V2.md) §15.5, §16, §25.6.

## Contexto

El destino incluye laptop Windows/Linux, nube por SSH, HPC (SLURM primero), web multiusuario y, más tarde, Kubernetes. Una sola receta de instalación no sirve para todos, y actualizar el motor durante una campaña cambiaría su ciencia a mitad de camino. [ADR-014](ADR-014-python-reference-environment.md) ya fijó un entorno uv para regenerar referencias, distinto del de la plataforma.

## Decisión

1. **Backend:** Python 3.12, FastAPI/Pydantic en un único servicio ASGI inicial; API y procesador durable de operaciones en entrypoints separados del mismo paquete. Más servicios solo con necesidad medida.
2. **Locks por target:** dependencias exactas resueltas y bloqueadas por plataforma (una lock universal no garantiza Windows+Linux). uv permitido si queda probado; el HPC no depende de que uv exista allí. Wheelhouse offline por plataforma con checksums. Distribución `qraft-hpc` fijada por origen y hash (nunca el paquete ajeno `qraft` de PyPI). NumPy <2 mientras HubbardFlow lo exija.
3. **Targets:**
   - **Local Windows:** servicio nativo + worker en WSL2 o remoto; WSL solo es requisito para cálculo local, no para enseñar.
   - **Local Linux / nube por SSH:** worker en entorno explícito; procesos remotos sin scheduler necesitan supervisor durable, no una PTY.
   - **HPC:** módulos nativos o Apptainer según sitio; MPI/PMI/ABI y ranks/threads probados por perfil. Un binario nompi rechaza un plan MPI distribuido. `OMP_NUM_THREADS` no es un valor fijo.
   - **Web (P9):** API sin estado de cálculo, OIDC, PostgreSQL, ArtifactStore compartido, workers con ownership, cola durable solo con varios workers.
   - **Kubernetes (P10):** control y Jobs separados, RBAC mínimo, cuotas, política de red; MPI solo con launcher calificado.
4. **Launcher local:** start/status/stop, health, logs, actualización y cierre limpio; apagar el servicio no borra campañas.
5. **Workers fijados:** cada campaña usa una versión/imagen de worker y motor fijada hasta terminar. Un rolling update de la API no cambia el motor de un run activo.
6. **CI y release separados:** CI de PR sin secretos, sin acceso HPC ni permisos de publicación; acciones fijadas por SHA. Integración HPC/release en workflow aparte con credenciales acotadas. El artefacto probado es el que se distribuye (instalación limpia sin `PYTHONPATH=src`). El build de release rechaza toolchains no declarados.

## Alternativas

| Opción | Motivo para no adoptarla |
|---|---|
| Kubernetes desde el inicio | Coste operativo alto antes de tener una ruta local/HPC fiable. |
| Una lock universal multiplataforma | No garantiza binarios compatibles (ver ADR-014: sisl sin wheel Windows). |
| Actualizar motores en caliente | Cambia la ciencia de un run activo. |

## Consecuencias

- Hay un manifiesto de versiones (`engine-versions.lock.json`, dueño Codex, T-010) y una matriz de targets probados.
- Windows depende de WSL2 para cálculo local.

## Contratos afectados

`engine-versions.lock.json`, `RuntimeProbeReceipt`, perfiles de sitio, `CapabilityQualificationRecord` (target).

## Pruebas exigidas

- Instalación limpia por target soportado y prueba del artefacto distribuido.
- Actualización de la API con un run activo: el run sigue con su worker fijado.
- Plan MPI contra binario nompi: rechazado.

## Migración

El frontend sigue con su build y CI actuales (Windows + Linux). `platform/` nace con su propio workflow (X2) sin tocar el CI del frontend.
