"""Genera ../surface.cases.json. Uso: RUNS=<directorio con slab3, slab3v y surf/> python3 build_surface_cases.py
Los valores esperados se calculan aquí con numpy, de forma independiente del oráculo JS, siguiendo la ficha WF-SURFACE.md.
Los perfiles reales son el promedio planar de `.VH` de SIESTA 5.4.2 (malla binaria Fortran de `SaveElectrostaticPotential`);
E_F sale de la línea `siesta: Fermi` del .out. Los sintéticos son analíticos."""
import json, os, re, struct
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
RUNS = os.environ['RUNS'].rstrip('/') + '/'
RY, BOHR = 13.605693122994, 0.529177210903
POLICY = {'potential': 'VH', 'allow_vt': False, 'window_A': 1.0, 'step_A': 0.25, 'margin_A': 4.0, 'width_min_A': 2.0,
          'slope_max_eV_per_A': 0.005, 'range_max_meV': 5.0, 'stability_meV': 3.0, 'perpendicular_tol_deg': 0.01,
          'convergence_meV': 10.0}


def read_grid(path):
    raw = open(path, 'rb').read(); rec = []; o = 0
    while o < len(raw):
        n = struct.unpack_from('<i', raw, o)[0]; rec.append(raw[o + 4:o + 4 + n]); o += 8 + n
    cell = np.frombuffer(rec[0], '<f8').reshape(3, 3) * BOHR
    nx, ny, nz, ns = np.frombuffer(rec[1], '<i4')
    data = np.array([np.frombuffer(r, '<f4') for r in rec[2:]]).reshape(ns, nz, ny, nx)
    return cell, data[0].mean(axis=(1, 2)) * RY


def atoms_z(fdf):
    t = open(fdf).read().split('%block AtomicCoordinatesAndAtomicSpecies')[1].split('%endblock')[0].strip().split('\n')
    return [float(l.split()[2]) for l in t]


def real(dirname, label, mode, sym):
    cell, p = read_grid(f'{RUNS}{dirname}/{label}.VH')
    out = open(f'{RUNS}{dirname}/out').read()
    ef = float(re.findall(r'siesta:\s+Fermi\s*=\s*([-\d.]+)', out)[-1])
    return dict(cell=[[round(float(x), 6) for x in r] for r in cell], atoms_z_A=atoms_z(f'{RUNS}{dirname}/in.fdf'), fermi_eV=ef,
                profile_eV=[round(float(x), 6) for x in p], potential='VH', scf_converged=True, dipole_correction=mode, faces_equivalent=sym)


# --- implementación independiente de la ficha -------------------------------------------------------------------
def make_interp(v, c):
    n = len(v); xs = np.arange(n + 1) * c / n; ys = np.append(v, v[0])
    return lambda z: np.interp(np.mod(z, c), xs, ys)


def mean_over(v, c, a, b):
    n = len(v); h = c / n; f = make_interp(v, c)
    nodes = [a] + [k * h for k in range(int(np.floor(a / h)) + 1, int(np.ceil(b / h)))] + [b]
    nodes = np.array(nodes); y = f(nodes)
    return float(np.sum(0.5 * (y[1:] + y[:-1]) * np.diff(nodes)) / (b - a))


def plateau_plus(v, c, top, nxt, pol):
    f = make_interp(v, c); w = pol['window_A']; end = nxt - pol['margin_A']; ws = []
    k = 0
    while True:
        s = top + pol['margin_A'] + k * pol['step_A']; k += 1
        if s + w > end + 1e-9: break
        xs = s + np.arange(9) * w / 8; ys = f(xs)
        slope = np.polyfit(xs - s, ys, 1)[0]; rng = (ys.max() - ys.min()) * 1000
        ws.append((s, abs(slope) <= pol['slope_max_eV_per_A'] and rng <= pol['range_max_meV'], mean_over(v, c, s, s + w)))
    if not ws: return None, 'VACUUM_TOO_SMALL'
    any_ok = False; i = 0
    while i < len(ws):
        if not ws[i][1]: i += 1; continue
        any_ok = True; j = i
        while j + 1 < len(ws) and ws[j + 1][1]: j += 1
        frm, to = ws[i][0], ws[j][0] + w
        if to - frm >= pol['width_min_A'] - 1e-9:
            ms = [x[2] for x in ws[i:j + 1]]
            if (max(ms) - min(ms)) * 1000 > pol['stability_meV']: return None, 'PLATEAU_UNSTABLE'
            return (frm, to, mean_over(v, c, frm, to)), None
        i = j + 1
    return None, ('PLATEAU_TOO_NARROW' if any_ok else 'PLATEAU_NOT_FOUND')


