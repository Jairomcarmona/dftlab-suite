"""Genera ../electronic.cases.json. Uso: RUNS=<directorio con runs/el> python3 build_electronic_cases.py
Los valores esperados se calculan aquí con numpy, de forma independiente del oráculo JS, sobre las salidas reales de
SIESTA 5.4.2 y de su utilidad `fat` (Si diamante, PBE, DZP, a = 5.43 Å, malla 8×8×8, 200 Ry). Los .bands se recortan a las
bandas 1–8 para que los vectores sean pequeños; el recorte se escribe en el mismo formato."""
import json, os, re
import numpy as np

R = os.environ['RUNS'].rstrip('/') + '/runs/el/'
BOHR_ANG = 0.529177210903
HBAR2_ME = 27.211386245988 * BOHR_ANG ** 2
POLICY = {'fit_halfwidth_invA': 0.05, 'min_points_per_side': 3, 'degeneracy_meV': 5.0, 'straightness_invA': 2e-5,
          'energy_match_eV': 1e-4, 'weight_rounding': 5e-6}
NB = 8


def read_bands(path):
    lines = open(path).read().split('\n')
    head = next(i for i, l in enumerate(lines) if re.fullmatch(r'\s*\d+\s+\d+\s+\d+\s*', l))
    nb, ns, nk = map(int, lines[head].split())
    t = ' '.join(lines[head + 1:]).split()
    kc = 1 if head == 3 else 3
    k, E, i = [], [], 0
    for _ in range(nk):
        k.append([float(x) for x in t[i:i + kc]]); i += kc
        E.append([float(x) for x in t[i:i + nb * ns]]); i += nb * ns
    return dict(head=lines[:head], kind='lines' if kc == 1 else 'points', nb=nb, ns=ns, nk=nk, k=np.array(k), E=np.array(E), tail=t[i:])


def trimmed_text(b, idx=None, nb=NB):
    """Mismo formato .bands con las bandas 1…nb (y, si se da, solo los k de idx)."""
    idx = range(b['nk']) if idx is None else idx
    out = list(b['head'])
    out.append(f"{nb:12d}{b['ns']:12d}{len(idx):12d}")
    for q in idx:
        kk = ' '.join(f'{x:10.6f}' if b['kind'] == 'lines' else f'{x:9.5f}' for x in b['k'][q])
        out.append(kk + ' ' + ' '.join(f'{e:11.4f}' for e in b['E'][q][:nb]))
    return '\n'.join(out) + '\n'


def gap(E, nocc, kind, fermi):
    vb, cb = E[:, nocc - 1], E[:, nocc]
    iv, ic = int(vb.argmax()), int(cb.argmin())
    scope = 'PATH' if kind == 'lines' else 'POINTS'
    if cb[ic] <= vb[iv]:
        return {'status': 'NO_GAP', 'scope': scope}
    return {'status': 'GAP', 'scope': scope, 'gap_eV': float(cb[ic] - vb[iv]), 'direct': iv == ic,
            'vbm': {'eV': float(vb[iv]), 'k_index': iv}, 'cbm': {'eV': float(cb[ic]), 'k_index': ic},
            'fermi_in_gap': bool(vb[iv] < fermi < cb[ic])}


