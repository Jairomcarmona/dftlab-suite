"""Genera ../preflight.cases.json. Uso: RUNS=<directorio con runs/fdf> python3 build_fdf_cases.py
Cada caso lleva los archivos de entrada de una corrida real de SIESTA 5.4.2 y, como valor esperado, lo que SIESTA
hizo: el valor que escribió en su fdf.*.log, el error fatal de su stderr o las etiquetas que no consultó."""
import json, os, re, glob

R = os.environ['RUNS'].rstrip('/') + '/runs/fdf/'
norm = lambda s: re.sub(r'[._-]', '', s).lower()

REGISTRY = {'MeshCutoff': {'type': 'physical', 'dimension': 'energy', 'canonical_unit': 'Ry', 'default': 300.0},
            'DM.Tolerance': {'type': 'real'}, 'MaxSCFIterations': {'type': 'integer'}}
# Factores de SIESTA 5.4.2 a la unidad canónica. eV → Ry sale del propio log (SCF.EDM.Tolerance 1e-3 eV = 0.7349864435E-04 Ry).
UNITS = {'energy': {'ry': 1.0, 'ev': 0.07349864435, 'hartree': 2.0, 'ha': 2.0, 'mry': 1e-3, 'mev': 0.07349864435e-3},
         'length': {'ang': 1.0, 'bohr': 0.529177, 'nm': 10.0}}

ERRORS = [('Label MeshCutoff not found in', 'REDIRECT_LABEL_NOT_FOUND'), ('no unit specified', 'UNIT_MISSING'),
          ('Incompatible dimensions', 'UNIT_DIMENSION_MISMATCH'), ('no integer value', 'INTEGER_EXPECTED'), ('no real value', 'REAL_EXPECTED'),
          ('Too many nested fdf files', 'CYCLIC_INCLUDE'), ('Cannot open', 'INCLUDE_NOT_FOUND')]


def files_of(d, extra=()):
    out = {'in.fdf': open(R + d + '/in.fdf').read()}
    for name in extra:
        out[name] = open(R + d + '/' + name).read()
    return out


def siesta_fact(d):
    err = open(R + d + '/err').read()
    for needle, code in ERRORS:
        if needle in err:
            return {'error': code}
    log = open(glob.glob(R + d + '/fdf*.log')[0]).read()
    m = re.search(r'^MeshCutoff\s+(\S+)\s+Ry\s*(# default value)?\s*$', log, re.M)
    return {'MeshCutoff_Ry': float(m.group(1)), 'default': bool(m.group(2))}


def queried(log):
    q = set()
    for l in log.split('\n'):
        t = l.split()
        if not t: continue
        if t[0].startswith('#:') and len(t) > 1: q.add(norm(t[1])); continue
        if t[0].startswith('#'): continue
        if t[0].lower() == '%block' and len(t) > 1: q.add(norm(t[1])); continue
        if t[0].startswith('%'): continue
        q.add(norm(t[0]))
    return q


cases = []
def C(**k): cases.append(k)

runs = [('pf-dup', 'dup', (), 'Etiqueta repetida: gana la primera'),
        ('pf-spell', 'spell', (), 'MeshCutoff y mesh_cutoff son la misma etiqueta'),
        ('pf-include-first', 'inc', ('extra.fdf',), '%include antes de la definición: gana el incluido'),
        ('pf-include-after', 'inc2', ('extra.fdf',), '%include después de la definición: gana la raíz'),
        ('pf-redirect-value', 'red', ('mc.val',), '«MeshCutoff < archivo» con solo el valor: SIESTA aborta'),
        ('pf-units-fortran', 'units', (), 'Exponente Fortran y unidad en minúsculas'),
        ('pf-no-unit', 'nounit', (), 'Magnitud física sin unidad: SIESTA aborta'),
        ('pf-bad-unit', 'badunit', (), 'Unidad de longitud para una energía: SIESTA aborta'),
        ('pf-ev', 'ev', (), 'Energía en eV convertida a Ry'),
        ('pf-int-real', 'intreal', (), 'Entero escrito como 2.0: SIESTA aborta'),
        ('pf-real-text', 'realbad', (), 'Real escrito como texto: SIESTA aborta'),
        ('pf-typo', 'typo', (), 'Etiqueta mal escrita: SIESTA usa el valor por defecto'),
        ('pf-comment', 'comment', (), 'Comentario # al final del valor'),
        ('pf-comment-bang', 'bang', (), 'Comentario ! al final del valor'),
        ('pf-comment-semi', 'semi', (), 'Comentario ; al final del valor'),
        ('pf-lowercase', 'lowcase', (), 'Etiqueta y unidad en minúsculas/mayúsculas'),
        ('pf-cycle', 'cyc', ('a.fdf', 'b.fdf'), 'Includes cíclicos: SIESTA aborta'),
        ('pf-missing', 'miss', (), 'Include que no existe: SIESTA aborta')]
