# DFT Lab helper scripts

## `dftlab_pack.py` – SIESTA Hamiltonian → compact JSON for the viewer

The browser app reads SIESTA's text outputs directly (`dftlab/static/js/siesta/`), but quantities that
need the Hamiltonian and overlap (H, S in the binary `.TSHS` / `.HSX`) are computed here, once, on the
machine where the run lives, and stored in one JSON file that is dropped into the app like any other file.

### Requirements

* Python ≥ 3.9, `numpy`, `sisl >= 0.15` (tested with 0.16.4), `scipy` (recommended; numpy fallback exists)
* `seekpath` (optional, for the standard k-path; otherwise the fdf `BandLines` block is used)

```bash
python3 -m pip install sisl seekpath scipy
```

The run directory must contain the `.fdf`, the `SystemLabel.TSHS` (`TS.HS.Save true`) or
`SystemLabel.HSX` (`SaveHS true`), and the basis files SIESTA wrote (`*.ion.xml` / `*.ion` or `.ORB_INDX`)
so that sisl knows the orbital labels (n, l, m, ζ, polarization).

### Usage

```bash
python3 dftlab_pack.py RUN.fdf -o run.dftlab.json [--path auto|fdf|seekpath] [--nk 200] [--mp 20]
        [--wf "band,k[,spin];..."] [--grid 28] [--coop] [--sigma 0.1] [--de 0.02]
        [--emin E] [--emax E] [--nelec N]
```

| option | meaning |
|---|---|
| `--path auto` | seekpath standard path (HPKOT) if seekpath is installed and the cell is commensurate, else the fdf `BandLines` (`fdf` forces the latter) |
| `--nk 200` | approximate number of k-points along the path (distributed by segment length) |
| `--mp 20` | n×n×n Monkhorst–Pack grid (time-reversal reduced; 1 along non-periodic directions) for PDOS, COOP, Fermi level and gap. `0` skips it |
| `--sigma 0.1 --de 0.02` | Gaussian broadening and energy step (eV) of the DOS grid; window = [lowest band − 1, E_F + 15] unless `--emin/--emax` |
| `--wf "vbm,G;cbm,cbm;5,X,1"` | wavefunctions: `band` = 1-based index, `vbm`, `cbm`, `vbm-1`, `cbm+2`…; `k` = a path label (`G`/`Gamma`, `X`, …), `kx/ky/kz` (fractional), `vbm` or `cbm` (location of the edge); optional spin (0/1) for polarized runs |
| `--grid 28` | real-space points along the longest lattice vector (others scaled by length, min 8) |
| `--coop` | COOP and COHP for every species pair at its nearest-neighbour distance (pairs up to 1.15 × d_NN) |
| `--nelec` | number of electrons (default: sum of the basis initial charges q0 = valence charge) |

Typical cost: Si (2 atoms, DZP) with `--mp 16 --coop` ≈ 20 s; bcc Fe spin-polarized `--mp 16` ≈ 20 s.
BLAS threading is disabled by default (many tiny diagonalizations); set `DFTLAB_THREADS=n` to change it.

Examples (from the test runs):

```bash
python3 dftlab_pack.py si.fdf -o si.dftlab.json --mp 16 --coop --wf "vbm,G;cbm,cbm;1,X"
python3 dftlab_pack.py fe.fdf -o fe.dftlab.json --mp 16 --coop --wf "5,G,0;5,G,1"     # collinear spin
python3 dftlab_pack.py fesoc.fdf -o fesoc.dftlab.json --mp 10 --path fdf --wf "9,H"  # spin-orbit
```

### What is computed

* **Energy reference.** Depending on the file and the sisl version, the H read from `.TSHS`/`.HSX` is
  either on SIESTA's absolute scale or shifted so that E_F = 0. The script estimates E_F on a 6×6×6
  grid and shifts H back when needed, so all energies match SIESTA's `.bands`/`.EIG` (checked to 5·10⁻⁵ eV
  at Γ in the tests). `fermi` is SIESTA's E_F (from the file); `fermiComputed` is the value re-derived
  from the MP grid (Fermi–Dirac, kT = 25 meV).
* **Bands** along the path, diagonalizing H(k) c = ε S(k) c in the lattice gauge.
* **Fat bands (Mulliken)**: w_{nk,i} = Re[c_i* (S(k) c)_i] with c⁺Sc = 1 (gauge invariant), summed over the
  orbitals of each group: by species, by l, by species+l. For every (n,k) the weights sum to 1
  (non-collinear: the two spinor components of an orbital are added).
