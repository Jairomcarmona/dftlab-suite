# DFT Lab — plan de construcción

*Aplicación web para dominar cálculos reales de DFT en sólidos: SCF, bandas, DOS y PDOS con spin, gap, función dieléctrica y DFT+U con U de Cococcioni.*

Versión del plan: 9 oct 2026 (con la ampliación de la sección 12). Todo lo marcado como **medido** se corrió en este entorno (contenedor Linux de 4 núcleos, 15 GB de RAM, PySCF 2.14.0, ASE 3.29.0, sisl 0.16.4, Python 3.13). Los scripts de prueba están en `pruebas/` junto a este documento.

---

## 0. Resumen

**Sí se puede, y con cálculos de verdad.** PySCF hace DFT periódico con bases gaussianas y pseudopotenciales GTH; con eso la app calcula, no anima. Lo probé en lo que más riesgo tenía:

| Pieza | Resultado medido | Referencia |
|---|---|---|
| Si, PBE, gap | 0.61 eV indirecto, mínimo de conducción al 87 % de Γ→X | PBE 0.61 eV, mínimo al ~85 % de Γ→X |
| Si, ε(ω) en partícula independiente | ε∞ = 13.4; pico E₂ en 4.0 eV; regla f: 7.92 de 8 electrones | IPA-PBE ε∞ ≈ 13–14; exp. 11.9 |
| MgO, PBE, gap | 4.62–4.67 eV (cortes 100–150 Ha) | PBE 4.5–4.95 eV; exp. 7.7–7.8 |
| NiO AFM con DFT+U | Gap 1.04 → 1.99 eV y momento 1.08 → 1.30 μB al subir U de 0 a 6 eV (base mínima) | PBE+U abre el gap y sube el momento; misma tendencia |
| U de Cococcioni | Respuestas perfectamente lineales; U = 15 eV en celda primitiva, **demasiado alto** | 4.6 eV (Cococcioni 2005); ≈ 5.6 eV (VASP, 32 átomos) |
| Fe, momento | 2.33 μB | PBE 2.2–2.3; exp. 2.22 |
| C, GaAs, LiF, NaCl, h-BN | Gaps 4.19, 0.50, 9.05, 5.10 y 4.65 eV | PBE 4.0–4.2, ≈0.5, 8.9–9.7, 5.0–5.1, 4.6–4.7 |
| SIESTA | sisl lee `.TSHS/.HSX` y da bandas, PDOS y velocidades a cualquier k | — |

**Lo que las pruebas cambiaron del plan inicial:**

1. **Las bandas no se interpolan, se calculan exactas.** La interpolación en espacio real del Hamiltoniano en base atómica falló: con DZVP la matriz de solapamiento interpolada deja de ser definida positiva. En cambio, el cálculo exacto no autoconsistente cuesta 0.1 s por punto k en Si con la malla bien ajustada.
2. **La malla de integración por defecto de PySCF es exagerada.** Para Si, malla 25³ en vez de 35³ da la misma energía (10⁻⁸ Ha) en la mitad de tiempo; para MgO la malla por defecto era 135³. La app fijará el corte de energía de forma explícita, y el módulo de convergencia lo enseñará.
3. **Los antiferromagnéticos no convergen "a la primera".** NiO AFM desde una semilla atómica divaga. La ruta que sí funciona es: no magnético → romper la simetría de spin → PBE+U → bajar U. Esa ruta es justo lo que hay que enseñar.
4. **Los óxidos de metales de transición son lentos** en 4 núcleos: NiO con base mínima tarda 8 min el estado no magnético y 3.5–5 min cada valor de U. Van precalculados; en vivo solo se recalculan casos pequeños.
5. **La U de Cococcioni funciona como método, pero el número aún no está validado.** En la celda primitiva salió 15 eV. Mi lectura (inferida, no comprobada) es que al perturbar un Ni de la celda primitiva se perturba toda su subred, y que la base mínima agrava el efecto. Hace falta supercelda; mi primer intento en supercelda de 8 átomos no convergió partiendo del estado no magnético. La solución prevista es arrancar la supercelda desde la densidad ya convergida de la celda primitiva (desplegada con `k2gamma`) y usar SCF de segundo orden. Es el punto con más riesgo del plan, y lo pongo como prueba de aceptación explícita en la fase 6.

**Lo que te pido decidir** está en la sección 11.

---

## 1. Principio de diseño

