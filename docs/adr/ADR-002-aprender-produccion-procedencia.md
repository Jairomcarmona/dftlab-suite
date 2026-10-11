# ADR-002: separación entre aprender y producción, promoción explícita y procedencia

Estado: **aceptado** el 2026-10-11 (T-007). Implementación pendiente: T-008 (schemas), T-013, T-014.
Fecha: 2026-10-11. Fuente: [propuesta maestra](../../PROPUESTA_MAESTRA_DFTLAB_V2.md) §4.1–4.2, §5.3, §12.2.

## Contexto

Los capítulos de Aprender muestran datos de corridas reales con su procedencia, y las herramientas generan `.fdf` y scripts. Al añadir ejecución, un ejemplo didáctico podría acabar enviado como cálculo, o un resultado importado podría presentarse como validado. Hoy no hay campos que distingan origen, finalidad y evaluación científica.

## Decisión

1. Todo dataset o resultado lleva cuatro campos independientes:
   - `origin`: ejemplo incorporado, simulación didáctica, importación del usuario o ejecución rastreada;
   - `purpose`: educativo, exploratorio u operativo;
   - `provenance_state`: verificado, parcial o desconocido;
   - `scientific_assessment`: la decisión del protocolo propietario (ADR-009), independiente de los anteriores.
   Ninguno se deriva de otro: un ejemplo con procedencia excelente sigue siendo educativo.
2. **Promoción explícita:** de un ejemplo o experimento solo se exporta una estructura o plantilla a un **borrador** de proyecto. El borrador pasa por revisión de modelo/pseudos/protocolo, preflight autoritativo y plan bloqueado antes de ejecutarse. No existe una ruta que envíe un ejemplo como run.
3. **Estados separados:** aprendizaje, borrador, plan resuelto, paquete, run, intento y resultado son entidades distintas. Los datos didácticos nunca se mezclan automáticamente con el almacén de campañas; no hay singleton mutable compartido entre vistas.
4. Un resultado real puede mostrarse en Aprender mediante una vista de lectura que no modifica el original ni su calificación.
5. Un resultado importado conserva parser/versión y procedencia parcial; no recibe el sello de una campaña rastreada.

## Alternativas

| Opción | Motivo para no adoptarla |
|---|---|
| Un único campo `trusted`/`valid` | Colapsa dimensiones distintas y permite presentar un ejemplo como validado. |
| Prohibir llevar ejemplos a producción | Pierde un flujo útil; la promoción explícita lo cubre sin riesgo. |
| Marcar solo en la UI | La autoridad no puede estar en la UI; los campos viven en los contratos y los valida el servidor. |

## Consecuencias

- Los JSON de `js/data/` necesitan un manifiesto de `LearningDataset` (origen, licencia, referencias, finalidad) sin cambiar sus valores.
- La UI muestra los cuatro campos; un estado desconocido se muestra como desconocido.

## Contratos afectados

Envelope de plataforma (§5.2), `LearningDataset`, `ResultDataset`, `AssessmentRecord`, `RunIntent` (T-008). Contrato de módulo: la línea de procedencia (`footer.prov`) pasa a derivarse del manifiesto cuando exista.

## Pruebas exigidas

- Fixture: un ejemplo incorporado nunca llega a una solicitud de run sin pasar por borrador y plan.
- Fixture: resultado con terminación técnica exitosa y `NOT_ESTABLISHED`; la UI no lo muestra como certificado.
- Un resultado importado no adquiere `provenance_state: verificado` sin evidencia.

## Migración

Primero los schemas (T-008), luego el manifiesto de los datasets existentes y la promoción a borrador (T-014). Los capítulos actuales siguen funcionando sin cambios mientras tanto.
