# ¿Tiene sentido la ruta? Viabilidad deducida de lo que SIESTA escribe y de la matemática

Anexo de [BACKLOG_V21.md](BACKLOG_V21.md). Las referencias [R] apuntan a `app/dftlab/static/js/siesta/README.md` y a los fixtures de `app/tests/siesta/fixtures/`.

Fecha: 2026-10-11. Criterio de Manuel: no "creer" que SIESTA puede, sino partir de qué archivos y datos produce y qué cálculo permiten.

Etiquetas de evidencia:
- **[R]** leído en el repo (`app/dftlab/static/js/siesta/README.md`, fixtures y `.fdf` reales).
- **[M]** deducido de la matemática de la magnitud.
- **[C]** conocimiento mío de SIESTA, **a confirmar en el manual de la versión fijada**.

## 1. Qué produce SIESTA físicamente
| Dato | Archivo | Evidencia |
|---|---|---|
| Energía total y su descomposición (Ekin, Hartree, Exc, ion-ion, **Edftu**, **D3**, Eso, campo externo), Fermi | `.out` | [R] `energyDecomposition`, `finalEnergy` |
| Fuerzas (eV/Å), tensor de esfuerzos, presión, **energía de eggbox** por paso | `.out`, `.FA` | [R] `forces`, `stress`, `eKSeggbox` |
| Cargas Mulliken, Hirshfeld, Voronoi, momento de espín (total y por átomo y orbital) | `.out` | [R] `populations`, `spinMoment` |
| Autovalores por k, bandas, DOS, PDOS por orbital | `.EIG`, `.KP`, `.bands`, `.DOS`, `.PDOS` | [R] |
| ε₂(ω) y **contribuciones por transición** (SIESTA 5) | `.EPSIMG`, `.contrib.EPSIMG` | [R] `parseContribEPSIMG` |
| Constantes de fuerza por desplazamientos | `.FC` | [R] `parseFC`, `physics/phonon.js` |
| Trayectorias, relajación | `.XV`, `.STRUCT_OUT`, `.ANI`, `.MDE` | [R] |
| Densidad y potenciales en malla | `.RHO`, `.DRHO`, `.VH`, `.VT` | [R] `rho.js: parseGrid` |
| H, S, matriz de densidad, coeficientes de onda | `.TSHS/.HSX/.DM/.WFSX` (binarios) | [R] solo vía `scripts/dftlab_pack.py` |
| Orbitales atómicos, **densidad de core**, proyectores KB | `.ion`, `.ion.xml` | [R] `parseIon` (`core {r,f}`) |

Límites estructurales [M]: pseudopotenciales (no hay niveles de core ni densidad de todos los electrones); base incompleta (diferencias de energía entre entornos distintos dependen de la base); sin híbridos ni GW en la versión principal [C].

