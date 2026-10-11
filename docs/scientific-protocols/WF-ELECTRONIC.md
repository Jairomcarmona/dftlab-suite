# Ficha de entrada: WF-ELECTRONIC fino (T-036: fat bands y masas)

Estado: **borrador para aceptar antes del código**. Bandas, DOS y PDOS ya existen en QRAFT (protocolo M7, `siestaflow.siesta.band-structure` y `siestaflow.siesta.dos-pdos`). Esta ficha cubre lo que falta. Dueño propuesto: QRAFT ([ADR-018](../adr/ADR-018-autoridad-protocolos-siesta-eos-electronica-superficie.md), opción A). Fuente: [maestro §11.2](../../PROPUESTA_MAESTRA_DFTLAB_V2.md).

## Lo que ya resuelve QRAFT `41043ed`

- Camino k con SeeK-path sobre la celda original (`get_explicit_k_path_orig_cell`), HPKOT, tramos y evidencia de inversión temporal; en modo automático bloquea si la transformación no está resuelta.
- Las propiedades parten de un estado M6 inmutable (FDF final, `.DM`, pseudos con hash).
- Exportación de `.bands`, `.DOS` y `.PDOS` sin inferir gaps ni picos.

## Decisiones nuevas

| # | Decisión | Por qué |
|---|---|---|
| B-1 | El gap se informa como «gap sobre el camino k» o «gap sobre la malla k», con la malla o el camino citado. «Gap global» solo con evidencia de búsqueda fuera del camino. | §11.2; QRAFT hoy no calcula gaps. |
| B-2 | Fat bands se producen en la misma corrida de bandas (`COOP.Write` y `.WFSX`) y se proyectan con la utilidad `fat` de la distribución fijada, cuya versión entra en el lock del worker (`fat` y `eigfat2plot` están en `siesta-env` 5.4.2; no se ejecutaron en esta auditoría). Normalización (Mulliken por orbital) declarada. | Una utilidad sin versión rompe la reproducibilidad. |
| B-3 | La masa de una línea es **direccional** y lleva dirección en coordenadas cartesianas, ventana de ajuste, número de puntos y tratamiento de degeneración. El tensor exige un muestreo 3D alrededor del extremo (corrida nueva con `BandPoints`). | §11.2. |
| B-4 | En bandas degeneradas en el extremo, la masa se marca `NOT_ESTABLISHED` salvo que la política defina cómo separarlas. | Un ajuste parabólico sobre bandas cruzadas da números sin sentido. |
| B-5 | Las energías de bandas, DOS y PDOS conservan E_F de la corrida que los produjo; una alineación con otra corrida se registra como operación. | Ver S-7 de [WF-SURFACE](WF-SURFACE.md): E_F depende de la celda. |

## Vectores que deben existir antes del código

1. Banda parabólica sintética con masa conocida en una dirección: se recupera dentro de la tolerancia aritmética.
2. Dos bandas degeneradas en el extremo: `NOT_ESTABLISHED`.
3. Camino que no pasa por el extremo real: el resultado dice «gap sobre el camino».
4. Fat bands: los pesos por k suman la carga de la banda dentro de la tolerancia declarada.