for cid, d, extra, title in runs:
    C(id=cid, kind='scalar', title=title, files=files_of(d, extra), root='in.fdf', label='MeshCutoff', expect=siesta_fact(d))

# Redirección con un archivo FDF que contiene la etiqueta: SIESTA la lee (corrida red/in2.fdf).
red2 = {'in.fdf': open(R + 'red/in2.fdf').read(), 'mc.fdf': open(R + 'red/mc.fdf').read()}
out2 = open(R + 'red/out2').read()
v = float(re.search(r'Mesh cutoff \(required, used\) =\s+(\S+)', out2).group(1))
C(id='pf-redirect-fdf', kind='scalar', title='«MeshCutoff < archivo.fdf» que contiene la etiqueta', files=red2, root='in.fdf', label='MeshCutoff',
  expect={'MeshCutoff_Ry': v, 'default': False})

# Bloque redirigido (corrida blk).
blk = {'in.fdf': open(R + 'blk/in.fdf').read(), 'lat.dat': open(R + 'blk/lat.dat').read()}
out = open(R + 'blk/out').read()
cell = [[float(x) for x in l.split()] for l in out.split('outcell: Unit cell vectors (Ang):')[1].strip().split('\n')[:3]]
C(id='pf-block-redirect', kind='block', title='%block LatticeVectors < archivo', files=blk, root='in.fdf', label='LatticeVectors',
  expect={'rows': [[x for x in r] for r in cell]})

# Etiquetas no consultadas por SIESTA, del fdf.*.log real.
for cid, d, title in (('pf-unused-typo', 'typo', 'MeshCutof no aparece en el log de SIESTA'),
                      ('pf-unused-none', 'units', 'Todas las etiquetas del input se consultaron')):
    log = open(glob.glob(R + d + '/fdf*.log')[0]).read()
    fdf = open(R + d + '/in.fdf').read()
    labels, seen, inb = [], set(), False
    for l in fdf.split('\n'):
        t = re.sub(r'[#!;].*$', '', l).split()
        if not t: continue
        if t[0].lower() == '%block': lab = t[1]; inb = True
        elif t[0].lower() == '%endblock': inb = False; continue
        elif inb or t[0].startswith('%'): continue
        else: lab = t[0]
        if norm(lab) not in seen:
            seen.add(norm(lab)); labels.append(lab)
    q = queried(log)
    C(id=cid, kind='unused', title=title, files={'in.fdf': fdf}, root='in.fdf', fdf_log=log, expect=[x for x in labels if norm(x) not in q])

doc = {'schema': 'dftlab.protocol-vectors@1', 'protocol': 'PREFLIGHT', 'ficha': 'docs/scientific-protocols/PREFLIGHT.md',
       'oracle': 'docs/scientific-protocols/vectors/fdf-oracle.mjs', 'engine': 'SIESTA 5.4.2 (siesta-env conda-forge)',
       'arithmetic_tolerance': {'rel': 1e-7, 'abs_meV': 1e-6}, 'registry': REGISTRY, 'units': UNITS, 'cases': cases}
open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'preflight.cases.json'), 'w').write(json.dumps(doc, ensure_ascii=False, indent=1) + '\n')
print(len(cases), 'casos')
for c in cases:
    print(c['id'], json.dumps(c['expect'])[:120])
