# SIESTA post-processing parsers (browser, ES modules)

Plain ES modules, no dependencies, used by DFT Lab to plot SIESTA output files that the
user drops into the page. Nothing is executed; files are only read. They also run under
Node ≥ 18 (the test-suite in `app/tests/siesta/` uses them directly).

```js
import { detectAndParse, parseMany } from './siesta/index.js';
const { kind, name, data, error } = detectAndParse(file.name, await file.arrayBuffer());
// several files at once (links Label.EIG with Label.KP for the k-weights):
const results = parseMany([{ name, content }, ...]);
```

`detectAndParse(fileName, textOrArrayBuffer, {kind?, kp?})` sniffs by name first and by
content otherwise, and never throws: a failure returns `{kind, data: null, error}`.

| `kind` | files | parser |
|---|---|---|
| `out` | `*.out`, stdout logs | `out.js: parseOut` |
| `fdf` | `*.fdf` | `out.js: parseFDF` |
| `bands` | `*.bands` (BandLines and BandPoints) | `bands.js: parseBands` |
| `eig` | `*.EIG` (+ `kp` option or `parseMany` for weights) | `eig.js: parseEIG` |
| `kp`, `pdos-kp` | `*.KP`, `*.PDOS.KP`, `*.BZ_KP` | `eig.js: parseKP` |
| `pdos` | `*.PDOS` (old, padded XML), `*.PDOS.xml` | `pdos.js: parsePDOS` |
| `pdos-text` | text tables from fmpdos / pdosxml / sisl (`# E col1 …`) | `pdos.js: parsePDOSText` |
| `dos` | `*.DOS` | `dos.js: parseDOS` |
| `epsimg` | `*.EPSIMG` | `epsimg.js: parseEPSIMG` |
| `epsimg-contrib` | `*.contrib.EPSIMG` (per-transition, SIESTA 5) | `epsimg.js: parseContribEPSIMG` |
| `ion-xml`, `ion` | `*.ion.xml`, `*.ion` | `ion.js: parseIonXML / parseIon` |
| `psf`, `psml` | `*.psf`, `*.psml` | `pseudo.js: parsePSF / parsePSML` |
| `mde`, `ani`, `fa`, `xv`, `struct` | `*.MDE`, `*.ANI`, `*.FA`/`*.FAC`, `*.XV`, `*.STRUCT_OUT/IN/NEXT_ITER` | `mde.js` |
| `fc` | `*.FC` (MD.TypeOfRun FC) | `fc.js: parseFC`, `fcRows` |
| `dftlab-pack` | `*.dftlab.json` from `scripts/dftlab_pack.py` | `JSON.parse`; then `await unpackDftlab(obj)` (`pack.js`) |

## Units

Energies in **eV** and lengths in **Å** unless stated. Where SIESTA writes other units the
original is kept next to the converted value and named in the `units` object of every result:
k-path distances and k-points are written by SIESTA in 1/Bohr → `x`, `kpoints` are in 1/Å (with 2π),
`xBohr`, `kpointsBohr` keep the original. Radial functions of `.ion`/`.psf`/`.psml` stay in Bohr and
Ry (PSML Hartree values are converted to Ry; `energyUnitOriginal` records it). Numeric arrays are
`Float64Array` (use `toPlain()` from `index.js` before `JSON.stringify`).

**Spin conventions.** `nspin = 1` curves in `.PDOS`, `.PDOS.xml` and `.DOS` are the DOS of *one*
spin channel (they integrate to N/2); the helpers (`totalPDOS`, `sumPDOS(..,'total')`,
`dos.total`) return both spins (2×). `nspin = 2` → `[up, down]`. Non-collinear / spin-orbit
(`nspin = 4`) → raw components `[uu, dd, c3, c4]`; `total = uu + dd`, `mz = uu − dd` (`c3`,`c4`
are the off-diagonal parts as written by SIESTA). In `.EIG`, NC/SOC runs write `nspin = 4/8` in the
header but a single block of `2·norb` eigenvalues per k; in `.bands` they write `nspin = 1`.

---

## `parseOut(text)` → main output

