# DFT Lab: mapa completo de contenidos

*Todo lo que ocurre en un cálculo de estructura electrónica, en el orden en que ocurre, y cómo lo vería y manipularía el usuario con cálculos reales de SIESTA.*

9 oct 2026. Lo marcado **medido** se corrió aquí con SIESTA 5.4.2 (conda-forge, con Lua y libxc) en 4 núcleos. Complementa a [PLAN_DFT_App.md](PLAN_DFT_App.md) y al [prototipo de Si](prototipo_si/dft_lab_si.html).

---

## Idea central

La app sigue la cadena real del cálculo. Cada eslabón se abre en tres capas:

1. **Qué es:** la ecuación y su significado físico, en una pantalla.
2. **Cómo lo hace SIESTA:** el algoritmo, las palabras clave del fdf que lo controlan y las líneas del `.out` donde aparece.
3. **Experimento real:** el usuario cambia un parámetro, SIESTA corre y se ve el efecto. Nada es animación: todo sale de un cálculo.

La pieza que hace posible la tercera capa es **el hook de Lua de SIESTA (medido)**. Con `LUA.Script`, SIESTA llama a un script en cada iteración del SCF. Probé que el script lee la energía total en cada ciclo y que puede **cambiar el peso del mezclador a mitad del SCF**: pasé de 0.25 a 0.6 en el ciclo 5 y el SCF terminó en 12 ciclos en lugar de 19. Eso permite un "SCF en vivo" donde el alumno ve cada iteración y la modifica mientras corre.

---

## A. Antes del SCF: qué se está resolviendo

### A1. Del problema de muchos cuerpos a Kohn–Sham
- Born–Oppenheimer → teoremas de Hohenberg–Kohn → sistema auxiliar de Kohn–Sham que reproduce la misma densidad.
- Experimento: una molécula pequeña (H₂, CO) con la densidad real y los orbitales KS, para separar "orbitales KS" de "funciones de onda reales".

### A2. Funcional de intercambio-correlación
- Qué aproxima: E_xc es todo lo que no sabemos escribir exactamente (intercambio de Pauli, correlación, parte cinética no clásica). El hueco de XC y por qué la LDA funciona mejor de lo esperado (cumple la regla de suma del hueco).
- **LDA:** ε_xc del gas homogéneo (Ceperley–Alder, parametrizado por PZ/PW92). Funciona bien en sólidos compactos y metales sp; sobreenlaza (a ~1 % corto, B₀ alto, cohesión sobreestimada).
- **GGA (PBE):** añade el gradiente reducido s mediante el factor F_x(s) (≤ 1.804). Mejora moléculas y energías de atomización; subenlaza en sólidos (a ~1 % largo). PBEsol recupera las constantes de red.
- **Lo que ninguno corrige:** gap subestimado (falta la discontinuidad derivativa), autointeracción (estados d/f demasiado deslocalizados, motiva DFT+U), y la dispersión (van der Waals).
- Mención con contexto: meta-GGA (SCAN), híbridos (PBE0, HSE06, B3LYP) y su efecto en el gap, vdW-DF y correcciones D3, DFT+U.
- Gráficas: ε_x y ε_c contra r_s, F_x(s) de PBE frente a PBEsol, mapa de s(r) en el cristal real (dónde la GGA se separa de la LDA), y la tabla a₀/B₀/E_g LDA vs PBE calculada con SIESTA.

### A3. Pseudopotenciales (datos verificados)
- Qué son: el core no participa en el enlace; se reemplaza por un potencial suave que reproduce las energías y la cola de la función de valencia fuera de r_c. Norma conservada (TM, ONCV), ultrasoft y PAW como concepto.
- Gráficas reales, leídas del archivo (ya probado con Si.psml y O.psf, ver [figura](pseudo_xc/pseudo_xc_real.png)):
  - V_l(r) por canal s, p, d, f, que se unen a −Z_val/r justo en r_c (Si: r_c = 1.89 Bohr).
  - Funciones pseudo sin nodos dentro de r_c, y la carga de valencia (integra a 4.000 e).
  - Carga de core parcial (corrección no lineal) cuando el pseudo la trae.
  - Separación local + no local de Kleinman–Bylander y proyectores.
- Herramientas: comparador de dos pseudos (LDA vs PBE, duro vs suave), lector de cabecera (configuración, r_c por canal, funcional), ondas parciales de prueba a energías distintas (derivada logarítmica) y detector de estados fantasma.

### A4. La base: orbitales atómicos numéricos
- SZ, DZ, DZP; radio de confinamiento (`PAO.EnergyShift`), `PAO.SplitNorm`, orbitales de polarización.
- Comparación con ondas planas y gaussianas: qué se gana y qué se pierde (BSSE, fuerzas de Pulay).
- Experimento: las funciones radiales reales del `.ion` y la curva de convergencia de energía, a y gap contra base y EnergyShift.

