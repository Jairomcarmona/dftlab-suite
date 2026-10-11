// bz.js -- first Brillouin zone (Wigner-Seitz cell of the reciprocal lattice) for DFT Lab.
//
// The zone is built by clipping a large cube with the bisector half-spaces
//   k . G <= |G|^2 / 2
// for all reciprocal lattice vectors G = n1 b1' + n2 b2' + n3 b3' with |n_i| <= range,
// where (b1', b2', b3') is the Niggli-reduced reciprocal basis (so range = 2 is plenty).
// Reciprocal lattices are arrays of ROW vectors (as returned by kpath.js, 2*pi included).

import { dot, cross, norm, add, sub, scale, vecmat, inv3, det3, niggliReduce } from './symmetry.js';

function clipPolygon(loop, n, d, eps) {
  // Sutherland-Hodgman: keep n.x <= d
  const out = [];
  const m = loop.length;
  for (let i = 0; i < m; i++) {
    const P = loop[i], Q = loop[(i + 1) % m];
    const sp = dot(n, P) - d, sq = dot(n, Q) - d;
    const pin = sp <= eps, qin = sq <= eps;
    if (pin) out.push(P);
    if ((pin && !qin && sp < -eps) || (!pin && qin && sq < -eps)) {
      const t = sp / (sp - sq);
      out.push(add(P, scale(sub(Q, P), t)));
    }
  }
  return out;
}

function orderLoop(points, normal) {
  const c = points.reduce((s, p) => add(s, p), [0, 0, 0]).map((x) => x / points.length);
  // in-plane basis
  let u = sub(points[0], c);
  if (norm(u) < 1e-14) u = sub(points[1], c);
  u = scale(u, 1 / norm(u));
  const nn = scale(normal, 1 / norm(normal));
  const v = cross(nn, u);
  return points
    .map((p) => { const w = sub(p, c); return { p, ang: Math.atan2(dot(w, v), dot(w, u)) }; })
    .sort((a, b) => a.ang - b.ang)
    .map((o) => o.p); // counter-clockwise seen from outside (normal points outwards)
}

function dedupePoints(points, tol) {
  const out = [];
  for (const p of points) if (!out.some((q) => norm(sub(p, q)) < tol)) out.push(p);
  return out;
}

/**
 * Brillouin zone polyhedron.
 * @param {number[][]} reciprocalLattice rows b1, b2, b3 (Cartesian, 1/Angstrom, 2*pi included or not)
 * @param {{range?: number}} options
 * @returns {{vertices: number[][], faces: number[][], edges: number[][], faceNormals: number[][],
 *            faceG: number[][], faceMiller: number[][], volume: number, reciprocalVolume: number}}
 *   faces are ordered vertex-index loops, counter-clockwise when seen from outside;
 *   faceG is the reciprocal lattice vector defining each face (face plane: k.G = |G|^2/2) and
 *   faceMiller its integer coordinates in the input reciprocal basis.
 */
