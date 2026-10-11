# Ficha de entrada: WF-SURFACE (T-040, depende de G-05/G-06 de T-028)

Estado: **borrador para aceptar antes del código**. Dueño: QRAFT ([ADR-018](../adr/ADR-018-autoridad-protocolos-siesta-eos-electronica-superficie.md), aceptado). Fuente: [maestro §11.4](../../PROPUESTA_MAESTRA_DFTLAB_V2.md). Evidencia: [auditoría P5–P10](../reviews/2026-10-11-auditoria-p5-p10.md#evidencia-siesta-542).

## Decisiones

| # | Decisión | Por qué |
|---|---|---|
| S-1 | El constructor de slabs (G-05, [ficha SLABS](SLABS.md)) entrega una celda con a1, a2 en el plano de la superficie y **a3 perpendicular** a ese plano, con la dirección de vacío y la normal hacia fuera de cada cara declaradas. | El promedio planar sobre planos (a1, a2) a lo largo de a3 solo es el perfil sobre la normal si a3 es perpendicular. «Normal arbitraria» en T-040 se cumple en el constructor, no en el análisis. |
| S-2 | `Slab.DipoleCorrection` es un enum `true \| false \| charge \| vacuum \| none` (manual 5.4.2), no un booleano. QRAFT debe aceptarlo y conservarlo (U-Q12). | 5.4.2 acepta `charge` y `vacuum` (corridas LiH: «compensate the system dipole» y «compensate the vacuum field»). El registro de QRAFT lo tipa `boolean` y su validador marca `vacuum` como `KEYWORD_VALUE_INVALID`. |
| S-3 | El potencial para Φ es `.VH` (Hartree + local, electrostático). `.VT` se acepta solo si la política lo declara. | En Al(111) LDA, `.VH` y `.VT` coinciden en el vacío a la precisión del archivo; con GGA la cola de Vxc puede no anularse. |
| S-4 | Φ por cara = meseta de vacío de esa cara − E_F de la **misma** corrida. Sin corrección dipolar solo se admite slab simétrico (`faces_equivalent` de [SLABS](SLABS.md) G5-10); con corrección, una Φ por cara. Nunca se usa «máximo del promedio planar». | El máximo es correcto solo para slab simétrico sin dipolo (lo dice la propia vista de Aprender). |
| S-5 | Gate de meseta: anchura mínima, pendiente máxima y estabilidad al mover la ventana, excluyendo la zona de la capa dipolar. Valores en la política. | §11.4. |
| S-6 | El promedio macroscópico usa una ventana igual a la distancia interplanar de la geometría, no un valor fijo. | Para el potencial dentro del slab (bulk de referencia, alineaciones). |
| S-7 | E_F no se compara entre corridas con celdas distintas sin alinear. | En Al(111) de 3 capas, pasar de 18 a 24 Å de vacío movió E_F +57.6 meV y la meseta lo mismo; Φ cambió 0.1 meV. |
| S-8 | Convergencia respecto a Φ: capas, vacío, k en el plano y base, cada una como etapa enlazada (protocolo de convergencia existente). | §11.4. |

## Referencia del potencial (DL-02)

Evidencia nueva (no cierra DL-02, cuya verificación declarada es Φ frente al experimento con tolerancia previa): Al(111), 3 capas, LDA/DZP, 150 Ry, 12×12×1. Con 18 Å de vacío Φ = 3.8923 eV; con 24 Å, Φ = 3.8924 eV. El promedio de `.VH` sobre la celda vale −3.34 eV, así que la referencia no es «promedio cero», pero E_F y `.VH` se mueven juntos. Es consistente con una referencia común para slab simétrico neutro sin corrección dipolar. Falta el caso con `charge`/`vacuum` y el caso GGA.

## Lo que declara la política (sin valores aquí)

Modo de corrección dipolar; potencial (`.VH`/`.VT`); anchura, pendiente y estabilidad de la meseta; zona excluida alrededor de la capa dipolar; tolerancias de convergencia de Φ.

## Vectores que deben existir antes del código

1. FDF con `Slab.DipoleCorrection vacuum`: aceptado y conservado.
2. Slab con a3 no perpendicular a (a1, a2): rechazado o reorientado con atom map.
3. Perfil sintético asimétrico: dos Φ y ninguna con la regla del máximo.
4. Perfil sin meseta (vacío insuficiente): `NOT_ESTABLISHED`.
5. Par de vacíos del caso Al(111) de la auditoría: Φ igual dentro de la tolerancia de la política.
