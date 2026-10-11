# ADR-009: políticas y gates científicos versionados; evidencia antes de calificación

Estado: **aceptado** el 2026-10-11 (T-007). Implementación pendiente: protocolos de P5–P8.
Fecha: 2026-10-11. Fuente: [propuesta maestra](../../PROPUESTA_MAESTRA_DFTLAB_V2.md) §2 (reglas 4, 5, 9), §10, §17, §25.7.

## Contexto

La regla vigente de rigor ([ARQUITECTURA.md](../../ARQUITECTURA.md) §1) dice que todo número mostrado está medido o citado. Al añadir preflight, campañas y pasaporte de calidad aparecen umbrales (tolerancias, mallas, convergencia). Si se escriben como constantes universales en la UI, se convierten en criterios científicos falsos.

## Decisión

1. **Ningún umbral nuevo es universal:** pertenece a una política o protocolo versionado, con justificación y digest. Cambiar una política crea una versión nueva; la evaluación anterior se conserva enlazada.
2. **Terminado ≠ convergido ≠ certificado.** Terminación técnica, integridad y evaluación científica son dimensiones distintas (ADR-005).
3. **Estados del pasaporte:** cada comprobación es `PASS`, `FAIL`, `NOT_APPLICABLE` o `NOT_ESTABLISHED`, con evidencia y política. El resumen conserva el peor bloqueo y los desconocidos; no promedia señales en una puntuación verde. Es una proyección: no reemplaza los enums nativos.
4. **Autoridad del gate:** la decisión la toma el motor o protocolo propietario (ADR-003). La UI y el asistente pueden sugerir, nunca certificar ni cambiar parámetros de un run. Una propuesta de IA es un borrador auditable con modelo/versión.
5. **Preflight con dos autoridades:** el preflight del frontend es orientativo; el preflight autoritativo corre en el servicio/motor. Reglas duras demostradas bloquean; heurísticas versionadas advierten. En modo experto se puede anular una heurística con registro; nunca una regla de integridad.
6. **Calificación por tupla:** una capability se califica por capability/adaptador, motores/hashes, protocolo/política, modo HF, ejecutable/perfil/launcher y alcance ensayado (`CapabilityQualificationRecord`). La admisión distingue investigación exploratoria (permitida con `NOT_ESTABLISHED` visible) de una afirmación de resultado calificado.
7. Incertidumbre estadística, sensibilidad a discretización y bounds numéricos son cantidades distintas; si no se estimó, se dice.

## Alternativas

| Opción | Motivo para no adoptarla |
|---|---|
| Umbrales fijos en la UI | Bloqueos o advertencias científicamente falsos (§22). |
| Booleano `valid` por resultado | Pierde regla, evidencia y alcance. |
| Puntuación global de calidad | Oculta bloqueos y desconocidos. |

## Consecuencias

- Las políticas viven en `docs/scientific-protocols/` y en los motores, no en el código de vistas.
- Los resultados ya mostrados en Aprender siguen con su procedencia; no ganan calificación operativa.

## Contratos afectados

`AssessmentRecord`, `ValidationReceipt`, `CapabilityQualificationRecord`, `AdmissionReceipt`, pasaporte de calidad (T-008/T-056/T-061).

## Pruebas exigidas

- Fixture `NOT_ESTABLISHED` que nunca se muestra como PASS ni certificado.
- Cambio de política: nueva evaluación enlazada, la anterior intacta.
- Override experto de heurística registrado; intento de anular una regla de integridad, rechazado.
- No se cambian tolerancias existentes para pasar pruebas (regla de WORKING_RULES).

## Migración

Las validaciones actuales de `tools/cellmesh.js` y `views/calc.js` (bloque A) siguen como preflight orientativo; sus límites pasan a declararse como heurísticas versionadas cuando exista el catálogo de políticas.
