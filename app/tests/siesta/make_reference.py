#!/usr/bin/env python3
"""Compute reference numbers for the SIESTA fixtures independently of the JS parsers.

Uses sisl readers where they exist (bands, EIG, KP, PDOS geometry) and plain numpy /
xml.etree / regular expressions otherwise. Writes fixtures/reference.json, which
run_tests.mjs compares against the browser parsers.

    python3 make_reference.py            # (re)generate fixtures/reference.json
"""
import base64
import gzip
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, "fixtures")
BOHR = 0.529177210903

try:
    import sisl
except ImportError:  # pragma: no cover
    sisl = None


def p(*parts):
    return os.path.join(FIX, *parts)


def trapz_upto(x, y, xmax):
    x = np.asarray(x, float); y = np.asarray(y, float)
    m = x <= xmax
    xs, ys = x[m], y[m]
    if m.sum() < len(x) and m.sum() > 0:
        i = m.sum()
        yc = np.interp(xmax, x[i - 1:i + 1], y[i - 1:i + 1])
        xs = np.append(xs, xmax); ys = np.append(ys, yc)
    return float(np.sum(0.5 * (ys[1:] + ys[:-1]) * np.diff(xs)))


# ------------------------------------------------------------------ bands
def ref_bands(path):
    sile = sisl.get_sile(path)
    ef = float(sile.read_fermi_level())
    data = sile.read_data()
    if len(data) == 3:
        (xl, ll), k, b = data
        fmt = "BandLines"
    else:
        k, b = data
        xl, ll, fmt = [], [], "BandPoints"
    b = np.asarray(b) + ef  # sisl returns E - Ef
    nk, ns, nb = b.shape
    # independent band edges along the path
    vb = b[b <= ef]; cb = b[b > ef]
    crossing = any((b[:, s, i].min() < ef - 1e-6) and (b[:, s, i].max() > ef + 1e-6) for s in range(ns) for i in range(nb))
    return {
        "format": fmt, "fermi": ef, "nk": int(nk), "nSpin": int(ns), "nBands": int(nb),
        "nLabels": len(ll), "labelX_bohr": [float(x) for x in xl],
        "e_first": float(b[0, 0, 0]), "e_last": float(b[-1, -1, -1]),
        "vbm": float(vb.max()) if vb.size else None, "cbm": float(cb.min()) if cb.size else None,
        "metallic": bool(crossing),
        "pathLength_bohr": float(np.asarray(k).ravel()[-1]) if fmt == "BandLines" else None,
    }


# ------------------------------------------------------------------ EIG
def ref_eig(path, kp_path):
    # plain numpy reading (sisl's eigSile assumes nspin blocks, which breaks for NC/SOC headers 4/8)
    lines = open(path).read().split("\n")
    ef = float(lines[0])
    nb, nsf, nk = map(int, lines[1].split())
    vals = np.array(" ".join(lines[2:]).split(), float)
    per = len(vals) // nk
    ns = (per - 1) // nb
    eig = vals.reshape(nk, per)[:, 1:].reshape(nk, ns, nb).transpose(1, 0, 2)
    if nsf <= 2 and sisl is not None:  # cross-check with sisl where its reader applies
        es = np.asarray(sisl.get_sile(path).read_data()) + ef
        assert np.allclose(es, eig, atol=1e-6), "sisl/numpy EIG mismatch"
    w = np.loadtxt(kp_path, skiprows=1)[:, 4]
    w = w / w.sum()
    eig = np.asarray(eig)
    ns = eig.shape[0]
    deg = 2.0 if (ns == 1 and nsf == 1) else 1.0
    ne = float(sum(deg * np.sum(w[:, None] * (eig[s] <= ef)) for s in range(ns)))
    crossing = any((eig[s][:, i].min() < ef - 1e-6) and (eig[s][:, i].max() > ef + 1e-6) for s in range(ns) for i in range(eig.shape[2]))
    vbm = max(float(eig[s][eig[s] <= ef].max()) for s in range(ns))
    cbm = min(float(eig[s][eig[s] > ef].min()) for s in range(ns))
    return {"fermi": ef, "nBandsHeader": nb, "nSpinHeader": nsf, "nk": int(eig.shape[1]), "nChannels": int(ns),
            "electronsStep": ne, "metallic": bool(crossing), "vbm": vbm, "cbm": cbm,
            "gap": 0.0 if crossing else cbm - vbm, "weightSum": 1.0}


