"""Genera ../presets.cases.json. Uso: RUNS=<directorio con runs/{mol,vc,probe}> python3 build_presets_cases.py
Las corridas son SIESTA 5.4.2 y vibra (ver docs/reviews/evidencia-p5-p10/README.md). Requiere numpy.
Los valores esperados se calculan aquí con código propio, independiente del oráculo presets-oracle.mjs."""
import json, os, re, itertools
import numpy as np

R = os.environ['RUNS'].rstrip('/') + '/runs/'
BOHR = 0.529177210903
KE = 14.399645478
ALPHA_SC = 2.8372974794806

KEEP = re.compile(r'^(Job completed|SCF cycle converged|siesta: k-point is Gamma-only|siesta: k-grid: Number of k-points|'
                  r'Folding of H and S|Total number of electrons:|redata: Spin configuration|redata: Net charge of the system|'
                  r'madelung:|siesta: Emadel|InitMesh: MESH =|InitMesh: Mesh cutoff|outcoor: (Relaxed|Final))')


def excerpt(path):
    """Líneas de la salida real que usan los gates, con los bloques de resumen de fuerzas completos."""
    L = open(R + path).read().split('\n')
    out = []
    for i, l in enumerate(L):
        if l.startswith('siesta: Atomic forces (eV/Ang):'):
            block = L[i:i + 9]
            if any(re.match(r'^\s+Max\s+\S+\s*$', s) for s in block):
                out.extend(block)
        elif KEEP.match(l):
            out.append(l)
    return '\n'.join(out) + '\n'


def facts(text):
    """Lectura independiente (Python) de los mismos hechos."""
    L = text.split('\n')
    meshes = []
    for l in L:
        if l.startswith('InitMesh: MESH ='):
            m = [int(x) for x in re.findall(r'(\d+) x\s*(\d+) x\s*(\d+)', l)[0]]
            if not meshes or meshes[-1] != m:
                meshes.append(m)
    cut = [tuple(float(x) for x in l.split('=')[1].split()[:2]) for l in L if l.startswith('InitMesh: Mesh cutoff')]
    forces = []
    for i, l in enumerate(L):
        if l.startswith('siesta: Atomic forces (eV/Ang):'):
            blk = L[i + 1:i + 9]
            tot = next((list(map(float, s.split()[1:4])) for s in blk if s.split()[:1] == ['Tot']), None)
            mx = next((float(s.split()[1]) for s in blk if s.split()[:1] == ['Max'] and len(s.split()) == 2), None)
            mc = next((float(s.split()[1]) for s in blk if s.split()[:1] == ['Max'] and s.split()[2:] == ['constrained']), None)
            if tot is not None and mx is not None:
                forces.append({'tot': tot, 'max': mx, 'max_constrained': mc})
    mad = None
    for l in L:
        if l.startswith('madelung: Charged system with'):
            mad = l.split()[4]
        if 'Energy correction terms can not be applied' in l:
            mad = 'NOT_APPLIED'
    emad = [float(l.split('=')[1]) for l in L if l.startswith('siesta: Emadel')]
    ele = [float(l.split(':')[1]) for l in L if l.startswith('Total number of electrons:')]
    spin = [l.split('=')[1].strip() for l in L if l.startswith('redata: Spin configuration')]
    q = [float(l.split('=')[1].split()[0]) for l in L if l.startswith('redata: Net charge of the system')]
    relaxed = True if any(l.startswith('outcoor: Relaxed') for l in L) else (False if any(l.startswith('outcoor: Final (unrelaxed)') for l in L) else None)
    return {
        'completed': any(l.startswith('Job completed') for l in L),
        'scf_converged': sum(l.startswith('SCF cycle converged') for l in L),
        'gamma_only': any(l.startswith('siesta: k-point is Gamma-only') for l in L),
        'folding': any(l.startswith('Folding of H and S implicitly performed') for l in L),
        'electrons': ele[0] if ele else None,
        'spin': spin[0] if spin else None,
        'net_charge': q[0] if q else None,
        'madelung': mad,
        'emadel_eV': emad[-1] if emad else None,
        'meshes': meshes,
        'mesh_cutoff_Ry': {'required': cut[-1][0], 'used_min': min(c[1] for c in cut)} if cut else None,
        'forces': forces,
        'relaxed': relaxed,
    }


def verdict(reasons):
    st = 'REJECTED' if any(s == 'REJECTED' for _, s in reasons) else ('REVIEW' if reasons else 'ACCEPTED')
    return {'status': st, 'reasons': [c for c, _ in reasons]}


