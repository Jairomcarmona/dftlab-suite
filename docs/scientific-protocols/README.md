# Fichas de entrada de protocolos científicos

Una ficha fija las decisiones de un workflow científico **antes** de escribir código: geometría, opciones de SIESTA, cantidad que se mide, gates y vectores de prueba. No fija tolerancias, que van en la política versionada del protocolo ([ADR-009](../adr/ADR-009-politicas-gates-cientificos.md)). Una ficha aceptada es la entrada de Codex y del revisor ([plan §19](../../PLAN_IMPLEMENTACION_CLAUDE_CODE.md#19-auditoría-p5p10-y-compuerta-de-diseño)).

| Ficha | Ticket | Estado |
|---|---|---|
| [WF-EOS](WF-EOS.md) | T-035 | Lista para aceptar; 20 vectores en `vectors/`; política v1 pendiente de Manuel |
| [Presets S-01…S-08](PRESETS.md) | T-029 | Lista para aceptar; 26 vectores en `vectors/`; política v1 y U-Q14…U-Q16 pendientes de Manuel |
| [WF-ELECTRONIC fino](WF-ELECTRONIC.md) | T-036 | Borrador; dueño QRAFT (ADR-018) |
| [WF-SURFACE](WF-SURFACE.md) | T-040 | Borrador; dueño QRAFT (ADR-018); depende de DL-02 |

WF-HUBBARD no tiene ficha aquí: su protocolo es de HubbardFlow y su ejecución está en [ADR-017](../adr/ADR-017-tarea-controladora-qraft-hf1.md).

## Vectores y oráculos

`vectors/<protocolo>.cases.json` contiene los casos de cada ficha, con valores esperados calculados de forma independiente (`vectors/build/`). `vectors/<protocolo>-oracle.mjs` es la implementación de referencia de la ficha, no código de producción. `node scripts/check-protocol-vectors.mjs` comprueba que oráculo y vectores concuerdan y corre dentro de `scripts/verify.mjs`. El motor dueño porta los vectores como fixture y su implementación debe pasarlos sin cambiar valores ni tolerancias.