# ------------------------------------------------------------------ PDOS (raw XML, independent of sisl)
def ref_pdos(path):
    root = ET.parse(path).getroot()
    ns = int(root.find("nspin").text)
    ef = float(root.find("fermi_energy").text)
    E = np.array(root.find("energy_values").text.split(), float)
    orbs = root.findall("orbital")
    tot = np.zeros((ns, len(E)))
    by_l = {}
    for o in orbs:
        d = np.array(o.find("data").text.split(), float).reshape(len(E), ns).T
        tot += d
        l = int(o.get("l").strip())
        by_l[l] = by_l.get(l, 0) + (d[0] + d[1] if ns >= 2 else 2 * d[0])
    total = tot[0] + tot[1] if ns >= 2 else 2 * tot[0]
    out = {"nspin": ns, "nOrbitals": len(orbs), "fermi": ef, "nE": len(E), "emin": float(E[0]), "emax": float(E[-1]),
           "electronsBelowFermi": trapz_upto(E, total, ef),
           "byL": {str(l): trapz_upto(E, v, ef) for l, v in sorted(by_l.items())},
           "species": sorted({o.get("species").strip() for o in orbs})}
    if ns >= 2:
        out["up"] = trapz_upto(E, tot[0], ef); out["down"] = trapz_upto(E, tot[1], ef)
    return out


def ref_dos(path, ef):
    d = np.loadtxt(path)
    ns = d.shape[1] - 1
    total = 2 * d[:, 1] if ns == 1 else d[:, 1] + d[:, 2]
    return {"nspin": ns, "nE": int(d.shape[0]), "electronsBelowFermi": trapz_upto(d[:, 0], total, ef)}


# ------------------------------------------------------------------ EPSIMG (+ independent KK on a few points)
def ref_epsimg(path):
    rows = [l for l in open(path) if l.strip() and not l.lstrip().startswith("#")]
    d = np.array([[float(x) for x in l.split()] for l in rows])
    E = d[:, 0]; e2 = d[:, 1:].sum(axis=1)
    hdr = [l for l in open(path) if l.startswith("##")]
    fsum = [float(hdr[i + 1].split()[1]) for i, h in enumerate(hdr) if "f-sum" in h]

    def kk(w):
        # eps1(w) = 1 + 2/pi P int w' e2 / (w'^2 - w^2), subtraction method on a 400k-point resampled grid
        x = np.linspace(E[0], E[-1], 400001)
        g = np.interp(x, E, e2) * x
        gw = np.interp(w, E, e2) * w
        with np.errstate(divide="ignore", invalid="ignore"):
            integ = (g - gw) / (x * x - w * w)
        bad = ~np.isfinite(integ)
        if bad.any():
            dg = np.gradient(g, x)
            integ[bad] = dg[bad] / (2 * x[bad]) if w > 0 else 0.0
        val = np.sum(0.5 * (integ[1:] + integ[:-1]) * np.diff(x))
        if w > 0:
            val += gw * (np.log(abs((x[-1] - w) / (x[-1] + w))) - np.log(abs((x[0] - w) / (x[0] + w)))) / (2 * w)
        return 1 + 2 / np.pi * val

    i = int(np.argmax(e2))
    metal = e2[0] > 1e-2 * e2.max()  # eps1 diverges at w -> 0 for metals
    probes = [float(E[np.argmin(abs(E - w))]) for w in ([1.0, 3.0] if metal else [0.0, 1.0, 3.0])]
    return {"nE": int(len(E)), "nCols": int(d.shape[1] - 1), "fsum": fsum, "eps2MaxE": float(E[i]), "eps2Max": float(e2[i]),
            "eps1": {str(w): float(kk(w)) for w in probes}}


# ------------------------------------------------------------------ main .out (regex)
FLOAT = r"([-+]?\d+\.\d+)"


