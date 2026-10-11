# ADR-006: Hubbard HF-1 primero, HF-2 tras contrato upstream, transición explícita por versión

Estado: **aceptado** el 2026-10-11 (T-007). La interfaz concreta de HF-1 y la brecha para HF-2 quedan pendientes del inventario C2 (T-009).
Fecha: 2026-10-11. Fuente: [propuesta maestra](../../PROPUESTA_MAESTRA_DFTLAB_V2.md) §8.2–8.4, §11.3, §20.

## Contexto

HubbardFlow tiene su propio plan LR (`ResolvedPerturbationPlan`, serializable y con digest) y un executor genérico que avanza en serie. QRAFT es el runtime de la plataforma (ADR-003). Integrar Hubbard nodo por nodo en QRAFT exige un export público de fragmentos, puertos y evidencia que hoy no está consolidado, según la propuesta.

## Decisión

1. **HF-1 (obligatorio, primero):** una capability de QRAFT encapsula una campaña HubbardFlow completa dentro de una allocation declarada. QRAFT controla la tarea exterior y reserva recursos suficientes para los launchers internos; HubbardFlow controla su interior. El estado interno se indexa con IDs hijos de la tarea exterior. Cancelar la tarea exterior propaga el cierre a los procesos internos; el resume comprueba ambos niveles. El controlador no se arranca bajo MPI y ninguna tarea interna se envía dos veces.
2. **HF-2 (posterior):** HubbardFlow exporta fragmentos y callbacks públicos y QRAFT ejecuta los nodos. Solo empieza cuando el contrato upstream exista y una prueba de equivalencia con HF-1 pase. En HF-2 se desactiva la programación independiente de esos nodos por el executor Hubbard: un solo controlador.
3. **Transición por versión:** cada campaña registra su modo (HF-1/HF-2) y versión en la evidencia. HF-2 no reemplaza retroactivamente campañas HF-1 ni es requisito para reproducirlas.
4. **Reglas científicas intocables** (§8.4): el resultado es `U_scalar_charge` y no se aplica como `Ueff`, J o V sin conversión validada; el número de perturbaciones lo decide el plan; `NOT_ESTABLISHED`, bounds y diagnósticos no se convierten en PASS; ningún fallback de inversión contra la política del motor; no se usa `File.DM.Init`.

## Pendiente del inventario C2

- Qué API pública de HubbardFlow @ `e508f47` permite lanzar una campaña completa como proceso encapsulado (entrada, salida, cancelación, resume) para HF-1.
- Qué falta para HF-2 (export de fragmentos, puertos, autorizaciones y evidencia por nodo) y qué cambio upstream lo cubre.

## Alternativas

| Opción | Motivo para no adoptarla |
|---|---|
| HF-2 directamente | Depende de una API que no existe; bloquearía el workflow Hubbard. |
| Reimplementar LR-U en la plataforma | Viola ADR-003 y las baselines congeladas de HubbardFlow. |
| Dejar a HubbardFlow programar todo, también fuera de la allocation | Doble scheduling y sin control de recursos de QRAFT. |

## Consecuencias

- En HF-1 el paralelismo interno es el que HubbardFlow tenga (serial hoy); no se promete más.
- La UI muestra el modo y la versión de cada campaña Hubbard.

## Contratos afectados

`CapabilityDescriptor` (modo HF), `CapabilityQualificationRecord`, `ResumePlan`, `AssessmentRecord` para resultados Hubbard (T-008/T-056).

## Pruebas exigidas

- Cancelar HF-1 durante un SCF interno: descendientes cerrados, ownership y evidencia de cierre (§18.3).
- Resume HF-1 con `.DM`, pseudo o política cambiada: reutilización rechazada con motivo verificable.
- Fixture `U_scalar_charge` que la UI no ofrece como `Ueff`.
- Para HF-2: equivalencia de resultados y evidencia con HF-1 sobre el mismo plan.

## Migración

Nada que migrar hoy. HF-1 llega en P7; HF-2 en P8 si el cambio upstream existe.
