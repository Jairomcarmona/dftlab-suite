# Ficha de entrada: constructor de slabs y restricciones (T-028, G-05 y G-06)

Estado: **lista para aceptar**. Es una operación de geometría de la plataforma ([ADR-003](../adr/ADR-003-autoridades-qraft-hubbardflow-plataforma.md)): no ejecuta SIESTA ni decide física de un protocolo. Su salida es una `StructureRevision` con `physical_intent: SLAB` y una transformación `SLAB` con atom map. La usan los presets S-04 ([PRESETS](PRESETS.md)) y WF-SURFACE (S-1, S-4). Fuente: [maestro §9.1](../../PROPUESTA_MAESTRA_DFTLAB_V2.md) (G-05, G-06).

Esta ficha está escrita para que la implemente quien solo programa: si algo no está aquí, en el oráculo o en los vectores, **se pregunta antes de decidirlo**. No se cambian los vectores para que una prueba pase.

## Qué existe hoy

No hay constructor general. Las láminas de Aprender (`corridas/wf.tar.gz`, `gen.py`) se escribieron a mano para cuatro caras: fcc(111), fcc(100), fcc(110) y hcp(0001). Sus convenciones (vacío entre planos extremos, lámina centrada, a3 perpendicular) se adoptan aquí, y el constructor reproduce esas láminas.

## Entrada

| Campo | Contenido |
|---|---|
| `bulk.primitive` | Celda primitiva (filas, Å) salida de G-03. |
| `bulk.conventional` | Celda convencional estándar de G-03 (Moyo). Solo sirve para leer `hkl`. |
| `bulk.atoms` | `{id, species, frac}` con `frac` en la celda primitiva. `id` es el `atom_id` de la revisión de origen. |
| `spec.hkl` | Índices de Miller enteros respecto de la celda convencional. En hexagonal, la interfaz puede aceptar (h k i l) y pasar (h k l) solo si i = −(h + k); si no, rechaza. El constructor recibe siempre tres índices. |
| `spec.n_planes` | Número de **planos atómicos** (no de celdas). Es lo que la interfaz llama «capas». |
| `spec.vacuum_A` | Distancia entre el plano superior y el inferior de la imagen siguiente, en Å. |
| `spec.termination` | Índice del plano que queda arriba (0 … P−1, ver G5-6). |

## Decisiones

| # | Decisión | Por qué |
|---|---|---|
| G5-1 | Los índices se pasan a la base primitiva: m = A_prim · G con G = h·b1 + k·b2 + l·b3 (recíproca convencional, sin 2π), escalados a enteros y divididos por su máximo común divisor. `primitiveMiller`. | Si la red de traslaciones fuera la convencional, la celda de superficie de fcc(111) tendría 4 veces el área necesaria (vector `slab-al111-conv`). (222) da la misma lámina que (111) (`slab-al222`). |
| G5-2 | a1 es el vector más corto de la red del plano (empate: índices enteros en orden lexicográfico). a2 es, entre los vectores más cortos que con a1 dan el área mínima y forman base dextrógira con la normal n̂, el de menor a1·a2 (ángulo obtuso si existe). | Base reducida y determinista. En hexagonal da 120°, como las láminas existentes. |
| G5-3 | n̂ = G/\|G\| apunta hacia fuera de la cara superior. Marco final: a1 sobre x, n̂ sobre z, a3 = (0, 0, L). | a3 ⟂ superficie ([WF-SURFACE](WF-SURFACE.md) S-1). |
| G5-4 | Vector de apilamiento: el vector de red con m·u = 1 de menor componente en el plano (empate lexicográfico). Su componente normal es d = 1/\|G_m\|. La celda (a1, a2, apilamiento) es una celda primitiva del cristal: cada repetición aporta sus átomos. | El resultado informa `stacking_shift`, el desplazamiento en el plano por repetición (1/3, 2/3 en fcc(111)). |
| G5-5 | Planos atómicos: alturas dentro de la repetición agrupadas con tolerancia 10⁻⁴ Å. P = planos por repetición. | Diamante (001) tiene P = 2; GaN(0001) tiene P = 4. |
| G5-6 | `termination` t elige el plano (orden ascendente de altura dentro de la repetición) que queda arriba. Se ofrecen P terminaciones; las equivalentes por simetría **no** se funden aquí (eso es de G-02). | Determinista y sin tolerancias de simetría escondidas. |
| G5-7 | La lámina tiene los `n_planes` planos que acaban en la terminación elegida. | Coincide con `nLayers` de `potencial.json`. |
| G5-8 | L = (z_sup − z_inf) + `vacuum_A`; el plano inferior queda en z = `vacuum_A`/2. Coordenadas en el plano envueltas a [0, 1) en la base (a1, a2). | Es la convención de `gen.py`; los cuatro vectores de referencia la reproducen. |
| G5-9 | Atom map: cada átomo lleva `id` = `<id de origen>:<repetición>`, `bulk_id`, `unit` y `plane` (desde abajo). Orden: plano ascendente y luego orden del bulk. | `:` está permitido en `defs.schema.json#/$defs/id`; `@` no. |
| G5-10 | `faces_equivalent`: verdadero si existe una isometría de la lámina que invierte z. Se buscan todas: operación puntual de la red 2D (matriz entera de entradas −1, 0, 1 que conserva la métrica) por la reflexión z → z_inf + z_sup − z, más una traslación en el plano. `facesEquivalent`. | Lo exige WF-SURFACE S-4 (sin corrección dipolar solo lámina simétrica). En los 8 casos de construcción coincide con spglib (operación con R₃₃ = −1); GaN(0001) da falso. |
| G5-11 | `slabInvariants` compara láminas sin depender de origen, orientación ni elección de a1 y a2: longitudes, área, planos, composición por plano, separaciones, distancias de registro entre planos vecinos hasta tres, vacío y z inferior. Rechaza `A3_NOT_PERPENDICULAR`. | Con esto se compara contra las láminas hechas a mano. |