### A5. Mallas y muestreo
- MeshCutoff: la malla en espacio real para V_H y V_xc; efecto *eggbox* (la energía cambia al desplazar todo el cristal).
- Puntos k: Monkhorst–Pack, Γ, desplazamientos, zona irreducible; convergencia en aislantes frente a metales.
- Smearing: Fermi–Dirac, Methfessel–Paxton, temperatura electrónica; energía libre frente a energía total.
- Experimento: curvas de convergencia reales y el eggbox medido moviendo un átomo por la malla.

---

## B. El ciclo SCF: el corazón

### B1. Anatomía de una iteración
Diagrama vivo, con cada caja clicable y los datos reales de la iteración n:

ρ_in (o H_in) → V_H por Poisson (FFT) + V_xc → H_KS = T + V_NL + V_na + δV_H + V_xc → **resolver** H c = ε S c → ocupaciones y nivel de Fermi → ρ_out (matriz densidad) → **mezclar** → ρ_in siguiente

En cada caja se ve el número que SIESTA calculó en ese ciclo: E_F, ΔDM máximo, ΔH máximo, energía de bandas y carga.

### B2. La energía total y sus términos (medido)
SIESTA imprime la descomposición completa. Para Si (LDA, DZP), en eV:

| Término | Valor | Qué es |
|---|---|---|
| Ebs | −78.07 | Suma de bandas, Σ f_n ε_n |
| Ekin | 82.62 | Energía cinética de los orbitales KS |
| Enl | 39.43 | Parte no local del pseudopotencial |
| Ena | 215.96 | Átomo neutro (local + Hartree de los átomos) |
| DEna, DUscf | 3.18, 0.36 | Correcciones de Hartree por la redistribución de carga |
| Ex, Ec | −55.08, −10.18 | Intercambio y correlación |
| Eions | 491.94 | Constante de iones (autoenergías) |
| **Etot** | **−215.64** | Energía de Kohn–Sham |
| Eharris | −214.66 | Funcional de Harris (en la primera iteración) |

- Experimento: ver cada término por iteración (gráfica apilada) y cómo Harris y Kohn–Sham convergen al mismo valor por lados distintos. Explica por qué la energía converge más rápido que la densidad (es variacional: el error es de segundo orden).
- Energía de cohesión, de formación y de adsorción como diferencias de energías totales, con los errores típicos (BSSE, referencia atómica con spin).

### B3. Algoritmos de mezcla (medido)
Si, mismo cálculo, solo cambia el mezclador:

| Mezclador | Ciclos | Tiempo |
|---|---|---|
| Lineal, peso 0.05 | 89 | 46 s |
| Lineal, 0.25 | 19 | 12.5 s |
| Lineal, 0.60 | 9 | 6.8 s |
| Lineal, 0.95 | 8 | 6.1 s |
| Broyden, 0.25 (historia 6) | 15 | 10.1 s |
| **Pulay, 0.25 (historia 6)** | **6** | **5.6 s** |
| Pulay, mezclando DM en vez de H | 7 | 6.4 s |
| Lineal 0.25, mezclando DM en vez de H | 43 | 24.8 s |

- Teoría: el SCF como problema de punto fijo; el mezclado lineal como iteración amortiguada; Pulay/DIIS como minimización del residuo en el subespacio de iteraciones previas; Broyden como Jacobiano aproximado.
- Por qué mezclar H converge mejor que mezclar ρ (la tabla lo muestra: lineal 0.25 tarda 19 ciclos con H y 43 con DM).
- Experimento: el alumno elige el mezclador y su historia, y ve el residuo por iteración en escala log; con el hook de Lua puede cambiarlo a mitad del ciclo.

### B4. Oscilaciones y divergencias (medido)
Mg metálico, supercelda alargada de 16 átomos:
- **Pulay:** converge en 5 ciclos (6 s). **Broyden:** 10 ciclos (9 s).
- **Lineal 0.5:** se acerca a la solución en los primeros 8 ciclos, luego la energía salta a +3300 eV y oscila sin converger; 150 ciclos y SIESTA aborta.
- **Lineal 0.1:** más lento, pero también diverge, alrededor del ciclo 50.

Este es el caso de estudio para enseñar inestabilidad del SCF en metales: por qué la respuesta dieléctrica de un metal amplifica los errores de larga longitud de onda (*charge sloshing*), qué hacen el preconditioning de Kerker (en códigos de ondas planas), el smearing y los mezcladores con historia. Otros casos que la app traería precalculados: magnéticos que saltan entre soluciones (NiO, Fe), superficies y slabs, sistemas con estados degenerados en el nivel de Fermi.

