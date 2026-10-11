"""Genera ../slabs.cases.json. Uso: WFREF=<carpeta wf extraída de corridas/wf.tar.gz> python3 build_slab_cases.py
Implementación independiente (numpy) de las convenciones de la ficha SLABS.md; la equivalencia de caras se
comprueba con spglib (grupo espacial de la lámina), no con el algoritmo del oráculo. Requiere numpy y spglib."""
import json, os, itertools, math
import numpy as np
import spglib

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, '..', '..', '..', '..'))
WF = os.environ['WFREF'].rstrip('/') + '/'


def lex_key(u):
    return tuple(u)


def prim_miller(Ap, Ac, hkl):
    B = np.linalg.inv(Ac).T
    G = np.array(hkl, float) @ B
    m = Ap @ G
    for s in range(1, 25):
        v = m * s
        if np.allclose(v, np.round(v), atol=1e-6):
            r = np.round(v).astype(int)
            g = math.gcd(*[abs(int(x)) for x in r])
            return [int(x) // g for x in r]
    raise ValueError


def lattice2d(Ap, m, R=6):
    Bp = np.linalg.inv(Ap).T
    Gm = np.array(m, float) @ Bp
    d = 1 / np.linalg.norm(Gm); n = Gm * d
    area = abs(np.linalg.det(Ap)) / d
    ip, st = [], []
    for u in itertools.product(range(-R, R + 1), repeat=3):
        c = np.array(u) @ Ap; mu = int(np.dot(m, u))
        if mu == 0 and any(u): ip.append((np.linalg.norm(c), u, c))
        if mu == 1: st.append((np.linalg.norm(c - np.dot(c, n) * n), u, c))
    ip.sort(key=lambda x: (round(x[0], 9), lex_key(x[1])))
    a1 = ip[0]
    cand = [v for v in ip if abs(abs(np.dot(np.cross(a1[2], v[2]), n)) - area) < 1e-6 * area]
    short = cand[0][0]
    right = [v for v in cand if abs(v[0] - short) < 1e-9 and np.dot(np.cross(a1[2], v[2]), n) > 0]
    right.sort(key=lambda v: (round(float(np.dot(a1[2], v[2])), 9), lex_key(v[1])))
    st.sort(key=lambda x: (round(x[0], 9), lex_key(x[1])))
    return n, d, area, a1[2], right[0][2], st[0][2]


def build(bulk, spec, tol=1e-4):
    Ap = np.array(bulk['primitive'], float)
    m = prim_miller(Ap, np.array(bulk['conventional'], float), spec['hkl'])
    n, d, area, a1, a2, cs = lattice2d(Ap, m)
    M = np.array([a1, a2, cs])
    Minv = np.linalg.inv(M)
    unit = []
    for k, a in enumerate(bulk['atoms']):
        f = (np.array(a['frac']) @ Ap) @ Minv
        f = f - np.floor(f); f[f > 1 - 1e-9] = 0
        unit.append(dict(k=k, id=a['id'], species=a['species'], f=f, h=f[2] * d))
    planes = []
    for h in sorted(u['h'] for u in unit):
        if not planes or h - planes[-1] > tol: planes.append(h)
    P = len(planes)
    pidx = lambda h: next(i for i, p in enumerate(planes) if abs(p - h) <= tol)
    t = spec['termination']; gb = t - spec['n_planes'] + 1
    e1 = a1 / np.linalg.norm(a1); e3 = n; e2 = np.cross(e3, e1)
    F = np.array([e1, e2, e3])
    A1, A2 = F @ a1, F @ a2
    T2 = np.array([[A1[0], A2[0]], [A1[1], A2[1]]])
    raw = []
    for g in range(gb, t + 1):
        mm = g // P; p = g - mm * P
        for u in unit:
            if pidx(u['h']) != p: continue
            x = F @ (u['f'] @ M + mm * cs)
            fab = np.linalg.solve(T2, x[:2]); fab = fab - np.floor(fab); fab[fab > 1 - 1e-9] = 0
            raw.append(dict(bid=u['id'], unit=mm, plane=g - gb, species=u['species'], fa=fab[0], fb=fab[1], z=x[2], k=u['k']))
    raw.sort(key=lambda a: (a['plane'], a['k']))
    zb = min(a['z'] for a in raw); zt = max(a['z'] for a in raw)
    L = zt - zb + spec['vacuum_A']; mmin = min(a['unit'] for a in raw)
    atoms = [dict(id=f"{a['bid']}:{a['unit'] - mmin}", bulk_id=a['bid'], unit=a['unit'] - mmin, plane=a['plane'], species=a['species'],
                  cart=[a['fa'] * A1[0] + a['fb'] * A2[0], a['fa'] * A1[1] + a['fb'] * A2[1], a['z'] - zb + spec['vacuum_A'] / 2]) for a in raw]
    cell = [[A1[0], A1[1], 0.0], [A2[0], A2[1], 0.0], [0.0, 0.0, L]]
    sh = np.linalg.solve(T2, (F @ cs)[:2]); sh = sh - np.floor(sh); sh[sh > 1 - 1e-7] = 0
    return dict(primitive_miller=m, d_A=d, area_A2=area, planes_per_unit=P, n_planes=spec['n_planes'], termination=t,
                stacking_shift=[float(x) for x in sh], cell=cell, atoms=atoms, faces_equivalent=faces_spglib(cell, atoms))


def faces_spglib(cell, atoms):
    lat = np.array(cell); pos = np.array([a['cart'] for a in atoms]) @ np.linalg.inv(lat)
    sp = sorted({a['species'] for a in atoms}); num = [sp.index(a['species']) + 1 for a in atoms]
    ds = spglib.get_symmetry((lat, pos, num), symprec=1e-4)
    # En la base de la celda, una rotación cambia z por −z si su fila/columna 3 es (0, 0, −1).
    return bool(any(R[2][2] == -1 for R in ds['rotations']))


def invariants(cell, atoms, tol=1e-4):
    A = np.array(cell, float)
    if abs(A[2] @ A[0]) > 1e-6 or abs(A[2] @ A[1]) > 1e-6 or abs(A[0][2]) > 1e-9 or abs(A[1][2]) > 1e-9:
        return {'error': 'A3_NOT_PERPENDICULAR'}
    T2 = np.array([[A[0][0], A[1][0]], [A[0][1], A[1][1]]])
    z = np.array([a['cart'][2] for a in atoms])
    planes = []
    for v in sorted(z):
        if not planes or v - planes[-1] > tol: planes.append(v)
    pid = [next(i for i, p in enumerate(planes) if abs(p - v) <= tol) for v in z]
    fr = [np.linalg.solve(T2, np.array(a['cart'][:2])) for a in atoms]
    comp = []
    for i in range(len(planes)):
        c = {}
        for a, p in zip(atoms, pid):
            if p == i: c[a['species']] = c.get(a['species'], 0) + 1
        comp.append(''.join(f'{s}{c[s]}' for s in sorted(c)))
    def reg(i, j):
        best = np.inf
        for p in range(len(atoms)):
            if pid[p] != i: continue
            for q in range(len(atoms)):
                if pid[q] != j: continue
                dd = fr[q] - fr[p]; dd = dd - np.round(dd)
                for s, t in itertools.product((-1, 0, 1), repeat=2):
                    best = min(best, np.linalg.norm(T2 @ (dd + [s, t])))
        return float(best)
    registry = [reg(i, i + k) for i in range(len(planes)) for k in (1, 2, 3) if i + k < len(planes)]
    return {'a_lengths_A': sorted([float(np.linalg.norm(A[0])), float(np.linalg.norm(A[1]))]), 'area_A2': float(abs(np.linalg.det(T2))),
            'n_atoms': len(atoms), 'n_planes': len(planes), 'plane_composition': comp,
            'spacings_A': [float(planes[i + 1] - planes[i]) for i in range(len(planes) - 1)], 'registry_A': registry,
            'vacuum_A': float(A[2][2] - (planes[-1] - planes[0])), 'z_bottom_A': float(planes[0])}


def read_fdf(path, species):
    t = open(path).read()
    lv = [[float(x) for x in l.split()] for l in t.split('%block LatticeVectors')[1].split('%endblock')[0].strip().split('\n')]
    at = [[float(x) for x in l.split()] for l in t.split('%block AtomicCoordinatesAndAtomicSpecies')[1].split('%endblock')[0].strip().split('\n')]
    return {'cell': lv, 'atoms': [{'species': species, 'cart': r[:3]} for r in at]}


def clean(x):
    if isinstance(x, dict): return {k: clean(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)): return [clean(v) for v in x]
    if isinstance(x, (np.floating,)): return float(x)
    if isinstance(x, (np.integer,)): return int(x)
    if isinstance(x, (np.bool_,)): return bool(x)
    if isinstance(x, float) and x == 0: return 0.0
    return x


a = 4.05
fcc = {'primitive': [[0, a / 2, a / 2], [a / 2, 0, a / 2], [a / 2, a / 2, 0]], 'conventional': [[a, 0, 0], [0, a, 0], [0, 0, a]],
       'atoms': [{'id': 'Al1', 'species': 'Al', 'frac': [0, 0, 0]}]}
fcc_conv = {'primitive': fcc['conventional'], 'conventional': fcc['conventional'],
            'atoms': [{'id': f'Al{i + 1}', 'species': 'Al', 'frac': f} for i, f in enumerate([[0, 0, 0], [0, .5, .5], [.5, 0, .5], [.5, .5, 0]])]}
am, cm = 3.209, 5.211
hexA = [[am, 0, 0], [-am / 2, am * math.sqrt(3) / 2, 0], [0, 0, cm]]
hcp = {'primitive': hexA, 'conventional': hexA,
       'atoms': [{'id': 'Mg1', 'species': 'Mg', 'frac': [1 / 3, 2 / 3, 1 / 4]}, {'id': 'Mg2', 'species': 'Mg', 'frac': [2 / 3, 1 / 3, 3 / 4]}]}
asi = 5.43
si = {'primitive': [[0, asi / 2, asi / 2], [asi / 2, 0, asi / 2], [asi / 2, asi / 2, 0]], 'conventional': [[asi, 0, 0], [0, asi, 0], [0, 0, asi]],
      'atoms': [{'id': 'Si1', 'species': 'Si', 'frac': [0, 0, 0]}, {'id': 'Si2', 'species': 'Si', 'frac': [.25, .25, .25]}]}
ag, cg, u = 3.189, 5.185, 0.377  # GaN wurtzita, valores de libro; solo geometría
hexG = [[ag, 0, 0], [-ag / 2, ag * math.sqrt(3) / 2, 0], [0, 0, cg]]
gan = {'primitive': hexG, 'conventional': hexG,
       'atoms': [{'id': 'Ga1', 'species': 'Ga', 'frac': [1 / 3, 2 / 3, 0]}, {'id': 'Ga2', 'species': 'Ga', 'frac': [2 / 3, 1 / 3, .5]},
                 {'id': 'N1', 'species': 'N', 'frac': [1 / 3, 2 / 3, u]}, {'id': 'N2', 'species': 'N', 'frac': [2 / 3, 1 / 3, .5 + u]}]}

cases = []
def C(**k): cases.append(clean(k))

refs = [('al111_n3', fcc, [1, 1, 1], 3, 'Al', os.path.join(REPO, 'docs/reviews/evidencia-p5-p10/al111_n3_vac18.fdf'), 'Al(111) de 3 capas'),
        ('al100_n7', fcc, [1, 0, 0], 7, 'Al', WF + 'al100_n7/al100_n7.fdf', 'Al(100) de 7 capas'),
        ('al110_n11', fcc, [1, 1, 0], 11, 'Al', WF + 'al110_n11/al110_n11.fdf', 'Al(110) de 11 capas'),
        ('mg0001_n7', hcp, [0, 0, 1], 7, 'Mg', WF + 'mg0001_n7/mg0001_n7.fdf', 'Mg(0001) de 7 capas')]
for name, bulk, hkl, n, el, path, title in refs:
    spec = {'hkl': hkl, 'n_planes': n, 'vacuum_A': 18.0, 'termination': 0}
    ref = read_fdf(path, el)
    exp = invariants(ref['cell'], ref['atoms'])
    got = build(bulk, spec)
    mine = invariants(got['cell'], got['atoms'])
    for k in exp:
        assert np.allclose(np.array(exp[k], dtype=object if k == 'plane_composition' else float).tolist() if k == 'plane_composition' else exp[k],
                           mine[k], atol=2e-5) if k != 'plane_composition' else exp[k] == mine[k], (name, k, exp[k], mine[k])
    C(id=f'slab-ref-{name}', kind='reference', title=f'{title}: igual que la lámina hecha a mano en corridas/wf', bulk=bulk, spec=spec,
      reference=ref, expect=exp)

builds = [('slab-si001-t0', si, [0, 0, 1], 4, 0, 'Si(001), 4 planos, terminación 0'),
          ('slab-si001-t1', si, [0, 0, 1], 4, 1, 'Si(001), 4 planos, terminación 1'),
          ('slab-gan0001', gan, [0, 0, 1], 4, 0, 'GaN(0001) polar: caras distintas'),
          ('slab-gan1010-t0', gan, [1, 0, 0], 4, 0, 'GaN(10-10), terminación 0'),
          ('slab-gan1010-t1', gan, [1, 0, 0], 4, 1, 'GaN(10-10), terminación 1'),
          ('slab-al222', fcc, [2, 2, 2], 3, 0, 'Índices (222): misma lámina que (111)'),
          ('slab-al111-conv', fcc_conv, [1, 1, 1], 3, 0, 'Celda convencional como si fuera primitiva: área ×4'),
          ('slab-al111-n5', fcc, [1, 1, 1], 5, 0, 'Al(111) de 5 capas')]
for cid, bulk, hkl, n, t, title in builds:
    spec = {'hkl': hkl, 'n_planes': n, 'vacuum_A': 15.0, 'termination': t}
    C(id=cid, kind='build', title=title, bulk=bulk, spec=spec, expect=build(bulk, spec))

al5 = build(fcc, {'hkl': [1, 1, 1], 'n_planes': 5, 'vacuum_A': 15.0, 'termination': 0})
C(id='cons-bottom2', kind='bottom_planes', title='Fijar los dos planos inferiores de Al(111) de 5 capas', bulk=fcc,
  spec={'hkl': [1, 1, 1], 'n_planes': 5, 'vacuum_A': 15.0, 'termination': 0}, k=2,
  expect=[i + 1 for i, at in enumerate(al5['atoms']) if at['plane'] < 2])
C(id='cons-render', kind='constraints', title='Restricciones válidas, desordenadas', n_atoms=5,
  fixed=[2, 1, {'atom': 4, 'direction': [1, 0, 0]}],
  expect={'text': '%block Geometry.Constraints\natom 1\natom 2\natom 4 1.000000 0.000000 0.000000\n%endblock Geometry.Constraints\n'})
C(id='cons-negative', kind='constraints', title='Índice negativo (SIESTA lo cuenta desde el final)', n_atoms=5, fixed=[-1], expect={'error': 'CONSTRAINT_INDEX_INVALID'})
C(id='cons-range', kind='constraints', title='Índice fuera de rango', n_atoms=5, fixed=[6], expect={'error': 'CONSTRAINT_INDEX_INVALID'})
C(id='cons-dup', kind='constraints', title='Átomo repetido', n_atoms=5, fixed=[2, 2], expect={'error': 'CONSTRAINT_DUPLICATED'})
C(id='cons-dir0', kind='constraints', title='Dirección nula', n_atoms=5, fixed=[{'atom': 3, 'direction': [0, 0, 0]}], expect={'error': 'CONSTRAINT_DIRECTION_INVALID'})
tilt = {'cell': [[2.863782, 0, 0], [-1.431891, 2.480108, 0], [0.5, 0.3, 22.676537]], 'atoms': read_fdf(refs[0][5], 'Al')['atoms']}
C(id='slab-tilted', kind='invariants', title='a3 inclinado respecto al plano: rechazado', geometry=tilt, expect=invariants(tilt['cell'], tilt['atoms']))

doc = {'schema': 'dftlab.protocol-vectors@1', 'protocol': 'SLABS', 'ficha': 'docs/scientific-protocols/SLABS.md',
       'oracle': 'docs/scientific-protocols/vectors/slab-oracle.mjs', 'engine': 'geometría; referencias corridas/wf.tar.gz (SIESTA 5.4.2)',
       'arithmetic_tolerance': {'rel': 1e-7, 'abs_meV': 1e-6, 'abs_A': 1e-9}, 'reference_tolerance_A': 2e-5, 'cases': cases}
open(os.path.join(HERE, '..', 'slabs.cases.json'), 'w').write(json.dumps(doc, ensure_ascii=False, indent=1) + '\n')
print(len(cases), 'casos')
for c in cases:
    if c['kind'] == 'build':
        e = c['expect']; print(c['id'], e['primitive_miller'], 'P', e['planes_per_unit'], 'faces', e['faces_equivalent'], 'atoms', len(e['atoms']), 'shift', e['stacking_shift'])
