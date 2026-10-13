# Ficha de entrada: WF-SURFACE (T-040, depende de G-05/G-06 de T-028)

Estado: **aceptada** por Manuel el 2026-10-13. Dueño: QRAFT ([ADR-018](../adr/ADR-018-autoridad-protocolos-siesta-eos-electronica-superficie.md), aceptado). Fuente: [maestro §11.4](../../PROPUESTA_MAESTRA_DFTLAB_V2.md). Evidencia: [auditoría P5–P10](../reviews/2026-10-11-auditoria-p5-p10.md#evidencia-siesta-542) y [corridas de superficie](../reviews/evidencia-p5-p10/superficie/README.md). Vectores: [`surface.cases.json`](vectors/surface.cases.json) (33 casos), oráculo [`surface-oracle.mjs`](vectors/surface-oracle.mjs), constructor independiente [`build_surface_cases.py`](vectors/build/build_surface_cases.py).

## Decisiones

| # | Decisión | Por qué |
|---|---|---|
| S-1 | El constructor de slabs (G-05, [ficha SLABS](SLABS.md)) entrega una celda con a1, a2 en el plano de la superficie y **a3 perpendicular** (tolerancia `perpendicular_tol_deg`), con la dirección de vacío y la normal hacia fuera de cada cara declaradas. El análisis rechaza una celda cuya a3 no lo sea (`A3_NOT_PERPENDICULAR`). | El promedio planar sobre planos (a1, a2) a lo largo de a3 solo es el perfil sobre la normal si a3 es perpendicular. «Normal arbitraria» de T-040 se cumple en el constructor, no en el análisis. |
| S-2 | `Slab.DipoleCorrection` es un enum `true \| false \| charge \| vacuum \| none` (5.4.2), no un booleano. QRAFT debe aceptarlo, conservar el valor escrito y distinguir el efecto: `true ≡ charge` y `none ≡ false` (corridas reales: misma E_F y misma energía total al microeV). Cualquier otro valor aborta SIESTA («Could not determine the dipole option»). No se usa con `NetCharge`. | El registro de QRAFT lo tipa `boolean` y su validador marca `vacuum` como `KEYWORD_VALUE_INVALID` (hallazgo H-08, U-Q12). |
| S-3 | El potencial para Φ es `.VH` (Hartree más parte local, electrostático). `.VT` solo si la política lo declara (`allow_vt`). | En Al(111) PBE de 18 Å, `.VT` coincide con `.VH` en el vacío al décimo de meV, pero la cola de Vxc de un caso GGA con vacío menor no está acotada. |
| S-4 | Φ por cara = meseta de vacío de esa cara − E_F de la **misma** corrida. Sin corrección dipolar solo se admite slab simétrico (`faces_equivalent` de [SLABS](SLABS.md) G5-10); un slab asimétrico sin corrección es `DIPOLE_UNCOMPENSATED_ASYMMETRIC`. Con corrección, una Φ por cara. Nunca se usa «máximo del promedio planar». | El máximo es correcto solo para slab simétrico sin dipolo; en el caso asimétrico real da la Φ de la cara alta para las dos y yerra 1.64 eV en la baja. |
| S-5 | Gate de meseta, con los valores de la política de abajo: ventanas de `window_A` que arrancan a `margin_A` del átomo más externo, 9 muestras por ventana; una ventana es plana si |pendiente| ≤ `slope_max_eV_per_A` y su rango ≤ `range_max_meV`; la meseta es el primer tramo de ventanas planas consecutivas de al menos `width_min_A`; sus ventanas no difieren más de `stability_meV`. Sin meseta: `NOT_ESTABLISHED` con motivo. | §11.4. No hace falta conocer dónde puso SIESTA la capa dipolar: el escalón corta la meseta por sí mismo. |
| S-6 | El promedio macroscópico usa una media móvil con ventana igual a la distancia interplanar de la geometría, no un valor fijo (para el potencial dentro del slab, referencias de bulk y alineaciones). | Una ventana de un periodo elimina la oscilación; otra longitud la deja. |
| S-7 | E_F no se compara entre corridas con celdas distintas sin alinear (`fermiComparable`). | Pasar de 18 a 24 Å de vacío movió E_F +57.6 meV y la meseta lo mismo; Φ cambió 0.1 meV. |
| S-8 | Convergencia de Φ respecto a capas, vacío, k en el plano y base: cada una como etapa enlazada (protocolo de convergencia existente). Una etapa necesita al menos tres puntos y converge si las dos últimas diferencias caben en `convergence_meV`. | §11.4. Con dos puntos no se puede distinguir convergencia de coincidencia. |
| S-9 | Orden de rechazo, la primera que aplica decide: `A3_NOT_PERPENDICULAR`, `SCF_NOT_CONVERGED`, `FERMI_MISSING`, `POTENTIAL_NOT_PERMITTED`, `DIPOLE_UNCOMPENSATED_ASYMMETRIC`, `VACUUM_TOO_SMALL`, y por cara `PLATEAU_NOT_FOUND`, `PLATEAU_TOO_NARROW`, `PLATEAU_UNSTABLE`. Una cara puede quedar establecida y la otra no; el veredicto del conjunto es `ESTABLISHED` solo si lo están las dos. | Para que el motivo sea estable entre implementaciones. |

## Algoritmo (referencia: `surface-oracle.mjs`)

1. **Vacío.** Se ordenan las z de los átomos módulo c (c = a3_z) y el hueco periódico mayor es el vacío `(top, next)`; la cara +z mira desde `top` y la −z desde `next`. Si `next − top − 2·margin_A < width_min_A`: `VACUUM_TOO_SMALL`.
2. **Interpolación.** El perfil es la media planar sobre una malla uniforme en z; entre nodos es lineal y periódico. Las medias son la integral exacta de ese interpolante.
3. **Cara +z.** Ventanas `[s, s + window_A]` con `s = top + margin_A + k·step_A` mientras `s + window_A ≤ next − margin_A`. En cada una, 9 muestras equiespaciadas, pendiente de mínimos cuadrados y rango.
4. **Meseta.** Primer tramo de ventanas planas consecutivas con anchura `≥ width_min_A`; si las medias de sus ventanas difieren más de `stability_meV`, `PLATEAU_UNSTABLE`. Φ = media del interpolante sobre el tramo − E_F.
5. **Cara −z.** El mismo procedimiento sobre el perfil reflejado z → −z.

## Política `qraft.surface.policy@1` (valores propuestos, medidos en las corridas de abajo)

| Campo | Valor | Qué protege |
|---|---|---|
| `potential`, `allow_vt` | `VH`, `false` | S-3 |
| `window_A`, `step_A` | 1.0, 0.25 | Resolución de la búsqueda |
| `margin_A` | 4.0 | Distancia desde el átomo más externo; la cola del potencial tarda hasta 3.3 Å en asentarse en las corridas reales |
| `width_min_A` | 2.0 | Meseta que merece el nombre |
| `slope_max_eV_per_A` | 0.005 | La corrida sin corrección tiene 0.112 eV/Å; las mesetas reales, 0.0001 |
| `range_max_meV` | 5.0 | Rango de la ventana |
| `stability_meV` | 3.0 | Deriva dentro de la meseta |
| `perpendicular_tol_deg` | 0.01 | S-1 |
| `convergence_meV` | 10.0 | S-8 |

La política no entra en los hashes de convergencia hasta que se acepte esta ficha; los valores se pueden cambiar con una nueva versión de la política (`@2`) y sin tocar el código.

## Corridas reales (SIESTA 5.4.2, un hilo, 150 Ry, DZP, mezcla Pulay 0.05)

| Corrida | Φ (eV) | Notas |
|---|---|---|
| Al(111) 3 capas, LDA, 18 Å de vacío | 3.8923 | Auditoría; E_F −4.1679 |
| Igual, 24 Å | 3.8924 | E_F −4.1102; Φ cambia 0.1 meV |
| Al(111) 3 capas, GGA/PBE, 18 Å | 3.7197 | E_F −3.9926; meseta plana a 0.1 meV; `.VT` = `.VH` en el vacío |
| Al(111) + H en una cara, `Slab.DipoleCorrection vacuum` | +z 5.5863; −z 3.9446 | Dos mesetas separadas por el escalón de la capa dipolar |
| Igual con `charge` | +z 5.5867; −z 3.9442 | Coincide con `vacuum` a 0.4 meV |
| Igual con `false` | — | Potencial en dientes de sierra, 0.112 eV/Å; sin meseta |

H atop a 1.6 Å del Al superior, sin relajar: es una prueba de la tubería de análisis, no un valor físico de adsorción. Las Φ de Al(111) de 3 capas no se comparan con el experimento (4.24–4.26 eV): DL-02 queda como está, con su réplica PBE/SZP en 4.176 eV.

## Vectores (33; los cinco exigidos y los que los acompañan)

| Exigido | Casos |
|---|---|
| 1. FDF con `Slab.DipoleCorrection vacuum` aceptado y conservado | `surf-dipole-vacuum`, `-charge`, `-true`, `-false`, `-none`, `-bogus` (rechazado), `-spelling`, `-dup`, `-absent` |
| 2. a3 no perpendicular rechazada | `surf-a3-ok`, `surf-a3-tilted` (la reorientación con atom map es de [SLABS](SLABS.md)) |
| 3. Perfil asimétrico: dos Φ y ninguna con la regla del máximo | `surf-synth-asym`, `surf-real-h-vacuum`, `surf-real-h-charge` |
| 4. Sin meseta: `NOT_ESTABLISHED` | `surf-synth-small-vacuum`, `-field`, `-bump`, `-drift`, `surf-real-h-false`, `surf-real-h-false-forced` |
| 5. Par de vacíos de Al(111): igual Φ | `surf-real-al111-vac18`, `-vac24`, `surf-fermi-differs`, `surf-fermi-same` |

Más: GGA (`surf-real-pbe-sym`), puertas (`surf-gate-vt`, `-vt-allowed`, `-scf`, `-fermi`), promedio macroscópico (`surf-macro`) y convergencia (`surf-conv-two`, `-vac`, `-layers`). Los esperados los calcula `build_surface_cases.py` con numpy, de forma independiente del oráculo.

## Qué entrega QRAFT (U-Q12 y T-040)

1. **U-Q12.** `Slab.DipoleCorrection` como enum en el registro 5.4.2 y en la validación electrostática: acepta y conserva los cinco valores, rechaza el resto con el motivo de S-2, nunca lo reescribe, y avisa si se combina con `NetCharge`. Prueba con los nueve vectores `surf-dipole-*`.
2. **Protocolo.** `qraft.api` exporta de forma aditiva el protocolo de superficie: dado el perfil y E_F de una corrida, devuelve el veredicto de S-9 y las Φ por cara; los 24 vectores restantes los reproduce el código de QRAFT. Convergencia por etapas enlazadas de S-8.
3. **Corrida real de calificación.** La del Al(111) de 3 capas con 18 y 24 Å (Φ 3.8923 y 3.8924 eV) y la asimétrica con `vacuum` (5.5863 y 3.9446), con los FDF y los hashes del README de evidencia. Resultado `NUMERICAL_CANDIDATE`; ninguna capability pasa de `CONTRACT_TESTED`.

## Lo que esta ficha no acredita

- Ninguna Φ es un valor de referencia física: son slabs de 3 capas sin relajar. La referencia con tolerancia previa sigue siendo DL-02.
- La política es una propuesta medida en seis corridas de Al(111); otros metales, adsorbatos con momento dipolar grande y slabs polares requieren corridas propias antes de fijar sus mesetas.
- El caso de campo eléctrico externo y el de capa cargada (`NetCharge`) no están cubiertos.