### B5. Resolver el problema de valores propios (medido)
- Diagonalización densa (LAPACK/ScaLAPACK, ELPA, MRRR), escalado O(N³).
- Métodos de orden N con funciones de Wannier localizadas (Kim, OMM) y PEXSI; cuándo convienen.
- Métodos iterativos de los códigos de ondas planas (Davidson, CG, RMM-DIIS), para entender la diferencia con SIESTA.
- Medido en Si de 64 átomos (Γ, DZP): diagonalización 85 s; OMM 527 s; misma energía (−6893.9534 y −6893.9535 eV). A este tamaño la diagonalización gana; la app mostrará dónde se cruzan las curvas al crecer el sistema.

### B6. Criterios de convergencia
- `DM.Tolerance`, `DM.Energy.Tolerance`, `SCF.H.Tolerance`, energía libre. Qué tolerancia hace falta para energías, para fuerzas y para fonones.
- Experimento: fuerzas contra tolerancia del SCF.

---

## C. Lo que se calcula con la solución

1. **Fuerzas y estrés:** Hellmann–Feynman más las fuerzas de Pulay (aparecen porque la base se mueve con los átomos). Relajación con CG, FIRE y BFGS, viendo la trayectoria en 3D.
2. **Ecuación de estado:** E(V) → Birch–Murnaghan → a₀ y B₀, comparados con el experimento y entre funcionales.
3. **Bandas, DOS, PDOS, bandas gordas y masas efectivas** (ya en el prototipo).
4. **Densidad y cargas:** ρ, diferencia ρ − Σρ_atómica (dónde se forma el enlace), Mulliken, Hirshfeld y Voronoi (SIESTA las imprime), con sus limitaciones.
5. **Potencial electrostático:** promedio planar y macroscópico, función trabajo, alineamiento de bandas en interfaces.
6. **Spin:** colineal, no colineal y espín-órbita; momentos; AFM frente a FM.
7. **DFT+U y U lineal de Cococcioni.**
8. **Óptica:** ε(ω) y su descomposición en transiciones (ya en el prototipo).
9. **Fonones** por diferencias finitas (`MD.TypeOfRun FC`) y dinámica molecular corta.
10. **Más allá de DFT:** híbridos, GW, BSE, solo como concepto y comparación de gaps.

---

## D. Práctica profesional

- **Lectura anotada del `.out`:** el archivo real de SIESTA con cada bloque explicado al pasar el cursor.
- **Protocolo de convergencia** antes de cualquier resultado publicable, generado y verificado por la app.
- **Errores típicos:** estados fantasma, eggbox, BSSE, dependencia lineal de la base, smearing excesivo en metales, AFM atrapado en un mínimo local.
- **Reproducibilidad:** cada figura lleva su procedencia (versión, fdf, pseudos, mallas).

---

## E. Herramientas y calculadoras (sin cuestionarios)

Pensadas para que el alumno las use como instrumento y Manuel en su trabajo diario.

- **Calculadora de gas de electrones:** n → r_s, k_F, E_F, ω_p (frecuencia de plasma), longitud de Thomas–Fermi. Sirve para entender LDA, smearing y óptica de metales.
- **Conversor de unidades:** Ry, Ha, eV, kJ/mol, K, cm⁻¹, nm, Bohr/Å, GPa/eV·Å⁻³.
- **Malla k:** a partir de la celda y la densidad deseada (puntos por Å⁻¹) propone la malla Monkhorst–Pack y dice cuántos puntos irreducibles quedan tras la simetría (spglib).
- **MeshCutoff ↔ espaciado de malla** y ↔ cutoff equivalente de ondas planas.
- **Ecuación de estado:** pegar E(V) o subir varios .out, ajuste Birch–Murnaghan con a₀, B₀, B′ y su incertidumbre.
- **Masa efectiva** desde las bandas: clic en un extremo y ajuste parabólico por dirección (tensor m*).
- **Energías de formación y de cohesión**, con la referencia atómica y química correcta.
- **Ocupaciones y smearing:** funciones Fermi–Dirac, Gauss, Methfessel–Paxton y Marzari–Vanderbilt superpuestas, con la entropía y el error en la energía.
- **Celda y simetría:** primitiva ↔ convencional ↔ supercelda N×N×N, grupo espacial, Wyckoff, zona de Brillouin y camino seekpath en 3D.
- **Generador de fdf** con comentarios en cada palabra clave, y **lector anotado del .out**.
- **Asistente de convergencia:** genera los barridos (k, MeshCutoff, base, EnergyShift), los corre y marca dónde se cumple la tolerancia pedida.
- **Glosario vivo:** cada término (r_s, r_c, DZP, Pulay...) enlaza a su pantalla de teoría y a la gráfica donde se ve.

