# ADR-018: autoridad de los protocolos EOS, electrónica fina y superficie

Estado: **aceptado** el 2026-10-11 por decisión de Manuel: **opción A** (QRAFT). Las fichas de `docs/scientific-protocols/` siguen en borrador y deben aceptarse antes de asignar T-035, T-036 fino y T-040 (compuerta del [plan §19](../../PLAN_IMPLEMENTACION_CLAUDE_CODE.md#19-auditoría-p5p10-y-compuerta-de-diseño)).
Fecha: 2026-10-11. Fuente: [auditoría P5–P10](../reviews/2026-10-11-auditoria-p5-p10.md), [propuesta maestra](../../PROPUESTA_MAESTRA_DFTLAB_V2.md) §11 y la matriz R-17/R-18/R-20. Relacionado: [ADR-003](ADR-003-autoridades-qraft-hubbardflow-plataforma.md), [ADR-009](ADR-009-politicas-gates-cientificos.md).

## Contexto

ADR-003 asigna autoridad a QRAFT (runtime y locks), a HubbardFlow (LR-U) y a la plataforma (operaciones e identidad). La matriz del maestro dice «Protocolo/analizador» para EOS, bandas finas y superficie, pero no dice **quién** es ese protocolo. Lo comprobado en QRAFT `41043ed`:

- Ya es autoridad científica de varios protocolos SIESTA: relajación (M5), cadena de estado fundamental (M6), bandas/DOS/PDOS (M7), convergencia de k y malla, selección magnética y óptica. Cada uno publica evidencia con `ScientificAuthority` (`PROVISIONAL`/`APPROVED`).
- No tiene EOS (ningún `Birch`, volumen ni ajuste), ni fat bands, ni masas efectivas, ni promedio planar ni función de trabajo. [`dos_pdos_results.py`](https://github.com/Jairomcarmona/siestaflow/blob/41043edcabef39026fe3cb6b7776362695faf9c6/src/qraft/dos_pdos_results.py#L4) dice que no infiere gaps ni picos.
- Sus variantes de FDF cambian **un escalar** ([`fdf_variants.py`](https://github.com/Jairomcarmona/siestaflow/blob/41043edcabef39026fe3cb6b7776362695faf9c6/src/qraft/engines/siesta/fdf_variants.py)). Una EOS necesita N geometrías, no N valores de un escalar (ver «trampa de LatticeConstant» en la [ficha WF-EOS](../scientific-protocols/WF-EOS.md)).

Sin dueño, Codex tendría que elegir al implementar T-035: o pone la ciencia en `platform/` (un tercer autor de gates, contra ADR-003 regla 3) o abre cambios a la vez en QRAFT y en la plataforma sin contrato previo. Es el mismo patrón que obligó a dos adendas en ADR-017.

## Decisión

**Opción A, adoptada.** QRAFT es la autoridad de los protocolos SIESTA no Hubbard: genera geometrías y planes, ejecuta, valida la evidencia y produce el resultado científico con su autoridad nativa. La plataforma solo proyecta (`AnalysisResult`, `AssessmentRecord` por referencia, ADR-005) y presenta.

1. Cada workflow (WF-EOS, WF-ELECTRONIC fino, WF-SURFACE) es un protocolo de QRAFT con capability propia, plan inmutable y digest, igual que M5–M8. Su ficha de entrada vive en `docs/scientific-protocols/` y se acepta **antes** del código (compuerta de diseño, [plan §19](../../PLAN_IMPLEMENTACION_CLAUDE_CODE.md#19-auditoría-p5p10-y-compuerta-de-diseño)).
2. Los umbrales viven en políticas versionadas del protocolo (ADR-009). La ficha fija qué parámetros declara la política, no sus valores.
3. Los lectores y vistas de la plataforma (por ejemplo, el ajuste BM de `views/calc.js` o el promedio planar de `views/potential.js`) siguen como herramientas de lectura y aprendizaje; no certifican ni alimentan una campaña.
4. Cambios upstream: U-Q10…U-Q13, que entran en QRAFT **después** de U-Q9 y no en paralelo, para no competir con HF-1. Mientras tanto se aceptan las fichas y sus vectores. Están en el [inventario de QRAFT](../compatibility/QRAFT_4d996ea.md#5-cambios-upstream-necesarios-ola-1-codex). Cada uno parte de la ficha aceptada y de sus vectores.

**Opción B (descartada).** Un paquete de análisis en `dftlab-suite` (por ejemplo `platform/science/`) ajusta y evalúa, y QRAFT solo ejecuta. Reduce cambios en QRAFT al análisis, pero la generación de geometrías y el fan-out siguen necesitando QRAFT (la plataforma no puede crear su propio DAG, ADR-003 regla 1). El resultado es el mismo número de repositorios por workflow y un tercer autor de gates.

**Opción C (descartada).** Diferir: mantener EOS, fat bands, masas y superficie como exportación y lectura offline (P5) sin campaña operativa. Es válido si P6/P7 no son prioridad, pero el catálogo debe decir `DESIGNED`, no `RUNTIME_VERIFIED`.

## Alternativas

| Opción | Motivo para no adoptarla |
|---|---|
| B | Dos repositorios por workflow igual que A, más una segunda definición de gate fuera del motor que ejecuta. |
| C | No resuelve P6/P7; solo los pospone. Aceptable como decisión explícita de alcance. |
| Decidir dentro del PR de Codex | Es lo que produjo las adendas de ADR-017: el diseño llega después del código. |

## Consecuencias

- Con A, cada workflow es **un** bloque upstream en QRAFT más un consumidor en la plataforma, en ese orden y con los vectores de la ficha como contrato entre ambos.
- Las fichas de `docs/scientific-protocols/` quedan como fuente común de Codex y del revisor.
- La plataforma no reutiliza el ajuste BM ni el promedio planar del frontend como evidencia; puede usarlos para comparar con fixtures.

## Contratos afectados

`AnalysisResult` (cantidades con unidad y base de normalización: por celda, átomo o fórmula), `AssessmentRecord`, `CapabilityDescriptor` de cada protocolo, `CapabilityQualificationRecord`. Con A no hace falta un schema nuevo en `contracts/` para el resultado nativo: se guarda por `NativeContractRef`.

## Pruebas exigidas

Las de cada ficha, en particular:

- EOS: la geometría de un volumen conserva las coordenadas fraccionarias (vector que falla con la trampa de `LatticeConstant`); todos los puntos con la misma malla real y la misma k-grid, o el protocolo lo rechaza.
- Superficie: `Slab.DipoleCorrection vacuum` se acepta y conserva; Φ invariante al cambiar el vacío en un caso simétrico.
- Un resultado técnico exitoso con evaluación `NOT_ESTABLISHED` no se muestra como calificado.

## Migración

No hay nada implementado de estos protocolos. Cambiar de opción exige un ADR nuevo antes de abrir T-035.