def vac_interval(zs, c):
    z = sorted(x % c for x in zs); best = (-1, 0, 0)
    for i, a in enumerate(z):
        nx = z[i + 1] if i + 1 < len(z) else z[0] + c
        if nx - a > best[0]: best = (nx - a, a, nx)
    return best[1], best[2]


def a3_perp(cell, tol):
    cell = np.array(cell)
    ang = lambda u, w: np.degrees(np.arccos(u @ w / np.linalg.norm(u) / np.linalg.norm(w)))
    al, be = ang(cell[1], cell[2]), ang(cell[0], cell[2])
    return dict(alpha_deg=float(al), beta_deg=float(be), perpendicular=bool(abs(al - 90) <= tol and abs(be - 90) <= tol))


def evaluate(run, pol=POLICY):
    sides = ['+z', '-z']
    def fail(r): return dict(verdict='NOT_ESTABLISHED', reasons=[r], faces=[dict(side=s, status='NOT_ESTABLISHED', reason=r, phi_eV=None, plateau=None) for s in sides])
    if not a3_perp(run['cell'], pol['perpendicular_tol_deg'])['perpendicular']: return fail('A3_NOT_PERPENDICULAR')
    if run['scf_converged'] is not True: return fail('SCF_NOT_CONVERGED')
    if run['fermi_eV'] is None: return fail('FERMI_MISSING')
    if run['potential'] != pol['potential'] and not (run['potential'] == 'VT' and pol['allow_vt']): return fail('POTENTIAL_NOT_PERMITTED')
    if run['dipole_correction'] in ('false', 'none') and not run['faces_equivalent']: return fail('DIPOLE_UNCOMPENSATED_ASYMMETRIC')
    c = run['cell'][2][2]; v = np.array(run['profile_eV']); top, nxt = vac_interval(run['atoms_z_A'], c)
    if nxt - top - 2 * pol['margin_A'] < pol['width_min_A']: return fail('VACUUM_TOO_SMALL')
    plus, rp = plateau_plus(v, c, top, nxt, pol)
    # cara −z: perfil reflejado z → −z (nodo i ↔ n−i)
    vm = np.array([v[(len(v) - i) % len(v)] for i in range(len(v))])
    minus, rm = plateau_plus(vm, c, c - nxt, c - top, pol)
    def face(side, p, r):
        if p is None: return dict(side=side, status='NOT_ESTABLISHED', reason=r, phi_eV=None, plateau=None)
        frm, to, mean = p
        pl = dict(from_A=frm, to_A=to, mean_eV=mean, width_A=to - frm) if side == '+z' else dict(from_A=c - to, to_A=c - frm, mean_eV=mean, width_A=to - frm)
        return dict(side=side, status='ESTABLISHED', reason=None, phi_eV=mean - run['fermi_eV'], plateau=pl)
    faces = [face('+z', plus, rp), face('-z', minus, rm)]
    reasons = sorted({f['reason'] for f in faces if f['reason']})
    return dict(verdict='ESTABLISHED' if all(f['status'] == 'ESTABLISHED' for f in faces) else 'NOT_ESTABLISHED', reasons=reasons, faces=faces)


def convergence(points, tol):
    if len(points) < 3: return dict(verdict='INSUFFICIENT_POINTS', deltas_meV=[], last_delta_meV=None)
    d = [(points[i + 1]['phi_eV'] - points[i]['phi_eV']) * 1000 for i in range(len(points) - 1)]
    return dict(verdict='CONVERGED' if all(abs(x) <= tol for x in d[-2:]) else 'NOT_CONVERGED', deltas_meV=d, last_delta_meV=d[-1])


