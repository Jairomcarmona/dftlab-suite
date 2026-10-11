// Shared helpers for the SIESTA parsers (no dependencies, browser + Node).
// All functions are pure; nothing touches the DOM.

export const BOHR_ANG = 0.529177210903;       // 1 Bohr in Angstrom
export const RY_EV = 13.605693122994;         // 1 Rydberg in eV
export const HA_EV = 27.211386245988;         // 1 Hartree in eV
export const KBAR_PER_EV_ANG3 = 1602.1766208; // 1 eV/Ang^3 in kbar

/** Accept a string, ArrayBuffer, Uint8Array or Node Buffer; return a string. */
export function toText(input) {
  if (typeof input === 'string') return input;
  if (input == null) return '';
  let bytes = null;
  if (input instanceof ArrayBuffer) bytes = new Uint8Array(input);
  else if (ArrayBuffer.isView(input)) bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (bytes) return new TextDecoder('utf-8').decode(bytes);
  return String(input);
}

/** Split text into lines (handles CRLF). */
export function lines(text) {
  return toText(text).split(/\r?\n/);
}

/** Parse a Fortran-style float ("1.0D-03", "0.17977+309", "*****" -> NaN). */
export function ffloat(s) {
  if (s == null) return NaN;
  s = String(s).trim();
  if (!s || /^\*+$/.test(s)) return NaN;
  let t = s.replace(/[dD]/, 'e');
  let v = Number(t);
  if (Number.isFinite(v)) return v;
  // Fortran drops the 'E' for 3-digit exponents: 0.17977+309
  const m = /^([-+]?\d*\.?\d*)([-+]\d+)$/.exec(t);
  if (m) {
    v = Number(m[1] + 'e' + m[2]);
    return Number.isFinite(v) ? v : (v > 0 ? Infinity : NaN);
  }
  v = parseFloat(t);
  return Number.isFinite(v) ? v : NaN;
}

/** All numbers in a string (whitespace separated tokens that parse). */
export function nums(s) {
  const out = [];
  for (const tok of String(s).trim().split(/\s+/)) {
    if (!tok) continue;
    const v = ffloat(tok);
    if (!Number.isNaN(v) || /^\*+$/.test(tok)) out.push(v);
  }
  return out;
}

/** Fast float tokenizer for big numeric blocks; returns Float64Array. */
export function floatBlock(s) {
  const toks = String(s).trim().split(/\s+/);
  const out = new Float64Array(toks.length);
  let n = 0;
  for (const t of toks) {
    if (!t) continue;
    let v = +t;
    if (Number.isNaN(v)) v = ffloat(t);
    out[n++] = v;
  }
  return n === out.length ? out : out.slice(0, n);
}

/** Trapezoidal integral of y(x), optionally only up to xmax (linear interpolation at the cut). */
export function trapz(x, y, xmax = Infinity, xmin = -Infinity) {
  let s = 0;
  for (let i = 1; i < x.length; i++) {
    let x0 = x[i - 1], x1 = x[i], y0 = y[i - 1], y1 = y[i];
    if (x1 <= xmin || x0 >= xmax) continue;
    if (x0 < xmin) { y0 = y0 + (y1 - y0) * (xmin - x0) / (x1 - x0); x0 = xmin; }
    if (x1 > xmax) { y1 = y0 + (y1 - y0) * (xmax - x0) / (x1 - x0); x1 = xmax; }
    s += 0.5 * (y0 + y1) * (x1 - x0);
  }
  return s;
}

/** Cumulative trapezoid (same length as x, starts at 0). */
export function cumtrapz(x, y) {
  const out = new Float64Array(x.length);
  for (let i = 1; i < x.length; i++) out[i] = out[i - 1] + 0.5 * (y[i] + y[i - 1]) * (x[i] - x[i - 1]);
  return out;
}

/** Evenly spaced grid. */
export function linspace(a, b, n) {
  const out = new Float64Array(n);
  const d = n > 1 ? (b - a) / (n - 1) : 0;
  for (let i = 0; i < n; i++) out[i] = a + i * d;
  return out;
}

export function strip(s) { return String(s ?? '').trim(); }

export function basename(name) { return String(name || '').split(/[\\/]/).pop(); }

