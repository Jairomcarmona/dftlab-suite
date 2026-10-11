# Pruebas de factibilidad

Scripts que se corrieron para el plan (`../PLAN_DFT_App.md`). Requieren `pip install pyscf ase sisl`. Todos importan `common.py`.

| Script | Qué mide |
|---|---|
| `si.py` | SCF y bandas de Si con GDF (lento en bandas) |
| `interp_test2.py`, `wsinterp.py` | Interpolación de bandas en espacio real (descartada) |
| `sym_test.py`, `mg_test.py`, `cut.py` | Simetría, multigrid y corte de energía |
| `eps.py` | ε(ω) de Si en partícula independiente, Kramers–Kronig y regla f |
| `lib.py` | Biblioteca: gap, camino k, momentos y tiempos |
| `nio2.py` | NiO AFM: ruta NM → +U → barrido de U |
| `lr.py`, `lr_sc.py` | U de Cococcioni en celda primitiva y supercelda |
| `sisl_test.py` | Escribir y leer un .TSHS con sisl; bandas y PDOS |

`resultados/` guarda las salidas tal cual (JSON por línea).