def molecule(f, q):
    r = []
    if not f['completed'] or f['scf_converged'] < 1: r.append(('SCF_NOT_PROVEN', 'REJECTED'))
    if not f['gamma_only']: r.append(('KGRID_NOT_GAMMA', 'REJECTED'))
    if f['folding']: r.append(('BASIS_OVERLAPS_IMAGES', 'REJECTED'))
    if q != 0 and f['madelung'] in (None, 'NOT_APPLIED'): r.append(('CHARGED_CELL_NO_MADELUNG', 'REJECTED'))
    if f['electrons'] is not None and round(f['electrons']) % 2 == 1 and f['spin'] == 'none': r.append(('ODD_ELECTRONS_UNPOLARIZED', 'REJECTED'))
    return {**verdict(r), 'net_force_eV_A': float(np.linalg.norm(f['forces'][-1]['tot'])) if f['forces'] else None}


def relaxation(f, intent):
    r = []
    if not f['completed'] or f['scf_converged'] < 1: r.append(('SCF_NOT_PROVEN', 'REJECTED'))
    if f['relaxed'] is not True: r.append(('NOT_RELAXED', 'REJECTED'))
    if intent['variable_cell']:
        if len(f['meshes']) > 1: r.append(('MESH_CHANGED_DURING_RELAXATION', 'REJECTED'))
        mc = f['mesh_cutoff_Ry']
        if mc and mc['used_min'] < mc['required']: r.append(('MESH_CUTOFF_BELOW_REQUEST', 'REJECTED'))
    if f['forces'] and np.linalg.norm(f['forces'][-1]['tot']) >= intent['max_force_tol_eV_A']: r.append(('NET_FORCE_ABOVE_TOLERANCE', 'REJECTED'))
    return verdict(r)


def fc_matrix(text):
    L = [l for l in text.split('\n') if l.strip()]
    n = int(L[0].split(':')[1].split()[0])
    v = np.array([[float(x) for x in l.split()] for l in L[1:]]).reshape(n, 3, 2, n, 3)
    K = (0.5 * (v[:, :, 0] + v[:, :, 1])).reshape(3 * n, 3 * n)
    asr = float(np.abs(K.reshape(3 * n, n, 3).sum(1)).max())
    return n, K, asr, float(np.abs(K - K.T).max())


def modes(K, cart, masses):
    n = len(masses)
    K = 0.5 * (K + K.T)
    sm = np.repeat(np.sqrt(masses), 3)
    D = K / np.outer(sm, sm)
    conv = 521.470898
    f = lambda w: list(np.sign(w) * np.sqrt(np.abs(w)) * conv)
    raw = f(np.linalg.eigvalsh(D))
    x = np.array(cart); com = (np.array(masses)[:, None] * x).sum(0) / sum(masses); r = x - com
    V = []
    for a in range(3):
        t = np.zeros((n, 3)); t[:, a] = 1; V.append((t * np.sqrt(masses)[:, None]).ravel())
    for a in range(3):
        e = np.eye(3)[a]; V.append((np.cross(e, r) * np.sqrt(masses)[:, None]).ravel())
    U, S, _ = np.linalg.svd(np.array(V).T, full_matrices=True)
    rank = int((S > 1e-8 * S.max()).sum())
    B = U[:, rank:]
    vib = f(np.linalg.eigvalsh(B.T @ D @ B))
    rr = sorted(abs(w) for w in raw)[:rank]
    return rank, raw, max(rr), vib


def vibrations(f, fc_text, cart, masses, pol):
    r = []
    if not f['completed']: r.append(('SCF_NOT_PROVEN', 'REJECTED'))
    n, K, asr, _ = fc_matrix(fc_text)
    if not f['forces'] or f['forces'][0]['max'] > pol['max_reference_force_eV_A']: r.append(('GEOMETRY_NOT_RELAXED', 'REJECTED'))
    rank, raw, rmax, vib = modes(K, cart, masses)
    if any(w < 0 for w in vib): r.append(('IMAGINARY_VIBRATION', 'REVIEW'))
    return {**verdict(r), 'rigid_modes': rank, 'raw_rigid_max_cm1': rmax, 'asr_violation_eV_A2': asr, 'vibrational_cm1': vib}


def fdf_geometry(path):
    t = open(R + path).read()
    blk = t.split('%block AtomicCoordinatesAndAtomicSpecies')[1].split('%endblock')[0].strip().split('\n')
    return [[float(x) for x in l.split()[:3]] for l in blk], [l.split()[3] for l in blk]