def ref_out(path):
    t = open(path).read()
    r = {}
    m = re.findall(r"siesta:\s+Total =\s+" + FLOAT, t)
    r["total"] = float(m[-1]) if m else None
    m = re.findall(r"siesta:\s+Fermi =\s+" + FLOAT, t)
    r["fermi"] = float(m[-1]) if m else None
    m = re.findall(r"siesta: FreeEng =\s+" + FLOAT, t)
    r["freeEng"] = float(m[-1]) if m else None
    r["nScfRows"] = len(re.findall(r"^\s*scf:\s+\d+", t, re.M)) + len(re.findall(r"^siesta: iscf =", t, re.M))
    r["scfConvergedCount"] = len(re.findall(r"SCF cycle converged after", t))
    r["notConverged"] = bool(re.search(r"SCF_NOT_CONV", t))
    m = re.search(r"Version\s*:\s*(\S+)", t); r["version"] = m.group(1) if m else None
    m = re.search(r"Mesh cutoff \(required, used\) =\s+" + FLOAT + r"\s+" + FLOAT, t)
    r["meshCutoff"] = [float(m.group(1)), float(m.group(2))] if m else None
    m = re.search(r"siesta: k-grid: Number of k-points =\s+(\d+)", t); r["nk"] = int(m.group(1)) if m else None
    r["nSpecies"] = len(re.findall(r"^Species number:", t, re.M))
    r["eKS"] = [float(x) for x in re.findall(r"siesta: E_KS\(eV\) =\s+" + FLOAT, t)]
    r["maxForceConstrained"] = [float(x) for x in re.findall(r"^\s+Max\s+" + FLOAT + r"\s+constrained", t, re.M)]
    sm = re.findall(r"spin moment: \{S\} , \|S\| = \{\s*" + FLOAT + r"\s+" + FLOAT + r"\s+" + FLOAT + r"\s*\}\s+" + FLOAT, t)
    r["lastSpinMoment"] = float(sm[-1][3]) if sm else None
    mull = re.search(r"Mulliken Atomic Populations:\n.*\n((?:\s+\d+\s+.*\n)+)", t)
    r["mullikenFirstCharge"] = float(mull.group(1).split()[1]) if mull else None
    r["nTimerRoutines"] = None
    m = re.search(r"Routine\s+Calls\s+Time/call\s+Tot\.time\s+%\n((?:\S+.*\d\n)+)", t)
    if m:
        r["nTimerRoutines"] = len(m.group(1).strip().split("\n"))
    m = re.search(r"Total number of electrons:\s+" + FLOAT, t); r["nElectrons"] = float(m.group(1)) if m else None
    r["completed"] = "Job completed" in t
    return r


def ref_mde(path):
    d = np.loadtxt(path, ndmin=2)
    return {"nSteps": int(d.shape[0]), "eKS_last": float(d[-1, 2]), "T_last": float(d[-1, 1])}


def ref_ani(path):
    L = open(path).read().split("\n")
    n = int(L[0]); frames = sum(1 for i, l in enumerate(L) if l.strip() == str(n))
    last = [float(x) for x in L[(frames - 1) * (n + 2) + 2].split()[1:4]]
    return {"nFrames": frames, "nAtoms": n, "lastFirstAtom": last}


def ref_fa(path):
    d = np.loadtxt(path, skiprows=1)
    return {"nAtoms": int(d.shape[0]), "maxNorm": float(np.linalg.norm(d[:, 1:4], axis=1).max())}


def ref_ion_xml(path):
    root = ET.parse(path).getroot()
    orbs = root.find("paos").findall("orbital")
    norms = []
    for o in orbs:
        l = int(o.get("l").strip())
        d = np.array(o.find("radfunc").find("data").text.split(), float).reshape(-1, 2)
        R = d[:, 1] * d[:, 0] ** l
        norms.append(float(np.sum(0.5 * ((R * d[:, 0]) ** 2)[1:] + 0.5 * ((R * d[:, 0]) ** 2)[:-1]) * (d[1, 0] - d[0, 0])))
    cut = [float(o.find("radfunc").find("cutoff").text) for o in orbs]
    return {"nOrbNl": len(orbs), "cutoffs": cut, "norms": norms, "Z": int(root.find("z").text), "valence": float(root.find("valence").text),
            "nProjectors": len(root.find("kbs").findall("projector"))}


def ref_ion_plain(path):
    t = open(path).read()
    return {"nOrb": len(re.findall(r"#orbital l, n, z", t)), "nKB": len(re.findall(r"#kb l", t)), "lj": "#kb l, j, n" in t}


def ref_psf(path):
    L = open(path).read().split("\n")
    nd, nu, nr = map(int, L[3].split()[:3]); a, b, z = map(float, L[3].split()[3:6])
    r = a * (np.exp(b * np.arange(1, nr + 1)) - 1)
    t = "\n".join(L)
    val = t.split("Valence charge follows")[1].split()
    rho = np.array(val[:nr], float)
    return {"nr": nr, "nDown": nd, "nUp": nu, "zval": z, "valenceElectrons": float(np.trapezoid(rho, r)), "rLast": float(r[-1])}


