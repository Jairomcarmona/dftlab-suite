#!/usr/bin/env python3
"""dftlab_pack.py - pack SIESTA H/S-derived quantities into one compact JSON for DFT Lab.

The browser viewer cannot reasonably read the binary .TSHS/.HSX files, so this companion
script reads the Hamiltonian and overlap with sisl and pre-computes everything that needs them:

  * structure + orbital list (basis labels from the .ion/.ORB_INDX files via the fdf)
  * band energies along a k-path (seekpath standard path, or the fdf BandLines block)
  * Mulliken fat-band weights  w_nk,i = Re[ c_i^* (S(k) c)_i ]  summed by species, by l and by species+l
  * PDOS by species / l / species+l on a Monkhorst-Pack grid (Gaussian broadening)
  * Fermi level and band gap (direct/indirect, VBM/CBM location)
  * optional: Bloch wavefunctions psi_nk(r) on a real-space grid of the cell (int8-quantized)
  * optional: COOP / COHP between nearest-neighbour species pairs

Usage:
  python dftlab_pack.py RUN.fdf -o run.dftlab.json [--path auto|fdf] [--nk 200] [--mp 20]
                        [--wf "band,k[,spin];..."] [--grid 28] [--coop]

Large arrays are stored as {"__array__": 1, "dtype", "shape", "encoding": "base64-gzip",
"data"} (little-endian, C order). Energies in eV, lengths in Angstrom, k in 1/Angstrom
(including the 2*pi factor), fractional k in units of the reciprocal lattice vectors.
"""
from __future__ import annotations

import argparse
import base64
import datetime as _dt
import gzip
import json
import math
import os
import re
import sys

# Many tiny dense diagonalizations: threaded BLAS only adds overhead (set DFTLAB_THREADS to override).
for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, os.environ.get("DFTLAB_THREADS", "1"))

import numpy as np

try:
    import sisl
except ImportError:  # pragma: no cover
    sys.exit("dftlab_pack.py needs sisl >= 0.15 (python3 -m pip install sisl)")

try:
    from scipy.linalg import eigh as _eigh
except ImportError:  # pragma: no cover
    _eigh = None

FORMAT_VERSION = 1
LSYM = "spdfgh"


# --------------------------------------------------------------------------- encoding helpers
def enc(arr, dtype="float32", inline_max=48, decimals=6):
    """Encode a numpy array: small arrays inline (nested lists), large ones base64(gzip(bytes))."""
    a = np.ascontiguousarray(np.asarray(arr), dtype=dtype)
    if a.size <= inline_max:
        if a.dtype.kind == "f":
            return np.round(a.astype(np.float64), decimals).tolist()
        return a.tolist()
    raw = a.astype(a.dtype.newbyteorder("<"), copy=False).tobytes()
    return {
        "__array__": 1,
        "dtype": a.dtype.name,
        "shape": list(a.shape),
        "encoding": "base64-gzip",
        "data": base64.b64encode(gzip.compress(raw, compresslevel=9, mtime=0)).decode("ascii"),
    }


def _r(x, d=6):
    return None if x is None or (isinstance(x, float) and not math.isfinite(x)) else round(float(x), d)


def log(*a):
    print("[dftlab_pack]", *a, file=sys.stderr, flush=True)


# --------------------------------------------------------------------------- reading
def _fdf_value(fdf, key, default=None):
    try:
        v = fdf.get(key)
    except Exception:
        v = None
    return default if v is None else v


def read_system(fdf_path):
    fdf = sisl.get_sile(fdf_path)
    base = os.path.dirname(os.path.abspath(fdf_path))
    label = _fdf_value(fdf, "SystemLabel", "siesta")
    geom = fdf.read_geometry()
    source = None
    H = None
    ef_siesta = None
    tshs = os.path.join(base, f"{label}.TSHS")
    hsx = os.path.join(base, f"{label}.HSX")
    if os.path.isfile(tshs):
        sile = sisl.get_sile(tshs)
        H = sile.read_hamiltonian(geometry=geom)
        try:
            ef_siesta = float(sile.read_fermi_level())
        except Exception:
            ef_siesta = None
        source = os.path.basename(tshs)
    elif os.path.isfile(hsx):
        sile = sisl.get_sile(hsx)
        H = sile.read_hamiltonian(geometry=geom)
        try:
            ef_siesta = float(sile.read_fermi_level())
            if ef_siesta != 0.0:
                # sisl shifts HSX Hamiltonians so that E_F = 0; restore SIESTA's absolute scale
                H.shift(ef_siesta)
        except Exception:
            ef_siesta = None
        source = os.path.basename(hsx)
    else:
        H = fdf.read_hamiltonian()
        source = "fdf.read_hamiltonian"
    return fdf, label, H, ef_siesta, source


