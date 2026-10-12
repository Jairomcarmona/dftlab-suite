# DFT Lab pseudopotential library (ONCVPSP 3.3.1 → PSML, for SIESTA 5.4.2)

> **License: proprietary, all rights reserved.** This library is DFT Lab's own work, intended for private commercial use. No licence to use, copy, modify or redistribute it is granted to third parties, and it must not be published or shipped in a distributable bundle (decision recorded 2026-10-12; see `docs/scientific-protocols/PSEUDOS.md`, D-7). ONCVPSP's own licence applies to its source code, not to the files it produces.

30 elements × 2 functionals (LDA, PBE). Every potential is a scalar-relativistic, optimized norm-conserving
Vanderbilt potential (Hamann, PRB 88, 085117 (2013)) with **2 projectors per angular-momentum channel**,
written directly in PSML by the PSML-enabled ONCVPSP build (`/opt/oncv/build/src/oncvpsp.x`).

```
pseudos/
  lda/<El>.psml   pbe/<El>.psml          pseudopotentials (SIESTA reads <label>.psml; use the element symbol as species label)
  inputs/{lda,pbe}/<El>.dat              exact ONCVPSP input that produced the file (only iexc differs between LDA and PBE)
  outputs/{lda,pbe}/<El>.out             full ONCVPSP stdout (ghost tests, test configurations, convergence tables, plot data)
  elements.json                          machine-readable version of the element table below
  validation/results.json                SIESTA equation-of-state results (a0, B0, B', moments, all E(a) points)
  validation/fdf/<mat>_<xc>.fdf          SIESTA input used (the point closest to the experimental lattice constant)
  validation/run_eos.py                  driver used to generate/run the E(a) scans and Birch–Murnaghan fits
```

## Important conventions

* **LDA flavour.** This ONCVPSP binary is built *without* libxc, so `iexc = 3` is
  **Ceperley–Alder as parametrized by Perdew–Zunger** (the PSML header says so: `LDA -- Ceperley-Alder Perdew-Zunger`),
  not PW92. In SIESTA use `XC.functional LDA` + `XC.authors CA` (= PZ) with the `lda/` files.
  PW92 vs PZ differences are negligible for teaching purposes (≪0.1 % in lattice constants), but CA is the consistent choice.
  PBE files: `XC.functional GGA`, `XC.authors PBE`.
* **Test configurations.** Every input uses the same 3 test configurations relative to the neutral reference:
  (1) a neutral excitation (s→p promotion for sp elements, d↔s transfer for d elements),
  (2) a +0.5 ion and (3) a +1 ion. The "max error" columns are the largest |ε_PS − ε_AE| over all states of all three
  configurations (configuration 0 is the reference and is exact by construction).
  Errors are split into *all states* and *valence only*, where "semicore" means the shallow-core shells that are
  kept in the valence for accuracy (column "semicore"). Hamann's original tests (e.g. O²⁺, Cu²⁺) are harsher and
  give several mHa for any reasonable rc because of the frozen 1s/2p cores; they were replaced by the standard set above.
* **Ghosts.** Every file passes both ONCVPSP 3.3.1 ghost detectors ("Testing for bound ghosts" and
  "Testing for highly-localized positive-energy ghosts") **for both LDA and PBE** – there is no `WARNING - GHOST`
  line in any `outputs/*/*.out`. Where a ghost appeared it was removed with `dvloc0` / `rc(5)` of the
  polynomial local potential (`lloc = 4`), as recommended in `doc/ghosts.txt`, choosing a value in the middle of a
  ghost-free window for both functionals.
* **Suggested MeshCutoff.** `Ecut` is the plane-wave kinetic-energy cutoff (Ha) at which the ONCVPSP
  convergence tables reach **1 mHa/electron** (max over all projector wave functions, max of LDA/PBE).
  The density needs components up to 2·G_max, i.e. 4·Ecut, so the suggestion is
  `MeshCutoff ≈ 4 × Ecut[Ry] = 8 × Ecut[Ha]`, rounded up to 50 Ry, with a floor of 150 Ry.
  For a compound use the largest value of its elements. The validation runs used 400 Ry throughout.