def mass(b, lo, hi, band, carrier, pol=POLICY):
    idx = np.arange(lo, hi + 1)
    reasons, direction = [], None
    if b['kind'] == 'points':
        P = b['k'][idx] / BOHR_ANG
        d = P[-1] - P[0]; u = d / np.linalg.norm(d); direction = u.tolist()
        s = (P - P[0]) @ u
        if np.linalg.norm((P - P[0]) - np.outer(s, u), axis=1).max() > pol['straightness_invA']:
            reasons.append('LINE_NOT_STRAIGHT')
    else:
        s = (b['k'][idx, 0] - b['k'][lo, 0]) / BOHR_ANG
    e = b['E'][idx, band - 1]
    j = int(e.argmin() if carrier == 'electron' else e.argmax())
    w = np.abs(s - s[j]) <= pol['fit_halfwidth_invA'] + 1e-12
    if min((w & (s < s[j])).sum(), (w & (s > s[j])).sum()) < pol['min_points_per_side']:
        reasons.append('EXTREMUM_AT_LINE_END')
    others = np.delete(b['E'][idx[j]][:b['nb']], band - 1)
    deg = int((np.abs(others - e[j]) * 1000 <= pol['degeneracy_meV']).sum())
    if deg:
        reasons.append('DEGENERATE_EXTREMUM')
    t = s[w] - s[j]
    c2, c1, c0 = np.polyfit(t, e[w], 2)
    m = (1 if carrier == 'electron' else -1) * HBAR2_ME / (2 * c2)
    if not m > 0:
        reasons.append('CURVATURE_SIGN')
    rms = float(np.sqrt(np.mean((np.polyval([c2, c1, c0], t) - e[w]) ** 2)))
    out = {'status': 'NOT_ESTABLISHED' if reasons else 'ESTABLISHED', 'reasons': reasons, 'mass_me': None if reasons else float(m),
           'extremum_k_index': int(idx[j]), 'extremum_eV': float(e[j]), 'degenerate_bands': deg,
           'extremum_offset_invA': float(-c1 / (2 * c2)), 'n_points': int(w.sum()), 'curvature_eV_A2': float(2 * c2)}
    if direction is not None:
        out['direction'] = direction
    return out


def read_eigfat(path):
    txt = open(path).read()
    lines = [l for l in txt.split('\n') if not l.startswith('#')]
    nb, ns, nk = map(int, lines[0].split())
    t = np.array(' '.join(lines[1:]).split(), float)
    rec = t.reshape(nk, 4 + 2 * nb * ns)
    return txt, rec[:, 4::2], rec[:, 5::2]


cases, inputs = [], {}
def C(**k): cases.append(k)
def I(name, text):
    """Las salidas grandes se guardan una vez en `inputs` y los casos las citan por nombre."""
    inputs[name] = text
    return name

# B-0: escala pi/a en celda FCC (corrida pia): SIESTA no calcula bandas y termina con «Job completed».
pia = open(R + 'pia/out').read().split('\n')
j = next(i for i, l in enumerate(pia) if 'pi/a option' in l)
C(id='el-run-pi-a', kind='run', title='BandLinesScale pi/a en celda FCC: SIESTA no calcula bandas', stdout='\n'.join(pia[j - 2:j + 3] + ['Job completed']),
  bands_written=os.path.exists(R + 'pia/si.bands'), expect={'status': 'FAIL', 'code': 'BAND_SCALE_REJECTED'})
path_out = open(R + 'path/out').read().split('\n')
k = next(i for i, l in enumerate(path_out) if 'Band Struct.' in l)
C(id='el-run-ok', kind='run', title='BandLinesScale ReciprocalLatticeVectors: bandas escritas', stdout='\n'.join(path_out[k:k + 2] + ['Job completed']),
  bands_written=os.path.exists(R + 'path/si.bands'), expect={'status': 'PASS'})
C(id='el-run-missing', kind='run', title='Corrida de bandas sin .bands', stdout='Job completed', bands_written=False,
  expect={'status': 'FAIL', 'code': 'BANDS_NOT_WRITTEN'})

# B-1: gap sobre el camino.
P = read_bands(R + 'path/si.bands'); fermi = float(P['head'][0])
ptxt = I('path.bands', trimmed_text(P))
C(id='el-gap-path', kind='gap', title='Si, camino Γ-X-W-L-Γ-K de 541 k: gap indirecto', bands=ptxt, n_occupied=4, expect=gap(P['E'], 4, 'lines', fermi))
seg = list(range(320, 441))
C(id='el-gap-L-Gamma', kind='gap', title='Solo el tramo L-Γ: el gap del camino es otro', bands=I('path-L-Gamma.bands', trimmed_text(P, seg)), n_occupied=4,
  expect=gap(P['E'][seg], 4, 'lines', fermi))