def interacts(geo, radii):
    """Fuerza bruta con numpy: solapamiento orbital o proyector KB común con una imagen."""
    cell = np.array(geo['cell']) / BOHR
    pos = np.array([a['cart'] for a in geo['atoms']]) / BOHR
    sp = [a['species'] for a in geo['atoms']]
    orb = np.array([radii[s]['orb'] for s in sp]); kb = np.array([radii[s]['kb'] for s in sp])
    rng = range(-3, 4)
    T = [np.array(t) @ cell for t in itertools.product(rng, rng, rng)]
    clear, hit = np.inf, False
    for t, Tv in zip(itertools.product(rng, rng, rng), T):
        if t == (0, 0, 0): continue
        for i in range(len(sp)):
            for j in range(len(sp)):
                rj = pos[j] + Tv
                clear = min(clear, np.linalg.norm(pos[i] - rj) - orb[i] - orb[j])
                for Uv in T:
                    for k in range(len(sp)):
                        rk = pos[k] + Uv
                        if np.linalg.norm(pos[i] - rk) < orb[i] + kb[k] and np.linalg.norm(rj - rk) < orb[j] + kb[k]:
                            hit = True
    return {'interacts': bool(clear < 0 or hit), 'min_clearance_bohr': float(clear), 'via_projector': bool(hit)}


def water(L, shift=None):
    c = L / 2
    return {'cell': [[L, 0, 0], [0, L, 0], [0, 0, L]],
            'atoms': [{'id': 'O1', 'species': 'O', 'cart': [c, c, c]},
                      {'id': 'H1', 'species': 'H', 'cart': [c + 0.757, c + 0.586, c]},
                      {'id': 'H2', 'species': 'H', 'cart': [c - 0.757, c + 0.586, c]}]}


# rc máximos de la salida de SIESTA (DZP, PAO.EnergyShift por defecto), en Bohr.
RADII = {'O': {'orb': 4.299534, 'kb': 1.372412}, 'H': {'orb': 5.232664, 'kb': 1.328875}}
POLICY = {'policy_id': 'qraft.presets.policy@1-draft', 'max_reference_force_eV_A': 0.01}

cases = []
def C(**k): cases.append(k)

# P-1, geometría antes de correr.
for L, folding in ((6, True), (8, False), (10, False)):
    g = water(L)
    exp = interacts(g, RADII)
    assert exp['interacts'] == folding, (L, exp)  # concuerda con la línea «Folding» de SIESTA
    C(id=f'pre-geo-{L:02d}', kind='image', title=f'Agua en caja de {L} Å (SIESTA {"pliega" if folding else "no pliega"} H y S)',
      geometry=g, radii=RADII, expect=exp)
obl = {'cell': [[9.0, 0, 0], [8.2, 3.5, 0], [0, 0, 12.0]], 'atoms': water(10)['atoms']}
obl['atoms'] = [dict(a, cart=[a['cart'][0] - 5 + 4.5, a['cart'][1] - 5 + 1.75, a['cart'][2] - 5 + 6]) for a in obl['atoms']]
C(id='pre-geo-obl', kind='image', title='Caja oblicua: vectores largos pero planos cercanos (sintético)',
  geometry=obl, radii=RADII, expect=interacts(obl, RADII))

# Lectura de salidas reales.
for cid, path, title in (('pre-parse-c14', 'mol/c14/out', 'H2O⁺ en caja cúbica de 14 Å'),
                         ('pre-parse-vc', 'vc/free/out', 'Si con celda variable y MeshCutoff libre')):
    t = excerpt(path)
    C(id=cid, kind='parse', title=title, stdout=t, expect=facts(t))

# P-2: Madelung de SIESTA frente a la fórmula de caja cúbica simple.
for L in (10, 14, 18):
    t = excerpt(f'mol/c{L}/out')
    f = facts(t)
    assert abs(f['emadel_eV'] - KE * ALPHA_SC / (2 * L)) < 2e-6
    C(id=f'pre-madelung-{L}', kind='madelung', title=f'Emadel de H2O⁺ en caja de {L} Å', stdout=t, charge=1, box_A=L,
      expect={'parsed_eV': f['emadel_eV'], 'formula_eV': KE * ALPHA_SC / (2 * L)})

# S-01: molécula.
for cid, path, q, title in (
        ('pre-mol-01', 'mol/n10/out', 0, 'H2O neutra en 10 Å, Gamma'),
        ('pre-mol-02', 'mol/n6/out', 0, 'H2O en 6 Å: la base alcanza a la imagen'),
        ('pre-mol-03', 'mol/c14/out', 1, 'H2O⁺ polarizada en caja cúbica'),
        ('pre-mol-04', 'mol/cort/out', 1, 'H2O⁺ en caja ortorrómbica: SIESTA no corrige'),
        ('pre-mol-05', 'mol/c10np/out', 1, 'H2O⁺ sin spin con 7 electrones'),
        ('pre-mol-06', 'mol/n10k2/out', 0, 'H2O con malla k 2×2×2'),
        ('pre-mol-07', 'mol/m500/out', 0, 'H2O relajada a 200 Ry y recalculada a 500 Ry: fuerza neta 0.31 eV/Å'),
        ('pre-mol-08', 'mol/m700/out', 0, 'H2O a 700 Ry: fuerza neta 3·10⁻⁴ eV/Å')):
    t = excerpt(path)
    C(id=cid, kind='molecule', title=title, stdout=t, intent={'net_charge': q}, expect=molecule(facts(t), q))

