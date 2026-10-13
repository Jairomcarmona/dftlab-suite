// Vista previa de geometría G-05/G-06, según SLABS.md. El servicio crea la revisión.
// Algoritmo de referencia portado; no emite revisión ni veredicto de un motor.
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a, b) => a.map((x, i) => x + b[i]);
const scale = (a, s) => a.map(x => x * s);
const norm = a => Math.sqrt(dot(a, a));
const det3 = m => dot(m[0], cross(m[1], m[2]));
const toCart = (f, M) => [0, 1, 2].map(j => f[0] * M[0][j] + f[1] * M[1][j] + f[2] * M[2][j]);
function inv3(m) {
  const d = det3(m);
  const c = (r0, c0, r1, c1) => m[r0][c0] * m[r1][c1] - m[r0][c1] * m[r1][c0];
  return [
    [c(1, 1, 2, 2) / d, -c(0, 1, 2, 2) / d, c(0, 1, 1, 2) / d],
    [-c(1, 0, 2, 2) / d, c(0, 0, 2, 2) / d, -c(0, 0, 1, 2) / d],
    [c(1, 0, 2, 1) / d, -c(0, 0, 2, 1) / d, c(0, 0, 1, 1) / d],
  ];
}
// Filas de la recíproca sin 2π: b_i · a_j = δ_ij.
const reciprocal = A => { const I = inv3(A); return [0, 1, 2].map(i => [I[0][i], I[1][i], I[2][i]]); };
const toFrac = (x, M) => { const I = inv3(M); return [0, 1, 2].map(j => x[0] * I[0][j] + x[1] * I[1][j] + x[2] * I[2][j]); };
const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
const wrap = (x, tol = 1e-9) => { const y = x - Math.floor(x); return y > 1 - tol ? 0 : y; };
const lexLess = (u, v) => { for (let i = 0; i < u.length; i++) if (u[i] !== v[i]) return u[i] < v[i]; return false; };

// G5-1: índices de Miller de la celda convencional → índices enteros coprimos en la base primitiva.
export function primitiveMiller(primitive, conventional, hkl) {
  const B = reciprocal(conventional);
  const G = add(add(scale(B[0], hkl[0]), scale(B[1], hkl[1])), scale(B[2], hkl[2]));
  const m = primitive.map(a => dot(a, G));
  for (let s = 1; s <= 24; s++) {
    const v = m.map(x => x * s);
    if (v.every(x => Math.abs(x - Math.round(x)) < 1e-6)) {
      const r = v.map(Math.round), g = r.reduce((a, b) => gcd(a, b), 0);
      return r.map(x => x / g);
    }
  }
  throw new Error('MILLER_NOT_RATIONAL');
}

function lattice2D(Ap, m, R = 6) {
  const Bp = reciprocal(Ap);
  const Gm = add(add(scale(Bp[0], m[0]), scale(Bp[1], m[1])), scale(Bp[2], m[2]));
  const d = 1 / norm(Gm), n = scale(Gm, d);
  const area = Math.abs(det3(Ap)) / d;
  const inPlane = [], stack = [];
  for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) for (let k = -R; k <= R; k++) {
    const u = [i, j, k], c = toCart(u, Ap), mu = m[0] * i + m[1] * j + m[2] * k;
    if (mu === 0 && (i || j || k)) inPlane.push({ u, c, len: norm(c) });
    if (mu === 1) stack.push({ u, c, p: norm(add(c, scale(n, -dot(c, n)))) });
  }
  const byLen = (a, b) => (Math.abs(a.len - b.len) > 1e-9 ? a.len - b.len : (lexLess(a.u, b.u) ? -1 : 1));
  inPlane.sort(byLen);
  const a1 = inPlane[0];
  const cands = inPlane.filter(v => Math.abs(Math.abs(dot(cross(a1.c, v.c), n)) - area) < 1e-6 * area);
  const shortest = cands[0].len;
  const right = cands.filter(v => Math.abs(v.len - shortest) < 1e-9 && dot(cross(a1.c, v.c), n) > 0)
    .sort((a, b) => (Math.abs(dot(a1.c, a.c) - dot(a1.c, b.c)) > 1e-9 ? dot(a1.c, a.c) - dot(a1.c, b.c) : (lexLess(a.u, b.u) ? -1 : 1)));
  stack.sort((a, b) => (Math.abs(a.p - b.p) > 1e-9 ? a.p - b.p : (lexLess(a.u, b.u) ? -1 : 1)));
  return { n, d, area, a1: a1.c, a2: right[0].c, cs: stack[0].c };
}

