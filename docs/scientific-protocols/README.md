# Fichas de entrada de protocolos científicos

Una ficha fija las decisiones de un workflow científico **antes** de escribir código: geometría, opciones de SIESTA, cantidad que se mide, gates y vectores de prueba. No fija tolerancias, que van en la política versionada del protocolo ([ADR-009](../adr/ADR-009-politicas-gates-cientificos.md)). Una ficha aceptada es la entrada de Codex y del revisor ([plan §19](../../PLAN_IMPLEMENTACION_CLAUDE_CODE.md#19-auditoría-p5p10-y-compuerta-de-diseño)).

| Ficha | Ticket | Estado |
|---|---|---|
| [WF-EOS](WF-EOS.md) | T-035 | Aceptada; 20 vectores en `vectors/`; política v1 aprobada |
| [Slabs y restricciones](SLABS.md) | T-028 (G-05, G-06) | Aceptada (2026-10-13); 19 vectores en `vectors/` |
| [Presets S-01…S-08](PRESETS.md) | T-029 | Aceptada; 26 vectores en `vectors/`; política v1 y U-Q14…U-Q16 aprobados |
| [Preflight del FDF](PREFLIGHT.md) | T-030 | Aceptada; 22 vectores en `vectors/`; U-Q17 aprobado |
| [Pseudopotenciales y especies](PSEUDOS.md) | T-031 | Aceptada; 20 vectores en `vectors/`; U-Q18 aprobado; biblioteca propietaria (D-7) |
| [WF-ELECTRONIC fino](WF-ELECTRONIC.md) | T-036 | Aceptada; 23 vectores en `vectors/`; política v1 aprobada; dueño QRAFT (ADR-018, U-Q13) |
| [WF-SURFACE](WF-SURFACE.md) | T-040 | Lista para aceptar (2026-10-13); 33 vectores y corridas reales de SIESTA 5.4.2; dueño QRAFT (ADR-018, U-Q12) |
| [Modelo de vista LR-U](LR-U-VISTA.md) | T-039 | Lista para aceptar (2026-10-13); 22 vectores; dueño la plataforma |

T-032 (registro de campañas y calculadoras), T-033 (postprocesador y lectores) y T-034 (comparación y exportación) no introducen física nueva: consumen estas fichas y el inventario T-001, cuyos lectores ya tienen pruebas en `app/tests/`. Sus contratos van por C3, no por una ficha de protocolo.

T-037 (convergencia) tampoco necesita ficha: QRAFT `41043ed` ya decide la convergencia de malla (`scientific_convergence.py`) y de malla k (`scientific_kgrid.py`) con referencia en el nivel más alto, niveles consecutivos con mallas distintas, confirmación de egg-box para la malla y `READY_FOR_HUMAN_REVIEW` como mejor resultado. La plataforma no lo reimplementa: guarda la regla y el informe, y la aceptación humana convierte un perfil provisional en aceptado. La fuerza neta de H2O frente al corte (0.0008 eV/Å a 200 Ry, 0.307 a 500 Ry; [evidencia](../reviews/evidencia-p5-p10/README.md#presets-s-01s-08)) muestra por qué la confirmación de egg-box no se puede omitir. Una molécula no converge malla k: va en Gamma ([PRESETS](PRESETS.md) M-1).

WF-HUBBARD no tiene ficha aquí: su protocolo es de HubbardFlow y su ejecución está en [ADR-017](../adr/ADR-017-tarea-controladora-qraft-hf1.md).

## Vectores y oráculos

`vectors/<protocolo>.cases.json` contiene los casos de cada ficha, con valores esperados calculados de forma independiente (`vectors/build/`). `vectors/<protocolo>-oracle.mjs` es la implementación de referencia de la ficha, no código de producción. `node scripts/check-protocol-vectors.mjs` comprueba que oráculo y vectores concuerdan y corre dentro de `scripts/verify.mjs`. El motor dueño porta los vectores como fixture y su implementación debe pasarlos sin cambiar valores ni tolerancias.