## Restricciones (G-06)

| # | Decisión | Por qué |
|---|---|---|
| G6-1 | «Fijar los k planos inferiores» selecciona los átomos con `plane` < k, en el orden de la geometría (`bottomPlaneAtoms`). | Usa el atom map de G5-9; no depende de alturas recalculadas. |
| G6-2 | `Geometry.Constraints` se escribe con `renderConstraints`: una línea `atom i` por átomo (o `atom i x y z` para fijar una dirección), con i positivo y ordenado; sin rangos ni índices negativos. Errores: `CONSTRAINT_INDEX_INVALID`, `CONSTRAINT_DUPLICATED`, `CONSTRAINT_DIRECTION_INVALID`. | En SIESTA 5.4.2, `atom -1` fija el último átomo (regla R-1 de [PRESETS](PRESETS.md)). |
| G6-3 | Las restricciones viajan en `transformations[].parameters` de la revisión y en el FDF; el digest del plan las incluye. | La identidad de geometría de QRAFT no incluye `Geometry.Constraints`; el hash del FDF efectivo sí. |

## Vectores

[`vectors/slabs.cases.json`](vectors/slabs.cases.json) contiene 19 casos:

- 4 de referencia: Al(111), Al(100), Al(110) y Mg(0001) construidos con 18 Å de vacío. Sus invariantes coinciden, con tolerancia 2·10⁻⁵ Å, con las láminas hechas a mano que ya corrieron en SIESTA 5.4.2 (`al111_n3_vac18.fdf` de la auditoría y `corridas/wf.tar.gz`).
- 8 construcciones completas, incluidas Si(001) con dos terminaciones, GaN(0001) polar, GaN(10-10) con dos terminaciones, (222) y la trampa de la celda convencional.
- 1 de planos inferiores, 5 de restricciones y 1 de a3 inclinado.

Los valores esperados vienen de una implementación independiente en numpy, y la equivalencia de caras de spglib (`vectors/build/build_slab_cases.py`). `node scripts/check-protocol-vectors.mjs` comprueba el [oráculo](vectors/slab-oracle.mjs) y corre en `scripts/verify.mjs`.

## Implementación

1. **Servicio (autoridad, Python).** Portar `buildSlab`, `facesEquivalent`, `slabInvariants`, `bottomPlaneAtoms` y `renderConstraints` en Python puro: numpy solo es dependencia opcional (`engines`) de `platform/pyproject.toml` y el álgebra es de 3×3. No usar el `SlabGenerator` de pymatgen ni `surface()` de ASE: sus convenciones de vacío, centrado y terminación son otras, y ASE en el navegador es DL-06. Salida: `StructureRevision` con `physical_intent: SLAB`, transformación `SLAB` con `parameters` = `spec` más `primitive_miller`, `d_A`, `planes_per_unit`, `stacking_shift`, `faces_equivalent` y restricciones, y el atom map como artefacto.
2. **Frontend (vista previa).** El mismo algoritmo en JS (puede partir del oráculo). La vista previa no crea revisiones; el servicio sí.
3. **Pruebas.** Los dos lados pasan `slabs.cases.json` sin cambiar valores ni tolerancias.

## Decisión pendiente de Manuel

Ninguna científica. Si prefieres pymatgen en el servicio (idea 3 del backlog), la ficha debe cambiar antes del código, porque sus convenciones no son estas.
