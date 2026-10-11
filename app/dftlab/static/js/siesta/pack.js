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