Cada número que aparece en pantalla sale de un cálculo real, y cada cálculo se puede seguir desde la ecuación hasta la gráfica:

- **Ecuación ↔ número ↔ gráfica.** Junto a cada gráfica va su ecuación (KaTeX) con los valores reales del cálculo sustituidos: por ejemplo, ε₂(ω) muestra Ω, N_k y los términos |⟨c|p|v⟩|² que más pesan en ese ω.
- **Vistas enlazadas.** Pasar el cursor por una banda en un punto k resalta ese k en la zona de Brillouin 3D, su peso orbital en la PDOS y las transiciones ópticas que salen de ahí en ε₂(ω). Pasar por un pico de ε₂ dibuja sobre las bandas qué pares (v, c, k) lo forman.
- **Un solo modelo de orbitales locales.** La PDOS proyecta sobre los mismos orbitales locales (MINAO ortogonalizados) sobre los que actúa la U de DFT+U. Así, "los d que ves en la PDOS" son exactamente "los d a los que se aplica U".
- **La convergencia es contenido, no configuración.** Puntos k, corte de energía, base y smearing tienen su propio módulo con curvas reales.
- **Honestidad numérica.** Cada resultado dice con qué base, malla k y corte se obtuvo, y lo compara con PBE de la literatura y con el experimento.

---

## 2. Factibilidad medida por función

| Función | Cómo se hace | Estado | Costo medido (4 núcleos) |
|---|---|---|---|
| SCF periódico (RKS/UKS) | `pbc.dft.KRKS/KUKS`, FFTDF, GTH-PBE | **Medido** | Si DZVP 4×4×4: 34 s (malla 25³); MgO 4×4×4: 28 s (100 Ha) a 114 s (150 Ha) |
| Historial SCF en vivo | `mf.callback` entrega E, ΔE, ‖g‖ y ρ por ciclo | **Medido** | Gratis |
| Bandas por camino k | `mf.get_bands(kpts)` no autoconsistente, camino de `ase.cell.bandpath` | **Medido** | Si: 216 k en 21 s (≈0.1 s/k) |
| Interpolación de bandas en base AO | Fourier de F(k), S(k) a espacio real | **Descartado** | S interpolada no definida positiva con DZVP; error de 0.3 eV con SZV |
| Simetría (zona irreducible) | `space_group_symmetry=True` | **Medido** | Si: 64 → 8 k, pero solo 10 % más rápido; no es prioridad |
| DOS | Eigenvalores en malla densa no autoconsistente + ensanchamiento gaussiano o tetraedros | Diseñado | Igual que bandas |
| PDOS por orbital y spin | Proyección sobre orbitales MINAO ortogonalizados (los de DFT+U) | Diseñado, API verificada | Despreciable |
| Spin colineal | `KUKS` + smearing de Fermi | **Medido** en NiO | Ver sección 6 |
| Gap directo/indirecto | De bandas + malla SCF | **Medido** | — |
| ε(ω) en partícula independiente | ε₂ de elementos ⟨c\|p\|v⟩ (integral `int1e_ipovlp`), ε₁ por Kramers–Kronig | **Medido** en Si | 216 k: 21 s de bandas + 0.3 s de elementos de matriz |
| DFT+U (Dudarev) | `KUKSpU(U_idx=['Ni 3d'], U_val=[U])` | **Medido** en NiO AFM | 210–290 s por valor de U (base mínima, 2×2×2) |
| U de Cococcioni | Respuesta lineal, perturbación de un solo sitio, χ₀ y χ, U = χ₀⁻¹ − χ⁻¹ | **Medido en celda primitiva:** χ₀ = −0.239 eV⁻¹, χ = −0.052 eV⁻¹, U = 15.2 eV (no validado). Supercelda: SCF no convergió desde NM | 15 min por 4 valores de α, más 16 min del estado base |
| Lectura de SIESTA | sisl: `.TSHS/.HSX` (H y S), `.fdf`, `.out` (historial SCF, momentos), `.bands`, `.PDOS` | **Medido** con un TSHS escrito y releído | Bandas de grafeno, 100 k: 0.02 s |
| GW (para "el problema del gap") | PySCF trae G₀W₀ periódico (`pbc.gw.krgw_ac`) | No medido | Caro; opcional |

---

## 3. Decisiones técnicas que salen de las pruebas