# --- perfiles sintéticos -----------------------------------------------------------------------------------------
def synth(c, slab_z, left, right, n=240, bump=None, drift=0.0, field=0.0, step_at=None):
    """Pozo cosenoidal dentro de la lámina (z entre extremos de slab_z) y vacío a nivel `left`/`right` con un escalón en el
    punto medio del vacío (corrección dipolar). `drift` (eV/Å) y `field` (eV/Å) añaden pendiente en el vacío."""
    z = np.arange(n) * c / n; lo, hi = min(slab_z), max(slab_z); mid = (hi + (lo + c)) / 2
    v = np.empty(n)
    for i, x in enumerate(z):
        if lo - 1.0 <= x <= hi + 1.0:
            t = min(x - (lo - 1.0), (hi + 1.0) - x); v[i] = -12 * (1 - np.exp(-t / 0.5)) + (left if x < (lo + hi) / 2 else right) * np.exp(-t / 2.0)
        else:
            u = x if x > hi else x + c
            lev = right if u < mid else left
            v[i] = left + field * (u - hi) if field else lev
    for b0, b1, dv in bump or []:
        for i, x in enumerate(z):
            u = x if x > hi else x + c
            if b0 <= u <= b1: v[i] += dv
    return [round(float(x), 6) for x in v]


def run_of(cell_c, atoms, fermi, profile, mode='vacuum', sym=False, **kw):
    r = dict(cell=[[2.863782, 0, 0], [-1.431891, 2.480108, 0], [0, 0, cell_c]], atoms_z_A=atoms, fermi_eV=fermi, profile_eV=profile,
             potential='VH', scf_converged=True, dipole_correction=mode, faces_equivalent=sym)
    r.update(kw); return r


cases = []
def add(i, title, kind, **kw): cases.append(dict(id=i, kind=kind, title=title, **kw))

# 1. a3 perpendicular
al = [[2.863782, 0, 0], [-1.431891, 2.480108, 0], [0, 0, 22.676537]]
tilt = [[2.863782, 0, 0], [-1.431891, 2.480108, 0], [0.8, 0.4, 22.6]]
for i, t, cell in [('surf-a3-ok', 'Celda de Al(111) con a3 perpendicular', al), ('surf-a3-tilted', 'a3 inclinada 2° respecto a la normal: rechazada', tilt)]:
    add(i, t, 'perpendicular', cell=cell, tol_deg=POLICY['perpendicular_tol_deg'], expect=a3_perp(cell, POLICY['perpendicular_tol_deg']))

# 2. corridas reales de SIESTA 5.4.2
R = {
    'surf-real-al111-vac18': ('Al(111) 3 capas, LDA/DZP, 18 Å de vacío: Φ = 3.8923 eV', real('slab3', 'al111_n3', 'false', True)),
    'surf-real-al111-vac24': ('Mismo slab con 24 Å de vacío: Φ = 3.8924 eV (E_F y meseta se mueven juntos)', real('slab3v', 'al111_n3', 'false', True)),
    'surf-real-pbe-sym': ('Al(111) 3 capas GGA/PBE/DZP: meseta plana, Φ = 3.7197 eV', real('surf/pbe_sym', 'pbe_sym', 'false', True)),
    'surf-real-h-vacuum': ('Al(111)+H en una cara, Slab.DipoleCorrection vacuum: dos Φ distintas', real('surf/h_vacuum', 'h_vacuum', 'vacuum', False)),
    'surf-real-h-charge': ('Mismo con charge: las dos Φ coinciden con vacuum a 0.5 meV', real('surf/h_charge', 'h_charge', 'charge', False)),
    'surf-real-h-false': ('Mismo sin corrección: lámina asimétrica sin dipolo compensado, rechazada', real('surf/h_false', 'h_false', 'false', False)),
}
for i, (t, run) in R.items(): add(i, t, 'run', run=run, policy=POLICY, expect=evaluate(run))
forced = dict(R['surf-real-h-false'][1], faces_equivalent=True)
add('surf-real-h-false-forced', 'Mismo perfil sin dipolo declarado simétrico a la fuerza: el potencial en dientes de sierra no tiene meseta', 'run', run=forced, policy=POLICY, expect=evaluate(forced))