## 2. Ruta por ruta
| Ruta | Datos de entrada necesarios | Veredicto | Por qué y qué comprobar |
|---|---|---|---|
| Fonones, ZPE, F_vib(T) | `.FC` | **Sí, ya hecho** | [R] Si 2×2×2: Γ óptico 15.64 THz (exp 15.53), error medio 3.2 %. |
| Electrónica, fatbands, masas, COHP | `.EIG/.bands/.PDOS`, H y S | **Sí** | [M] COHP_μν = Σ c·c·H_μν es exacto en base localizada; pack ya extrae COOP/COHP [R]. |
| Óptica ε(ω), Tauc | `.EPSIMG` | **Sí** | Solo da ε₂; ε₁ por Kramers-Kronig truncado [R], lo que sesga ε∞ y el límite estático. Gap subestimado. |
| ε(ω) por pares de banda y k (idea de "clic en el pico") | `.contrib.EPSIMG` | **Sí, más barato de lo que dije** | Corrijo mi afirmación anterior de que SIESTA solo da ε total: existe archivo por transición en SIESTA 5 [R]. |
| Elasticidad C_ij | tensor de esfuerzos | **Sí** | [M] C_ij = dσ/dε por ajuste lineal; validar con Si contra experimento; exigir MeshCutoff convergido porque la presión tiene ruido de eggbox. |
| Formación y casco convexo | E_tot de fases y elementos | **Sí, con cuidado** | [M] ΔH_f es diferencia de energías de sistemas distintos: exige misma base por especie, mismos pseudos/XC y celda relajada con base fija a la celda de partida; comparar con y sin +U (Edftu) no es válido sin correcciones. |
| T,p finitas, ab initio de superficies | E_tot + `.FC` de sólido y gas | **Sí** | [M] Álgebra de μ(T,p) más F_vib; cuesta fonones del gas. |
| Energía de superficie, Wulff | E_tot de slabs | **Sí, con ruido** | [M] γ = (E_slab − N·E_bulk)/2A amplifica el error de E_bulk con N; método Boettger resta energías grandes: exigir convergencia en espesor. |
| Función de trabajo | `.VH`/`.VT` en vacío, E_F | **Probable** | [M] Φ = V_vac − E_F; [C] confirmar que `.VH` y E_F comparten referencia; validar con un metal conocido (Al(111) ≈ 4.2-4.3 eV exp.). Corrección dipolar para slabs asimétricos [C]. |
| Adsorción | E_tot, `.FC` parcial | **Sí, con BSSE** | [M] ΔE_ads sobre-enlaza por base de adsorbato prestada por el sustrato; contrapeso con átomos fantasma [C: número atómico negativo en la lista de especies]. |
| CHE, volcán, diagramas | solo energías y ZPE | **Sí** | [M] Álgebra; límites son del funcional (O₂ en GGA) y del modelo sin solvente. |
| NEB (difusión, reacción) | fuerzas por imagen | **Sí, con límite** | [M] Las fuerzas con eggbox limitan la precisión; usar `eKSeggbox` como compuerta [R] y MeshCutoff alto. |
| Voltaje OCV de baterías | E_tot con +U | **Sí** | [R] el repo ya corre PBE+U en NiO; mismo U en todas las lítiaciones. |
| Magnetismo, energía de intercambio | E_tot por configuración, momentos | **Sí** | [R] hay Fe y NiO FM/AFM; J_ij por TB2J necesita H, S binarios [C]. |
| Bader | ρ en malla + densidad de core | **Posible, con cuidado** | [M] Sin la densidad de core la partición cerca del núcleo no está bien definida; [R] `parseIon` ya expone `core`, así que se podría sumar. SIESTA tiene opción propia para volcar la carga con core [C]. |
| ELF | orbitales ocupados en malla | **Posible, implementación propia** | [M] ELF necesita τ = ½Σ\|∇ψ\|², y los ψ salen de los coeficientes de onda × orbitales atómicos, que el repo ya sabe reconstruir (`si_wf.json`) [R]. No aceptaría como cierto que critic2 lo lea de SIESTA. |
| RDG/NCI, Δρ | densidades en malla | **Sí** | [M] s = \|∇ρ\|/(2(3π²)^{1/3}ρ^{4/3}); Δρ es resta en la misma malla. |
| Defectos cargados | E_tot, ΔV en malla, ε₀ | **Parcial, con un hueco** | [M] FNV necesita la constante dieléctrica **estática** ε₀ = ε∞ + ε_ion. ε∞ sale de la óptica; ε_ion requiere cargas de Born, que no están en tus lectores. En SIESTA hay polarización por fase de Berry [C], pero habría que construir ese flujo. Además el gap subestimado falsea los niveles dentro del gap [M]. |
| Offsets de banda (VBO) | VBM de cada bulk + potencial macroscópico | **Sí, pero NO como lo propone el informe** | [M] El informe usa niveles de core; con pseudopotenciales no hay niveles de core. Hay que usar el método del potencial electrostático promedio. |
| Pourbaix | energías sólidas + datos acuosos | **Parcial** | [M] Los datos acuosos no salen de SIESTA. |

## 3. Compuertas automáticas que sugiere esta lectura (baratas, alto valor)
1. **Eggbox:** el parser ya extrae `eKSeggbox`; rechazar resultados donde supere un umbral definido por política.
2. **Base:** repetir un caso pequeño con base mayor (DZP→TZP) y reportar el cambio en la magnitud final.
3. **Consistencia de energía total:** misma base por especie, mismo XC, mismos pseudos y mismas mallas en toda diferencia de energías; fallar el flujo si no.
4. **Referencias:** cada campaña lleva un caso de validación con valor experimental o publicado (Si fonones, Al función de trabajo, Si elasticidad).
5. **+U:** no mezclar energías con y sin Edftu en un casco.

## 4. Lo que corrijo de mi parte
- Dije que SIESTA solo entrega ε total: existe `.contrib.EPSIMG` [R].
- Dije que la idea de clic en el pico necesitaba un cálculo nuevo y caro: con ese archivo podría ser lectura y suma.
