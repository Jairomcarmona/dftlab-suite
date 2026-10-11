"""Extract everything the prototype needs from a SIESTA run (fdf + TSHS + out + EPSIMG) using sisl."""
import json, re, time, numpy as np, sisl, seekpath
from scipy.spatial import Voronoi

t0 = time.time()
H = sisl.get_sile('si.fdf').read_hamiltonian()
g = H.geometry
Ef = sisl.get_sile('si.bands').read_fermi_level()
orb_l = np.array([o.l for a in g.atoms for o in a.orbitals])           # per orbital in one atom
orb_l_all = np.concatenate([[o.l for o in g.atoms[ia].orbitals] for ia in range(g.na)])
nocc = 4

# ---------- Seekpath path (same cell SIESTA used) ----------
sp = seekpath.get_explicit_k_path((g.cell, g.fxyz, g.atoms.Z), reference_distance=0.02)
krel = np.array(sp['explicit_kpoints_rel'])
assert np.allclose(sp['primitive_lattice'], g.cell, atol=1e-4), 'seekpath cell differs from SIESTA cell'
xk = np.array(sp['explicit_kpoints_linearcoord'])
labels = [(float(xk[i]), (l if l != 'GAMMA' else 'Γ')) for i, l in enumerate(sp['explicit_kpoints_labels']) if l]

def mulliken_l(es, k):
    S = H.Sk(k=k, format='array')
    c = es.state                                  # (nb, no)
    w = np.real(np.conj(c) * (c @ S.T))           # Mulliken per orbital, (nb, no)
    return np.stack([w[:, orb_l_all == l].sum(1) for l in (0, 1, 2)], -1)  # (nb, 3)

bands, fat = [], []
for k in krel:
    es = H.eigenstate(k)
    bands.append(es.eig); fat.append(mulliken_l(es, k))
bands = np.array(bands); fat = np.clip(np.array(fat), 0, 1)
vbm = bands[:, :nocc].max(); cbm = bands[:, nocc:].min()
ivbm = int(np.argmax(bands[:, nocc-1])); icbm = int(np.argmin(bands[:, nocc]))
print('bands', bands.shape, 'gap', cbm-vbm, 'vbm at', krel[ivbm], 'cbm at', krel[icbm], round(time.time()-t0, 1), 's')

# ---------- DOS / PDOS on a dense MP grid ----------
mp = sisl.MonkhorstPack(H, [20, 20, 20], trs=True)
E = np.linspace(-13, 8, 841)
sig = 0.12
dos = np.zeros_like(E); pdos = np.zeros((3, E.size))
for k, wk in zip(mp.k, mp.weight):
    es = H.eigenstate(k); m = mulliken_l(es, k)
    e = es.eig - vbm
    gss = np.exp(-((E[:, None]-e[None, :])/sig)**2/2)/(sig*np.sqrt(2*np.pi))
    dos += 2*wk*gss.sum(1); pdos += 2*wk*(gss[None] * m.T[:, None, :]).sum(2)
print('DOS integral up to 0 eV:', np.trapezoid(dos[E <= 0], E[E <= 0]), round(time.time()-t0, 1), 's')

# ---------- epsilon_2 decomposition (k, v, c) from velocity matrix elements ----------
mpo = sisl.MonkhorstPack(H, [14, 14, 14], trs=False)
tr = []    # (ik, v, c, dE, |d|^2)
for ik, k in enumerate(mpo.k):
    es = H.eigenstate(k)
    d = es.derivative(1, matrix=True)            # (3, nb, nb) eV*Ang
    m2 = (np.abs(d[:, nocc:, :nocc])**2).sum(0)/3
    dE = es.eig[nocc:, None] - es.eig[None, :nocc]
    for c in range(m2.shape[0]):
        for v in range(nocc):
            if dE[c, v] < 12.0:
                tr.append((ik, v, nocc+c, dE[c, v], m2[c, v]))
tr = np.array(tr)
W = np.linspace(0.02, 12, 600); eta = 0.1
G = np.exp(-((W[:, None]-tr[None, :, 3])/eta)**2/2)
eps2_raw = (G*tr[None, :, 4]).sum(1)/W**2

# SIESTA's own eps2 (EPSIMG) to fix the absolute scale and validate the shape
txt = [l for l in open('si.EPSIMG') if not l.startswith('#')]
se = np.array([[float(x) for x in l.split()] for l in txt if l.strip()])
s_eps = np.interp(W, se[:, 0], se[:, 1])
scale = np.dot(s_eps, eps2_raw)/np.dot(eps2_raw, eps2_raw)
eps2 = eps2_raw*scale
corr = np.corrcoef(eps2, s_eps)[0, 1]
print('eps2 peak (ours, siesta):', W[np.argmax(eps2)], W[np.argmax(s_eps)], 'shape corr', round(corr, 4), round(time.time()-t0, 1), 's')

