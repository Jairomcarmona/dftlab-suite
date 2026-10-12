# Ficha de entrada: pseudopotenciales, especies y bundles (T-031)

Estado: **lista para aceptar**. Autoridad: el preflight y el staging de QRAFT (`engines/siesta/pseudopotentials.py`) deciden si una corrida puede usar un conjunto de pseudos; la plataforma guarda la biblioteca, los hashes y las licencias. Fuente: [maestro §10](../../PROPUESTA_MAESTRA_DFTLAB_V2.md) («Se controla XC, valencia, relatividad, capacidades y alias») y [plan T-031](../../PLAN_IMPLEMENTACION_CLAUDE_CODE.md). Evidencia: [corridas de pseudos](../reviews/evidencia-p5-p10/README.md#pseudopotenciales-t-031).

Esta ficha está escrita para que la implemente quien solo programa: si algo no está aquí, en el oráculo o en los vectores, **se pregunta antes de decidirlo**. Los vectores dicen lo que hizo SIESTA; no se cambian para que una prueba pase.

## Qué existe

La biblioteca del proyecto (`app/dftlab/data/pseudos/`, con su [README](../../app/dftlab/data/pseudos/README.md)) tiene **30 elementos en dos funcionales** (60 archivos PSML 1.1): ONCVPSP 3.3.1, escalar-relativistas, dos proyectores por canal, con entrada, salida y validación EOS de cada uno. El LDA es Ceperley-Alder en la parametrización de Perdew-Zunger, no PW92. La biblioteca es de un solo origen; no hay licencia escrita en los archivos.

## Lo que hace SIESTA 5.4.2 (comprobado)

| # | Hecho | Evidencia (Si, PBE, SZP, 150 Ry) |
|---|---|---|
| PS-1 | Para la especie con etiqueta L, SIESTA busca `L.vps`, `L.psf` y `L.psml`, en ese orden, y usa el primero **sin avisar**. Si no hay ninguno, aborta con «Pseudopotential file not found: L.{vps,psf,psml}» (código de salida 134). El nombre del elemento no cuenta. | Con `Si.psf` y `Si.psml` en la carpeta leyó `Si.psf`. Con la etiqueta `Si1` y solo `Si.psml`, abortó. |
| PS-2 | Si el funcional del pseudo y el de la corrida difieren, SIESTA escribe «xc_check: WARNING: Pseudopotential generated with … functional» y **sigue**. Distingue LDA CA de LDA PW92. | PBE con pseudo LDA, LDA con pseudo PBE y LDA PW92 con pseudo CA-PZ terminaron con `Job completed`. CA con CA-PZ y PBE con PBE no avisan. |
| PS-3 | El funcional de un PSML está en `libxc-info` como identificadores de libxc: PBE = 101, 130; CA-PZ = 1, 9. PSML 1.0 usa `<header>` y tipos `XC_EXCHANGE`; PSML 1.1 usa `<pseudo-atom-spec>` y `exchange`. | Cabeceras de la biblioteca y del fixture `Si.soft.psml`. |
| PS-4 | Un alias es una etiqueta con su propio archivo: dos especies `Si1` y `Si2` con copias del mismo PSML dan la misma energía que una especie `Si`. | E_KS = −265.4858 eV en los dos casos. |

## Decisiones

| # | Decisión |
|---|---|
| D-1 | El funcional de la corrida (`XC.functional`, `XC.authors`) se traduce a identificadores de libxc con la tabla fijada de la versión (`XC_AUTHORS` del oráculo) y se compara con el de cada pseudo leído de su cabecera (`psmlInfo`). Si difieren, `FAIL` `PSEUDO_XC_MISMATCH` antes de correr; un `XC.authors` fuera de la tabla es `FAIL` `XC_UNKNOWN`. Después de correr, un aviso de `xc_check` en stdout también es `FAIL` (cubre psf, que no se lee antes). `xcGate`, `stdoutXcWarnings`. |
| D-2 | En el manifiesto y en la carpeta de la corrida, el archivo de cada especie es exactamente `<etiqueta>.<formato>`, con mayúsculas iguales. Si no, `FAIL` `SPECIES_FILENAME_MISMATCH`. `manifestCheck`. |
| D-3 | El staging deja **un solo** archivo `<etiqueta>.{vps,psf,psml}` por especie y comprueba su hash después de copiar. Si hay más de uno, `FAIL` `PSEUDO_FILE_AMBIGUOUS` (PS-1: SIESTA usaría el primero sin avisar). `resolvePseudoFile` informa el archivo que SIESTA usaría y si es ambiguo. |
| D-4 | Un alias (`SpeciesDefinition` con etiqueta propia y el mismo pseudo) se materializa como una copia con el nombre de la etiqueta; el manifiesto guarda, por etiqueta, el hash del origen. Las copias tienen el mismo hash. |
| D-5 | Cada pseudo del catálogo guarda: elemento, Z, valencia (`z-pseudo`), relatividad, NLCC, identificadores de libxc, formato, hash SHA-256 del archivo, origen y licencia o «sin licencia declarada». La relatividad `scalar` o `no` no sirve para spin-órbita (QRAFT ya lo comprueba en `magnetism.py`). |
| D-6 | El catálogo se anuncia como «30 elementos en LDA (CA-PZ) y PBE», no como 60 pseudos. Un pseudo externo entra con los mismos campos de D-5 y no cambia en silencio una revisión que ya usaba otro. |

## Diferencias que hay que corregir

| Dónde | Hoy | Debe (vector) | Cambio |
|---|---|---|---|
| QRAFT `PseudopotentialVerifier` | `SPECIES_FILENAME_MISMATCH` compara por prefijo y sin mayúsculas: `S` con `Si.psml` y `Si` con `Si_old.psml` pasan | D-2 (`ps-manifest-prefix`, `ps-manifest-suffix`) | **U-Q18** |
| QRAFT, manifiesto | `xc_family` se guarda pero no se compara con la cabecera ni con el FDF | D-1 (`ps-xc-*`) | U-Q18 |
| QRAFT, staging | No comprueba otros `<etiqueta>.{vps,psf}` en la carpeta | D-3 (`ps-file-both`) | U-Q18 |

## Vectores

[`vectors/pseudos.cases.json`](vectors/pseudos.cases.json) contiene 20 casos: 4 cabeceras PSML (las de los archivos, recortadas hasta `</exchange-correlation>`), 6 de funcional, 2 de avisos en stdout, 5 de qué archivo usa SIESTA y 3 de manifiesto. Los esperados de cabecera vienen de `xml.etree`; los de funcional y archivo, de lo que hizo SIESTA (`vectors/build/build_pseudo_cases.py`). `node scripts/check-protocol-vectors.mjs` comprueba el [oráculo](vectors/pseudo-oracle.mjs) y corre en `scripts/verify.mjs`.

## Implementación, en este orden

1. **QRAFT U-Q18:** D-1…D-3 en el verificador y el staging. Porta `pseudos.cases.json` como fixture.
2. **Plataforma:** catálogo con los campos de D-5, alias de D-4 y texto de D-6; el bundle lleva los archivos con el nombre de su etiqueta y el manifiesto de hashes.
3. Subir el pin de QRAFT cuando U-Q18 entre.

## Decisión pendiente de Manuel

Aceptar U-Q18 y su orden (después de U-Q9), y decir qué licencia declara la biblioteca propia.
