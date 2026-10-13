# Corridas de superficie para WF-SURFACE

Fecha: 2026-10-13. SIESTA 5.4.2 (conda-forge `nompi`), un hilo, Linux x86_64. Pseudos del repositorio (`app/dftlab/data/pseudos/`): `lda/Al.psml` (sha256 `2c5aa725…`), `lda/H.psml` (`52e21053…`), `pbe/Al.psml` (`c53846ea…`). Celda de Al(111) de 3 capas con 18 Å de vacío (c = 22.676537 Å); en las asimétricas, un H atop a 1.6 Å del Al superior. Son corridas de diagnóstico de la tubería de análisis, no valores de referencia física.

`planar_profile.py` lee la malla binaria `.VH`, promedia sobre los planos (a1, a2) y da el perfil a lo largo de a3 (`profile(d)` devuelve z, V y E_F). Los perfiles que usan los vectores están dentro de `docs/scientific-protocols/vectors/surface.cases.json`, que `build_surface_cases.py` regenera con `RUNS=<carpeta con slab3, slab3v y surf/>`.

| FDF | `Slab.DipoleCorrection` | E_F (eV) | E total (eV) | Iteraciones |
|---|---|---|---|---|
| `h_false.fdf` | false | −4.846213 | −237.876991 | 19 |
| `h_none.fdf` | none | −4.846213 | −237.876991 | 19 |
| `h_true.fdf` | true | −4.844244 | −237.873330 | 20 |
| `h_charge.fdf` | charge | −4.844244 | −237.873330 | 20 |
| `h_vacuum.fdf` | vacuum | −4.844247 | −237.873334 | 20 |
| `pbe_sym.fdf` | — (GGA/PBE, Al(111) sin H) | −3.992565 | −222.271689 | 12 |

`true` ≡ `charge` y `none` ≡ `false` (misma E_F y misma energía). Con un valor no reconocido (`bogus`) SIESTA aborta con «init_dipole: Could not determine the dipole option [charge, vacuum, none]».
Plateaus de `.VH`: con `vacuum` y con `charge`, −0.8997 eV en la cara inferior y +0.7422 eV en la superior (Φ 3.9446 y 5.5863 eV); con `false`, pendiente 0.112 eV/Å en todo el vacío; con GGA, −0.2729 eV plano a 0.1 meV y `.VT` igual a `.VH` en el vacío.