* **PDOS** on the MP grid: Σ_nk w_k g_s w_{nk,i} δ_σ(E − ε_nk) (g_s = 2 for unpolarized runs), grouped
  as above; `total` integrates to the electron count below E_F (`electronsBelowFermi`).
* **Gap**: VBM = max ε ≤ E_F, CBM = min ε > E_F over MP grid ∪ path, per spin channel and overall;
  metal if any band crosses E_F; direct if VBM and CBM share the k-point.
* **Wavefunctions** (optional): ψ_nk(r) = Σ_{i,T} c_i φ_i(r − R_i − T) e^{ik·T} (sisl, lattice gauge)
  on an N1×N2×N3 grid of the home cell.
* **COOP/COHP** (optional): for each species pair A–B, the masked matrices S_AB(k), H_AB(k) keep only the
  orbital pairs of atoms at the nearest-neighbour distance (both A→B and B→A);
  COOP(E) = Σ_nk w_k Re[c⁺ S_AB(k) c] δ(E−ε), COHP the same with H (plot −COHP).
  For non-collinear runs COHP uses the charge part of H.

### Output layout (`*.dftlab.json`)

All energies in eV, lengths in Å, cartesian k in 1/Å **including 2π**, fractional k in reciprocal-lattice units.
Arrays with more than 48 elements are packed as

```json
{"__array__": 1, "dtype": "float32", "shape": [1, 203, 26], "encoding": "base64-gzip", "data": "H4sI…"}
```

(little-endian, C order; decode with `pack.js: unpackDftlab()` in the browser). Small arrays are inline lists.

```text
{
  dftlab: "siesta-pack", version: 1, generator, created, source: {fdf, systemLabel, hamiltonian},
  units: {...}, spin: {kind: unpolarized|polarized|noncollinear|spin-orbit, nchannels, degeneracy, noncollinear},
  nElectrons, energyReference, fermi, fermiSiesta, fermiComputed,
  structure: {cell[3][3], rcell[3][3], positions[na][3], fractional, species[], symbols[], Z[], pbc[3],
              nAtoms, nOrbitals, orbitals: [{atom (0-based), species, Z, n, l, m, zeta, P, name}]},
  bands: {pathSource: seekpath|fdf, pathInfo: {bravais, spacegroup, spacegroupNumber}, nk, nBands,
          x[nk] (1/Å), kfrac[nk][3], kcart[nk][3], labels: [{x, label: "Γ" | "U|K", k}],
          energies[spin][k][band],
          fatbands: {definition, bySpecies|byL|bySpeciesL: {names[], data[spin][group][k][band]}}},
  dos: {mp[3], nk, sigma, energy[nE], total[spin][nE], electronsBelowFermi,
        bySpecies|byL|bySpeciesL: {names[], data[spin][group][nE]}},
  gap: {type: metal|direct|indirect, gap, directGap, metallic, source,
        vbm: {e, k (frac), band (0-based), spin}, cbm: {…}, channels: [{spin, vbm, vbmK, vbmBand, cbm, …}]},
  wavefunctions?: {grid[3], phaseConvention,
        states: [{band (1-based), bandIndex0, k (frac), kLabel, spin, energy, norm, dV (Å³), spinor,
                  components: {scale, re: int8[N1][N2][N3], im: int8[N1][N2][N3]}   // [up, down] if spinor
                 }]},
  coop?: {pairs: [{species: [A, B], distance (Å), nPairs, coop[spin][nE], cohp[spin][nE]}], energy: "same as dos.energy", note}
}
```

**Wavefunction phase convention.** Values are `int8 × scale` (Å^-3/2), grid point (i,j,l) is at
r = (i/N1) a1 + (j/N2) a2 + (l/N3) a3 (C order). ψ is the full Bloch function, so the value in the cell
translated by n = (n1,n2,n3) is ψ(r + n·A) = ψ(r) · exp(2πi k_frac·n): to tile a supercell multiply each
copy by that phase (for Γ the copies are identical). The arbitrary global phase is fixed so that the point
of largest |ψ| is real and positive; Σ|ψ|² dV over the home cell ≈ 1 (`norm`).

### Limitations

* Needs the binary H/S of the run (`SaveHS` and/or `TS.HS.Save`); `.nc` (CDF.Save) input is read by sisl
  only if the fdf points to it.
* Spin-orbit/non-collinear: bands, fat bands, PDOS, gap and wavefunction spinors are supported;
  spin-resolved (Sx, Sy, Sz) fat bands are not computed.
* seekpath may return a standardized cell that is not commensurate with the input (e.g. strongly distorted
  supercells): the script then falls back to the fdf `BandLines`.