// G-05: construye la lámina. bulk = {primitive, conventional, atoms:[{id, species, frac}]} con frac en la primitiva.
// spec = {hkl, n_planes, vacuum_A, termination}. Ver la ficha para cada convención.
export function buildSlab(bulk, spec, tol = 1e-4) {
  const Ap = bulk.primitive;
  const m = primitiveMiller(Ap, bulk.conventional, spec.hkl);
  const { n, d, area, a1, a2, cs } = lattice2D(Ap, m);
  const M = [a1, a2, cs];
  const unit = bulk.atoms.map((a, k) => {
    const f = toFrac(toCart(a.frac, Ap), M).map(x => wrap(x));
    return { k, id: a.id, species: a.species, f, h: f[2] * d };
  });
  const hs = [...unit.map(u => u.h)].sort((x, y) => x - y);
  const planes = [];
  for (const h of hs) if (!planes.length || h - planes.at(-1) > tol) planes.push(h);
  if (planes.length > 1 && planes[0] + d - planes.at(-1) <= tol) throw new Error('PLANE_WRAP_AMBIGUOUS');
  const P = planes.length;
  const planeOf = h => planes.findIndex(p => Math.abs(p - h) <= tol);
  const t = spec.termination ?? 0;
  if (t < 0 || t >= P) throw new Error('TERMINATION_OUT_OF_RANGE');
  const gTop = t, gBot = gTop - spec.n_planes + 1;
  const e1 = scale(a1, 1 / norm(a1)), e3 = n, e2 = cross(e3, e1);
  const inFrame = x => [dot(x, e1), dot(x, e2), dot(x, e3)];
  const A1 = inFrame(a1), A2 = inFrame(a2);
  const det2 = A1[0] * A2[1] - A1[1] * A2[0];
  const raw = [];
  for (let g = gBot; g <= gTop; g++) {
    const mm = Math.floor(g / P), p = g - mm * P;
    for (const u of unit.filter(x => planeOf(x.h) === p)) {
      const x = inFrame(add(toCart(u.f, M), scale(cs, mm)));
      const fa = wrap((x[0] * A2[1] - x[1] * A2[0]) / det2), fb = wrap((A1[0] * x[1] - A1[1] * x[0]) / det2);
      raw.push({ bulk_id: u.id, unit: mm, plane: g - gBot, species: u.species, fa, fb, z: x[2], k: u.k });
    }
  }
  raw.sort((a, b) => a.plane - b.plane || a.k - b.k);
  const zBot = Math.min(...raw.map(a => a.z)), zTop = Math.max(...raw.map(a => a.z));
  const L = zTop - zBot + spec.vacuum_A;
  const mMin = Math.min(...raw.map(a => a.unit));
  const atoms = raw.map(a => ({
    id: `${a.bulk_id}:${a.unit - mMin}`, bulk_id: a.bulk_id, unit: a.unit - mMin, plane: a.plane, species: a.species,
    cart: [a.fa * A1[0] + a.fb * A2[0], a.fa * A1[1] + a.fb * A2[1], a.z - zBot + spec.vacuum_A / 2],
  }));
  const cell = [[A1[0], A1[1], 0], [A2[0], A2[1], 0], [0, 0, L]];
  return {
    primitive_miller: m, d_A: d, area_A2: area, planes_per_unit: P, n_planes: spec.n_planes, termination: t,
    stacking_shift: (() => { const x = inFrame(cs); return [wrap((x[0] * A2[1] - x[1] * A2[0]) / det2, 1e-7), wrap((A1[0] * x[1] - A1[1] * x[0]) / det2, 1e-7)]; })(),
    cell, atoms, faces_equivalent: facesEquivalent({ cell, atoms }),
  };
}

// ¿Existe una isometría de la lámina que cambia z por −z? Parte plana: operación de la red 2D (entera en la base a1, a2).
export function facesEquivalent(slab, tol = 1e-4) {
  const [A1, A2] = slab.cell, Lz = slab.cell[2][2];
  const det2 = A1[0] * A2[1] - A1[1] * A2[0];
  const fr = slab.atoms.map(a => [(a.cart[0] * A2[1] - a.cart[1] * A2[0]) / det2, (A1[0] * a.cart[1] - A1[1] * a.cart[0]) / det2, a.cart[2]]);
  const zs = slab.atoms.map(a => a.cart[2]), zc = Math.min(...zs) + Math.max(...zs);
  const G = [[A1[0] ** 2 + A1[1] ** 2, A1[0] * A2[0] + A1[1] * A2[1]], [0, A2[0] ** 2 + A2[1] ** 2]]; G[1][0] = G[0][1];
  const ops = [];
  const vals = [-1, 0, 1];
  for (const r00 of vals) for (const r01 of vals) for (const r10 of vals) for (const r11 of vals) {
    const R = [[r00, r01], [r10, r11]];
    if (Math.abs(r00 * r11 - r01 * r10) !== 1) continue;
    let ok = true;
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      let s = 0;
      for (let k = 0; k < 2; k++) for (let l = 0; l < 2; l++) s += R[k][i] * G[k][l] * R[l][j];
      if (Math.abs(s - G[i][j]) > 1e-6 * (G[0][0] + G[1][1])) ok = false;
    }
    if (ok) ops.push(R);
  }
  const inPlaneDist = (u, v) => {
    let best = Infinity;
    for (const s of [-1, 0, 1]) for (const t of [-1, 0, 1]) {
      const da = u[0] - v[0] - Math.round(u[0] - v[0]) + s, db = u[1] - v[1] - Math.round(u[1] - v[1]) + t;
      best = Math.min(best, Math.hypot(da * A1[0] + db * A2[0], da * A1[1] + db * A2[1]));
    }
    return best;
  };
  for (const R of ops) {
    const img = fr.map(f => [R[0][0] * f[0] + R[0][1] * f[1], R[1][0] * f[0] + R[1][1] * f[1], zc - f[2]]);
    for (let j = 0; j < fr.length; j++) {
      if (slab.atoms[j].species !== slab.atoms[0].species) continue;
      const tr = [fr[j][0] - img[0][0], fr[j][1] - img[0][1]];
      const all = img.every((p, i) => fr.some((q, k) => slab.atoms[k].species === slab.atoms[i].species
        && Math.abs(q[2] - p[2]) < tol && inPlaneDist([p[0] + tr[0], p[1] + tr[1]], q) < tol));
      if (all) return true;
    }
  }
  return false;
}