export function brillouinZone(reciprocalLattice, { range = 2 } = {}) {
  const B = reciprocalLattice;
  const red = niggliReduce(B, 1e-10 * Math.max(...B.map((b) => dot(b, b)))).lattice;
  const lscale = Math.max(...red.map(norm));
  const eps = 1e-10 * lscale * lscale;
  const tol = 1e-8 * lscale;
  // candidate G vectors, shortest first
  const Gs = [];
  for (let i = -range; i <= range; i++) for (let j = -range; j <= range; j++) for (let k = -range; k <= range; k++) {
    if (!i && !j && !k) continue;
    const G = vecmat([i, j, k], red);
    Gs.push(G);
  }
  Gs.sort((g, h) => dot(g, g) - dot(h, h));
  // start: cube containing the WS cell
  const R = red.reduce((s, b) => s + norm(b), 0);
  let faces = [];
  const ax = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let a = 0; a < 3; a++) for (const s of [1, -1]) {
    const n = scale(ax[a], s);
    const u = ax[(a + 1) % 3], v = ax[(a + 2) % 3];
    const c0 = scale(n, R);
    const loop = [
      add(c0, add(scale(u, R), scale(v, R))), add(c0, add(scale(u, -R), scale(v, R))),
      add(c0, add(scale(u, -R), scale(v, -R))), add(c0, add(scale(u, R), scale(v, -R))),
    ];
    faces.push({ normal: n, d: R, G: null, loop: orderLoop(loop, n) });
  }
  for (const G of Gs) {
    const d = dot(G, G) / 2;
    // quick reject: all vertices inside
    let anyOut = false;
    for (const f of faces) { for (const p of f.loop) if (dot(G, p) - d > eps) { anyOut = true; break; } if (anyOut) break; }
    if (!anyOut) continue;
    const newFaces = [];
    const cap = [];
    for (const f of faces) {
      const loop = clipPolygon(f.loop, G, d, eps);
      for (const p of loop) if (Math.abs(dot(G, p) - d) <= Math.max(eps, 1e-9 * d)) cap.push(p);
      const lp = dedupePoints(loop, tol);
      if (lp.length >= 3) newFaces.push({ ...f, loop: lp });
    }
    const capPts = dedupePoints(cap, tol);
    if (capPts.length >= 3) newFaces.push({ normal: G, d, G, loop: orderLoop(capPts, G) });
    faces = newFaces;
  }
  // global vertex list
  const vertices = [];
  const idx = (p) => {
    for (let i = 0; i < vertices.length; i++) if (norm(sub(vertices[i], p)) < tol * 10) return i;
    vertices.push(p);
    return vertices.length - 1;
  };
  const Binv = inv3(B);
  const outFaces = [], normals = [], faceG = [], faceMiller = [];
  for (const f of faces) {
    let loop = f.loop.map(idx).filter((v, i, arr) => v !== arr[(i + 1) % arr.length]);
    // drop collinear vertices
    let changed = true;
    while (changed && loop.length > 3) {
      changed = false;
      for (let i = 0; i < loop.length; i++) {
        const a = vertices[loop[(i + loop.length - 1) % loop.length]], b = vertices[loop[i]], c = vertices[loop[(i + 1) % loop.length]];
        if (norm(cross(sub(b, a), sub(c, b))) < tol * lscale) { loop.splice(i, 1); changed = true; break; }
      }
    }
    if (loop.length < 3) continue;
    outFaces.push(loop);
    normals.push(scale(f.normal, 1 / norm(f.normal)));
    faceG.push(f.G ? f.G.slice() : null);
    faceMiller.push(f.G ? vecmat(f.G, Binv).map((x) => Math.round(x)) : null);
  }
  // keep only vertices used by faces, re-index
  const used = [...new Set(outFaces.flat())].sort((a, b) => a - b);
  const remap = new Map(used.map((v, i) => [v, i]));
  const verts = used.map((i) => vertices[i]);
  const facesIdx = outFaces.map((l) => l.map((v) => remap.get(v)));
  const edgeSet = new Map();
  for (const l of facesIdx) for (let i = 0; i < l.length; i++) {
    const a = l[i], b = l[(i + 1) % l.length];
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (!edgeSet.has(key)) edgeSet.set(key, a < b ? [a, b] : [b, a]);
  }
  // volume = sum over faces of (1/3) * area * distance-from-origin
  let vol = 0;
  facesIdx.forEach((l, fi) => {
    let area = [0, 0, 0];
    for (let i = 1; i + 1 < l.length; i++) area = add(area, cross(sub(verts[l[i]], verts[l[0]]), sub(verts[l[i + 1]], verts[l[0]])));
    vol += Math.abs(dot(area, normals[fi])) / 2 * dot(verts[l[0]], normals[fi]) / 3;
  });
  return {
    vertices: verts,
    faces: facesIdx,
    edges: [...edgeSet.values()],
    faceNormals: normals,
    faceG,
    faceMiller,
    volume: vol,
    reciprocalVolume: Math.abs(det3(B)),
  };
}

/** Edges of the zone as Cartesian line segments [[p1, p2], ...] (for wireframe drawing). */
export function bzWireframe(bz) {
  return bz.edges.map(([a, b]) => [bz.vertices[a], bz.vertices[b]]);
}

/** Triangulated faces (fan) for mesh rendering: {positions: flat Float32-ready array, indices}. */
export function bzMesh(bz) {
  const positions = bz.vertices.flat();
  const indices = [];
  for (const l of bz.faces) for (let i = 1; i + 1 < l.length; i++) indices.push(l[0], l[i], l[i + 1]);
  return { positions, indices };
}

/** True if Cartesian k lies inside (or on) the zone. */
export function isInBZ(bz, k, tol = 1e-9) {
  return bz.faces.every((l, fi) => dot(k, bz.faceNormals[fi]) <= dot(bz.vertices[l[0]], bz.faceNormals[fi]) + tol);
}

/** Map a Cartesian k-point into the first Brillouin zone (Wigner-Seitz reduction). */
export function toFirstBZ(k, reciprocalLattice, range = 2) {
  const red = niggliReduce(reciprocalLattice, 1e-12).lattice;
  // first bring to the reduced parallelepiped centred on Gamma
  const f = vecmat(k, inv3(red)).map((x) => x - Math.round(x));
  let kk = vecmat(f, red);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = -range; i <= range; i++) for (let j = -range; j <= range; j++) for (let l = -range; l <= range; l++) {
      if (!i && !j && !l) continue;
      const cand = sub(kk, vecmat([i, j, l], red));
      if (dot(cand, cand) < dot(kk, kk) - 1e-12) { kk = cand; improved = true; }
    }
  }
  return kk;
}

/**
 * Cartesian geometry of a k-path (output of kpath.getPath) for drawing inside the BZ:
 * {points: {label: [kx,ky,kz]}, segments: [{from, to, start:[..], end:[..]}], lines: polylines (continuous runs)}
 */
export function kpathCartesian(res) {
  const B = res.reciprocal_primitive_lattice;
  const points = {};
  for (const [lab, f] of Object.entries(res.point_coords)) points[lab] = vecmat(f, B);
  const segments = res.path.map(([a, b]) => ({ from: a, to: b, start: points[a], end: points[b] }));
  const lines = [];
  for (const s of segments) {
    const cur = lines[lines.length - 1];
    if (cur && cur.labels[cur.labels.length - 1] === s.from) { cur.labels.push(s.to); cur.points.push(s.end); }
    else lines.push({ labels: [s.from, s.to], points: [s.start, s.end] });
  }
  return { points, segments, lines };
}

/** Reciprocal axes for drawing: [{label:'b1', vector}, ...]. */
export function reciprocalAxes(reciprocalLattice) {
  return reciprocalLattice.map((v, i) => ({ label: `b${i + 1}`, vector: v.slice() }));
}