# 2b. etiqueta Slab.DipoleCorrection (S-2); valores comprobados con SIESTA 5.4.2: true≡charge y none≡false (mismas E_F y energía)
def dipole_label(text):
    rows = [l.split('#')[0].split() for l in text.split('\n')]
    rows = [r for r in rows if r and re.sub(r'[._-]', '', r[0]).lower() == 'slabdipolecorrection']
    if not rows: return dict(accepted=True, value=None, effective='NONE', error=None)
    if len(rows) > 1: return dict(accepted=False, value=None, effective=None, error='LABEL_DUPLICATED')
    v = (rows[0][1] if len(rows[0]) > 1 else '').lower()
    eff = {'true': 'CHARGE', 'charge': 'CHARGE', 'vacuum': 'VACUUM', 'false': 'NONE', 'none': 'NONE'}.get(v)
    return dict(accepted=True, value=v, effective=eff, error=None) if eff else dict(accepted=False, value=None, effective=None, error='KEYWORD_VALUE_INVALID')
head = 'SystemLabel al111h\nXC.functional LDA\nMeshCutoff 150 Ry\n'
for v in ['vacuum', 'charge', 'true', 'false', 'none', 'bogus']:
    t = head + f'Slab.DipoleCorrection {v}   # comentario\n'
    add(f'surf-dipole-{v}', f'Slab.DipoleCorrection {v}' + (': rechazado (SIESTA aborta)' if v == 'bogus' else ': aceptado y conservado'), 'dipole_label', fdf=t, expect=dipole_label(t))
t = head + 'Slab_DipoleCorrection vacuum\n'; add('surf-dipole-spelling', 'La etiqueta se reconoce con la ortografía flexible de FDF (Slab_DipoleCorrection)', 'dipole_label', fdf=t, expect=dipole_label(t))
t = head + 'Slab.DipoleCorrection vacuum\nSlab.DipoleCorrection none\n'; add('surf-dipole-dup', 'Etiqueta repetida: rechazada', 'dipole_label', fdf=t, expect=dipole_label(t))
t = head; add('surf-dipole-absent', 'Sin etiqueta: sin corrección', 'dipole_label', fdf=t, expect=dipole_label(t))

# 3. perfil sintético asimétrico: dos Φ y ninguna con la regla del máximo
c = 30.0; slab = [10.0, 12.3, 14.6]
prof = synth(c, slab, left=-0.9, right=0.74)
r = run_of(c, slab, -4.8, prof)
ev = evaluate(r); mx = max(prof) + 4.8
assert abs(ev['faces'][1]['phi_eV'] - mx) > 1.0 and abs(ev['faces'][0]['phi_eV'] - ev['faces'][1]['phi_eV']) > 1.0, ev
add('surf-synth-asym', 'Perfil sintético asimétrico con dipolo compensado: dos Φ distintas; la regla del máximo erraría 1.6 eV en la cara baja', 'run', run=r, policy=POLICY, expect=ev, max_rule_phi_eV=mx)

# 4. sin meseta: poco vacío / pendiente / bump / deriva
for i, t, cc, kw in [
    ('surf-synth-small-vacuum', 'Vacío de 6 Å: no cabe una ventana a 4 Å de cada cara', 10.6, dict(left=0.5, right=0.5)),
    ('surf-synth-field', 'Vacío de 18 Å con campo de 0.1 eV/Å (sin corrección): pendiente fuera de la política', 29.0, dict(left=0.0, right=0.0, field=0.1)),
    ('surf-synth-bump', 'Meseta partida por salientes cada 2.4 Å: ningún tramo plano llega a 2 Å', 28.0, dict(left=0.4, right=0.4, bump=[(20.2 + 2.4 * k, 20.8 + 2.4 * k, 0.5) for k in range(6)])),
    ('surf-synth-drift', 'Meseta con deriva lenta de 1 meV/Å: pendiente permitida pero ventanas inestables', 30.0, dict(left=0.4, right=0.4, drift=0.001)),
]:
    slab2 = [10.0, 12.3, 14.6]
    p = synth(cc, slab2, **{k: v for k, v in kw.items() if k != 'drift'})
    if 'drift' in kw:
        z = np.arange(len(p)) * cc / len(p); p = [round(x + (kw['drift'] * (zz - 14.6) if zz > 14.6 else 0.0), 6) for x, zz in zip(p, z)]
    rr = run_of(cc, slab2, -4.8, p, mode='none', sym=True)
    add(i, t, 'run', run=rr, policy=POLICY, expect=evaluate(rr))

