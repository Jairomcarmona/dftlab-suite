"""G-05/G-06 geometry authority; row vectors in Angstrom, no engine execution.

Conventions and fixed arithmetic thresholds follow SLABS.md. Preview code is
independent of revision creation; these routines use only the standard library.
"""
from __future__ import annotations

from functools import cmp_to_key, reduce
from itertools import product
from math import floor, gcd, isfinite, sqrt


def _dot(a, b):
    return sum(x*y for x, y in zip(a, b))


def _cross(a, b):
    return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]


def _norm(a):
    return sqrt(_dot(a, a))


def _scale(a, s):
    return [x*s for x in a]


def _add(a, b):
    return [x+y for x, y in zip(a, b)]


def _cart(f, rows):
    return [sum(f[i]*rows[i][j] for i in range(3)) for j in range(3)]


def _reciprocal(rows):
    det = _dot(rows[0], _cross(rows[1], rows[2]))
    if not isfinite(det) or abs(det) == 0:
        raise ValueError("Singular cell")
    return [_scale(_cross(rows[(i+1)%3], rows[(i+2)%3]), 1/det) for i in range(3)]


def _wrap(x, tol=1e-9):
    y = x-floor(x)
    return 0 if y > 1-tol else y


def primitive_miller(primitive, conventional, hkl):
    if len(hkl) != 3 or any(type(x) is not int for x in hkl) or not any(hkl):
        raise ValueError("Miller indices must be three nonzero integers as a tuple")
    g = _cart(hkl, _reciprocal(conventional))
    m = [_dot(a, g) for a in primitive]
    for s in range(1, 25):
        v = [x*s for x in m]
        if all(abs(x-round(x)) < 1e-6 for x in v):
            integers = [round(x) for x in v]
            divisor = reduce(gcd, integers, 0)
            if divisor:
                return [x//divisor for x in integers]
    raise ValueError("MILLER_NOT_RATIONAL")


def _lattice(primitive, m):
    g = _cart(m, _reciprocal(primitive))
    d = 1/_norm(g)
    normal = _scale(g, d)
    area = abs(_dot(primitive[0], _cross(primitive[1], primitive[2])))/d
    planar, stack = [], []
    for u in product(range(-6, 7), repeat=3):
        c = _cart(u, primitive)
        mu = _dot(m, u)
        if mu == 0 and any(u):
            planar.append((u, c, _norm(c)))
        if mu == 1:
            stack.append((u, c, _norm(_add(c, _scale(normal, -_dot(c, normal))))))
    def ordered(a, b):
        delta = a[2]-b[2]
        return (-1 if delta < 0 else 1) if abs(delta) > 1e-9 else (-1 if a[0] < b[0] else 1)
    planar.sort(key=cmp_to_key(ordered))
    stack.sort(key=cmp_to_key(ordered))
    if not planar or not stack:
        raise ValueError("Surface lattice search has no basis")
    a1 = planar[0][1]
    candidates = [v for v in planar if abs(abs(_dot(_cross(a1, v[1]), normal))-area) < 1e-6*area]
    if not candidates:
        raise ValueError("Surface lattice search has no primitive pair")
    shortest = candidates[0][2]
    right = [v for v in candidates if abs(v[2]-shortest) < 1e-9 and _dot(_cross(a1, v[1]), normal) > 0]
    def angle_order(a, b):
        delta = _dot(a1, a[1])-_dot(a1, b[1])
        return (-1 if delta < 0 else 1) if abs(delta) > 1e-9 else (-1 if a[0] < b[0] else 1)
    right.sort(key=cmp_to_key(angle_order))
    return normal, d, area, a1, right[0][1], stack[0][1]


def build_slab(bulk, spec):
    """Construct the atomic planes ending at the selected termination."""
    if type(spec['n_planes']) is not int or spec['n_planes'] < 1:
        raise ValueError("n_planes must be positive")
    if not isfinite(spec['vacuum_A']) or spec['vacuum_A'] <= 0 or not bulk['atoms']:
        raise ValueError("Positive vacuum and nonempty bulk required")
    primitive = bulk['primitive']
    m = primitive_miller(primitive, bulk['conventional'], spec['hkl'])
    normal, d, area, a1, a2, cs = _lattice(primitive, m)
    rows = [a1, a2, cs]
    recip = _reciprocal(rows)
    unit = []
    for k, atom in enumerate(bulk['atoms']):
        pos = _cart(atom['frac'], primitive)
        f = [_wrap(_dot(pos, b)) for b in recip]
        unit.append(dict(k=k, atom=atom, f=f, h=f[2]*d))
    planes = []
    for h in sorted(u['h'] for u in unit):
        if not planes or h-planes[-1] > 1e-4:
            planes.append(h)
    if len(planes) > 1 and planes[0]+d-planes[-1] <= 1e-4:
        raise ValueError("PLANE_WRAP_AMBIGUOUS")
    pcount = len(planes)
    t = spec.get('termination', 0)
    if type(t) is not int or not 0 <= t < pcount:
        raise ValueError("TERMINATION_OUT_OF_RANGE")
    bottom = t-spec['n_planes']+1
    e1 = _scale(a1, 1/_norm(a1))
    frame = [e1, _cross(normal, e1), normal]
    convert = lambda x: [_dot(x, e) for e in frame]
    A1, A2 = convert(a1), convert(a2)
    det = A1[0]*A2[1]-A1[1]*A2[0]
    frac2 = lambda x: [(x[0]*A2[1]-x[1]*A2[0])/det, (A1[0]*x[1]-A1[1]*x[0])/det]
    raw = []
    for plane in range(bottom, t+1):
        repeat, within = divmod(plane, pcount)
        for u in unit:
            if abs(u['h']-planes[within]) > 1e-4:
                continue
            x = convert(_add(_cart(u['f'], rows), _scale(cs, repeat)))
            fa, fb = map(_wrap, frac2(x))
            raw.append(dict(bulk_id=u['atom']['id'], unit=repeat, plane=plane-bottom,
                            species=u['atom']['species'], fa=fa, fb=fb, z=x[2], k=u['k']))
    raw.sort(key=lambda a: (a['plane'], a['k']))
    zlow, zhigh = min(a['z'] for a in raw), max(a['z'] for a in raw)
    minimum = min(a['unit'] for a in raw)
    atoms = [dict(id=f"{a['bulk_id']}:{a['unit']-minimum}", bulk_id=a['bulk_id'],
                  unit=a['unit']-minimum, plane=a['plane'], species=a['species'],
                  cart=[a['fa']*A1[0]+a['fb']*A2[0], a['fa']*A1[1]+a['fb']*A2[1], a['z']-zlow+spec['vacuum_A']/2]) for a in raw]
    slab = dict(primitive_miller=m, d_A=d, area_A2=area, planes_per_unit=pcount,
                n_planes=spec['n_planes'], termination=t,
                stacking_shift=[_wrap(x, 1e-7) for x in frac2(convert(cs))],
                cell=[[A1[0], A1[1], 0], [A2[0], A2[1], 0], [0, 0, zhigh-zlow+spec['vacuum_A']]], atoms=atoms)
    slab['faces_equivalent'] = faces_equivalent(slab)
    return slab


def _planar_data(geom):
    a, b = geom['cell'][:2]
    det = a[0]*b[1]-a[1]*b[0]
    frac = [[(p['cart'][0]*b[1]-p['cart'][1]*b[0])/det,
             (a[0]*p['cart'][1]-a[1]*p['cart'][0])/det] for p in geom['atoms']]
    def distance(u, v):
        delta = [u[i]-v[i]-round(u[i]-v[i]) for i in range(2)]
        return min(_norm([a[j]*(delta[0]+s)+b[j]*(delta[1]+t) for j in range(2)])
                   for s, t in product((-1, 0, 1), repeat=2))
    return frac, distance


def faces_equivalent(slab):
    a, b = slab['cell'][:2]
    metric = [[_dot(a, a), _dot(a, b)], [_dot(a, b), _dot(b, b)]]
    frac, distance = _planar_data(slab)
    z = [p['cart'][2] for p in slab['atoms']]
    zsum = min(z)+max(z)
    for r in product((-1, 0, 1), repeat=4):
        R = [r[:2], r[2:]]
        if abs(r[0]*r[3]-r[1]*r[2]) != 1:
            continue
        if any(abs(sum(R[k][i]*metric[k][l]*R[l][j] for k in range(2) for l in range(2))-metric[i][j]) > 1e-6*(metric[0][0]+metric[1][1]) for i in range(2) for j in range(2)):
            continue
        image = [[_dot(R[0], f), _dot(R[1], f)] for f in frac]
        for j, atom in enumerate(slab['atoms']):
            if atom['species'] != slab['atoms'][0]['species']:
                continue
            tr = [frac[j][i]-image[0][i] for i in range(2)]
            if all(any(q['species'] == p['species'] and abs(z[k]-(zsum-z[i])) < 1e-4
                       and distance(_add(image[i], tr), frac[k]) < 1e-4
                       for k, q in enumerate(slab['atoms'])) for i, p in enumerate(slab['atoms'])):
                return True
    return False


def slab_invariants(geom):
    a, b, c = geom['cell']
    if abs(_dot(c, a)) > 1e-6 or abs(_dot(c, b)) > 1e-6 or abs(a[2]) > 1e-9 or abs(b[2]) > 1e-9:
        return {'error': 'A3_NOT_PERPENDICULAR'}
    planes = []
    for z in sorted(atom['cart'][2] for atom in geom['atoms']):
        if not planes or z-planes[-1] > 1e-4:
            planes.append(z)
    ids = [next(i for i, z in enumerate(planes) if abs(z-atom['cart'][2]) <= 1e-4) for atom in geom['atoms']]
    composition = []
    for i in range(len(planes)):
        counts = {}
        for atom, plane in zip(geom['atoms'], ids):
            if plane == i:
                counts[atom['species']] = counts.get(atom['species'], 0)+1
        composition.append(''.join(f'{s}{counts[s]}' for s in sorted(counts)))
    frac, distance = _planar_data(geom)
    registry = [min(distance(frac[p], frac[q]) for p in range(len(ids)) for q in range(len(ids)) if ids[p] == i and ids[q] == i+k)
                for i in range(len(planes)) for k in (1, 2, 3) if i+k < len(planes)]
    return dict(a_lengths_A=sorted([_norm(a), _norm(b)]), area_A2=abs(a[0]*b[1]-a[1]*b[0]),
                n_atoms=len(ids), n_planes=len(planes), plane_composition=composition,
                spacings_A=[y-x for x, y in zip(planes, planes[1:])], registry_A=registry,
                vacuum_A=c[2]-(planes[-1]-planes[0]), z_bottom_A=planes[0])


def bottom_plane_atoms(slab, k):
    return [i+1 for i, a in enumerate(slab['atoms']) if a['plane'] < k]


def render_constraints(n_atoms, fixed):
    seen = set()
    for c in fixed:
        i = c if type(c) is int else c.get('atom') if isinstance(c, dict) else None
        if type(i) is not int or not 1 <= i <= n_atoms:
            return {'error': 'CONSTRAINT_INDEX_INVALID'}
        if i in seen:
            return {'error': 'CONSTRAINT_DUPLICATED'}
        seen.add(i)
        if isinstance(c, dict):
            v = c.get('direction')
            if not isinstance(v, list) or len(v) != 3 or any(type(x) not in (int, float) or not isfinite(x) for x in v) or _norm(v) == 0:
                return {'error': 'CONSTRAINT_DIRECTION_INVALID'}
    lines = []
    for c in sorted(fixed, key=lambda c: c if type(c) is int else c['atom']):
        lines.append(f'atom {c}' if type(c) is int else f"atom {c['atom']} "+' '.join(f'{x:.6f}' for x in c['direction']))
    return {'text': '\n'.join(['%block Geometry.Constraints', *lines, '%endblock Geometry.Constraints'])+'\n'}


class SlabService:
    """Create a contract revision and content addressed atom map for its owner.

    The caller obtains the source revision through the authorized draft store;
    atoms and primitive cell are taken from that revision, never from preview.
    """
    def __init__(self, repository, artifacts, drafts=None):
        from .draft_storage import SQLiteDraftRepository
        self.repository, self.artifacts = repository, artifacts
        self.drafts = drafts or SQLiteDraftRepository(repository, artifacts)

    def create_revision(self, owner, draft_id, draft_revision, conventional, spec, *, fixed=(),
                        idempotency_key, conventional_from_g03=False):
        import hashlib
        from .contracts import canonical
        from .domain import envelope
        if not conventional_from_g03:
            raise ValueError('Conventional cell must be explicitly supplied from G-03/Moyo')
        bundle = self.drafts.get_revision(owner, draft_id, draft_revision)
        source = bundle['structure']
        contracts = self.repository.contracts
        contracts.validate('structure-revision', source)
        project = source['project_id']
        self.repository.project(owner, project)
        p = source['payload']
        if p['cell']['unit'] != 'angstrom':
            raise ValueError('Slab source must use Angstrom')
        primitive = p['cell']['vectors']
        reciprocal = _reciprocal(primitive)
        if p['coordinates']['kind'] == 'cartesian' and p['coordinates']['unit'] != 'angstrom':
            raise ValueError('Slab source must use Angstrom')
        bulk = {'primitive': primitive, 'conventional': conventional, 'atoms': [
            {'id': s['atom_id'], 'species': s['species_label'],
             'frac': s['position'] if p['coordinates']['kind'] == 'fractional' else [_dot(s['position'], b) for b in reciprocal]}
            for s in p['sites']]}
        slab = build_slab(bulk, spec)
        constraints = render_constraints(len(slab['atoms']), fixed)
        if 'error' in constraints:
            raise ValueError(constraints['error'])
        data = canonical([{k: a[k] for k in ('id', 'bulk_id', 'unit', 'plane')} for a in slab['atoms']])
        upload = self.artifacts.stage(owner, {'project_id': project, 'kind': 'dftlab.atom-map',
            'media_type': 'application/json', 'size_bytes': len(data),
            'sha256': hashlib.sha256(data).hexdigest(),
            'idempotency_key': 'slab-map-'+hashlib.sha256(idempotency_key.encode('utf-8')).hexdigest()})
        for start in range(upload['received_bytes'], len(data), 65536):
            end = min(start+65536, len(data))
            self.artifacts.write(owner, upload['upload_id'], start, end-1, len(data), data[start:end])
        artifact = self.artifacts.commit(owner, upload['upload_id'])['payload']
        reference = {k: artifact[k] for k in ('artifact_id', 'sha256', 'media_type')}
        parameters = {**spec, **{k: slab[k] for k in ('primitive_miller', 'd_A', 'planes_per_unit', 'stacking_shift', 'faces_equivalent')},
                      'constraints': list(fixed)}
        revision = envelope('structure-revision', project, {
            'structure_id': p['structure_id'], 'revision': p['revision']+1, 'parent_revision': p['revision'],
            'convention': 'cell-vectors-as-rows', 'cell': {'vectors': slab['cell'], 'unit': 'angstrom'},
            'periodicity': list(p['periodicity']), 'coordinates': {'kind': 'cartesian', 'unit': 'angstrom'},
            'sites': [{'atom_id': a['id'], 'species_label': a['species'], 'position': a['cart']} for a in slab['atoms']],
            'physical_intent': 'SLAB', 'transformations': [{'kind': 'SLAB', 'from_revision': p['revision'],
                'atom_map': reference, 'parameters': parameters}]}, contracts=contracts)
        # Persist through the existing draft CAS/idempotency port. Preview input
        # cannot supply source atoms or create an accepted scientific verdict.
        content = {k: v for k, v in revision['payload'].items()
                   if k not in {'structure_id', 'revision', 'parent_revision'}}
        revised, _ = self.drafts.revise(owner, draft_id, {
            'idempotency_key': idempotency_key, 'expected_revision': draft_revision,
            'changes': {'structure': content}})
        return revised['structure']
