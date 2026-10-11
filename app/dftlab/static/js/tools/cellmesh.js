// Celda → malla k y MeshCutoff: validación de entradas y búsqueda del tamaño de malla FFT.
// Sin DOM, para poder probarlo en Node.

export const LIMITS = {
  length: [0.1, 1e4],   // Å
  angle: [1, 179],      // grados
  dk: [1e-3, 10],       // Å⁻¹ (con 2π)
  cutoff: [1, 1e5],     // Ry
  maxFft: 1 << 20,      // dominio de fftGood
  maxMesh: 8192,        // puntos por eje de la malla real
  maxK: 1000,           // puntos k por eje
};

// Menor entero m ≥ n cuyos únicos factores primos son 2, 3 y 5 (los tamaños que admite la FFT de SIESTA).
// Dominio: entero con 1 ≤ n ≤ LIMITS.maxFft. Fuera de él lanza RangeError. Termina siempre: como mucho en la
// siguiente potencia de 2, que es 2, 3, 5-lisa.
export function fftGood(n) {
  if (!Number.isInteger(n) || n < 1 || n > LIMITS.maxFft)
    throw new RangeError(`fftGood: n debe ser un entero entre 1 y ${LIMITS.maxFft} (recibido ${n})`);
  const cap = 2 ** Math.ceil(Math.log2(n));
  for (let c = n; c <= cap; c++) {
    let m = c;
    for (const p of [2, 3, 5]) while (m % p === 0) m /= p;
    if (m === 1) return c;
  }
  return cap; // inalcanzable: cap es potencia de 2
}

// Valores crudos de los campos (cadenas o números) → {ok, values} o {ok:false, editing, errors}.
// `editing` es verdadero cuando algún campo está vacío: el usuario aún escribe y no se muestra como error.
export function validateCellInputs(raw) {
  const errors = [];
  let editing = false;
  const num = (name, v, [lo, hi], unit) => {
    if (v === '' || v == null || (typeof v === 'string' && v.trim() === '')) { editing = true; return NaN; }
    const x = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(x)) { errors.push(`${name}: no es un número finito`); return NaN; }
    if (x < lo || x > hi) { errors.push(`${name}: debe estar entre ${lo} y ${hi} ${unit}`); return NaN; }
    return x;
  };
  const L = ['a', 'b', 'c'].map((k, i) => num(k, raw.L[i], LIMITS.length, 'Å'));
  const ang = ['α', 'β', 'γ'].map((k, i) => num(k, raw.ang[i], LIMITS.angle, '°'));
  const dk = num('Δk', raw.dk, LIMITS.dk, 'Å⁻¹');
  const ec = num('MeshCutoff', raw.ec, LIMITS.cutoff, 'Ry');
  if (editing) return { ok: false, editing: true, errors };
  if (errors.length) return { ok: false, editing: false, errors };
  const [ca, cb, cg] = ang.map(x => Math.cos(x * Math.PI / 180));
  const g = 1 - ca * ca - cb * cb - cg * cg + 2 * ca * cb * cg; // (V/abc)²
  if (!(g > 1e-9)) return { ok: false, editing: false, errors: ['Los ángulos α, β, γ no definen una celda no degenerada (volumen nulo o imposible)'] };
  const h = Math.PI / Math.sqrt(ec) * 0.529177210903; // Å, igual que doCell2
  const nm = L.map(l => Math.ceil(l / h));
  if (nm.some(n => n > LIMITS.maxMesh))
    return { ok: false, editing: false, errors: [`La malla real superaría ${LIMITS.maxMesh} puntos por eje: reduce las longitudes o el MeshCutoff`] };
  return { ok: true, values: { L, ang, dk, ec, sh: raw.sh } };
}