---

## F. Lo que la vuelve "wow" y adoptable como curso formal

### F1. Visualizaciones que no tiene ningún curso
- **Clic en una banda → su función de onda en 3D.** Se toma el punto (n, k) de la gráfica de bandas y sisl calcula ψ_nk(r) en la malla real; se ve la isosuperficie con su fase. Enlaza bandas, carácter orbital y enlace químico en un solo gesto.
- **Densidad convergiendo en vivo:** ρ(r) y la diferencia ρ − Σρ_atómica, iteración por iteración del SCF (vía el hook de Lua).
- **Superficie de Fermi 3D** de metales reales (Cu, Al, Mg), coloreada por velocidad de Fermi.
- **Fonones animados:** clic en una rama de la dispersión y los átomos vibran con ese modo en el visor 3D.
- **Relajación y dinámica molecular** como película, con energía y fuerzas sincronizadas.
- **Imagen STM simulada** (Tersoff–Hamann, a partir de la LDOS de SIESTA) de una superficie o de grafeno con un defecto.
- **Cono de Dirac del grafeno** como superficie 3D E(k_x, k_y), y la apertura del gap en h-BN.
- **Densidad de spin 3D** de NiO antiferromagnético, con y sin U.
- **Desdoblamiento de bandas (unfolding)** de una supercelda con defecto para ver cómo se rompen las bandas del cristal perfecto.

### F2. Puentes de teoría
- **Laboratorio de tight-binding:** el alumno ajusta parámetros de Slater–Koster y ve su modelo sobre las bandas DFT reales. Conecta el curso de estado sólido con DFT.
- **Derivaciones paso a paso:** Hohenberg–Kohn por reducción al absurdo, ecuaciones de Kohn–Sham por variación, teorema de Janak, Hellmann–Feynman. Cada paso se despliega y enlaza a la gráfica donde se ve.
- **Fase de Berry:** polarización y curvatura de Berry en h-BN con sisl, como entrada a materiales topológicos.
- **Historia de la DFT:** de Thomas–Fermi (1927) a Kohn–Sham (1965), Nobel de Kohn (1998) y la escalera de Jacob, con los artículos originales.

### F3. "Reproduce el artículo"
Prácticas que reproducen resultados clásicos con SIESTA: ecuación de estado del Si (Yin y Cohen, 1980), bandas del grafeno, gap de NiO con DFT+U (Dudarev / Cococcioni). El alumno compara su figura con la publicada.

### F4. Laboratorio colectivo (para el aula)
- El profesor lanza un experimento y cada alumno corre un punto (un volumen, una malla k, un valor de U). La curva del grupo se arma en vivo en la pantalla del salón.
- Panel del profesor: quién corrió qué, con qué parámetros, y dónde divergió el SCF de cada uno.

### F5. Lo que pide una universidad para adoptarlo
- **Temario oficial** en tres niveles: licenciatura (16 semanas, conceptos y Si/grafeno), maestría (metales, magnetismo, óptica), doctorado (DFT+U lineal, fonones, superficies, protocolo publicable).
- **Una práctica por semana** con objetivo, fundamento, procedimiento real y análisis. Se evalúa con la bitácora, no con cuestionarios.
- **Bitácora exportable:** cada experimento genera un reporte con figuras, fdf, pseudos, versión y tiempos, listo para entregar o adjuntar a una tesis.
- **Bilingüe** español/inglés, y referencias bibliográficas por pantalla (Martin, Kohanoff, Giustino, artículos de SIESTA).
- **Instalación de laboratorio:** un servidor del departamento con SIESTA y la app, y los alumnos solo usan el navegador. Estimador de costo (tiempo y memoria contra número de átomos) para planear clases.

---

## Qué cambia en la arquitectura

- **SIESTA como motor en vivo**, con el hook de Lua para transmitir cada iteración a la interfaz y recibir cambios del usuario.
- **Biblioteca de "experimentos" precalculados** para lo que tarda: superceldas, metales difíciles, magnéticos y barridos de convergencia.
- PySCF queda solo como apoyo para lo que SIESTA no expone. Ya no es el motor principal.

## Pendiente de medir

- Orden N con el funcional de Kim en Si de 64 átomos: no terminó el primer ciclo SCF en 15 min (la minimización CG de las funciones de Wannier avanzaba muy lento). Hay que ajustar `ON.eta` y `ON.RcLWF`, o mostrarlo como ejemplo de por qué orden N solo conviene en sistemas grandes y bien parametrizados.
- Cuánto se puede extraer del hook de Lua aparte de las energías (matriz densidad y Hamiltoniano por iteración), para dibujar ρ(r) convergiendo.
- Superficies y slabs como caso de oscilación de carga más claro.