* **Basis (SIESTA).** SIESTA's automatic DZP basis is generated from the PSML valence configuration; semicore shells
  are detected automatically (`Semic=T`) and get a single-zeta orbital. **Use `PAO.EnergyShift` ≤ 20–50 meV with these
  potentials for 3d transition metals**: with 100 meV the PAOs of Cu/Ni are confined too much and the lattice
  constant collapses by 1–2 % extra (see "Basis sensitivity" below). All validation numbers use DZP + 20 meV.

## Elements

rc in bohr, listed for l = s/p/d(/f). Local potential column = `lloc / rc(5) / dvloc0` (lloc 4 = polynomial continuation).
NLCC = non-linear core correction (model core charge; icmod 1 = polynomial, 3 = Teter function with given
parameters, 2 = Teter function fitted). Errors in mHa as LDA / PBE. (*) = only the semicore levels exceed ~1 mHa,
valence levels are below 1 mHa. (**) = a valence level exceeds 1 mHa (see notes).

| El | valence configuration (reference) | semicore | rc (bohr) | local pot. | NLCC | ghost check | max test error, all states (mHa) LDA / PBE | max valence error (mHa) | Ecut 1 mHa/e (Ha) | suggested MeshCutoff (Ry) |
|---|---|---|---|---|---|---|---|---|---|---|
| H | 1s1 | - | 1.30 | 4/1.17/+0.0 | no | none (LDA+PBE) | 0.51 / 0.60 | 0.60 | 14.0 | 150 |
| Li | 1s2 2s1 | 1s | 2.00/3.00 | 4/1.00/+0.0 | no | none (LDA+PBE) | 2.92 / 3.31 | 0.16 (*) | 13.5 | 150 |
| B | 2s2 2p1 | - | 1.50/1.50 | 4/1.30/+0.0 | no | none (LDA+PBE) | 0.78 / 0.52 | 0.78 | 22.3 | 200 |
| C | 2s2 2p2 | - | 1.28/1.28 | 4/1.14/+0.0 | no | none (LDA+PBE) | 0.94 / 1.02 | 1.02 | 32.9 | 300 |
| N | 2s2 2p3 | - | 1.36/1.36 | 4/1.20/+0.0 | no | none (LDA+PBE) | 0.96 / 0.85 | 0.96 | 36.8 | 300 |
| O | 2s2 2p4 | - | 1.35/1.25 | 4/1.12/+0.0 | no | none (LDA+PBE) | 1.42 / 1.29 | 1.42 (**) | 37.6 | 350 |
| F | 2s2 2p5 | - | 1.19/1.19 | 4/1.02/+0.0 | no | none (LDA+PBE) | 1.46 / 1.33 | 1.46 (**) | 46.4 | 400 |
| Na | 2s2 2p6 3s1 | 2s, 2p | 1.45/1.55/1.80 | 4/1.40/+0.0 | no | none (LDA+PBE) | 0.73 / 0.73 | 0.01 | 27.0 | 250 |
| Mg | 2s2 2p6 3s2 | 2s, 2p | 1.40/1.50/1.80 | 4/1.30/+0.0 | no | none (LDA+PBE) | 1.24 / 1.22 | 0.07 (*) | 31.9 | 300 |
| Al | 3s2 3p1 | - | 2.30/2.40/2.50 | 4/1.80/+0.0 | yes (icmod 1) | none (LDA+PBE) | 0.16 / 0.64 | 0.64 | 10.9 | 150 |
| Si | 3s2 3p2 | - | 2.70/2.70/2.70 | 4/2.70/+0.0 | yes (icmod 1) | none (LDA+PBE) | 0.30 / 0.23 | 0.30 | 11.3 | 150 |
| P | 3s2 3p3 | - | 2.00/2.00/2.20 | 4/1.90/+0.0 | yes (icmod 1) | none (LDA+PBE) | 0.19 / 0.22 | 0.22 | 16.1 | 150 |
| S | 3s2 3p4 | - | 1.90/1.90/2.10 | 4/1.80/+0.0 | yes (icmod 1) | none (LDA+PBE) | 0.19 / 0.20 | 0.20 | 18.4 | 150 |
| Cl | 3s2 3p5 | - | 2.43/2.43/2.70 | 4/2.25/+0.0 | no | none (LDA+PBE) | 0.86 / 0.70 | 0.86 | 18.4 | 150 |
| K | 3s2 3p6 4s1 | 3s, 3p | 2.00/2.10/2.30 | 4/2.00/+0.0 | no | none (LDA+PBE) | 0.16 / 0.11 | 0.00 | 20.7 | 200 |
| Ca | 3s2 3p6 3d0.01 4s1.99 | 3s, 3p | 1.90/2.20/2.00 | 4/1.90/+0.0 | no | none (LDA+PBE) | 0.86 / 0.89 | 0.22 | 25.1 | 250 |
| Ti | 3s2 3p6 3d2 4s2 | 3s, 3p | 2.20/2.40/2.40 | 4/2.20/+0.0 | no | none (LDA+PBE) | 1.22 / 1.14 | 0.83 (*) | 25.2 | 250 |
| Fe | 3s2 3p6 3d6 4s2 | 3s, 3p | 1.71/1.89/1.89 | 4/1.71/+0.0 | no | none (LDA+PBE) | 1.00 / 0.95 | 1.00 | 36.5 | 300 |
| Ni | 3s2 3p6 3d8 4s2 | 3s, 3p | 1.52/1.68/1.68 | 4/1.52/+0.0 | no | none (LDA+PBE) | 0.87 / 0.84 | 0.87 | 45.7 | 400 |
| Cu | 3s2 3p6 3d10 4s1 | 3s, 3p | 1.70/1.80/1.60 | 4/1.60/+0.0 | no | none (LDA+PBE) | 2.87 / 2.82 | 2.87 (**) | 42.8 | 350 |
| Zn | 3s2 3p6 3d10 4s2 | 3s, 3p | 1.52/1.68/1.68 | 4/1.52/+0.5 | no | none (LDA+PBE) | 0.92 / 0.98 | 0.98 | 47.0 | 400 |
| Ga | 3d10 4s2 4p1 | 3d | 2.50/2.60/2.00 | 4/2.00/+2.0 | yes (icmod 1) | none (LDA+PBE) | 1.23 / 1.26 | 0.86 (*) | 31.8 | 300 |
| Ge | 3d10 4s2 4p2 | 3d | 2.60/2.60/2.00 | 4/2.00/+2.0 | no | none (LDA+PBE) | 1.78 / 1.67 | 0.49 (*) | 30.6 | 250 |
| As | 4s2 4p3 | - | 2.40/2.50/2.80 | 4/2.00/+0.5 | yes (icmod 3) | none (LDA+PBE) | 0.72 / 0.92 | 0.92 | 12.3 | 150 |
| Se | 4s2 4p4 | - | 2.61/2.70/2.79 | 4/2.52/+0.0 | yes (icmod 3) | none (LDA+PBE) | 0.64 / 0.82 | 0.82 | 9.9 | 150 |
| Sr | 4s2 4p6 5s2 | 4s, 4p | 2.20/2.40/2.20 | 4/2.20/+1.0 | no | none (LDA+PBE) | 1.22 / 1.20 | 0.10 (*) | 12.7 | 150 |
| Zr | 4s2 4p6 4d2 5s2 | 4s, 4p | 2.20/2.20/2.00 | 4/2.00/+0.0 | yes (icmod 4) | none (LDA+PBE) | 1.41 / 1.50 | 0.11 (*) | 17.2 | 150 |
| Mo | 4s2 4p6 4d5 5s1 | 4s, 4p | 1.99/2.09/1.90 | 4/1.90/+0.0 | no | none (LDA+PBE) | 1.23 / 1.18 | 0.11 (*) | 19.9 | 200 |
| Ag | 4s2 4p6 4d10 5s1 | 4s, 4p | 1.70/1.87/1.70 | 4/1.70/+0.5 | no | none (LDA+PBE) | 1.36 / 1.22 | 0.10 (*) | 27.9 | 250 |
| Au | 5s2 5p6 5d10 6s1 | 5s, 5p | 1.76/2.00/1.92/2.40 | 4/1.76/+0.0 | yes (icmod 2) | none (LDA+PBE) | 2.18 / 2.33 | 0.25 (*) | 21.9 | 200 |