```text
{
  program: {version, executable, architecture, compiler, compilerFlags, parallelisations, features[]},
  run: {start, end, directory, mode:'serial'|'MPI', nodes, threads, parallelLines[], completed, reading},
  systemName, systemLabel,
  fdf: {keys:{normKey:{name,value,tokens}}, blocks:{normKey:{name,lines[]}}, includes[], order[]} | null,
  fdfText,                 // echo of the input ("Dump of input data file"; only when read from stdin)
  input: {systemLabel, xcFunctional, xcAuthors, basisSize, meshCutoff, spin, opticalPolarization, mdType},
  species: [{index, Z, label, pseudoFile, pseudoFormat ('formatted'|'PSML'|…), psmlVersion, libxcIds,
             generationMethod, xc, valenceCharge, groundStateConfig,
             pseudizedShells:[{n,l,lsym,occupation,rc(Bohr)}],
             kb:[{l, rc, el, ekb, kbcos}] (Ry/Bohr as printed), nKB,
             basis:[{state:'3s', n, l, polarization, zetas:[{izeta, rc, energy, kinetic, …} (Bohr, Ry)]}],
             nOrbitals, vnaCutoff, warnings[]}],
  basisBlock,              // the echoed %block PAO.Basis (text)
  redata: {"Spin configuration": "collinear", …},   // every "redata:" line
  mixing: {"Pulay mixing": …}, method, dynamics, electronicTemperature:{value, unit},
  spin: {config, nComponents, polarized, noncollinear},
  nAtoms, nOrbitals, nProjectors, nElectrons, ionicCharge, systemType,
  kgrid, pdosKgrid: {nk, supercell[3][3], displacement[3], cutoff (Å), source},
  mesh: {cutoffInput, cutoffRequired, cutoffUsed (Ry), mesh:[n1,n2,n3], unit:'Ry'},
  optical: {"Polarization type": …, fSumRule} | null,
  initialGeometry: {positions (Å), species[]}, cell (Å, last), cellLengths, cellAngles, volume (Å³),
  steps: [{index, type:'Single-point calculation'|'CG opt. move'|'MD step'|…, number,
           coordinates:{kind, unit:'scaled'|'ang'|'bohr'|'fractional', coords, species, labels},
           cell, volume, mesh,
           scf:[row], scfConverged, scfIterations, scfCriterion, max_dDM, max_dH,
           eKS, eKSeggbox, etot, freeEnergy, fermi, energyDecomposition (pre-SCF one of that step),
           forces:{atoms[[fx,fy,fz]], total, max, res, maxConstrained, maxNorm} (eV/Å),
           maxForce, maxForceNorm, resForce,
           stressVoigtKbar[6] (x,y,z,yz,xz,xy), stress:{static|total: 3×3 eV/Å³},
           pressure:{static|total|fromVoigt:{kbar, kbarMolecule}}, enthalpy, freeEnthalpy, temperatureIon (K)}],
  scf: [row]               // all SCF rows of all steps; row = {iscf, step, Eharris, E_KS, FreeEng, dDmax, Ef,
                           //   dHmax, …(any header column), spinMoment:{S:[Sx,Sy,Sz], abs}}
  trajectory: [{step, type, eKS, etot, freeEnergy, maxForce, scfIterations, scfConverged,
                temperatureIon, pressureKbar, volume}],
  isRelaxation, isMD, nSteps,
  energyDecomposition: {Ebs, Eions, Ena, Ekin, Enl | 'Enl(+so)', Eso | 'Eso(nil)', Edftu, DEna, DUscf, DUext,
                        Ex, Ec, Exc, EbV, 'eta*DQ', Emadel, Emeta, Emolmec, Ekinion, Eharris, Etot, FreeEng},
                        // last "Program's energy decomposition" block; keys exactly as printed
  finalEnergy: {'Band Struct.', Kinetic, Hartree, Edftu, Eso, 'Ext. field', 'Exch.', 'Corr.', 'Bulk bias',
                'Exch.-corr.', 'Ion-electron', 'Ion-ion', Ekinion, 'D3 dispersion', Total, Fermi},
  final: {etot, freeEnergy, eHarris, fermi, scfConverged, maxForce, pressureKbar},
  fermi, forces, stress, stressVoigtKbar, pressure, finalCoordinates,
  populations: {
    mulliken|hirshfeld|voronoi: {columns:['charge','valence',('S','Sx','Sy')'Sz'], atoms:[{atom, charge, valence, Sz…, species}], total[]},
    mullikenOrbital: [{spin:'up'|'down'|null, species, orbitals:['3s',…], atoms:[{atom, qatom, qorb[]}]}
                      | {spin:'noncollinear', species, rows:[{atom, index, orbital, charge, spin, Svec[3]}]}],
    mullikenQtot: {up|down|total}},
  spinMoment: {S[3], abs},   // last one printed
  eigenvalues: {nSpin, nk, eig[spin][k][band]} | null,   // only with WriteEigenvalues
  timers: {wallTime (s), routines:[{name, calls, timePerCall, total, percent}], inline:[…]},
  convergence: [{line, text}], warnings: [{line, text}], notes: [{line, text}],
  units: {…}
}
```