1. **Motor:** PySCF `pbc` con FFTDF (no densidad ajustada GDF). GDF hizo el SCF un poco más rápido, pero las bandas con GDF tardan 14 s por punto k contra ~1 s con FFTDF. Tras el SCF se cambia `mf.with_df` a FFTDF para bandas.
2. **Corte de energía explícito** (`cell.ke_cutoff`) por elemento, nunca la malla por defecto. Valores de partida: 60–80 Ha para Si/C/Ga/As, 120–150 Ha cuando hay O, F o metales de transición. El módulo de convergencia mostrará E y gap contra el corte.
3. **Bases:** `gth-szv` para modo rápido (en vivo), `gth-dzvp` o `gth-dzvp-molopt-sr` para la biblioteca. SZV da gaps malos para conducción (Si: 2.2 eV contra 0.61 eV), y la app lo enseñará como lección, no lo esconderá.
4. **Bandas exactas, no interpoladas** (ver sección 0).
5. **Metales y magnéticos con smearing de Fermi** (σ ≈ 0.002–0.01 Ha), visible y ajustable.
6. **AFM por ruta guiada:** NM → rotura de simetría de spin en los d → PBE+U con U alta → barrido descendente de U reutilizando la densidad.
7. **ε(ω):** gauge de velocidad con `int1e_ipovlp`. Falta el conmutador del pseudopotencial no local, [V_NL, r]; la regla f da 7.92 de 8 en Si, así que el efecto es pequeño, pero la app lo dirá. Sin campos locales ni excitones (IPA).
8. **U de Cococcioni con perturbación de un solo sitio y supercelda.** La función de PySCF perturba todos los sitios a la vez (respuesta q = 0, que mezcla sitios). La app usará su propia rutina sobre `KUKSpU.alpha` con una α por sitio y construirá las matrices χ₀ y χ, que es el método del artículo de 2005. La supercelda arranca desde la densidad de la celda primitiva desplegada (`k2gamma`), no desde cero.

---

## 4. Arquitectura

```
Navegador (Vite + TypeScript)
 ├─ Three.js: cristal, zona de Brillouin con camino k, isosuperficies de densidad y orbitales
 ├─ Gráficas enlazadas (Plotly.js o uPlot+D3): bandas, DOS/PDOS, SCF, ε(ω), U
 ├─ KaTeX: ecuaciones con los números del cálculo
 └─ Estado único (store) con la "selección" compartida: k, banda, energía, ω, átomo, spin
        │  REST (JSON)  +  WebSocket (progreso SCF)
Backend (Python 3.11+, FastAPI)
 ├─ api/        endpoints: /materials, /jobs, /results/{hash}/{bands|dos|pdos|eps|scf|u}
 ├─ engine/     envoltorio de PySCF: build_cell, scf, bands, dos, pdos, optics, dftu, lr_u
 ├─ siesta/     puente sisl: lectura de TSHS/HSX/fdf/out → mismo formato de resultado
 ├─ jobs/       cola de trabajos (ProcessPool + SQLite), cancelación, límites de tiempo
 ├─ cache/      resultados por hash de entrada (estructura, xc, base, malla k, corte, U, smearing, versión)
 └─ library/    biblioteca precalculada (HDF5/npz) con valores de referencia
```

**Formato de resultado único** (lo producen PySCF y el puente de SIESTA): estructura, red recíproca, malla k, eigenvalores por spin y k, pesos orbitales, nivel de Fermi, historial SCF, momentos, ε(ω), datos de U. Así todas las vistas funcionan igual con un cálculo propio o con uno de SIESTA del clúster.

**Caché por contenido:** el hash de la entrada decide si un resultado ya existe. La biblioteca se distribuye ya calculada; lo que un alumno calcula queda en caché para el siguiente.

**Streaming del SCF:** cada ciclo envía E, ΔE, ‖g‖, ‖Δρ‖ y, cada pocos ciclos, un corte de la densidad para animar cómo converge ρ(r).

---

## 5. Módulos de la app (lo que el alumno ve y mueve)