// Invariantes para comparar dos láminas sin depender del origen, la orientación ni la elección de a1, a2.
export function slabInvariants(geom, tol = 1e-4) {
  const [A1, A2, A3] = geom.cell;
  if (Math.abs(dot(A3, A1)) > 1e-6 || Math.abs(dot(A3, A2)) > 1e-6 || Math.abs(A1[2]) > 1e-9 || Math.abs(A2[2]) > 1e-9)
    return { error: 'A3_NOT_PERPENDICULAR' };
  const det2 = A1[0] * A2[1] - A1[1] * A2[0];
  const zs = geom.atoms.map(a => a.cart[2]);
  const sorted = [...zs].sort((x, y) => x - y);
  const planes = [];
  for (const z of sorted) if (!planes.length || z - planes.at(-1) > tol) planes.push(z);
  const pIdx = z => planes.findIndex(p => Math.abs(p - z) <= tol);
  const fr = geom.atoms.map(a => [(a.cart[0] * A2[1] - a.cart[1] * A2[0]) / det2, (A1[0] * a.cart[1] - A1[1] * a.cart[0]) / det2]);
  const comp = planes.map((_, i) => {
    const c = {};
    geom.atoms.forEach((a, k) => { if (pIdx(a.cart[2]) === i) c[a.species] = (c[a.species] || 0) + 1; });
    return Object.keys(c).sort().map(s => `${s}${c[s]}`).join('');
  });
  const regDist = (i, j) => {
    let best = Infinity;
    geom.atoms.forEach((a, p) => {
      if (pIdx(a.cart[2]) !== i) return;
      geom.atoms.forEach((b, q) => {
        if (pIdx(b.cart[2]) !== j) return;
        for (const s of [-1, 0, 1]) for (const t of [-1, 0, 1]) {
          const da = fr[q][0] - fr[p][0] - Math.round(fr[q][0] - fr[p][0]) + s;
          const db = fr[q][1] - fr[p][1] - Math.round(fr[q][1] - fr[p][1]) + t;
          best = Math.min(best, Math.hypot(da * A1[0] + db * A2[0], da * A1[1] + db * A2[1]));
        }
      });
    });
    return best;
  };
  const registry = [];
  for (let i = 0; i < planes.length; i++) for (let k = 1; k <= 3 && i + k < planes.length; k++) registry.push(regDist(i, i + k));
  const lens = [norm(A1), norm(A2)].sort((x, y) => x - y);
  return {
    a_lengths_A: lens, area_A2: Math.abs(det2), n_atoms: geom.atoms.length, n_planes: planes.length,
    plane_composition: comp, spacings_A: planes.slice(1).map((z, i) => z - planes[i]),
    registry_A: registry, vacuum_A: A3[2] - (planes.at(-1) - planes[0]), z_bottom_A: planes[0],
  };
}

// G-06: índices (1-based, orden de la geometría) de los átomos de los `k` planos inferiores.
export function bottomPlaneAtoms(slab, k) {
  return slab.atoms.map((a, i) => [a, i + 1]).filter(([a]) => a.plane < k).map(([, i]) => i);
}

// G-06 / regla R-1: bloque Geometry.Constraints. Índices positivos, sin repetir, uno por línea.
export function renderConstraints(nAtoms, fixed) {
  const seen = new Set();
  for (const c of fixed) {
    const i = typeof c === 'number' ? c : c.atom;
    if (!Number.isInteger(i) || i < 1 || i > nAtoms) return { error: 'CONSTRAINT_INDEX_INVALID' };
    if (seen.has(i)) return { error: 'CONSTRAINT_DUPLICATED' };
    seen.add(i);
    if (typeof c !== 'number' && (!Array.isArray(c.direction) || c.direction.length !== 3 || norm(c.direction) === 0))
      return { error: 'CONSTRAINT_DIRECTION_INVALID' };
  }
  const lines = [...fixed].sort((a, b) => (typeof a === 'number' ? a : a.atom) - (typeof b === 'number' ? b : b.atom))
    .map(c => (typeof c === 'number' ? `atom ${c}` : `atom ${c.atom} ${c.direction.map(x => x.toFixed(6)).join(' ')}`));
  return { text: ['%block Geometry.Constraints', ...lines, '%endblock Geometry.Constraints'].join('\n') + '\n' };
}
