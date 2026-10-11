# DFT Lab crystal toolkit (browser, offline)

Plain ES modules for crystal symmetry, band-structure k-paths, Brillouin zones and structure
files. They run in the browser with no server and no bundler; the only binary dependency is the
moyo WebAssembly module ([moyo-wasm](https://github.com/spglib/moyo) 0.21.0, MIT OR Apache-2.0),
an spglib-compatible symmetry finder.

```
crystal/
  (moyo lives in ../../vendor/moyo/, outside the editable code)
  vendor/moyo/loader.js     initMoyo(): loads the wasm (http, inline base64 or Node)
  vendor/moyo/moyo_wasm.js         wasm-bindgen glue (unmodified)
  vendor/moyo/moyo_wasm_bg.wasm    moyo 0.21.0 binary (746 kB)
  vendor/moyo/moyo_wasm_inline.js  the same binary as a base64 string (for file:// pages)
  vendor/moyo/moyo_wasm.d.ts       moyo TypeScript API
  symmetry.js               analyze(), cell utilities, Niggli reduction, linear algebra
  kpath.js                  port of seekpath (HPKOT) get_path / get_explicit_k_path
  bz.js                     first Brillouin zone polyhedron + drawing helpers
  formats.js                CIF, (ext)XYZ, POSCAR, SIESTA XV/STRUCT_OUT/fdf, BandLines, k-grid
  elements.js               symbols, Z, masses, covalent radii, Jmol/CPK colours
```

Tests: `app/tests/crystal/` (see the end of this file).

## Conventions

A **cell** is a plain object used by every module:

```js
const cell = {
  lattice: [[ax, ay, az], [bx, by, bz], [cx, cy, cz]], // ROWS are lattice vectors, Angstrom
  positions: [[x, y, z], ...],                          // FRACTIONAL coordinates
  numbers: [14, 14],                                    // atomic numbers
  // optional: labels: ['Si1', ...], types: [...]  (integers used for symmetry instead of
  //           numbers, e.g. to separate spin-up/down Fe), pbc: [true,true,true], info: {...}
};
```

All matrices are arrays of rows. Reciprocal lattices include the 2π factor (seekpath convention),
so k-point distances are in 1/Å.

## Loading moyo

```js
import { initMoyo } from './crystal/symmetry.js';

await initMoyo();            // served over http(s): fetches moyo/moyo_wasm_bg.wasm next to loader.js
await initMoyo('inline');    // offline / file://: imports moyo/moyo_wasm_inline.js (base64, ~1 MB)
await initMoyo(bytes);       // Uint8Array | ArrayBuffer | base64 string | data: URI | WebAssembly.Module | URL
```

Browsers do not load ES modules from `file://` pages, so a fully offline app is either served by
a local static server (any, e.g. `python -m http.server`) or bundled; in both cases the inline
module avoids a separate `.wasm` request. `initMoyo()` with no argument also uses `globalThis.MOYO_WASM_BASE64` when it is defined, reads the
file with `node:fs` under Node.js, and falls back to the inline module for `file:` URLs. This build
of wasm-bindgen exports `initSync({module})` and an async default `init({module_or_path})`; the
loader always resolves the bytes itself and calls `initSync`, so the same code path works everywhere.
`initMoyoSync(bytesOrBase64)`, `isMoyoReady()` and `getMoyo()` are also exported from
`vendor/moyo/loader.js`.

## symmetry.js

```js
import { initMoyo, analyze, supercell, perturb, substitute, bonds } from './crystal/symmetry.js';
await initMoyo();
const a = 5.431;
const si = { lattice: [[0, a/2, a/2], [a/2, 0, a/2], [a/2, a/2, 0]],
             positions: [[0, 0, 0], [0.25, 0.25, 0.25]], numbers: [14, 14] };
const d = analyze(si, { symprec: 1e-5 });
d.number;            // 227
d.hm_symbol;         // 'F d -3 m'      d.international -> 'Fd-3m'
d.crystal_system;    // 'cubic'         d.lattice_system, d.point_group ('m-3m')
d.bravais;           // 'cF'  (HPKOT/seekpath symbol: cP cF cI tP tI oP oF oI oC oA hP hR mP mC aP)
d.pearson_symbol;    // 'cF8'
d.wyckoffs;          // ['a', 'a']      d.site_symmetry_symbols -> ['-43m', '-43m']
d.equivalent_atoms;  // [0, 0]          d.orbits -> [{representative, indices, element, wyckoff, siteSymmetry}]
d.nOps;              // 48              d.operations -> [{rotation (rows, integer), translation}]
d.conventional;      // standardized conventional cell (spglib setting; == spglib std_lattice)
d.primitive;         // standardized primitive cell (moyo prim_std_cell)
d.transformation_matrix, d.origin_shift;   // spglib convention: x_std = P x_in + p
d.std_linear, d.std_origin_shift;          // moyo convention: A_std = A_in * std_linear
d.std_rotation_matrix, d.prim_std_linear, d.mapping_std_prim, d.has_inversion, d.raw (moyo dataset)
```

`analyze(cell, {symprec, setting, preferInputOrientation})` uses `setting: 'Spglib'` (default,
spglib-compatible Hall settings) or `'Standard'` (ITA standard settings). `analyzeAsync()`
initialises moyo first. Note: moyo has no separate angle tolerance parameter.

The standardized cell is unique only up to the proper rotations of the crystal's point group, and
moyo sometimes picks e.g. a↔b, c→−c for an input that is already a standard conventional cell
(spglib returns the identity). With `preferInputOrientation: true` (default) the input→standard
relation (`transformation_matrix`, `origin_shift`, `std_rotation_matrix`, `std_linear`, ...) is
then re-expressed with the proper group operation that makes the transformation the identity
(`d.reoriented` tells whether this happened). The standardized cells themselves are not changed. Conventional and primitive positions
are wrapped into [0, 1) like spglib's.

Other exports:

| function | description |
| --- | --- |
| `standardize(cell, {toPrimitive, symprec})` | standardized conventional / primitive cell |
| `operationsFromNumber(n, {setting, primitive})`, `spaceGroupType(n)` | space-group tables from moyo |
| `supercell(cell, n)` | `n` = integer, `[n1,n2,n3]` or 3x3 integer matrix M (new lattice = M·lattice) |
| `perturb(cell, amp, {seed, atoms, strain})` | random displacements ≤ `amp` Å (deterministic seed), optional strain |
| `substitute(cell, selector, element)` | selector: index, index list, element symbol, or predicate |
| `removeAtoms(cell, idx)`, `addAtom(cell, el, pos, {cartesian})` | edit atoms |
| `fracToCart`, `cartToFrac`, `cartesianPositions`, `wrapPositions` | coordinate conversion |
| `cellParameters(L)`, `latticeFromParameters(a,b,c,α,β,γ)`, `reciprocalLattice(L, twoPi)`, `volume(L)` | lattice helpers |
| `bonds(cell, {scale=1.15, tolerance, maxLength, minDistance, radii, pbc})` | bonds `d < scale·(r_i+r_j)` with periodic images: `[{i, j, image, length, vector}]` |
| `neighborList(cell, opts)`, `distance(cell, i, j)` | neighbours, minimum-image distance |
| `formula(cell)` | `{formula, reduced, counts, z}` |
| `niggliReduce(L, eps)` | port of spglib's Niggli reduction (`{lattice, transformation}`) |
| `bravaisLattice(n)`, `crystalSystem(n)`, `latticeSystem(n)`, `spacegroupHasInversion(n)`, `spacegroupCentering(n)` | space-group tables |
| `dot, cross, norm, add, sub, scale, det3, inv3, matmul, matvec, vecmat, transpose` | 3D linear algebra |

## kpath.js -- seekpath / HPKOT

Faithful port of seekpath 2.2.2 (`seekpath.get_path`, `get_explicit_k_path`, `get_path_orig_cell`,
`get_explicit_k_path_orig_cell`, `hpkot.spg_mapping.get_primitive`, `get_P_matrix`, and the
`band_path_data` tables for all 29 extended Bravais lattices cP1 … aP3). Please cite
Y. Hinuma, G. Pizzi, Y. Kumagai, F. Oba, I. Tanaka, *Comput. Mater. Sci.* **128**, 140 (2017).

```js
import { getPath, getExplicitKPath, primitiveCellFromPath, bandPlotTicks, prettyLabel } from './crystal/kpath.js';
const res = getExplicitKPath(si, { referenceDistance: 0.025, symprec: 1e-5 });
res.bravais_lattice_extended;     // 'cF2'
res.path;                         // [['GAMMA','X'], ['X','U'], ['K','GAMMA'], ['GAMMA','L'], ['L','W'], ['W','X']]
res.point_coords.X;               // [0.5, 0, 0.5]  (fractional, w.r.t. reciprocal_primitive_lattice)
res.primitive_lattice;            // HPKOT primitive cell -> use THIS cell for the band calculation
res.reciprocal_primitive_lattice; // rows, 2*pi included
res.primitive_transformation_matrix, res.inverse_primitive_transformation_matrix;
res.explicit_kpoints_rel;         // 202 points; also _abs, _labels, _linearcoord, explicit_segments
res.warnings;                     // EdgeCaseWarning messages (seekpath issues Python warnings)
primitiveCellFromPath(res);       // {lattice, positions, numbers}
bandPlotTicks(res);               // [{x, label}] with 'X|K' at discontinuities
prettyLabel('GAMMA');             // 'Γ'   prettyLabel('X_1', {latex:true}) -> 'X$_{1}$'
```

Returned keys are the seekpath ones (snake_case): `point_coords, path, has_inversion_symmetry,
augmented_path, bravais_lattice, bravais_lattice_extended, conv_lattice, conv_positions,
conv_types, primitive_lattice, primitive_positions, primitive_types, reciprocal_primitive_lattice,
primitive_transformation_matrix, inverse_primitive_transformation_matrix, volume_original_wrt_conv,
volume_original_wrt_prim, spacegroup_number, spacegroup_international, rotation_matrix`, plus
`primitive_numbers`, `conv_numbers`, `conv_prim_atoms_mapping`, `warnings` and `dataset`
(the `analyze()` result).

Options: `withTimeReversal` (default true; false adds the k' = -k path for non-centrosymmetric
crystals), `threshold` (1e-7, edge-case detection), `symprec` (1e-5 Å), `dataset` (reuse an
`analyze()` result), `referenceDistance` (0.025 1/Å).

`getPathOrigCell(cell)` / `getExplicitKPathOrigCell(cell)` give the special points in the
reciprocal basis of the *input* cell (no re-standardization; `is_supercell` flags supercells).
`getPathFromStandardized({conv_lattice, conv_positions, conv_types, spacegroup_number, ...})` runs
the HPKOT logic on an already standardized spglib conventional cell (no moyo needed).
`getExplicitFromImplicit(res, d)`, `getPrimitive`, `getPMatrix`, `getPathData`, `evalExpr`,
`BAND_PATH_DATA` are also exported.

**Why moyo works as the spglib replacement here.** seekpath uses spglib's `std_lattice`,
`std_positions`, `std_types`, `number`, `transformation_matrix` and `std_rotation_matrix`. For all
530 Hall settings (random cells, random bases, random orientations) moyo's `std_cell` with
`setting: "Spglib"` reproduces spglib's `std_lattice` to 1e-6 Å *including its Cartesian
orientation*, and the space-group numbers, Hall numbers and Wyckoff letters agree, so the
extended-Bravais classification (which depends only on the conventional a, b, c, β), the k-point
coordinates, the path, the primitive lattice and the reciprocal lattice are identical to
seekpath's. moyo may choose a different (equivalent) origin for the atoms of non-centrosymmetric
or polar groups, so `conv_positions`/`primitive_positions` can differ from seekpath's by an origin
shift or by a lattice automorphism (an equivalent description of the same crystal); nothing in the
k-path depends on it. The triclinic (aP) case uses `niggliReduce`, a port of spglib's `niggli.c`
(verified against `spglib.niggli_reduce` on 1,500+ lattices including degenerate metrics).

## bz.js

```js
import { brillouinZone, bzWireframe, bzMesh, kpathCartesian, isInBZ, toFirstBZ } from './crystal/bz.js';
const bz = brillouinZone(res.reciprocal_primitive_lattice);
bz.vertices;   // [[kx,ky,kz], ...]
bz.faces;      // ordered vertex loops (counter-clockwise seen from outside)
bz.edges;      // [[i, j], ...]
bz.faceNormals, bz.faceG, bz.faceMiller;   // plane k·G = |G|²/2 of each face
bz.volume;     // == bz.reciprocalVolume (|det B|)
bzWireframe(bz);           // [[p1, p2], ...] line segments
bzMesh(bz);                // {positions (flat), indices} triangle fan, e.g. for three.js
kpathCartesian(res);       // {points: {label: k_cart}, segments, lines (continuous polylines)}
isInBZ(bz, k); toFirstBZ(k, B); reciprocalAxes(B);
```

The zone is computed by clipping a cube with the bisector planes of all G = n·b' (|n_i| ≤ 2) of
the Niggli-reduced reciprocal basis, so it is robust for very oblique cells.

## formats.js

```js
import * as F from './crystal/formats.js';
const cell = F.readStructure(text, { filename: 'Si.cif' });   // auto-detects the format
cell.info.warnings;                                           // notes (partial occupancy, ...)
F.writeStructure(cell, 'poscar');                             // 'cif' | 'xyz' | 'extxyz' | 'poscar' | 'fdf' | 'struct_in'
```

Readers (all return a cell with `info.format`):

* `readCIF(text, {block, tolerance=0.05 Å, occupancy='max'|'all'})`, `readCIFAll(text)` --
  handles COD/ICSD/Materials Project variants: uncertainties `5.431(2)`, quoted/semicolon fields,
  comments, multiple data blocks, `_symmetry_equiv_pos_as_xyz`, `_space_group_symop_operation_xyz`
  (and dotted CIF2/mmCIF forms), `_atom_site_type_symbol` with charges (`O2-`), labels-only
  elements, Cartesian `_atom_site_Cartn_*`, dummy atoms, partial occupancies (disordered sites keep
  the majority species and a warning). Atoms are expanded with the listed operations and merged
  within `tolerance`. If no operations are listed and moyo is initialised, they are generated from
  the Hall / H-M symbol (setting-aware) or the IT number. `parseCIFBlocks`, `parseSymop`,
  `formatSymop`, `cifNumber` are exported too.
* `readXYZ(text, {frame, vacuum=10})`, `readXYZAll` -- plain and extended XYZ (`Lattice="..."`,
  `Properties=species:S:1:pos:R:3:...`, `pbc="T T T"`; extra per-atom columns go to
  `info.arrays`). Plain XYZ gives a molecule in a box (`pbc` false).
* `readPOSCAR(text, {species})` -- VASP 4/5, scale factor (also negative = volume, or 3 factors),
  Selective dynamics (`info.selectiveDynamics`), Direct/Cartesian.
* `readXV(text)` -- SIESTA `.XV` (Bohr, with velocities), `readStructOut(text)` -- `.STRUCT_OUT`/`.STRUCT_IN`.
* `readFDF(text)` -- `LatticeConstant` + `%block LatticeVectors` or `%block LatticeParameters`,
  `%block ChemicalSpeciesLabel`, `AtomicCoordinatesFormat` (Ang, Bohr, NotScaledCartesianAng/Bohr,
  ScaledCartesian, Fractional/ScaledByLatticeVectors), `%block AtomicCoordinatesAndAtomicSpecies`,
  numeric `%block AtomicCoordinatesOrigin`. fdf labels are case/`-_.` insensitive. `parseFDF`
  returns the raw values/blocks. Bohr = 0.529177 Å (SIESTA's constant, `BOHR_SIESTA`).

Writers:

* `writeCIF(cell, {title, symmetrize=false, symprec})` -- P1 (all atoms), or with
  `symmetrize: true` the standardized conventional cell, its symmetry operations and one atom per
  Wyckoff orbit (with multiplicity and letter).
* `writeXYZ(cell, {comment})`, `writeExtXYZ(cell, {comment, info})`.
* `writePOSCAR(cell, {comment, cartesian, selectiveDynamics})` -- VASP 5, atoms grouped by species.
* `writeFDF(cell, {systemLabel, coordinates: 'Fractional'|'Ang', speciesLabels, speciesOrder})`,
  `writeStructIn(cell)`.
* `writeBandLines(kpathResult, {referenceDistance=0.025, pointsPerSegment, includeGeometry})` --
  SIESTA `BandLinesScale ReciprocalLatticeVectors` + `%block BandLines` with seekpath labels
  (`GAMMA` -> `\Gamma`). The first number on each line is the number of points from the previous
  point (excluded) to this one; a path discontinuity starts with `1`. The total number of k-points
  equals seekpath's explicit path. **The coordinates refer to the seekpath primitive cell**: use
  `primitiveCellFromPath(res)` / `writeFDF(...)` (or `includeGeometry: true`) for the SIESTA run.
* `writeKgridMonkhorstPack(cell, {kspacing=0.2, grid, shift, twoPi=true})` and
  `kgridFromSpacing(cell, kspacing)` -- n_i = max(1, ceil(|b_i| / kspacing)), |b_i| with 2π
  (VASP KSPACING convention); non-periodic directions get 1.

Example: SIESTA band-structure input from a CIF

```js
import { initMoyo } from './crystal/symmetry.js';
import { getPath, primitiveCellFromPath } from './crystal/kpath.js';
import { readCIF, writeFDF, writeBandLines, writeKgridMonkhorstPack } from './crystal/formats.js';
await initMoyo();
const cell = readCIF(cifText);
const res = getPath(cell);
const prim = primitiveCellFromPath(res);
const fdf = writeFDF(prim, { systemLabel: 'bands' })
  + writeKgridMonkhorstPack(prim, { kspacing: 0.15 })
  + writeBandLines(res, { referenceDistance: 0.02 });
```

## elements.js

`SYMBOLS, NAMES, MASSES, COVALENT_RADII` (Cordero 2008), `JMOL_COLORS, CPK_COLORS` indexed by Z;
`atomicNumber('Fe3+') -> 26`, `symbolOf(z)`, `massOf(z)`, `covalentRadius(z)`,
`colorOf(z, 'jmol'|'cpk')`, `elementInfo('Ti')`.

## Tests

```
cd app/tests/crystal
python3 make_reference.py   # spglib + seekpath + ASE references -> reference.json, fixtures/
node run_tests.mjs          # compares; --verbose shows all notes, --filter <text> selects cases
```

`run_tests.mjs` prints one line per case (PASS/FAIL plus the failed checks) and a summary.
Checks per structure: space-group number and symbol, number of operations, Wyckoff letters,
orbits, rotation/transformation consistency, conventional lattice (Cartesian, vs spglib
`std_lattice`), extended Bravais symbol, primitive lattice and P matrix, primitive atoms (exact or
equivalent), path labels/segments, special-point coordinates (1e-6), explicit k-points
(coordinates, labels, linear coordinates, segments), volume ratios, `get_path_orig_cell`, the
no-time-reversal path, the HPKOT port fed with spglib's own standardized cell (must be identical
to 1e-9, atoms included), BZ volume = |det B| and BZ vertices = seekpath/scipy `BZ`, and special
points inside the BZ. Plus reader/writer round trips, files written by ASE, SIESTA files, BandLines
and Monkhorst-Pack grids.

Result (spglib 2.7.0, seekpath 2.2.2, moyo-wasm 0.21.0):

| group | cases | pass |
| --- | --- | --- |
| one random structure per extended Bravais case (cP1 … aP3, 2 space groups each when possible) | 57 | 57 |
| seekpath's own example POSCARs (all 29 cases, with/without inversion) | 60 | 60 |
| materials (Si, GaAs, NaCl, graphite, ZnO, rutile ×2, SrTiO3, Fe, Mg, Bi2Se3 ×2, MoS2, 2×2×2 supercell) | 14 | 14 |
| symprec (distorted Si, nearly tetragonal cell, two tolerances each) | 4 | 4 |
| CIF files (COD, ICSD, MP/ASE P1, CIF2 dotted tags, H-M symbol only) | 6 | 6 |
| one random structure for each of the 230 space groups (random Hall setting, scrambled basis, rotated) | 230 | 230 |
| format readers/writers | 71 | 71 |

`browser_smoke.mjs` (needs Playwright) loads the modules in headless Chromium with the three
moyo loading modes (http fetch, `'inline'`, `globalThis.MOYO_WASM_BASE64`).

## Known differences from spglib + seekpath

* Atom coordinates of the standardized cells may be an equivalent description (different origin
  or a lattice automorphism) for some space groups (163 of 371 test structures: 70 differ by an
  origin shift, 93 by an affine-normalizer operation); lattices, k-points, labels and paths are
  identical. As a consequence Wyckoff letters can be relabelled for a few structures with
  alternative origins (e.g. Si 8a vs spglib 8b, hcp Mg 2c vs 2d; same site symmetries and orbits).
* `rotation_matrix` / `transformation_matrix` may be a different but equivalent choice (see
  `preferInputOrientation`), so `getPathOrigCell` coordinates can differ from seekpath's by a
  symmetry operation of the crystal (234 of 365 cases; 124 identical) or, where the standardized atoms differ by a
  normalizer operation, by a lattice automorphism (7 cases).
* `primitive_positions` are not wrapped (as in seekpath); `primitiveCellFromPath` wraps them.
* `angle_tolerance` is not available (moyo's default is used).
* Near the symprec boundary moyo and spglib can disagree because their tolerance algorithms differ.
* seekpath's edge-case `EdgeCaseWarning`s are returned in `res.warnings` instead of being raised.