1. **El ciclo SCF en una molécula** (H₂, N₂, CO, con PySCF molecular, instantáneo): semilla → V_H[ρ] + V_xc[ρ] → diagonalizar → nueva ρ → mezclar. Se ve cada término de la energía y la densidad en 3D cambiando por ciclo.
2. **Del cristal a la zona de Brillouin:** red directa y recíproca, malla de Monkhorst–Pack, zona irreducible, camino de alta simetría.
3. **SCF periódico y convergencia:** curvas reales de E y gap contra malla k, corte y base.
4. **Bandas:** gap directo o indirecto marcado sobre las bandas y en la ZB 3D; masa efectiva por ajuste parabólico.
5. **DOS y PDOS:** ensanchamiento, bandas "gordas" coloreadas por carácter orbital, todo con el mismo eje de energía.
6. **Spin:** Fe y Ni ferromagnéticos (bandas ↑/↓, desdoblamiento de intercambio, momento), NiO antiferromagnético.
7. **El gap y su problema:** tabla KS contra experimento para toda la biblioteca, con explicación de la discontinuidad derivativa; G₀W₀ opcional.
8. **Función dieléctrica:** ε₂ como suma de transiciones v→c, Kramers–Kronig hacia ε₁, ε∞, regla f como control de calidad; mapa de qué k y qué bandas forman cada pico.
9. **DFT+U:** barrido de U (gap, PDOS d, momento) y U de Cococcioni con las rectas N(α), pendientes χ₀ y χ, y el U resultante aplicado.
10. **Puente SIESTA:** subir `.TSHS` + `.fdf` + `.out` del clúster y ver todo lo anterior con datos propios.

---

## 6. Biblioteca de materiales y valores de control

Valores de referencia: PBE de la literatura (mismo funcional, cálculos convergidos) y experimento. "Medido aquí" es lo que salió en estas pruebas.

| Material | Qué enseña | Medido aquí (PBE, base, malla k) | Tiempo SCF medido (4 núcleos) | PBE de la literatura | Experimento |
|---|---|---|---|---|---|
| H₂, N₂, CO (molécula) | El ciclo SCF, orbitales | No medido (PySCF molecular, segundos) | — | — | — |
| Si (diamante) | Gap indirecto, bandas sp³, ε(ω) | 0.61 eV indirecto, CBM al 87 % de Γ→X (DZVP, 4×4×4); ε∞ = 13.4 | 34 s | 0.61 eV; ε∞ (IPA) ≈ 13–14 | 1.17 eV; ε∞ = 11.9 |
| C (diamante) | Gap indirecto grande | 4.19 eV indirecto (CBM al 70 % de Γ→X); directo en Γ 5.63 eV | 43 s | 4.0–4.2 eV; directo ≈ 5.6 eV | 5.48 eV |
| GaAs (zincblenda) | Gap directo en Γ | 0.50 eV directo en Γ | 220 s | ≈ 0.5 eV (sin SOC) | 1.52 eV |
| MgO (sal gema) | Iónico, PDOS O 2p / Mg 3s | 4.62–4.67 eV directo (cortes 100–150 Ha) | 59–114 s | 4.5–4.95 eV | 7.7–7.8 eV |
| LiF (sal gema) | Gap enorme | 9.05 eV directo en Γ | 103 s | 8.9–9.7 eV | 14.2 eV |
| NaCl (sal gema) | Iónico, PDOS Cl 3p | 5.10 eV directo en Γ | 165 s | 5.0–5.1 eV | 8.5–9.0 eV |
| Grafeno | Cono de Dirac en K | Sin smearing el SCF no converge en 50 ciclos (semimetal); con smearing de Fermi σ = 0.005 Ha converge en 6 ciclos y da gap 0 en K | 74 s con smearing | Gap 0 en K | Gap 0 |
| h-BN (monocapa) | Mismo esqueleto, gap abierto | 4.65 eV directo en K | 69 s | 4.6–4.7 eV | ≈ 6 eV (bulk) |
| Fe (bcc, FM) | Spin, momento, bandas ↑/↓ | 2.33 μB (DZVP-MOLOPT-SR, 6×6×6, σ = 0.01 Ha) | 402 s | 2.2–2.3 μB | 2.22 μB |
| Ni (fcc, FM) | Momento pequeño, sensible a k y smearing | 0.28 μB con 6×6×6 y σ = 0.01 Ha: **bajo**, necesita malla k más densa y σ menor | 543 s | ≈ 0.6–0.65 μB | 0.6 μB |
| NiO (AFM-II) | DFT+U, U de Cococcioni | Base mínima, 2×2×2: gap 1.04 / 1.50 / 1.80 / 1.99 eV y momento Mulliken 1.08 / 1.18 / 1.25 / 1.30 μB para U = 0 / 2 / 4 / 6 eV; AFM 0.9 eV más estable que NM por celda | NM 506 s; cada U 210–290 s | PBE: 0.5–1.0 eV, 1.2–1.4 μB; PBE+U(≈5–6): ≈ 3 eV, ≈ 1.7 μB; U lineal 4.6 eV (Cococcioni 2005), ≈ 5.6 eV (VASP, supercelda de 32 átomos) | 3.7–4.3 eV; 1.64–1.9 μB |
| MnO (AFM-II) | DFT+U con d⁵ | No medido (mismo flujo que NiO) | Similar a NiO | PBE ≈ 0.8–1.0 eV | 3.6–4.0 eV; 4.58 μB |