SCF tables: the column names come from the header line (`iscf Eharris(eV) E_KS(eV) FreeEng(eV) dDmax Ef(eV) dHmax(eV)`),
so variants without Harris, with extra columns, or the old `siesta: iscf …` layout are handled;
fixed-width fields that run together (`33.736569-44.788847315.508565`) are split by their 6 decimals;
`*****` overflows become `NaN`. The order-N/OMM style (`siesta: iscf = n` + `Eharris(eV) = …`) is also read.
`fdfGet(fdf, 'mesh.cutoff')` / `fdfBlock(fdf, 'BandLines')` look keys up with fdf rules (case, `.`, `-`, `_` ignored).

## `parseBands(text)`

```text
{format:'BandLines'|'BandPoints', fermi, nBands, nSpin, nk, emin, emax, kmin, kmax (1/Å),
 x: Float64Array[nk] (1/Å path distance), xBohr (original),
 kpoints: [[kx,ky,kz]] (BandPoints, cartesian 1/Å) | null, kpointsBohr,
 bands: [spin][band] → Float64Array[nk]  (absolute eV),
 labels: [{x, xBohr, raw:'\Gamma', label:'Γ'}], warnings[]}
```
Helpers: `shiftToFermi(b)`, `bandEdges(b)` → `{vbm:{e,k,band,spin,x}, cbm, gap, metallic, direct}`, `prettyLabel()`.

## `parseEIG(text, kpText?)`, `parseKP(text)`

```text
EIG: {fermi, nBands, nSpin (channels stored), nSpinFile (header 1|2|4|8), noncollinear, spinDegeneracy (2|1),
      nk, eig: [spin][k] → Float64Array[nBands] (eV), weights (normalized), weightsFromKP,
      kpoints (1/Å) | null, kpointsBohr, warnings}
KP:  {nk, kpoints (1/Å), kpointsBohr, weights, weightSum}
```
* `analyzeGap(eig, {fermi?, tol?})` → `{fermi, vbm:{e,k,band,spin,kpoint}, cbm, gap, metallic, direct,
  type:'metal'|'direct'|'indirect', directGap, channels:[per spin, also nOccupiedBands]}` (E_F as separator).
* `computeDOS(eig, {emin, emax, npts|de, sigma=0.1, shape:'gaussian'|'lorentzian'})` →
  `{energy, dos[spin], total, electronsBelowFermi, sigma, shape}` (states/eV/cell, spin degeneracy included).
* `countElectrons(eig, Ef?)` – step-function count Σ w·g·θ(E_F−ε).

## `parsePDOS(text)` (XML) / `parsePDOSText(text)`

