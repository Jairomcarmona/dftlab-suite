// Oráculo de referencia de la lectura FDF de SIESTA 5.4.2 para el preflight (ficha docs/scientific-protocols/PREFLIGHT.md).
// Reproduce lo que hace SIESTA, comprobado con corridas; no es código de producción.

// PF-1: SIESTA compara etiquetas sin mayúsculas y sin '.', '_' ni '-'.
export const normalizeLabel = s => s.replace(/[._-]/g, '').toLowerCase();

const stripComment = l => l.replace(/[#!;].*$/, '');

// PF-2…PF-4: resolución de includes y redirecciones; la primera aparición gana.
// files: {nombre: texto}; los nombres son relativos a la carpeta del FDF raíz.
export function resolve(files, root, maxDepth = 16) {
  const values = new Map();
  const order = [];
  const visit = (name, depth) => {
    if (depth > maxDepth) throw { code: 'CYCLIC_INCLUDE', file: name };
    if (!(name in files)) throw { code: 'INCLUDE_NOT_FOUND', file: name };
    const lines = files[name].split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const raw = stripComment(lines[i]).trim();
      if (!raw) continue;
      const t = raw.split(/\s+/);
      const where = { file: name, line: i + 1 };
      if (/^%include$/i.test(t[0])) { visit(t[1], depth + 1); continue; }
      if (/^%block$/i.test(t[0])) {
        const label = t[1];
        let rows;
        if (t[2] === '<') {
          if (!(t[3] in files)) throw { code: 'INCLUDE_NOT_FOUND', file: t[3] };
          rows = files[t[3]].split(/\r?\n/).map(l => stripComment(l).trim()).filter(Boolean);
        } else {
          rows = [];
          for (i++; i < lines.length && !/^\s*%endblock/i.test(lines[i]); i++) {
            const r = stripComment(lines[i]).trim();
            if (r) rows.push(r);
          }
        }
        record(label, { kind: 'block', rows, ...where });
        continue;
      }
      if (t[0].startsWith('%')) continue;
      if (t[1] === '<') {
        // PF-3: «Etiqueta < archivo» busca la etiqueta dentro de ese archivo FDF.
        if (!(t[2] in files)) throw { code: 'INCLUDE_NOT_FOUND', file: t[2] };
        let inner;
        try { inner = resolve(files, t[2], maxDepth - depth - 1); } catch (e) { throw e; }
        const hit = inner.values[normalizeLabel(t[0])];
        if (!hit || hit.kind !== 'scalar') throw { code: 'REDIRECT_LABEL_NOT_FOUND', file: t[2], label: t[0] };
        record(t[0], { ...hit, label: t[0], redirected_from: t[2] });
        continue;
      }
      record(t[0], { kind: 'scalar', tokens: t.slice(1), ...where });
    }
  };
  const record = (label, v) => {
    const k = normalizeLabel(label);
    order.push(label);
    if (!values.has(k)) values.set(k, { label, ...v });
  };
  try { visit(root, 0); } catch (e) { if (e && e.code) return { error: e.code, file: e.file }; throw e; }
  return { values: Object.fromEntries(values), labels: order };
}

// PF-5, PF-6: valor de una etiqueta escalar según su tipo. units: {dimensión: {unidad en minúsculas: factor a la canónica}}.
const INT = /^[+-]?\d+$/;
const REAL = /^[+-]?(\d+\.?\d*|\.\d+)([eEdD][+-]?\d+)?$/;
const toNumber = s => Number(s.replace(/[dD]/, 'e'));
export function scalarValue(resolved, label, entry, units) {
  const v = resolved.values[normalizeLabel(label)];
  if (!v) return { source: 'DEFAULT' };
  const [x, u] = v.tokens;
  if (entry.type === 'integer') return INT.test(x) ? { value: Number(x) } : { error: 'INTEGER_EXPECTED' };
  if (entry.type === 'real') return REAL.test(x) ? { value: toNumber(x) } : { error: 'REAL_EXPECTED' };
  if (entry.type === 'physical') {
    if (!REAL.test(x)) return { error: 'REAL_EXPECTED' };
    if (u === undefined) return { error: 'UNIT_MISSING' };
    const key = u.toLowerCase();
    for (const [dim, table] of Object.entries(units)) {
      if (key in table) {
        if (dim !== entry.dimension) return { error: 'UNIT_DIMENSION_MISMATCH' };
        return { value: toNumber(x) * table[key], unit: entry.canonical_unit };
      }
    }
    return { error: 'UNIT_UNKNOWN' };
  }
  return { value: v.tokens.join(' ') };
}

// PF-7: etiquetas del input que SIESTA no consultó (según su fdf.*.log). Orden de aparición, sin repetir.
export function unusedLabels(resolved, fdfLog) {
  const queried = new Set();
  for (const l of fdfLog.split(/\r?\n/)) {
    const t = l.trim().split(/\s+/);
    if (!t[0]) continue;
    if (t[0].startsWith('#:') && t[1]) queried.add(normalizeLabel(t[1]));
    else if (t[0].startsWith('#')) continue;
    else if (/^%block$/i.test(t[0]) && t[1]) queried.add(normalizeLabel(t[1]));
    else if (!t[0].startsWith('%')) queried.add(normalizeLabel(t[0]));
  }
  const seen = new Set(), out = [];
  for (const label of resolved.labels) {
    const k = normalizeLabel(label);
    if (seen.has(k)) continue;
    seen.add(k);
    if (!queried.has(k)) out.push(label);
  }
  return out;
}