Notas sobre lo medido:
- La biblioteca final se calculará con DZVP también para NiO y MnO (aquí usé base mínima para medir el flujo en tiempo razonable).
- Los momentos de NiO son poblaciones de Mulliken en base mínima; la app usará la misma proyección MINAO que DFT+U, y el valor se moverá algo.

Fuentes de referencia: Paier et al. y compilaciones de benchmarks PBE (gaps de Si, C, LiF, NaCl, MgO); Cococcioni y de Gironcoli, PRB 71, 035105 (2005) (U lineal de NiO, FeO y Fe); tutorial de VASP de U lineal en NiO (supercelda de 32 átomos, U ≈ 5.6 eV).

---

## 7. Puente con SIESTA

- **Entrada:** `.TSHS` o `.HSX` (Hamiltoniano y solapamiento), `.fdf` (estructura y parámetros), `.out` (historial SCF, momentos, energía), y opcionalmente `.bands`, `.PDOS`, `.EIG`.
- **Qué hace la app:** con H(R) y S(R) de SIESTA calcula bandas en cualquier camino, DOS/PDOS en cualquier malla, velocidades y ε(ω) IPA con la misma rutina que usa para PySCF. Lo medí con un TSHS escrito y releído por sisl.
- **Qué no hace:** no corre SIESTA. El cálculo pesado sigue en el clúster.
- **Pendiente:** probar con un `.TSHS` real tuyo (ver sección 11).

---

## 8. Riesgos y limitaciones

| Riesgo | Qué pasa | Cómo lo manejo |
|---|---|---|
| **Velocidad en vivo** | Un SCF de NiO AFM con base mínima tarda 4–8 min en 4 núcleos; con DZVP será varias veces más. | Biblioteca precalculada. En vivo solo moléculas, Si/C/grafeno en modo rápido (SZV, malla k pequeña) y postproceso (bandas, DOS, ε) sobre densidades ya convergidas. La app avisa del costo antes de lanzar. |
| **Convergencia de magnéticos** | AFM desde semilla atómica divaga (lo vi en NiO). | Ruta guiada NM → rotura de simetría → +U → bajar U, con smearing y amortiguamiento. Se enseña como parte del módulo de spin. |
| **Base gaussiana en sólidos** | DZVP puede tener casi dependencia lineal (S con eigenvalor 0.002 en NiO DZVP); SZV da conducción mala. | Control del menor eigenvalor de S antes de cada cálculo; descarte de exponentes difusos si hace falta. SZV solo en modo rápido y etiquetado. |
| **Valores distintos de ondas planas** | Gaps y U no coinciden al 100 % con QE o VASP. | Cada valor se muestra con su base y su malla, junto al PBE de la literatura. Las diferencias se explican, no se esconden. |
| **U depende de la proyección** | El U de Cococcioni depende de qué orbitales d se usan (aquí MINAO ortogonalizados). | La app lo dice y muestra la sensibilidad. La PDOS usa la misma proyección, así que es coherente dentro de la app. |
| **U de Cococcioni en celda primitiva** | Perturbar un Ni de la celda de 4 átomos perturba toda su subred; el valor converge solo con supercelda. | Celda primitiva para la demostración en vivo; superceldas 2×2×2 precalculadas y la extrapolación mostrada. |
| **ε(ω) aproximada** | Partícula independiente: sin campos locales, sin excitones, sin el conmutador del pseudopotencial no local. | Regla f como control visible (7.92 de 8 en Si). Explicación de qué falta y hacia dónde movería el espectro. |
| **Sin acoplamiento espín-órbita** | GaAs y materiales pesados no muestran el desdoblamiento SOC. | Se indica en el material. SOC queda fuera de la primera versión. |
| **Grafeno y h-BN con vacío** | El vacío agranda la malla de integración y el costo. | Vacío mínimo razonable (≈12 Å) y precálculo. |
| **Archivos de SIESTA variados** | Versiones de SIESTA y opciones (spin no colineal, SOC) cambian los formatos. | Empezar con spin colineal y `.TSHS/.HSX` de SIESTA 4.1 y 5.x; probar con tus archivos reales antes de cerrar el módulo. |
| **Hardware del servidor** | Con 4 núcleos el precálculo completo tarda horas. | Precálculo una sola vez; en un servidor de 16–32 núcleos baja a una fracción. gpu4pyscf es opción futura. |
| **U de Cococcioni sin validar** | En celda primitiva dio 15 eV contra 4.6–5.6 eV de la literatura; la supercelda no convergió desde NM. | Supercelda desde densidad primitiva desplegada + SCF de segundo orden + base DZVP. Si aun así el valor no cae en 3–8 eV, la app mostrará la convergencia con el tamaño de supercelda y lo explicará, en lugar de esconderlo. |
| **Ni con momento bajo** | 0.28 μB con 6×6×6 y σ = 0.01 Ha, contra ≈0.6 μB. | Malla k ≥ 12³ y σ ≤ 0.003 Ha en la biblioteca; se convierte en ejercicio de convergencia. |