# S-02, S-03, S-04: relajaciones.
for cid, path, intent, title in (
        ('pre-rel-01', 'mol/relax/out', {'variable_cell': False, 'max_force_tol_eV_A': 0.005}, 'H2O relajada con CG'),
        ('pre-rel-02', 'vc/mesh/out', {'variable_cell': True, 'max_force_tol_eV_A': 0.01}, 'Si P=0 con Mesh.Sizes fijo'),
        ('pre-rel-03', 'vc/free/out', {'variable_cell': True, 'max_force_tol_eV_A': 0.01}, 'Si P=0 con MeshCutoff: la malla oscila 24³↔30³'),
        ('pre-rel-04', 'probe/cons/out', {'variable_cell': False, 'max_force_tol_eV_A': 0.04}, 'Dos pasos CG con un átomo fijo: sin converger')):
    t = excerpt(path)
    C(id=cid, kind='relaxation', title=title, stdout=t, intent=intent, expect=relaxation(facts(t), intent))

# S-07: vibraciones a partir del archivo .FC.
MASS = {'1': 15.999, '2': 1.008}
for cid, d, title in (('pre-vib-01', 'mol/fc', 'FC sobre geometría sin relajar (200 Ry)'),
                      ('pre-vib-02', 'mol/fc2', 'FC relajada a 200 Ry'),
                      ('pre-vib-03', 'mol/chain400/fc', 'Relajación y FC a 400 Ry'),
                      ('pre-vib-04', 'mol/chain700/fc', 'Relajación y FC a 700 Ry')):
    t = excerpt(d + '/out')
    fct = open(R + d + '/h2o.FC').read()
    cart, sp = fdf_geometry(d + '/in.fdf')
    masses = [MASS[s] for s in sp]
    C(id=cid, kind='vibrations', title=title, stdout=t, fc=fct, cart=cart, masses=masses, policy=POLICY,
      vibra_cm1=[float(l.split('=')[1]) for l in open(R + d + '/h2o.vectors') if l.strip().startswith('Frequency')],
      expect=vibrations(facts(t), fct, cart, masses, POLICY))
# Diatómica sintética con un resorte k: 5 modos rígidos y una frecuencia sqrt(k/μ).
k, m1, dd = 22.0, 14.007, 0.02
cart = [[5.0, 5.0, 4.45], [5.0, 5.0, 5.55]]
Kd = np.zeros((6, 6)); Kd[2, 2] = Kd[5, 5] = k; Kd[2, 5] = Kd[5, 2] = -k
rows = []
for i in range(2):
    for a in range(3):
        for sgn in (-1, 1):
            for j in range(2):
                rows.append('  '.join(f'{Kd[3*i+a, 3*j+b]:.9E}' for b in range(3)))
fct = f'Force constants matrix. n_atoms, displacement [Ang]: 2 {dd:.16E}\n' + '\n'.join(rows) + '\n'
ok = 'siesta: Atomic forces (eV/Ang):\n----------------------------------------\n   Tot    0.000000    0.000000    0.000000\n----------------------------------------\n   Max    0.000000\n   Res    0.000000    sqrt( Sum f_i^2 / 3N )\nJob completed\n'
expd = vibrations(facts(ok), fct, cart, [m1, m1], POLICY)
assert expd['rigid_modes'] == 5 and abs(expd['vibrational_cm1'][0] - 521.470898 * np.sqrt(k / (m1 / 2))) < 1e-6
C(id='pre-vib-05', kind='vibrations', title='Diatómica sintética: cinco modos rígidos y ω = √(k/μ)', stdout=ok, fc=fct, cart=cart,
  masses=[m1, m1], policy=POLICY, expect=expd)

doc = {'schema': 'dftlab.protocol-vectors@1', 'protocol': 'PRESETS', 'ficha': 'docs/scientific-protocols/PRESETS.md',
       'oracle': 'docs/scientific-protocols/vectors/presets-oracle.mjs', 'engine': 'SIESTA 5.4.2 (siesta-env conda-forge), vibra',
       'arithmetic_tolerance': {'rel': 1e-7, 'abs_meV': 1e-6}, 'cases': cases}
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'presets.cases.json')
open(out, 'w').write(json.dumps(doc, ensure_ascii=False, indent=1) + '\n')
print(len(cases), 'casos')