```text
{format:'xml', nspin, noncollinear, nOrbitals, fermi, energy: Float64Array[ne] (eV),
 components: ['perSpin'] | ['up','down'] | ['uu','dd','c3','c4'],
 orbitals: [{index, atom, species, Z, position (Å), positionBohr, n, l, m, z (zeta), P (polarization),
             lsym, data: [component] → Float64Array[ne]}]}
text: {format:'text', energy, columns[], columnNames[], comments[]}
```
Helpers: `orbitalSpin(p, orb, 'total'|'up'|'down'|'mz'|index)`, `sumPDOS(p, {species, atom, n, l, m, z, P}, spin)`
(filters accept a value or an array), `totalPDOS(p, spin)`, `groupPDOS(p, ['species','l'], spin)` →
`[{key, label:'Si-p', data, nOrbitals}]`, `integratePDOS(p, curve?, upto=Ef)`, `listSpecies`, `listAtoms`.

## `parseDOS(text)`

`{nspin, noncollinear, components, energy, dos:[component], total (both spins), comments}`; `integrateDOS(d, upto)`.

## `parseEPSIMG(text)` and optics helpers

```text
{nspin, emin, emax, fsumRule[spin], drudeWp2Ha[spin] (Ha², original), drudeWpEV[spin],
 energy (eV), eps2:[spin] (per spin channel), eps2Total (sum), comments}
```
The polarization type (polarized / unpolarized / polycrystal) is not in the file: take it from
`parseOut(...).optical['Polarization type']` or `input.opticalPolarization`.
* `kramersKronig(E, eps2, {eps1Inf=1})` – ε₁ by principal value (subtraction method, truncated at the
  last energy; diverges at ω→0 for metals).
* `opticalConstants(E, eps1, eps2)` → `{n, k, reflectivity, absorption (1/cm), eels}`.
* `opticalSpectrum(eps, {spin?})` → `{energy, eps1, eps2, n, k, reflectivity, absorption, eels}`.
* `addDrude(E, eps1, eps2, wpEV, gammaEV)`.
* `parseContribEPSIMG(text, {maxRows})` → `{blocks:[{ispin, ipol, columns[12], rows[]}]}`.

## `parseIonXML(text)` / `parseIon(text)`

```text
{format, symbol, label, Z, valence, mass, selfEnergy (Ry), selfEnergyEV, lmaxBasis, norbsNl, lmaxProjs, nprojsNl,
 ljProjs, basisSpecs (text), pseudoHeader[],
 orbitals: [{l, n, z, polarized, population, npts, delta, cutoff (Bohr), cutoffAng, r, f (= R/r^l), R, norm, name}],
 basis: [{n, l, lsym, polarized, population, zetas:[{z, cutoff, cutoffAng}]}], nOrbitalsTotal,
 projectors: [{l, j|null, n, refEnergy (Ry), r, f, cutoff}],
 vna {r, f (Ry)}, chlocal {r, f}, reducedVlocal {r, f} (xml only), core {r, f} | null}
```
`f` of the PAOs is SIESTA's tabulated `R(r)/r^l`, so `φ_lm(r) = f(r)·r^l·Y_lm`; `∫ R² r² dr = 1` (`norm`).
`core` and `chlocal` are densities (4π∫r²ρ dr gives the electron count; chlocal integrates to −Z_val).

## `parsePSF(text)` / `parsePSML(text)`

```text
psf:  {format:'psf', header:{name, xc, relativistic:'nrl'|'rel'|'isp', coreCorrection:'nc'|'pcec'|…, generator,
       date, method, configurationLine, shells:[{n,l,lsym,occupation,rc}], zval, rawHeader[]},
       grid:{npts, a, b, recipe:'r(i)=a(exp(b i)-1)', r}, semilocal:{down:[{l,lsym,rV,V}], up:[…], upMeaning},
       potentialKind, coreCharge (4πr²ρ), valenceCharge (4πr²ρ), valenceElectrons, coreElectrons}
psml: {format:'psml', version, uuid, energyUnitOriginal, lengthUnitOriginal,
       provenance:[{creator, date, annotation, inputFile:{name, content}}],
       header:{atomicLabel, atomicNumber, zPseudo, flavor, relativity, spinDft, coreCorrections, annotation,
               xcAnnotation, libxc:[{name, type, id}], valenceConfiguration:[{n,l,lsym,occupation}]},
       grid:{npts, annotation, r},
       semilocal:[{set, potentials:[{n,l,lsym,j,rc,eref,flavor,r,V (Ry)}]}],
       pseudoWaveFunctions:[{set, functions:[{n,l,lsym,j,r,f}]}],
       projectors:[{set, projectors:[{l,lsym,seq,j,ekb (Ry),eref,type,r,f}]}],
       localPotential {type, r, V (Ry)} | null, valenceCharge {totalCharge, r, f}, coreCharge {matchingRadius, r, f} | null,
       valenceElectrons, coreElectrons}
```
PSML charges are stored as `f = 4πρ(r)` (∫ r² f dr = Q); `radialCharge(rho)` returns `4πr²ρ`.