def ref_psml(path):
    root = ET.parse(path).getroot()
    nsuri = root.tag.split("}")[0] + "}" if root.tag.startswith("{") else ""
    q = lambda n: nsuri + n  # noqa: E731
    grid = np.array(root.find(q("grid")).find(q("grid-data")).text.split(), float)
    vc = root.find(q("valence-charge")).find(q("radfunc")).find(q("data"))
    f = np.array(vc.text.split(), float); r = grid[:len(f)]
    nsl = len(root.findall(f".//{q('slps')}"))
    nproj = len(root.findall(f".//{q('proj')}"))
    return {"npts": int(len(grid)), "valenceElectrons": float(np.trapezoid(f * r * r, r)), "nSemilocal": nsl, "nProjectors": nproj}


def ref_pack(path, bands_path):
    d = json.load(open(path))

    def dec(a):
        if isinstance(a, dict):
            return np.frombuffer(gzip.decompress(base64.b64decode(a["data"])), dtype=a["dtype"]).reshape(a["shape"])
        return np.array(a)
    eb = dec(d["bands"]["energies"])
    # Gamma eigenvalues from the SIESTA .bands file vs the packed path (both start at Gamma)
    sile = sisl.get_sile(bands_path)
    ef = sile.read_fermi_level()
    data = sile.read_data()
    b = np.asarray(data[-1]) + ef
    return {"fermi": d["fermi"], "gapType": d["gap"]["type"], "gap": d["gap"]["gap"], "nk": d["bands"]["nk"],
            "nSpin": int(eb.shape[0]), "nBands": int(eb.shape[2]), "gamma": eb[:, 0, :].astype(float).tolist(),
            "gammaSiesta": b[0].tolist(), "electronsBelowFermi": d["dos"]["electronsBelowFermi"], "nElectrons": d["nElectrons"]}


def main():
    if sisl is None:
        sys.exit("make_reference.py needs sisl")
    R = {}
    for lab in ("si", "fe", "fesoc"):
        R[lab] = {
            "out": ref_out(p(lab, f"{lab}.out")),
            "bands": ref_bands(p(lab, f"{lab}.bands")),
            "eig": ref_eig(p(lab, f"{lab}.EIG"), p(lab, f"{lab}.KP")),
            "pdos": ref_pdos(p(lab, f"{lab}.PDOS.xml")),
            "pack": ref_pack(p(lab, f"{lab}.dftlab.json"), p(lab, f"{lab}.bands")),
        }
        R[lab]["dos"] = ref_dos(p(lab, f"{lab}.DOS"), R[lab]["pdos"]["fermi"])
    R["si"]["pdos_old"] = ref_pdos(p("si", "si.PDOS"))
    R["si"]["bandpoints"] = ref_bands(p("si", "sibp.bands"))
    R["si"]["out_stdin"] = ref_out(p("si", "si_stdin.out"))
    R["si"]["epsimg"] = ref_epsimg(p("si", "si.EPSIMG"))
    R["fe"]["epsimg"] = ref_epsimg(p("fe", "fe.EPSIMG"))
    R["si"]["ion_xml"] = ref_ion_xml(p("si", "Si.ion.xml"))
    R["fesoc"]["ion"] = ref_ion_plain(p("fesoc", "Fe.ion"))
    R["relax"] = {"out": ref_out(p("relax", "relax.out")), "mde": ref_mde(p("relax", "relax.MDE")),
                  "ani": ref_ani(p("relax", "relax.ANI")), "fa": ref_fa(p("relax", "relax.FA"))}
    R["md"] = {"out": ref_out(p("md", "md.out")), "mde": ref_mde(p("md", "md.MDE")), "ani": ref_ani(p("md", "md.ANI"))}
    R["misc"] = {k: ref_out(p("misc", f)) for k, f in (("mg", "mg_lin050_notconv.out"), ("omm", "omm.out"), ("graphite", "graphite_vdw_psml.out"))}
    R["pseudo"] = {"Si.psf": ref_psf(p("pseudo", "Si.psf")), "Si.soft.psml": ref_psml(p("pseudo", "Si.soft.psml")),
                   "Si_lda_oncv.psml": ref_psml(p("pseudo", "Si_lda_oncv.psml"))}
    out = p("reference.json")
    with open(out, "w") as fh:
        json.dump(R, fh, indent=1)
    print("wrote", out)


if __name__ == "__main__":
    main()