def spin_info(H):
    s = H.spin
    if s.is_polarized:
        return {"kind": "polarized", "nchannels": 2, "degeneracy": 1, "noncollinear": False}
    if s.is_noncolinear or s.is_spinorbit:
        return {"kind": "spin-orbit" if s.is_spinorbit else "noncollinear", "nchannels": 1, "degeneracy": 1, "noncollinear": True}
    return {"kind": "unpolarized", "nchannels": 1, "degeneracy": 2, "noncollinear": False}


def orbital_table(geom):
    rows = []
    for ia in range(geom.na):
        atom = geom.atoms[ia]
        for io, o in enumerate(atom.orbitals):
            rows.append({
                "atom": ia, "species": atom.tag, "Z": int(atom.Z),
                "n": int(getattr(o, "n", 0) or 0), "l": int(getattr(o, "l", 0) or 0),
                "m": int(getattr(o, "m", 0) or 0), "zeta": int(getattr(o, "zeta", 1) or 1),
                "P": bool(getattr(o, "P", False)),
                "name": o.name() if hasattr(o, "name") else f"o{io}",
            })
    return rows


# --------------------------------------------------------------------------- k-space helpers
def lattice_gauge(H):
    """Name of the 'lattice' (cell-periodic phase e^{ik.T}) gauge: 'lattice' in sisl >= 0.16, 'cell' in 0.15."""
    for g in ("lattice", "cell", "R"):
        try:
            H.Hk((0, 0, 0), gauge=g, format="array")
            return g
        except Exception:  # noqa: BLE001
            continue
    return "lattice"


class KSolver:
    """Diagonalize H(k), S(k) in the lattice gauge; return energies, vectors and Mulliken weights."""

    def __init__(self, H, spin):
        self.H = H
        self.spin = spin
        self.no = H.no
        self.nc = spin["noncollinear"]
        self.gauge = lattice_gauge(H)

    def solve(self, k, ispin=0, vectors=True):
        H = self.H
        kw = {"gauge": self.gauge, "format": "array"}
        if self.spin["kind"] == "polarized":
            Hk = H.Hk(k, spin=ispin, **kw)
        else:
            Hk = H.Hk(k, **kw)
        if H.orthogonal:
            Sk = np.eye(Hk.shape[0])
        else:
            Sk = H.Sk(k, **kw)
            if Sk.shape[0] != Hk.shape[0]:
                Sk = np.kron(Sk, np.eye(2))
        if _eigh is not None:
            e, c = (_eigh(Hk, Sk) if vectors else (_eigh(Hk, Sk, eigvals_only=True), None))
        else:  # numpy fallback via Cholesky
            Lc = np.linalg.cholesky(Sk)
            Li = np.linalg.inv(Lc)
            e, y = np.linalg.eigh(Li @ Hk @ Li.conj().T)
            c = Li.conj().T @ y
        if not vectors:
            return e, None, None, None
        w = np.real(np.conj(c) * (Sk @ c))  # (n_basis, n_bands)
        if self.nc and w.shape[0] == 2 * self.no:
            w = w[0::2] + w[1::2]
        return e, c, w, (Hk, Sk)


def align_energy_reference(H, solver, spin, nelec, ef_siesta):
    """Put H on SIESTA's absolute energy scale.

    Depending on the file and the sisl version, the Hamiltonian read from .TSHS/.HSX is either on
    SIESTA's absolute scale or already shifted so that E_F = 0. A quick Fermi-level estimate on a
    coarse grid tells which one it is; when it sits at ~0 instead of ~E_F(SIESTA), H is shifted back."""
    if ef_siesta is None or not nelec or abs(ef_siesta) < 1e-3:
        return "as read"
    k, w, _ = kgrid_mp(H, 6)
    eigs = [np.array([solver.solve(kk, s, vectors=False)[0] for kk in k]) for s in range(spin["nchannels"])]
    ef0 = fermi_from_eigs(eigs, w, nelec, spin["degeneracy"])
    if abs(ef0) < abs(ef0 - ef_siesta):
        H.shift(ef_siesta)
        log(f"H was referenced to E_F (estimate {ef0:+.3f} eV); shifted by {ef_siesta:+.4f} eV to SIESTA's absolute scale")
        return "shifted back by E_F(SIESTA)"
    return "absolute (as read)"


def kgrid_mp(H, n):
    nn = [n if H.nsc[i] > 1 else 1 for i in range(3)]
    bz = sisl.MonkhorstPack(H, nn, trs=True)
    return np.asarray(bz.k), np.asarray(bz.weight) / np.sum(bz.weight), nn


def frac_to_cart(H, kf):
    return np.asarray(kf) @ H.rcell  # 1/Ang incl. 2*pi


def cart_to_frac(H, kc):
    return np.asarray(kc) @ np.linalg.inv(H.rcell)


_GREEK = {"GAMMA": "Γ", "G": "Γ", "\\GAMMA": "Γ", "SIGMA": "Σ", "DELTA": "Δ", "LAMBDA": "Λ"}