// ----------------------------------------------------------------------------
// Minimal XML parser (enough for PDOS.xml, ion.xml and PSML).
// Produces {name, attrs, children, text}. Namespaces are stripped from names.
// ----------------------------------------------------------------------------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeEntities(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENT[e] ?? m;
  });
}

export function parseXML(text) {
  text = toText(text);
  const root = { name: '#document', attrs: {}, children: [], text: '' };
  const stack = [root];
  let i = 0;
  const n = text.length;
  const textParts = new Map();
  const pushText = (node, s) => {
    let arr = textParts.get(node);
    if (!arr) textParts.set(node, (arr = []));
    arr.push(s);
  };
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) { pushText(stack[stack.length - 1], text.slice(i)); break; }
    if (lt > i) pushText(stack[stack.length - 1], text.slice(i, lt));
    if (text.startsWith('<!--', lt)) { const e = text.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
    if (text.startsWith('<![CDATA[', lt)) {
      const e = text.indexOf(']]>', lt + 9);
      pushText(stack[stack.length - 1], text.slice(lt + 9, e < 0 ? n : e));
      i = e < 0 ? n : e + 3; continue;
    }
    if (text[lt + 1] === '?' || text[lt + 1] === '!') { const e = text.indexOf('>', lt); i = e < 0 ? n : e + 1; continue; }
    // find end of tag, respecting quotes
    let j = lt + 1, q = null;
    while (j < n) {
      const c = text[j];
      if (q) { if (c === q) q = null; }
      else if (c === '"' || c === "'") q = c;
      else if (c === '>') break;
      j++;
    }
    const raw = text.slice(lt + 1, j);
    i = j + 1;
    if (raw[0] === '/') {
      // closing tag: pop until matching
      const nm = raw.slice(1).trim().replace(/^.*:/, '');
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === nm) { stack.length = k; break; }
      }
      continue;
    }
    const selfClose = /\/\s*$/.test(raw);
    const body = selfClose ? raw.replace(/\/\s*$/, '') : raw;
    const m = /^\s*([^\s/>]+)/.exec(body);
    if (!m) continue;
    const name = m[1].replace(/^.*:/, '');
    const attrs = {};
    const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let a;
    const rest = body.slice(m[0].length);
    while ((a = re.exec(rest))) attrs[a[1].replace(/^.*:/, '')] = decodeEntities(a[3] ?? a[4] ?? '');
    const node = { name, attrs, children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
  }
  // join text
  const fin = (node) => {
    const parts = textParts.get(node);
    node.text = parts ? decodeEntities(parts.join('')) : '';
    for (const c of node.children) fin(c);
  };
  fin(root);
  return root;
}

export function xchild(node, name) {
  if (!node) return null;
  for (const c of node.children) if (c.name === name) return c;
  return null;
}
export function xchildren(node, name) {
  return node ? node.children.filter((c) => c.name === name) : [];
}
/** Depth-first search for first descendant with name. */
export function xfind(node, name) {
  if (!node) return null;
  for (const c of node.children) {
    if (c.name === name) return c;
    const r = xfind(c, name);
    if (r) return r;
  }
  return null;
}
export function xfindAll(node, name, out = []) {
  if (!node) return out;
  for (const c of node.children) {
    if (c.name === name) out.push(c);
    xfindAll(c, name, out);
  }
  return out;
}
export function xtext(node) { return node ? node.text.trim() : ''; }
export function xnum(node) { return node ? ffloat(node.text) : NaN; }
export function attrNum(node, k) {
  if (!node || node.attrs[k] == null) return NaN;
  return ffloat(node.attrs[k]);
}
export function attrStr(node, k) {
  return node && node.attrs[k] != null ? node.attrs[k].trim() : null;
}

/** Convert typed arrays to plain arrays recursively (for JSON.stringify). */
export function toPlain(obj) {
  if (obj == null) return obj;
  if (ArrayBuffer.isView(obj)) return Array.from(obj);
  if (Array.isArray(obj)) return obj.map(toPlain);
  if (typeof obj === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(obj)) if (typeof v !== 'function') o[k] = toPlain(v);
    return o;
  }
  return obj;
}