# 5. otras puertas
base = R['surf-real-al111-vac18'][1]
for i, t, kw in [('surf-gate-vt', '.VT no permitido por la política', dict(potential='VT')),
                 ('surf-gate-scf', 'SCF sin converger', dict(scf_converged=False)),
                 ('surf-gate-fermi', 'Sin E_F en la salida', dict(fermi_eV=None))]:
    rr = dict(base, **kw); add(i, t, 'run', run=rr, policy=POLICY, expect=evaluate(rr))
rr = dict(base); add('surf-gate-vt-allowed', '.VT permitido por la política', 'run', run=dict(base, potential='VT'), policy=dict(POLICY, allow_vt=True), expect=evaluate(dict(base, potential='VT'), dict(POLICY, allow_vt=True)))

# 6. promedio macroscópico (ventana = distancia interplanar)
d = 2.338290; c = 14.0; n = 280; z = np.arange(n) * c / n
v = [round(float(-3.0 + 2.0 * np.cos(2 * np.pi * x / d)), 6) for x in z]
centers = [3.0, 5.2, 7.7]
exp = [mean_over(np.array(v), c, x - d / 2, x + d / 2) for x in centers]
assert all(abs(e + 3.0) < 2e-3 for e in exp), exp
add('surf-macro', 'Cosenoide de periodo d: la media móvil de ventana d recupera la constante', 'macro', profile_eV=v, cell_c_A=c, period_A=d, centers_A=centers, expect=exp)

# 7. E_F entre corridas
ca, cb = R['surf-real-al111-vac18'][1]['cell'], R['surf-real-al111-vac24'][1]['cell']
add('surf-fermi-differs', 'E_F de celdas con distinto vacío: no comparable', 'fermi_comparable', cell_a=ca, cell_b=cb, tol_A=1e-4, expect=dict(comparable=False, reason='CELLS_DIFFER'))
add('surf-fermi-same', 'E_F de la misma celda: comparable', 'fermi_comparable', cell_a=ca, cell_b=ca, tol_A=1e-4, expect=dict(comparable=True, reason=None))

# 8. convergencia de Φ
pts = lambda *vals: [dict(label=str(i), phi_eV=x) for i, x in enumerate(vals)]
for i, t, p in [('surf-conv-two', 'Dos puntos: insuficiente', pts(3.8923, 3.8924)),
                ('surf-conv-vac', 'Vacío 12, 18, 24 Å: converge', pts(3.8901, 3.8923, 3.8924)),
                ('surf-conv-layers', 'Capas 3, 5, 7 con saltos de 300 y 120 meV: no converge', pts(3.89, 4.19, 4.31))]:
    add(i, t, 'convergence', points=p, tol_meV=POLICY['convergence_meV'], expect=convergence(p, POLICY['convergence_meV']))

doc = dict(schema='dftlab.protocol-vectors@1', protocol='SURFACE', ficha='docs/scientific-protocols/WF-SURFACE.md',
           oracle='docs/scientific-protocols/vectors/surface-oracle.mjs', engine='SIESTA 5.4.2 (siesta-env conda-forge, un hilo)',
           policy='qraft.surface.policy@1', arithmetic_tolerance=dict(rel=1e-6, abs=1e-6), cases=cases)
json.dump(doc, open(os.path.join(HERE, '..', 'surface.cases.json'), 'w'), ensure_ascii=False, indent=1)
open(os.path.join(HERE, '..', 'surface.cases.json'), 'a').write('\n')
print(len(cases), 'casos')
for c_ in cases:
    if c_['kind'] == 'run': print(c_['id'], c_['expect']['verdict'], c_['expect']['reasons'], [None if f['phi_eV'] is None else round(f['phi_eV'], 4) for f in c_['expect']['faces']])
