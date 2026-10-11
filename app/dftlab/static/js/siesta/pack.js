// Reader for the JSON written by scripts/dftlab_pack.py ("*.dftlab.json").
// Large arrays are stored as {"__array__":1, dtype, shape, encoding:"base64-gzip", data}
// (little-endian, C order). unpackDftlab() replaces each of them by
// {shape, dtype, data: TypedArray} and leaves small inline arrays as nested JS arrays.
// Gzip is inflated with the standard DecompressionStream (browsers, Node >= 18).

const DTYPES = {
  float32: Float32Array, float64: Float64Array, int8: Int8Array, uint8: Uint8Array,
  int16: Int16Array, uint16: Uint16Array, int32: Int32Array, uint32: Uint32Array,
};

export function isDftlabPack(obj) {
  return !!obj && typeof obj === 'object' && obj.dftlab === 'siesta-pack';
}

function b64ToBytes(b64) {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // eslint-disable-next-line no-undef
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

async function gunzip(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('DecompressionStream not available');
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function decodeArray(a) {
  const T = DTYPES[a.dtype];
  if (!T) throw new Error(`unsupported dtype ${a.dtype}`);
  let bytes = b64ToBytes(a.data);
  if (a.encoding === 'base64-gzip') bytes = await gunzip(bytes);
  const n = (a.shape || []).reduce((p, d) => p * d, 1);
  if (!Number.isInteger(n) || n < 0 || bytes.byteLength !== n * T.BYTES_PER_ELEMENT) {
    throw new Error(`array ${JSON.stringify(a.shape)} ${a.dtype}: ${bytes.byteLength} bytes, expected ${n * T.BYTES_PER_ELEMENT}`);
  }
  const buf = bytes.byteOffset % T.BYTES_PER_ELEMENT === 0 ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes.slice().buffer;
  return { shape: a.shape, dtype: a.dtype, data: new T(buf) };
}

/** Decode all packed arrays (in place on a deep copy). Accepts the parsed object or JSON text. */
export async function unpackDftlab(input) {
  const obj = typeof input === 'string' ? JSON.parse(input) : structuredClone(input);
  if (!isDftlabPack(obj)) throw new Error('not a dftlab pack (missing "dftlab":"siesta-pack")');
  const walk = async (node) => {
    if (Array.isArray(node)) { for (let i = 0; i < node.length; i++) node[i] = await walk(node[i]); return node; }
    if (node && typeof node === 'object') {
      if (node.__array__) return decodeArray(node);
      for (const k of Object.keys(node)) node[k] = await walk(node[k]);
    }
    return node;
  };
  return walk(obj);
}

/** Flat index into a C-ordered nd array: at(arr, i, j, k) */
export function at(arr, ...idx) {
  let off = 0;
  for (let d = 0; d < arr.shape.length; d++) off = off * arr.shape[d] + (idx[d] ?? 0);
  return arr.data[off];
}

/** Slice the last axis as a subarray view: row(arr, i, j) -> TypedArray of length shape[-1] */
export function row(arr, ...idx) {
  const n = arr.shape[arr.shape.length - 1];
  let off = 0;
  for (let d = 0; d < arr.shape.length - 1; d++) off = off * arr.shape[d] + (idx[d] ?? 0);
  return arr.data.subarray(off * n, off * n + n);
}

/** Dequantize an int8 wavefunction component {scale, re, im} -> {re: Float32Array, im: Float32Array} */
export function dequantizeWF(comp) {
  const re = Float32Array.from(comp.re.data ?? comp.re, (v) => v * comp.scale);
  const im = Float32Array.from(comp.im.data ?? comp.im, (v) => v * comp.scale);
  return { re, im };
}

// ---- what an unpacked pack provides to a viewer ----

// Small arrays are written inline as nested lists (enc(..., inline_max)); give them the decoded form.
function nd(a) {
  if (a && ArrayBuffer.isView(a.data) && Array.isArray(a.shape)) return a;
  if (!Array.isArray(a)) return null;
  const shape = []; for (let t = a; Array.isArray(t); t = t[0]) shape.push(t.length);
  const flat = a.flat(shape.length - 1);
  if (flat.length !== shape.reduce((p, d) => p * d, 1) || !flat.every((v) => typeof v === 'number')) return null;
  return { shape, data: Float64Array.from(flat) };
}
const isArr = (a, rank) => !!a && ArrayBuffer.isView(a.data) && Array.isArray(a.shape) && (rank == null || a.shape.length === rank);

/** Band path of an unpacked pack in the shape parseBands() returns (absolute energies in eV,
 *  x in 1/Ang incl. 2pi, as written by dftlab_pack.py). Null when the pack has no usable bands. */
export function packBands(pack) {
  const b0 = pack && pack.bands;
  if (!b0) return null;
  const b = { ...b0, energies: nd(b0.energies), x: nd(b0.x), kcart: nd(b0.kcart) };
  if (!isArr(b.energies, 3) || !isArr(b.x, 1)) return null;
  const [nSpin, nk, nBands] = b.energies.shape;
  if (b.x.shape[0] !== nk || !Number.isFinite(pack.fermi)) return null;
  const bands = Array.from({ length: nSpin }, (_, s) => Array.from({ length: nBands }, (_, n) => {
    const v = new Float64Array(nk);
    for (let k = 0; k < nk; k++) v[k] = b.energies.data[(s * nk + k) * nBands + n];
    return v;
  }));
  return {
    format: 'dftlab-pack', fermi: pack.fermi, nBands, nSpin, nk,
    noncollinear: !!pack.spin?.noncollinear,
    x: Float64Array.from(b.x.data),
    kpoints: isArr(b.kcart, 2) ? Array.from({ length: nk }, (_, k) => Array.from(b.kcart.data.subarray(3 * k, 3 * k + 3))) : null,
    bands,
    labels: (b.labels || []).map((l) => ({ x: l.x, raw: l.label, label: l.label, k: l.k })),
    units: { energy: 'eV', x: '1/Ang', kpoints: '1/Ang cartesian' },
    warnings: [],
  };
}

/** Broadened DOS of an unpacked pack: {energy, fermi, total[channel], byL:{names, data[channel][group]}, ...}. */
export function packDOS(pack) {
  const d0 = pack && pack.dos;
  if (!d0) return null;
  const d = { ...d0, energy: nd(d0.energy), total: nd(d0.total) };
  if (!isArr(d.energy, 1) || !isArr(d.total, 2) || !Number.isFinite(pack.fermi)) return null;
  const nE = d.energy.shape[0], [nch, nE2] = d.total.shape;
  if (nE2 !== nE) return null;
  const chan = (a, c, g, ng) => a.data.subarray(((c * ng) + g) * nE, ((c * ng) + g + 1) * nE);
  const groups = (G0) => { const G = G0 && { names: G0.names, data: nd(G0.data) }; return (G && Array.isArray(G.names) && isArr(G.data, 3) && G.data.shape[1] === G.names.length && G.data.shape[0] === nch && G.data.shape[2] === nE)
    ? { names: G.names, data: Array.from({ length: nch }, (_, c) => G.names.map((_, g) => chan(G.data, c, g, G.data.shape[1]))) } : null; };
  return {
    energy: d.energy.data, fermi: pack.fermi, sigma: d.sigma, mp: d.mp, nk: d.nk, nChannels: nch,
    total: Array.from({ length: nch }, (_, c) => chan(d.total, c, 0, 1)),
    byL: groups(d.byL), bySpecies: groups(d.bySpecies), bySpeciesL: groups(d.bySpeciesL),
    electronsBelowFermi: d.electronsBelowFermi,
    units: { energy: 'eV', dos: 'states/eV/cell' },
  };
}

/** Cell of an unpacked pack as {lattice (Ang), positions (fractional), numbers (Z)}. */
export function packStructure(pack) {
  const s = pack && pack.structure;
  if (!s || !Array.isArray(s.cell) || !Array.isArray(s.fractional) || !Array.isArray(s.Z) || s.fractional.length !== s.Z.length) return null;
  return { lattice: s.cell, positions: s.fractional, numbers: s.Z };
}

/** Parts of the pack that a generic viewer can show, and the remaining parts by name. */
export function packContents(pack) {
  const extras = [];
  if (pack?.bands?.fatbands) extras.push({ key: 'fatbands', label: 'bandas ponderadas por especie y l (fatbands)' });
  if (pack?.coop?.pairs?.length) extras.push({ key: 'coop', label: `COOP/COHP (${pack.coop.pairs.length} par${pack.coop.pairs.length > 1 ? 'es' : ''})` });
  if (pack?.wavefunctions?.states?.length) extras.push({ key: 'wavefunctions', label: `funciones de onda (${pack.wavefunctions.states.length} estado${pack.wavefunctions.states.length > 1 ? 's' : ''})` });
  return { bands: !!packBands(pack), dos: !!packDOS(pack), structure: !!packStructure(pack), gap: !!pack?.gap, extras };
}