F = read_bands(R + 'fat/si.bands')
C(id='el-gap-coarse', kind='gap', title='Mismo camino con 45 k: el mínimo de conducción no está muestreado', bands=I('fat.bands', trimmed_text(F)), n_occupied=4,
  expect=gap(F['E'], 4, 'lines', float(F['head'][0])))
C(id='el-gap-wrong-occupation', kind='gap', title='Ocupación de 5 bandas en Si: no hay gap entre la 5 y la 6', bands=ptxt, n_occupied=5,
  expect=gap(P['E'], 5, 'lines', fermi))

# B-3, B-4: masas direccionales (corrida mass, BandPoints: cuatro líneas de 49 puntos con paso 0.0025·2π/a).
M = read_bands(R + 'mass/si.bands'); mtxt = I('mass.bands', trimmed_text(M))
for cid, lo, hi, band, carrier, title in (
        ('el-mass-cb-long', 0, 48, 5, 'electron', 'Si, mínimo de conducción en Δ, dirección [100]: masa longitudinal'),
        ('el-mass-cb-trans', 49, 97, 5, 'electron', 'Si, mínimo de conducción en Δ, dirección [010]: masa transversal'),
        ('el-mass-vb-100', 98, 146, 4, 'hole', 'Si, máximo de valencia en Γ, [100]: triplete degenerado'),
        ('el-mass-vb-111', 147, 195, 4, 'hole', 'Si, máximo de valencia en Γ, [111]: triplete degenerado'),
        ('el-mass-end', 0, 20, 5, 'electron', 'Línea que no contiene el mínimo: extremo en el borde'),
        ('el-mass-wrong-carrier', 49, 97, 5, 'hole', 'Hueco pedido sobre un mínimo de conducción')):
    C(id=cid, kind='mass', title=title, bands=mtxt, line={'from': lo, 'to': hi, 'band': band, 'carrier': carrier}, policy=POLICY,
      expect=mass(M, lo, hi, band, carrier))