## `mde.js`

```text
parseMDE: {nSteps, columns:{step, temperature (K), eKS, eTot (eV), volume (Å³), pressure (kbar), …}, columnInfo[]}
parseANI: {nFrames, nAtoms, frames:[{comment, symbols[], positions (Å)}]}
parseFA:  {nAtoms, index[], forces (eV/Å), norms, maxForce, maxComponent, total}
parseXV:  {cell (Å), cellBohr, nAtoms, species, Z, positions (Å), velocities (Å/fs)}
parseStructOut: {cell (Å), nAtoms, species, Z, fractional, positions (Å)}
```

## `pack.js` – reading `*.dftlab.json`

`await unpackDftlab(objOrText)` turns every packed array into `{shape, dtype, data: TypedArray}`
(C order). Helpers: `at(arr, i, j, …)`, `row(arr, i, j)` (view on the last axis),
`dequantizeWF({scale, re, im})`. The pack layout is documented in `app/scripts/README.md`.
Packs are validated: every decoded array must have exactly `prod(shape)` elements. For a viewer:
`packBands(pack)` (same shape as `parseBands`, absolute eV), `packDOS(pack)` (`total[channel]`, `byL`, …),
`packStructure(pack)` (`{lattice, positions (fractional), numbers}`) and `packContents(pack)` (what is
viewable plus `extras`: fatbands, COOP/COHP, wavefunctions, named for the parts a screen does not show).

## `runset.js` – a set of files imported together

`createFileSet()` keeps each file in the form its reader needs (bytes for grid files, UTF-8 text for the rest),
unpacks `.dftlab.json` and recomputes the `.EIG` ← `.KP` link (same label, readable, finite non-negative weights,
same number of k-points) whenever a file is added, replaced or removed, so the result does not depend on the load
order. `link` on each entry records the origin of weights and k-points (`{kp, weights, kpoints, note}`; on a `.KP`:
`{usedBy}`). Tests: `app/tests/siesta/run_import_tests.mjs`.

## `parseFC(text, {nAtoms?})` (`fc.js`)
Header `Force constants matrix. n_atoms, displacement [Ang]: N d` (old files: no numbers, pass `nAtoms`), then for each displaced
atom (MD.FCFirst…MD.FCLast), direction x,y,z and sign (−,+) a block of N lines `−ΔF_jx −ΔF_jy −ΔF_jz` / Δu in eV/Å².
Returns `{nAtoms, displ (Å|null), nDisplaced, blocks: Float64Array(3N)[]}`; `fcRows(fc, first=1)` → `[{atom, rows[3], asym}]`
(± average). Phonons from it: `physics/phonon.js` (diagonal supercell, Wigner–Seitz images, acoustic sum rule). Tests: `run_fc_tests.mjs`.

## Not supported in the browser

Binary/NetCDF files (`.TSHS`, `.HSX`, `.DM`, `.WFSX`, `.fullBZ.WFSX`, `*.nc`, …) – use `scripts/dftlab_pack.py`.
The Fortran grid files (`.RHO`, `.DRHO`, `.VH`, `.VT`, …) are read by `rho.js: parseGrid` from their bytes. Non-collinear `.bands` files cannot be told apart from unpolarized ones
from the file alone (`noncollinear: null`); take the spin setting from the `.out`. SIESTA ≤ 4.0 outputs
were not available for testing (the parser accepts the older `siesta: iscf` SCF layout and `siesta:`-prefixed
forces/timers, but this is untested).