---

## 9. Orden de construcción (one-shot)

Cada fase termina con una prueba automática que compara contra los valores de la sección 6. No se pasa a la siguiente si falla.

**Fase 0. Esqueleto y entorno.** Repositorio con `backend/` (FastAPI + PySCF + ASE + sisl) y `frontend/` (Vite + TypeScript + Three.js + Plotly + KaTeX). Docker con versiones fijadas. Prueba: `/health` responde y el SCF de H₂ da la energía de referencia de PySCF.

**Fase 1. Motor y formato de resultado.** `engine/` con build_cell, scf (RKS/UKS, smearing), bands, dos, pdos, y el formato de resultado único en HDF5. Caché por hash. Prueba: Si da gap 0.6 ± 0.05 eV indirecto y MgO 4.6 ± 0.1 eV.

**Fase 2. Cola de trabajos y streaming.** ProcessPool + SQLite, WebSocket con cada ciclo SCF, cancelación y límites de tiempo. Prueba: un SCF de Si emite todos sus ciclos y se puede cancelar.

**Fase 3. Vistas enlazadas básicas.** Estructura 3D, zona de Brillouin con camino k, bandas, DOS/PDOS, historial SCF; selección compartida (k, banda, energía). Prueba: Playwright verifica que el hover en bandas resalta el k en la ZB y la energía en la DOS.

**Fase 4. Spin y gap.** UKS, bandas ↑/↓, momentos, ruta guiada para AFM. Prueba: Fe y Ni con momento dentro de ±0.15 μB del PBE de la literatura; NiO AFM más estable que NM.

**Fase 5. ε(ω).** Elementos de matriz de momento, ε₂, Kramers–Kronig, regla f, descomposición por (k, v, c) enlazada con las bandas. Prueba: Si con ε∞ entre 12.5 y 14.5 y regla f ≥ 7.8 de 8.

**Fase 6. DFT+U y U de Cococcioni.** Barrido de U, perturbación de un solo sitio, matrices χ₀ y χ, gráfica N(α). Prueba: el gap de NiO sube de forma monótona con U; el U lineal con supercelda y DZVP cae en 3–8 eV para NiO (si no, se documenta la convergencia con el tamaño de supercelda).

**Fase 7. Puente SIESTA.** Lectura con sisl de `.TSHS/.HSX/.fdf/.out` al formato único; bandas, PDOS y ε(ω) con la misma rutina. Prueba: con un TSHS de referencia, las bandas coinciden con el `.bands` de SIESTA.

**Fase 8. Biblioteca y precálculo.** Script que calcula todos los materiales de la sección 6 con sus pruebas de convergencia y guarda resultados. Prueba: tabla de control generada sola; cada material dentro de la tolerancia de su valor PBE.

**Fase 9. Contenido didáctico.** Textos, ecuaciones con números sustituidos y recorridos guiados por módulo, en español. Prueba: revisión tuya módulo por módulo.

**Fase 10. Pulido y despliegue.** Modo claro/oscuro, móvil, rendimiento, manual de instalación y de uso para el curso.

---

## 10. Hardware y despliegue