### Notes per element

* **Shipped Hamann inputs used** (rc etc. unchanged, only the test configurations replaced): Li, Si, K, Sr, Zr.
  **Shipped inputs re-tuned** (rc scaled and/or ncon/qcut changed because they gave >1 mHa errors in the standard
  tests, or because of a ghost): C (from the adapted /opt/run/oncv/c_lda.dat), N, O, Cl, Ca, Ti, Cu, Ge (dvloc0 to remove a
  GHOST(+) in LDA), Se, Au. All other elements are new inputs written in the same style.
* **First-row elements C, N, O, F** need small rc (1.1–1.3 bohr) to reach ~1 mHa; the largest remaining error is the
  2p level of the +1 cation (O: 1.4 mHa, F: 1.5 mHa). Getting O/F strictly below 1 mHa costs > 45 / 60 Ha and was not
  considered worth it for a teaching code (these are the "~1 mHa" cases (**)).
* **Li**: 1s is kept in the valence (Hamann's choice); valence 2s/2p errors are ≤0.16 mHa, the 1s semicore level of
  Li⁺ is off by ~3 mHa – harmless, because the 1s level is 50 eV deep.
* **Na, Mg** include 2s2p; **K, Ca** include 3s3p; **Ti, Fe, Ni, Cu, Zn** include 3s3p; **Sr, Zr, Mo, Ag** include 4s4p;
  **Au** includes 5s5p (4f frozen in the core); **Ga, Ge** include 3d (the 3d is counted as semicore in the error split);
  **As, Se** have 3d in the core and use a model core charge (Teter, icmod 3).
* **Ca**: the reference configuration is 3s² 3p⁶ 3d^0.01 4s^1.99 so that the d projector is built on the bound 3d
  state (the default scattering-state d channel gave 3 mHa errors in 3d¹4s¹).
* **Cu (\*\*)**: the 3d⁹4s² test (d→s transfer) gives 2.9 mHa on 3d and on the 3s/3p semicore levels; the error decreases
  only very slowly with rc (Hamann's shipped Cu gives 10.6 mHa in the same test). The +0.5/+1 ions are < 0.5 mHa.
  The SIESTA validation of fcc Cu is good (see below), so this was accepted.
* **Au (\*)**: valence 5d/6s errors ≤ 0.25 mHa; 5s semicore 2.2–2.3 mHa (frozen 4f). Not validated in a solid.
* **Al** uses rc = 2.3/2.4/2.5 with dvloc0 = 0: smaller rc (2.0–2.2) produced persistent GHOST(−) states.
* **Zn, Ag, As**: dvloc0 = +0.5 Ha to remove positive-energy (Zn, Ag) and one deeply bound (As, PBE only) ghost.
* Hardest potentials (largest MeshCutoff): Zn, F, Ni (Ecut ≈ 46–47 Ha → 400 Ry), Cu (43 Ha → 350 Ry).
  Softest: Se, Al, Si, As, Sr, H (≤ 14 Ha → 150 Ry).

## Validation in SIESTA 5.4.2

Protocol: DZP basis with `PAO.EnergyShift 20 meV`, `MeshCutoff 400 Ry`, 7 lattice constants
(LDA: −4…+2 %, PBE: −2…+4 % around experiment), third-order Birch–Murnaghan fit of E(V).
k-grids: 8×8×8 shifted (diamond/zincblende), 6×6×6 shifted (rocksalt), 14×14×14 (fcc/bcc metals,
Methfessel–Paxton order 1, 0.01 Ry, free energy), 6×6×4 Γ-centred (ZnO, only *a* varied at the
experimental c/a = 1.602 and u = 0.382). Ni and Fe are spin-polarized (ferromagnetic start). Moments are the
total spin moment per atom interpolated at the fitted a0. Experimental values: room-temperature lattice constants
(not zero-point corrected; ZPE correction would increase the experimental reference by ~0.1–0.3 %).

| material | a_exp (Å) | a0 LDA (Å) | B0 LDA (GPa) | a0 PBE (Å) | B0 PBE (GPa) | B_exp (GPa) |
|---|---|---|---|---|---|---|
| Si | 5.431 | 5.424 (-0.1 %) | 94 | 5.492 (1.1 %) | 86 | 99.2 |
| C | 3.567 | 3.554 (-0.4 %) | 446 | 3.594 (0.8 %) | 417 | 443 |
| Al | 4.05 | 3.986 (-1.6 %) | 84 | 4.042 (-0.2 %) | 77 | 76 |
| MgO | 4.212 | 4.186 (-0.6 %) | 170 | 4.276 (1.5 %) | 152 | 165 |
| GaAs | 5.653 | 5.642 (-0.2 %) | 75 | 5.807 (2.7 %) | 58 | 75.6 |
| NaCl | 5.64 | 5.481 (-2.8 %) | 32 | 5.708 (1.2 %) | 25 | 26.6 |
| ZnO | 3.25 | 3.213 (-1.1 %) | 162 | 3.300 (1.5 %) | 134 | 143 |
| Cu | 3.615 | 3.518 (-2.7 %) | 191 | 3.631 (0.5 %) | 141 | 140 |
| Ni | 3.524 | 3.422 (-2.9 %) | 265 | 3.489 (-1.0 %) | — | 186 |
| Fe | 2.867 | 2.761 (-3.7 %) | 291 | 2.826 (-1.4 %) | 202 | 168 |

Fe PBE fitted on a = 2.74–2.87 Å (the moment jumps above 2.87 Å); with TZP + 5 meV a0 = 2.838 Å. Ni PBE: E(a) has ~3 meV noise that a tighter SCF (DM 1e-6) does not remove; a0 approximate, B0 not given (open issue).


Expected behaviour (plane-wave literature): LDA 1–2 % short (3 % for Fe, Ni), PBE 0–1.5 % long.


### Basis sensitivity (same potentials, DZP with PAO.EnergyShift = 100 meV)

A first validation pass used `PAO.EnergyShift 100 meV`. sp materials were within 0.1–0.5 % of the 20 meV
results, but the 3d metals contracted strongly (LDA Cu −3.8 %, Ni below −4 %, PBE Ni −4.8 %, PBE B0(Cu) ≈ 90 GPa).
Diagnostics on Cu (LDA, 3 points) gave a0 = 3.507 Å with TZP + 50 meV, 3.519 Å with DZP + 20 meV and
3.511 Å with Hamann's original (softer) Cu potential at DZP + 100 meV – i.e. the problem is PAO confinement, not
the pseudopotential. Results of that pass (a0 in Å, error vs experiment):

| material | LDA, 100 meV | PBE, 100 meV |
|---|---|---|
| Si | 5.415 (-0.3%) | 5.482 (+0.9%) |
| C | 3.552 (-0.4%) | 3.592 (+0.7%) |
| Al | 3.970 (-2.0%) | 4.029 (-0.5%) |
| Cu | 3.477 (-3.8%) | 3.635 (+0.6%) |
| MgO | 4.176 (-0.9%) | 4.263 (+1.2%) |
| GaAs | 5.606 (-0.8%) | 5.771 (+2.1%) |
| NaCl | 5.444 (-3.5%) | 5.669 (+0.5%) |
| Ni | 3.377 (-4.2%) [min. outside range] | 3.356 (-4.8%) [min. outside range] |

## How the potentials were made (reproducible)

Scripts in `/opt/run/pslib` (scratch, not part of the app): `oncv.py` (input writer / runner / parser),
`specs.py` (starting inputs), `tune.py` (rc-scale × ncon × qcut scans, picking the softest ghost-free input with
valence error ≤ 1 mHa and semicore ≤ 1.5 mHa), `build_final.py` (LDA+PBE check), `install.py` (writes this folder),
`val/val.py` (SIESTA equation of state). Each `inputs/*/<El>.dat` here is self-contained and can be rerun with
`LD_LIBRARY_PATH=/opt/fc/lib /opt/oncv/build/src/oncvpsp.x < El.dat > El.out` (PSML is written to `ONCVPSPPSML`).