# Sintéticos: parábolas exactas en una dirección (1,1,0)/√2, en 1/Bohr.
def synth(bands_fn, n=41, step=0.002, bend=0.0):
    u = np.array([1, 1, 0]) / np.sqrt(2)
    k0 = np.array([0.1, 0.05, 0.2])
    rows = []
    for i in range(n):
        t = (i - n // 2) * step
        kk = k0 + t * u + (np.array([0, 0, bend]) if i == n - 1 else 0)
        rows.append((kk, bands_fn(t / BOHR_ANG)))
    head = ['  0.0', '  -10.0  10.0']
    txt = '\n'.join(head + [f'{2:12d}{1:12d}{n:12d}'] + [' '.join(f'{x:.10f}' for x in kk) + ' ' + ' '.join(f'{e:.10f}' for e in E) for kk, E in rows]) + '\n'
    return txt
par = I('synth-parabolas.bands', synth(lambda q: [-1.0 - HBAR2_ME * q * q / (2 * 0.5), 0.5 + HBAR2_ME * q * q / (2 * 0.35)]))
def from_txt(txt):
    p = R + '../../_tmp_synth.bands'
    open(p, 'w').write(inputs.get(txt, txt)); b = read_bands(p); os.remove(p); return b
B = from_txt(par)
for cid, band, carrier, title in (('el-mass-synth-e', 2, 'electron', 'Parábola exacta, m = 0.35'), ('el-mass-synth-h', 1, 'hole', 'Parábola exacta de hueco, m = 0.5')):
    C(id=cid, kind='mass', title=title, bands=par, line={'from': 0, 'to': 40, 'band': band, 'carrier': carrier}, policy=POLICY, expect=mass(B, 0, 40, band, carrier))
deg = I('synth-degenerate.bands', synth(lambda q: [HBAR2_ME * q * q / (2 * 0.3), 0.002 + HBAR2_ME * q * q / (2 * 0.9)]))
C(id='el-mass-synth-degenerate', kind='mass', title='Dos bandas a 2 meV en el mínimo', bands=deg, line={'from': 0, 'to': 40, 'band': 1, 'carrier': 'electron'},
  policy=POLICY, expect=mass(from_txt(deg), 0, 40, 1, 'electron'))
bent = I('synth-bent.bands', synth(lambda q: [-1.0, HBAR2_ME * q * q / (2 * 0.35)], bend=0.001))
C(id='el-mass-synth-bent', kind='mass', title='Línea de k que no es recta', bands=bent, line={'from': 0, 'to': 40, 'band': 2, 'carrier': 'electron'},
  policy=POLICY, expect=mass(from_txt(bent), 0, 40, 2, 'electron'))
narrow = dict(POLICY, fit_halfwidth_invA=0.004)
C(id='el-mass-synth-few-points', kind='mass', title='Ventana con menos de 3 puntos por lado', bands=par, line={'from': 0, 'to': 40, 'band': 2, 'carrier': 'electron'},
  policy=narrow, expect=mass(B, 0, 40, 2, 'electron', narrow))

# B-2: fat bands (corrida fat, 45 k, `fat -b 1 -B 8` con proyecciones Si_3s, Si_3p y Si_3d).
sets = {n: read_eigfat(R + f'fat/fatsi.{n}.EIGFAT') for n in ('s', 'p', 'd')}
# Partición por átomos (fatat.mpr: «1», «2» y «2_3s 2_3p»).
sets.update({n: read_eigfat(R + f'fat/fatat.{n}.EIGFAT') for n in ('a1', 'a2', 'a2sp')})
ftxt = 'fat.bands'
for n in sets:
    I(f"{'fatat' if n.startswith('a') else 'fatsi'}.{n}.EIGFAT", sets[n][0])
def fat_expect(names, bands):
    if bands is not F:
        return {'status': 'FAIL', 'reasons': ['FAT_BANDS_MISMATCH']}
    Eb = F['E'][:, :NB]
    dE = max(float(np.abs(sets[n][1] - Eb).max()) for n in names)
    s = sum(sets[n][2] for n in names)
    err = float(np.abs(s - 1).max())
    reasons = (['FAT_BANDS_MISMATCH'] if dE > POLICY['energy_match_eV'] else []) + (['PARTITION_INCOMPLETE'] if err > POLICY['weight_rounding'] * len(names) else [])
    return {'status': 'FAIL' if reasons else 'PASS', 'reasons': reasons, 'sets': sorted(names), 'max_energy_diff_eV': dE, 'max_sum_error': err,
            'min_weight': float(min(sets[n][2].min() for n in names))}
for cid, names, btxt, b, title in (('el-fat-spd', ('s', 'p', 'd'), ftxt, F, 'Proyecciones s, p y d: suman 1 por estado'),
                                   ('el-fat-sp', ('s', 'p'), ftxt, F, 'Falta la proyección d: partición incompleta'),
                                   ('el-fat-atoms', ('a1', 'a2'), ftxt, F, 'Proyecciones por átomo: suman 1 por estado'),
                                   ('el-fat-atoms-no-d', ('a1', 'a2sp'), ftxt, F, 'Átomo 2 sin orbitales d: partición incompleta'),
                                   ('el-fat-other-run', ('s', 'p', 'd'), ptxt, P, '.EIGFAT de otra corrida de bandas')):
    C(id=cid, kind='fat', title=title, bands=btxt, eigfat={n: f"{'fatat' if n.startswith('a') else 'fatsi'}.{n}.EIGFAT" for n in names}, policy=POLICY, expect=fat_expect(names, b))

doc = {'schema': 'dftlab.protocol-vectors@1', 'protocol': 'ELECTRONIC', 'ficha': 'docs/scientific-protocols/WF-ELECTRONIC.md',
       'oracle': 'docs/scientific-protocols/vectors/electronic-oracle.mjs', 'engine': 'SIESTA 5.4.2 y fat (siesta-env conda-forge)',
       'policy': 'qraft.electronic.policy@1-draft', 'arithmetic_tolerance': {'rel': 1e-6, 'abs': 1e-9}, 'inputs': inputs, 'cases': cases}
open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'electronic.cases.json'), 'w').write(json.dumps(doc, ensure_ascii=False, indent=1) + '\n')
print(len(cases), 'casos')
for c in cases:
    print(c['id'], json.dumps(c['expect'])[:200])