- **Servidor recomendado:** Linux con 16–32 núcleos y 32–64 GB de RAM (un nodo modesto del laboratorio o de la universidad). Los alumnos solo usan el navegador; no instalan nada.
- **Laptop:** sirve para desarrollo y para el modo rápido (moléculas, Si/C con SZV), no para precalcular la biblioteca.
- **Precálculo de la biblioteca:** con lo medido en 4 núcleos, los no magnéticos tardan de 1 a 7 min cada uno con DZVP, Fe y Ni de 7 a 9 min, y NiO con base mínima unos 25 min por barrido completo de U. Con DZVP, superceldas para la U lineal y mallas k más densas, estimo una o dos noches en 4 núcleos y unas pocas horas en 32 núcleos. Es una sola vez; luego todo sale de la caché.
- **Instalación:** `pip install pyscf ase sisl fastapi` en Python 3.11+; el frontend se compila a archivos estáticos. Un `docker compose up` levanta todo.
- **GPU (opcional, futuro):** gpu4pyscf acelera DFT con bases gaussianas; no lo probé aquí.

---

## 11. Decisiones que necesito de ti

1. **Dónde va a correr.** Recomiendo un servidor del laboratorio o de la universidad, con los alumnos entrando por navegador. La alternativa es que cada quien lo instale en su laptop, que limita la app al modo rápido.
2. **Archivos reales de SIESTA.** Para cerrar el puente necesito uno o dos cálculos tuyos: `.TSHS` (o `.HSX`), `.fdf` y `.out`, de preferencia uno no magnético y uno con spin.
3. **Base de la biblioteca.** Recomiendo DZVP (lo medido aquí). TZVP mejora la conducción pero cuesta 2–3 veces más.
4. **Alcance de la primera versión.** Recomiendo dejar fuera SOC, spin no colineal, híbridos y GW; entran en una segunda versión.
5. **Idioma.** Recomiendo español con el término en inglés entre paréntesis la primera vez (por ejemplo, "densidad de estados proyectada (PDOS)"), para que los alumnos reconozcan lo que verán en artículos y en SIESTA.

Cuando apruebes el plan (con o sin cambios en estas cinco decisiones), arranco la construcción por el orden de la sección 9.

---

## 12. Ampliación (9 oct, después de tu revisión): cristalografía, seekpath y dos modos

### 12.1 Medido para esta ampliación

| Prueba | Resultado |
|---|---|
| Leer CIF con ASE | GaAs convencional, 8 átomos, leído sin pérdida |
| spglib: grupo espacial | F-43m (216), 96 operaciones en la celda convencional, posiciones de Wyckoff a y c |
| spglib: celda primitiva | 8 → 2 átomos |
| seekpath: camino k | Red cF2, camino Γ–X–U, K–Γ–L–W–X; 0.04 s |
| seekpath → PySCF | Si en la celda primitiva estándar de seekpath: gap 0.61 eV, CBM al 84 % de Γ→X, 166 puntos k en 17 s. Coincide con el cálculo anterior |
| Supercelda 2×2×2 | 64 átomos, sigue en F-43m |
| Rotura de simetría | Mover un átomo 0.05 Å → Cmm2 (35); sustituir un Ga por Zn → P-43m (215) |
| Tolerancia (symprec) | Con un átomo movido 0.01 Å: symprec 10⁻⁴ y 10⁻³ dan Cmm2; 2·10⁻² recupera F-43m |
| XYZ y XYZ extendido | XYZ simple = molécula sin celda; XYZ extendido conserva la red |
| Orden magnético | NiO no magnético Fm-3m (225); al distinguir Ni↑ y Ni↓ baja a R-3m (166), que es la celda AFM-II que usé |
| sisl, capacidades extra | Tiene COOP/COHP (`COP`), fase de Berry, conductividad, Hall anómalo, funciones de onda en malla real, momento de spin, y escribe `BandLines` para el fdf |

Todo con spglib 2.7.0 y seekpath 2.2.2. Script: `pruebas/sym/symtest.py` y `pruebas/sym/sp_pyscf.py`.

### 12.2 Geometría y simetría (entra en los dos modos)