def pretty(lbl):
    s = str(lbl).strip().strip("'\"")
    u = s.upper()
    if u in _GREEK:
        return _GREEK[u]
    m = re.match(r"^([A-Z]+)_(\d+)$", s)
    if m:
        return (_GREEK.get(m.group(1), m.group(1))) + m.group(2)
    return s.lstrip("\\")


def path_seekpath(H, nk):
    import warnings

    import seekpath

    g = H.geometry
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        res = seekpath.get_path((g.cell, g.fxyz, [int(a.Z) for a in g.atoms]), with_time_reversal=True)
    Bp = np.asarray(res["reciprocal_primitive_lattice"])  # rows, 1/Ang incl 2pi
    R = np.asarray(res.get("rotation_matrix", np.eye(3)))
    Bo = np.asarray(H.rcell)
    best = None
    for cand in (np.eye(3), R, R.T, np.linalg.inv(R)):
        Bc = Bp @ cand  # rotate reciprocal rows back to the input frame
        f = Bc @ np.linalg.inv(Bo)
        err = np.abs(f - np.round(f)).max()
        if best is None or err < best[0]:
            best = (err, cand)
    if best[0] > 1e-3:
        raise RuntimeError("seekpath cell is not commensurate with the input cell")
    rot = best[1]
    pts = {k: np.asarray(v) @ Bp @ rot for k, v in res["point_coords"].items()}  # cartesian, input frame
    segs = res["path"]
    total = sum(np.linalg.norm(pts[b] - pts[a]) for a, b in segs)
    info = {"bravais": res.get("bravais_lattice_extended"), "spacegroup": res.get("spacegroup_international"),
            "spacegroupNumber": res.get("spacegroup_number")}
    return build_path(H, [(a, pts[a], b, pts[b]) for a, b in segs], nk, total), "seekpath", info


def path_fdf(H, fdf, nk_unused=None):
    blk = fdf.get("BandLines")
    if not blk:
        raise RuntimeError("no %block BandLines in the fdf")
    scale = str(_fdf_value(fdf, "BandLinesScale", "pi/a")).lower()
    alat = _fdf_value(fdf, "LatticeConstant", None)
    entries = []
    for ln in blk:
        t = ln.split()
        if len(t) < 4:
            continue
        n = int(t[0]); kv = np.array([float(x) for x in t[1:4]]); lab = " ".join(t[4:]) if len(t) > 4 else ""
        if scale.startswith("reciprocal"):
            kc = kv @ H.rcell
        else:  # pi/a, with a the LatticeConstant in Ang
            a_ang = _lattice_constant_ang(fdf)
            kc = kv * math.pi / a_ang
        entries.append((n, kc, lab))
    # expand like SIESTA: n points from the previous point to this one (n=1 -> jump)
    ks, xs, labels = [], [], []
    x = 0.0
    prev = None
    for n, kc, lab in entries:
        if prev is None or n <= 1:
            if prev is not None and labels and abs(labels[-1]["x"] - x) < 1e-12:
                labels[-1]["label"] += "|" + pretty(lab)
            else:
                labels.append({"x": x, "label": pretty(lab), "raw": lab})
            ks.append(kc); xs.append(x); prev = kc
            continue
        for i in range(1, n + 1):
            k = prev + (kc - prev) * i / n
            x += np.linalg.norm(k - ks[-1])
            ks.append(k); xs.append(x)
        labels.append({"x": x, "label": pretty(lab), "raw": lab})
        prev = kc
    kc = np.array(ks)
    return {"kcart": kc, "kfrac": cart_to_frac(H, kc), "x": np.array(xs), "labels": labels}, "fdf", {}


def _lattice_constant_ang(fdf):
    try:
        v = fdf.get("LatticeConstant", unit="Ang")
        if v:
            return float(v)
    except Exception:
        pass
    return 1.0


def build_path(H, segs, nk, total):
    """segs: [(labelA, kA_cart, labelB, kB_cart)]; points per segment proportional to its length."""
    ks, xs, labels = [], [], []
    x = 0.0
    last = None
    for a, ka, b, kb in segs:
        if last != a:  # path start or discontinuity: new start point at the same x
            if last is None:
                labels.append({"x": x, "label": pretty(a), "raw": a})
            else:
                labels[-1]["label"] += "|" + pretty(a)
            ks.append(ka); xs.append(x)
        L = np.linalg.norm(kb - ka)
        n = max(2, int(round(nk * L / total)))
        for i in range(1, n + 1):
            k = ka + (kb - ka) * i / n
            x += np.linalg.norm(k - ks[-1]) if last == a or i > 1 else np.linalg.norm(k - ka)
            ks.append(k); xs.append(x)
        labels.append({"x": x, "label": pretty(b), "raw": b})
        last = b
    kc = np.array(ks)
    return {"kcart": kc, "kfrac": cart_to_frac(H, kc), "x": np.array(xs), "labels": labels}