# per-omega decomposition: for a grid of omegas keep the top band pairs and k-point weights
kcart = mpo.tocartesian(mpo.k)
Wd = np.round(np.arange(1.0, 9.01, 0.1), 2)
decomp = []
for w in Wd:
    gw = np.exp(-((w-tr[:, 3])/eta)**2/2)*tr[:, 4]
    tot = gw.sum()
    if tot <= 0: decomp.append(dict(w=float(w), pairs=[], k=[])); continue
    pairs = {}
    for (ik, v, c, de, m), x in zip(tr, gw):
        pairs[(int(v), int(c))] = pairs.get((int(v), int(c)), 0)+x
    top = sorted(pairs.items(), key=lambda t: -t[1])[:6]
    kw = np.bincount(tr[:, 0].astype(int), weights=gw, minlength=len(mpo.k))/tot
    sel = np.argsort(-kw)[:120]
    decomp.append(dict(w=float(w), pairs=[[v, c, round(float(x/tot), 4)] for (v, c), x in top],
                       k=[[round(float(a), 4) for a in kcart[i]]+[round(float(kw[i]), 5)] for i in sel if kw[i] > 1e-4]))

# eps1 by Kramers-Kronig from SIESTA eps2
dw = se[1, 0]-se[0, 0]; om = se[:, 0]; e2 = se[:, 1]
eps1 = np.array([1+2/np.pi*np.sum(np.where(np.abs(om-w) > 1e-9, om*e2/(om**2-w**2+1e-30), 0))*dw for w in W])

# ---------- Brillouin zone polyhedron ----------
B = g.rcell   # includes 2pi, 1/Ang
pts = np.array([i*B[0]+j*B[1]+k*B[2] for i in range(-2, 3) for j in range(-2, 3) for k in range(-2, 3)])
vor = Voronoi(pts); c0 = np.argmin(np.linalg.norm(pts, axis=1))
faces = []
for (p, q), rv in zip(vor.ridge_points, vor.ridge_vertices):
    if c0 in (p, q) and -1 not in rv:
        faces.append([[round(float(x), 5) for x in vor.vertices[i]] for i in rv])
hs = {('Γ' if k == 'GAMMA' else k): [round(float(x), 5) for x in np.dot(v, B)] for k, v in sp['point_coords'].items()}
path_cart = np.dot(krel, B)

# ---------- structure (conventional cube for display) ----------
conv = g.tile(2, 0).tile(2, 1).tile(2, 2)
a = 5.431
xyz = [p for p in conv.xyz]
cube = []
for p in xyz:
    # map into the conventional cube [0,a)^3 using the fcc lattice
    q = np.mod(p, a)
    cube.append(q)
cube = np.unique(np.round(np.array(cube), 3), axis=0)
edge = [p for p in cube]
extra = []
for p in cube:   # add face/edge/corner images on the cube boundary for a nice display
    for s in np.array(np.meshgrid([0, 1], [0, 1], [0, 1])).reshape(3, -1).T:
        q = p + s*a
        if np.all(q <= a+1e-3): extra.append(q)
atoms = np.unique(np.round(np.array(extra), 3), axis=0)
bonds = [[i, j] for i in range(len(atoms)) for j in range(i+1, len(atoms)) if abs(np.linalg.norm(atoms[i]-atoms[j])-2.3517) < 0.05]

# ---------- SCF history ----------
scf = [[int(m.group(1)), float(m.group(2)), float(m.group(3))] for m in re.finditer(r'scf:\s+(\d+)\s+(-?\d+\.\d+)\s+-?\d+\.\d+\s+-?\d+\.\d+\s+(\d+\.\d+)', open('si.out').read())]

out = dict(
    meta=dict(system='Si (diamante)', code='SIESTA 5.4.2', xc='LDA (Ceperley–Alder)', basis='DZP', mesh_cutoff='200 Ry',
              kgrid='8×8×8 (SCF), 20×20×20 (DOS), 14×14×14 (ε₂, sisl), 16×16×16 (ε₂, SIESTA)', pseudo='Si.psf (Troullier–Martins, tests de SIESTA)',
              spacegroup='Fd-3m (227)', bravais=sp['bravais_lattice_extended'], a=5.431, natoms=2, norb=int(H.no),
              gap=round(float(cbm-vbm), 3), kvbm=[round(float(x), 3) for x in krel[ivbm]], kcbm=[round(float(x), 3) for x in krel[icbm]],
              fsum_siesta=0.8535, eps_scale=float(scale), eps_shape_corr=round(float(corr), 4), Ef=float(Ef-vbm)),
    bands=dict(x=[round(float(v), 5) for v in xk], E=np.round(bands-vbm, 4).T.tolist(), fat=np.round(fat, 3).transpose(1, 0, 2).tolist(),
               labels=labels, kcart=np.round(path_cart, 5).tolist(), nocc=nocc),
    dos=dict(E=np.round(E, 4).tolist(), total=np.round(dos, 4).tolist(), s=np.round(pdos[0], 4).tolist(), p=np.round(pdos[1], 4).tolist(), d=np.round(pdos[2], 4).tolist()),
    eps=dict(w=np.round(W, 4).tolist(), eps2=np.round(s_eps, 4).tolist(), eps2_sisl=np.round(eps2, 4).tolist(), eps1=np.round(eps1, 4).tolist(), decomp=decomp),
    bz=dict(faces=faces, points=hs, path=sp['path']),
    structure=dict(atoms=np.round(atoms, 3).tolist(), bonds=bonds, a=a),
    scf=scf,
)
json.dump(out, open('si_proto.json', 'w'), separators=(',', ':'))
print('written', round(time.time()-t0, 1), 's')