- **Entrada:** CIF, XYZ, XYZ extendido, POSCAR, `.fdf`/`.XV`/`.STRUCT_OUT` de SIESTA (ASE y sisl leen todos).
- **Visor 3D (Three.js):** átomos y enlaces, celda unitaria, celda convencional y primitiva superpuestas, poliedros de coordinación, medición de distancias y ángulos, repetición visual de la celda.
- **Simetría (spglib):** grupo espacial y puntual, operaciones dibujadas en 3D (ejes de rotación, planos espejo, centro de inversión), posiciones de Wyckoff coloreadas, y un deslizador de tolerancia que muestra cómo una estructura "casi simétrica" cambia de grupo.
- **Reducir o estandarizar:** convencional → primitiva → estándar de seekpath, con la matriz de transformación visible. Celda de Niggli para comparar estructuras.
- **Superceldas N×N×N y N×M×L** (y matrices generales): con el grupo espacial recalculado en vivo. El alumno ve que la supercelda perfecta conserva el grupo, y que un defecto, un desplazamiento o un orden magnético lo rompe.
- **Zona de Brillouin y camino k con seekpath:** la ZB 3D con los puntos de alta simetría etiquetados, el camino resaltado, y la explicación de por qué el camino depende de la red de Bravais (y de la orientación estándar). Para AFM y superceldas, la ZB plegada junto a la original.

### 12.3 Modo Aprender (didáctico, pero con cálculos reales)

Los módulos 1–9 de la sección 5, más estas opciones:
1. **Cristalografía primero:** del CIF al grupo espacial, a la primitiva y al camino k, antes de cualquier SCF.
2. **Plegado de bandas:** las bandas de Si en la celda primitiva frente a las de la supercelda 2×2×2, para entender por qué una supercelda "tiene más bandas", y el desplegado (unfolding) que las recupera.
3. **Laboratorio de convergencia guiado:** el alumno elige malla k o corte, predice el resultado y lo compara con el cálculo.
4. **"Rompe la simetría":** sustituir un átomo, mover otro o imponer orden magnético, y ver cómo cambian grupo, ZB, degeneraciones y gap.
5. **Problemas con respuesta verificable:** ejercicios donde el alumno calcula algo (masa efectiva, gap, ε∞) y la app lo compara con el cálculo real.
6. **Cuaderno de cálculo exportable:** cada sesión genera el script de PySCF equivalente, para que el alumno lo reproduzca fuera de la app.

### 12.4 Modo Postprocesar (tus cálculos reales de SIESTA)

1. **Carga del cálculo:** carpeta o archivos `.fdf`, `.TSHS/.HSX`, `.out`, `.XV`, `.bands`, `.PDOS`, `.RHO`, `.VH`, `.EIG`.
2. **Bandas en cualquier camino seekpath** a partir de H y S, sin volver al clúster; bandas gordas por átomo, orbital y spin.
3. **DOS y PDOS** en cualquier malla k y ensanchamiento; PDOS agrupada por especie, sitio o momento angular.
4. **COOP/COHP** desde H y S con sisl: carácter enlazante o antienlazante por par de átomos.
5. **Densidad de carga y potencial** (`.RHO`, `.VH`): isosuperficies 3D, cortes, promedio planar y macroscópico (función trabajo, alineamiento de bandas en interfaces).
6. **Funciones de onda en malla real** para estados elegidos (en Γ o en cualquier k).
7. **ε(ω) IPA** con la misma rutina que la parte didáctica.
8. **Desplegado de bandas** de superceldas con defectos (Popescu–Zunger con H y S). No lo probé; sisl no lo trae, así que habría que implementarlo.
9. **Auditoría de convergencia:** lee varios `.out` y grafica energía, gap y fuerzas contra malla k, MeshCutoff o base.
10. **Comparación lado a lado** de dos o más cálculos (por ejemplo, con y sin U, o dos superceldas).
11. **Generador de entradas para el clúster:** escribe el `.fdf` con la estructura estandarizada, la supercelda, `%block BandLines` de seekpath y `%block kgrid_Monkhorst_Pack`. Así el camino k de SIESTA y el de la app son el mismo.
12. **Figuras para publicación:** exportación a SVG o PDF con estilo consistente, y los datos en CSV.

### 12.5 Cómo cambia el orden de construcción

- La **fase 1** gana la lectura de estructuras, spglib, seekpath y las superceldas (todo probado).
- La **fase 3** gana el visor 3D completo y la ZB de seekpath.
- La **fase 7 (SIESTA)** pasa a ser el modo Postprocesar completo y se divide en dos: 7a (bandas, PDOS, COOP/COHP, densidad, potencial, generador de fdf) y 7b (desplegado de bandas y auditoría de convergencia).
- Las opciones 2–6 del modo Aprender entran en la **fase 9**.