# --------------------------------------------------------------------------- analysis
def gap_analysis(eigs, ef, kfrac):
    """eigs: list over channels of (nk, nb) arrays."""
    out = {"channels": []}
    vbm = (-np.inf, None, None, None)
    cbm = (np.inf, None, None, None)
    metallic = False
    direct = np.inf
    for s, E in enumerate(eigs):
        occ = E <= ef + 1e-6
        bmin, bmax = E.min(axis=0), E.max(axis=0)
        cross = bool(np.any((bmin < ef - 1e-6) & (bmax > ef + 1e-6)))
        metallic |= cross
        ev = np.where(occ, E, -np.inf)
        ec = np.where(~occ, E, np.inf)
        kv = np.unravel_index(np.argmax(ev), E.shape)
        kc = np.unravel_index(np.argmin(ec), E.shape)
        dg = np.min(ec.min(axis=1) - ev.max(axis=1))
        direct = min(direct, dg)
        ch = {"spin": s, "vbm": _r(ev[kv]), "vbmK": [_r(v) for v in kfrac[kv[0]]], "vbmBand": int(kv[1]),
              "cbm": _r(ec[kc]), "cbmK": [_r(v) for v in kfrac[kc[0]]], "cbmBand": int(kc[1]),
              "metallic": cross, "gap": 0.0 if cross else _r(ec[kc] - ev[kv]), "directGap": 0.0 if cross else _r(dg)}
        out["channels"].append(ch)
        if ev[kv] > vbm[0]:
            vbm = (ev[kv], kv[0], kv[1], s)
        if ec[kc] < cbm[0]:
            cbm = (ec[kc], kc[0], kc[1], s)
    out.update({
        "metallic": bool(metallic),
        "gap": 0.0 if metallic else _r(cbm[0] - vbm[0]),
        "directGap": 0.0 if metallic else _r(direct),
        "type": "metal" if metallic else ("direct" if (np.allclose(kfrac[vbm[1]], kfrac[cbm[1]]) and vbm[3] == cbm[3]) else "indirect"),
        "vbm": {"e": _r(vbm[0]), "k": [_r(v) for v in kfrac[vbm[1]]] if vbm[1] is not None else None, "band": vbm[2], "spin": vbm[3]},
        "cbm": {"e": _r(cbm[0]), "k": [_r(v) for v in kfrac[cbm[1]]] if cbm[1] is not None else None, "band": cbm[2], "spin": cbm[3]},
    })
    return out


def group_index(orbs, key):
    keys = []
    for o in orbs:
        if key == "species":
            keys.append(o["species"])
        elif key == "l":
            keys.append(LSYM[o["l"]])
        else:
            keys.append(f"{o['species']}-{LSYM[o['l']]}")
    names = list(dict.fromkeys(keys))
    M = np.zeros((len(names), len(orbs)))
    for i, k in enumerate(keys):
        M[names.index(k), i] = 1.0
    return names, M


def fermi_from_eigs(eigs, weights, nelec, degeneracy, kT=0.025):
    """Fermi level by bisection on a Fermi-Dirac occupation (all channels)."""
    allE = np.concatenate([E.ravel() for E in eigs])
    lo, hi = allE.min() - 1, allE.max() + 1

    def count(mu):
        n = 0.0
        for E in eigs:
            x = np.clip((E - mu) / kT, -60, 60)
            n += degeneracy * np.sum(weights[:, None] / (1 + np.exp(x)))
        return n

    for _ in range(200):
        mid = 0.5 * (lo + hi)
        if count(mid) < nelec:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


# --------------------------------------------------------------------------- COOP/COHP masks
def nn_pairs(geom, tol=1.15):
    """Nearest-neighbour distance per species pair and the orbital-pair masks over the supercell."""
    na = geom.na
    xyz = geom.xyz
    sc_xyz = geom.axyz(np.arange(geom.na_s))
    tags = [geom.atoms[ia].tag for ia in range(na)]
    dmin = {}
    for ia in range(na):
        d = np.linalg.norm(sc_xyz - xyz[ia], axis=1)
        for ja_s in range(geom.na_s):
            dd = d[ja_s]
            if dd < 1e-4:
                continue
            key = tuple(sorted((tags[ia], tags[ja_s % na])))
            if dd < dmin.get(key, np.inf):
                dmin[key] = dd
    pairs = {}
    for key, d0 in dmin.items():
        sel = []
        for ia in range(na):
            d = np.linalg.norm(sc_xyz - xyz[ia], axis=1)
            for ja_s in np.nonzero((d > 1e-4) & (d <= d0 * tol))[0]:
                if tuple(sorted((tags[ia], tags[ja_s % na]))) == key:
                    sel.append((ia, int(ja_s)))
        pairs[key] = {"d": float(d0), "atomPairs": sel}
    return pairs


def masked_elements(csr_sc, geom, atom_pairs):
    """Pre-select the supercell matrix elements M_ij(T), i in atom a, j in atom b(T), for the given pairs.
    Returns (rows, cols_in_unit_cell, values, T_cartesian)."""
    no = geom.no
    rows, cols, vals = [], [], []
    csr = csr_sc.tocsr()
    for ia, ja_s in atom_pairs:
        o1, o2 = geom.a2o(ia, all=True), geom.a2o(ja_s, all=True)
        sub = csr[o1][:, o2].tocoo()
        if sub.nnz == 0:
            continue
        rows.append(o1[sub.row]); cols.append(o2[sub.col]); vals.append(sub.data)
    if not rows:
        return None
    r = np.concatenate(rows); c = np.concatenate(cols); v = np.concatenate(vals)
    T = geom.sc_off[c // no] @ geom.cell
    return r, c % no, v, T


def masked_k_matrix(sel, no, k_cart):
    """sum_T M_ij(T) exp(i k.T) for the pre-selected elements (lattice gauge)."""
    M = np.zeros((no, no), complex)
    if sel is None:
        return M
    r, c, v, T = sel
    np.add.at(M, (r, c), v * np.exp(1j * (T @ k_cart)))
    return M


# --------------------------------------------------------------------------- wavefunctions
def parse_wf_spec(spec):
    out = []
    for part in [p.strip() for p in (spec or "").split(";") if p.strip()]:
        t = [x.strip() for x in part.split(",")]
        if len(t) < 2:
            raise SystemExit(f"--wf entry '{part}' must be 'band,k[,spin]'")
        out.append({"band": t[0], "k": t[1], "spin": int(t[2]) if len(t) > 2 else 0})
    return out


def resolve_k(kspec, path, gap):
    s = kspec.strip()
    if s.lower() in ("vbm", "cbm"):
        k = (gap.get(s.lower()) or {}).get("k")
        if k is None:
            raise SystemExit(f"cannot resolve k='{s}' (no gap information)")
        return np.array(k, float), s.upper()
    if re.match(r"^[-+0-9.eE]+([/:][-+0-9.eE]+){2}$", s):
        return np.array([float(x) for x in re.split("[/:]", s)]), s
    want = pretty(s)
    for lab, kf in zip(path["labels"], path.get("labelK", [])):
        for piece in lab["label"].split("|"):
            if piece == want:
                return np.asarray(kf, float), want
    raise SystemExit(f"k-point label '{s}' not found on the path (labels: {[l['label'] for l in path['labels']]})")


def resolve_band(bspec, gap, nb):
    s = bspec.strip().lower()
    m = re.match(r"^(vbm|homo|cbm|lumo)([-+]\d+)?$", s)
    if m:
        base = gap.get("vbm" if m.group(1) in ("vbm", "homo") else "cbm", {}).get("band")
        if base is None:
            raise SystemExit(f"cannot resolve band '{bspec}'")
        return base + int(m.group(2) or 0)
    b = int(s) - 1  # 1-based on the command line
    if not 0 <= b < nb:
        raise SystemExit(f"band {bspec} out of range 1..{nb}")
    return b


def grid_shape(H, n):
    lens = np.linalg.norm(H.cell, axis=1)
    return [max(8, int(round(n * L / lens.max()))) for L in lens]


def compute_wavefunction(H, spin, k, band, ispin, shape):
    kw = {"gauge": lattice_gauge(H)}
    es = H.eigenstate(k, spin=ispin, **kw) if spin["kind"] == "polarized" else H.eigenstate(k, **kw)
    sub = es.sub(band)
    energy = float(np.asarray(es.eig)[band])
    comps = []
    for spinor in ([0, 1] if spin["noncollinear"] else [None]):
        grid = sisl.Grid(shape, geometry=H.geometry, dtype=np.complex128)
        if spinor is None:
            sub.wavefunction(grid)
        else:
            sub.wavefunction(grid, spinor=spinor)
        comps.append(np.asarray(grid.grid))
    dv = sisl.Grid(shape, geometry=H.geometry).dvolume
    # fix the arbitrary global phase: largest-|psi| point real and positive
    ref = comps[0].ravel()[np.argmax(np.abs(comps[0]))]
    ph = np.conj(ref) / abs(ref) if abs(ref) > 0 else 1.0
    comps = [c * ph for c in comps]
    norm = float(sum(np.sum(np.abs(c) ** 2) for c in comps) * dv)
    out = []
    for c in comps:
        amax = max(np.abs(c.real).max(), np.abs(c.imag).max(), 1e-30)
        scale = amax / 127.0
        out.append({
            "scale": scale,
            "re": enc(np.round(c.real / scale).astype(np.int8), "int8"),
            "im": enc(np.round(c.imag / scale).astype(np.int8), "int8"),
        })
    return energy, out, norm, dv


# --------------------------------------------------------------------------- main
def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("fdf", help="SIESTA input file of the run (its directory must hold the .TSHS or .HSX)")
    ap.add_argument("-o", "--output", default=None, help="output JSON (default: <SystemLabel>.dftlab.json)")
    ap.add_argument("--path", choices=["auto", "fdf", "seekpath"], default="auto",
                    help="k-path: seekpath standard path (auto falls back to the fdf BandLines)")
    ap.add_argument("--nk", type=int, default=200, help="approx. number of k-points along the path")
    ap.add_argument("--mp", type=int, default=20, help="Monkhorst-Pack grid n x n x n for PDOS/Fermi/gap (0 = skip)")
    ap.add_argument("--sigma", type=float, default=0.10, help="Gaussian broadening for PDOS/COOP (eV)")
    ap.add_argument("--de", type=float, default=0.02, help="energy step of the DOS grid (eV)")
    ap.add_argument("--emin", type=float, default=None, help="DOS window minimum (eV, absolute; default lowest band - 1)")
    ap.add_argument("--emax", type=float, default=None, help="DOS window maximum (eV, absolute; default E_F + 15)")
    ap.add_argument("--wf", default="", help='wavefunctions: "band,k[,spin];..."  band = 1-based index | vbm | cbm | vbm-1 ...; '
                                             'k = path label (G, X, ...) | "kx/ky/kz" fractional | vbm | cbm')
    ap.add_argument("--grid", type=int, default=28, help="wavefunction grid points along the longest lattice vector")
    ap.add_argument("--coop", action="store_true", help="also compute COOP/COHP between nearest-neighbour species pairs")
    ap.add_argument("--nelec", type=float, default=None, help="number of electrons (default from the basis q0)")
    args = ap.parse_args(argv)

    fdf, label, H, ef_siesta, src = read_system(args.fdf)
    geom = H.geometry
    spin = spin_info(H)
    log(f"{label}: {geom.na} atoms, {geom.no} orbitals, spin={spin['kind']}, H from {src}")
    orbs = orbital_table(geom)
    nelec = args.nelec if args.nelec is not None else float(np.sum(geom.q0)) if np.sum(geom.q0) > 0 else None
    solver = KSolver(H, spin)
    nch = spin["nchannels"]
    energy_reference = align_energy_reference(H, solver, spin, nelec, ef_siesta)

    pack = {
        "dftlab": "siesta-pack", "version": FORMAT_VERSION,
        "generator": f"dftlab_pack.py (sisl {sisl.__version__}, numpy {np.__version__})",
        "created": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
        "source": {"fdf": os.path.basename(args.fdf), "systemLabel": label, "hamiltonian": src},
        "units": {"energy": "eV", "length": "Ang", "k": "1/Ang (cartesian, incl. 2pi)", "kfrac": "reciprocal lattice units",
                  "dos": "states/eV/cell (spin degeneracy included in 'total')", "wavefunction": "Ang^-3/2 (after * scale)"},
        "spin": spin,
        "nElectrons": nelec,
        "energyReference": energy_reference,
    }
    pack["structure"] = {
        "cell": np.round(geom.cell, 8).tolist(), "positions": np.round(geom.xyz, 8).tolist(),
        "fractional": np.round(geom.fxyz, 8).tolist(),
        "species": [geom.atoms[ia].tag for ia in range(geom.na)], "Z": [int(geom.atoms[ia].Z) for ia in range(geom.na)],
        "symbols": [geom.atoms[ia].symbol for ia in range(geom.na)],
        "nAtoms": int(geom.na), "nOrbitals": int(geom.no), "orbitals": orbs,
        "rcell": np.round(H.rcell, 8).tolist(),
        "pbc": [bool(H.nsc[i] > 1) for i in range(3)],
    }

    # ---------------- MP grid: Fermi level, PDOS, gap, COOP
    sig = args.sigma
    mp_eigs = None
    if args.mp > 0:
        kmp, wmp, nn = kgrid_mp(H, args.mp)
        log(f"MP grid {nn}: {len(kmp)} irreducible k-points")
        mp_eigs = [np.zeros((len(kmp), geom.no * (2 if spin["noncollinear"] else 1))) for _ in range(nch)]
        mp_w = [np.zeros((len(kmp), geom.no, mp_eigs[0].shape[1])) for _ in range(nch)]
        coop_data = None
        if args.coop:
            pairs = nn_pairs(geom)
            Ssc = H.tocsr(dim=H.S_idx) if not H.orthogonal else None
            Hsc = [H.tocsr(dim=s) for s in range(nch if spin["kind"] == "polarized" else 1)]
            if spin["noncollinear"]:
                log("COOP/COHP for non-collinear spin uses the spin-diagonal (charge) part of H")
                Hsc = [0.5 * (H.tocsr(dim=0) + H.tocsr(dim=1))]
            sel = {key: {"coop": masked_elements(Ssc, geom, pr["atomPairs"]) if Ssc is not None else None,
                         "cohp": [masked_elements(h, geom, pr["atomPairs"]) for h in Hsc]} for key, pr in pairs.items()}
            coop_data = {"pairs": pairs, "coop": {}, "cohp": {}}
        for ik, k in enumerate(kmp):
            kc = frac_to_cart(H, k)
            for s in range(nch):
                e, c, w, (Hk, Sk) = solver.solve(k, s)
                mp_eigs[s][ik] = e
                mp_w[s][ik] = w
                if coop_data is not None:
                    for key, pr in pairs.items():
                        for kind, sl in (("coop", sel[key]["coop"]), ("cohp", sel[key]["cohp"][s if len(Hsc) > 1 else 0])):
                            if sl is None:
                                continue
                            M = masked_k_matrix(sl, geom.no, kc)
                            if spin["noncollinear"]:
                                M = np.kron(M, np.eye(2))
                            val = np.real(np.einsum("in,ij,jn->n", np.conj(c), M, c))
                            coop_data[kind].setdefault(key, np.zeros((nch, len(kmp), len(e))))[s, ik] = val
        ef_calc = fermi_from_eigs(mp_eigs, wmp, nelec, spin["degeneracy"]) if nelec else None
        fermi = ef_siesta if ef_siesta is not None else ef_calc
        allE = np.concatenate([E.ravel() for E in mp_eigs])
        emin = args.emin if args.emin is not None else float(allE.min()) - 1.0
        emax = args.emax if args.emax is not None else float(min(allE.max(), fermi + 15.0))
        E = np.arange(emin, emax + 0.5 * args.de, args.de)

        def broaden(eigs_s, weights_s):
            # eigs_s (nk, nb), weights_s (nk, nb) -> (nE,)
            out = np.zeros_like(E)
            pref = 1.0 / (sig * math.sqrt(2 * math.pi))
            for ik in range(eigs_s.shape[0]):
                x = (E[:, None] - eigs_s[ik][None, :]) / sig
                out += np.exp(-0.5 * x * x) @ weights_s[ik] * pref
            return out

        deg = spin["degeneracy"]
        total = np.array([broaden(mp_eigs[s], wmp[:, None] * np.ones_like(mp_eigs[s]) * deg) for s in range(nch)])
        dos = {"mp": nn, "nk": int(len(kmp)), "sigma": sig, "energy": enc(E), "total": enc(total)}
        for key in ("species", "l", "speciesL"):
            names, M = group_index(orbs, {"speciesL": "sl"}.get(key, key))
            proj = np.zeros((nch, len(names), len(E)))
            for s in range(nch):
                for ig in range(len(names)):
                    wg = np.einsum("o,kon->kn", M[ig], mp_w[s]) * wmp[:, None] * deg
                    proj[s, ig] = broaden(mp_eigs[s], wg)
            dos["by" + key[0].upper() + key[1:]] = {"names": names, "data": enc(proj)}
        idx = E <= fermi
        _trapz = getattr(np, "trapezoid", None) or np.trapz
        dos["electronsBelowFermi"] = _r(float(_trapz(total.sum(axis=0)[idx], E[idx])))
        pack["dos"] = dos
        if coop_data is not None:
            co = {"pairs": [], "energy": "same as dos.energy"}
            for key, pr in coop_data["pairs"].items():
                entry = {"species": list(key), "distance": _r(pr["d"]), "nPairs": len(pr["atomPairs"])}
                for kind in ("coop", "cohp"):
                    if key in coop_data[kind]:
                        arr = coop_data[kind][key]
                        entry[kind] = enc(np.array([broaden(mp_eigs[s], arr[s] * wmp[:, None] * deg) for s in range(nch)]))
                co["pairs"].append(entry)
            co["note"] = "COOP = sum_nk w_k Re[c^+ S_AB(k) c] delta(E-e_nk); COHP same with H (plot -COHP). Both A->B and B->A counted."
            pack["coop"] = co
        pack["fermiComputed"] = _r(ef_calc) if ef_calc is not None else None
    else:
        fermi = ef_siesta
        kmp = None
    pack["fermi"] = _r(fermi)
    pack["fermiSiesta"] = _r(ef_siesta) if ef_siesta is not None else None

    # ---------------- band path
    path = None
    pinfo = {}
    if args.path in ("auto", "seekpath"):
        try:
            path, psrc, pinfo = path_seekpath(H, args.nk)
        except Exception as exc:  # noqa: BLE001
            if args.path == "seekpath":
                raise
            log(f"seekpath unavailable ({exc}); using fdf BandLines")
    if path is None:
        try:
            path, psrc, pinfo = path_fdf(H, fdf)
        except Exception as exc:  # noqa: BLE001
            log(f"no band path: {exc}")
    if path is not None:
        nk = len(path["kfrac"])
        nb = geom.no * (2 if spin["noncollinear"] else 1)
        eb = np.zeros((nch, nk, nb))
        names_s, Ms = group_index(orbs, "species")
        names_l, Ml = group_index(orbs, "l")
        names_sl, Msl = group_index(orbs, "sl")
        fs = np.zeros((nch, len(names_s), nk, nb), np.float32)
        fl = np.zeros((nch, len(names_l), nk, nb), np.float32)
        fsl = np.zeros((nch, len(names_sl), nk, nb), np.float32)
        for ik, k in enumerate(path["kfrac"]):
            for s in range(nch):
                e, c, w, _ = solver.solve(k, s)
                eb[s, ik] = e
                fs[s, :, ik] = Ms @ w
                fl[s, :, ik] = Ml @ w
                fsl[s, :, ik] = Msl @ w
        # label positions in fractional coordinates
        labk = []
        for lab in path["labels"]:
            i = int(np.argmin(np.abs(path["x"] - lab["x"])))
            labk.append(np.round(path["kfrac"][i], 6).tolist())
        path["labelK"] = labk
        pack["bands"] = {
            "pathSource": psrc, "pathInfo": pinfo, "nk": nk, "nBands": nb,
            "x": enc(path["x"]), "kfrac": enc(path["kfrac"]), "kcart": enc(path["kcart"]),
            "labels": [{"x": _r(l["x"]), "label": l["label"], "k": kk} for l, kk in zip(path["labels"], labk)],
            "energies": enc(eb),  # [spin][k][band]
            "fatbands": {
                "definition": "w_nk,i = Re[c_i^* (S(k) c)_i], c^+ S c = 1; summed over orbitals of each group",
                "bySpecies": {"names": names_s, "data": enc(fs)},
                "byL": {"names": names_l, "data": enc(fl)},
                "bySpeciesL": {"names": names_sl, "data": enc(fsl)},
            },
        }

    # ---------------- gap (MP grid + path)
    if mp_eigs is not None or path is not None:
        eigs, kf = [], []
        for s in range(nch):
            parts = []
            if mp_eigs is not None:
                parts.append(mp_eigs[s])
            if path is not None:
                parts.append(eb[s])
            eigs.append(np.vstack(parts))
        if mp_eigs is not None:
            kf.append(kmp)
        if path is not None:
            kf.append(path["kfrac"])
        pack["gap"] = gap_analysis(eigs, fermi, np.vstack(kf))
        pack["gap"]["source"] = "MP grid + band path" if (mp_eigs is not None and path is not None) else ("MP grid" if mp_eigs is not None else "band path")

    # ---------------- wavefunctions
    wfs = parse_wf_spec(args.wf)
    if wfs:
        shape = grid_shape(H, args.grid)
        pack["wavefunctions"] = {
            "grid": shape,
            "phaseConvention": (
                "psi_nk(r) = sum_{i,T} c_i phi_i(r - R_i - T) exp(i k.T) (lattice gauge, sisl), sampled on the "
                "grid r = (i/N1) a1 + (j/N2) a2 + (l/N3) a3 of the home cell, C order [i][j][l]. It is the full Bloch "
                "function, so a neighbouring cell n = (n1,n2,n3) is obtained as psi(r + n.A) = psi(r) * "
                "exp(2*pi*i*(kfrac . n)). The global phase is fixed so that the largest-|psi| point is real "
                "and positive. Values = int8 * scale (Ang^-3/2); sum |psi|^2 dV over the home cell ~ 1."),
            "states": [],
        }
        if path is None:
            path = {"labels": [], "labelK": []}
        for wf in wfs:
            k, klabel = resolve_k(wf["k"], path, pack.get("gap", {}))
            b = resolve_band(wf["band"], pack.get("gap", {}), geom.no * (2 if spin["noncollinear"] else 1))
            ispin = wf["spin"] if spin["kind"] == "polarized" else 0
            energy, comps, norm, dv = compute_wavefunction(H, spin, k, b, ispin, shape)
            pack["wavefunctions"]["states"].append({
                "band": b + 1, "bandIndex0": b, "k": np.round(k, 6).tolist(), "kLabel": klabel, "spin": ispin,
                "energy": _r(energy), "norm": _r(norm), "dV": dv,
                "components": comps if spin["noncollinear"] else comps[0],
                "spinor": spin["noncollinear"],
            })
            log(f"wavefunction band {b + 1} at k={k} spin {ispin}: E={energy:.4f} eV, norm={norm:.4f}")

    out = args.output or f"{label}.dftlab.json"
    with open(out, "w") as fh:
        json.dump(pack, fh, separators=(",", ":"), allow_nan=False, default=_json_default)
    log(f"wrote {out} ({os.path.getsize(out) / 1024:.1f} KiB)")
    return 0


def _json_default(o):
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return None if not np.isfinite(o) else float(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    if isinstance(o, (np.bool_,)):
        return bool(o)
    raise TypeError(type(o))


if __name__ == "__main__":
    sys.exit(main())
