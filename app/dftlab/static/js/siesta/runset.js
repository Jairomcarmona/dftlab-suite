// Set of files imported together in Postproceso. Keeps, for every file, the original content in the
// form its reader needs (bytes for the binary Fortran grids, UTF-8 text for the rest), the reader's
// result and the links between files. A link is recomputed whenever the set changes, so the result
// does not depend on the order in which files are added, replaced or removed.
//
// Links handled: SystemLabel.EIG <- SystemLabel.KP (k-point weights and coordinates).
// A .KP is attached only when it has the same label as the .EIG, is readable, has finite
// non-negative weights with a positive sum and the same number of k-points; otherwise the .EIG keeps
// uniform weights and the reason is reported in `link.note`.
import { basename, toText } from './util.js';
import { detectAndParse } from './index.js';
import { isGridName } from './rho.js';
import { isDftlabPack, unpackDftlab } from './pack.js';

export const eigLabel = (name) => basename(name).replace(/\.[^.]+$/, '');   // same rule parseMany uses
export const kpLabel = (name) => basename(name).replace(/\.kp$/i, '');

const msg = (e) => String(e && e.message ? e.message : e);

/** Read one file. Never throws: failures come back as {data: null, error}.
 *  item: {name, content: string | ArrayBuffer | Uint8Array, ...extra fields kept as they are} */
export async function readEntry(item) {
  const name = basename(item.name);
  const e = { ...item, name, content: item.content, kind: 'unknown', data: null, error: null };
  if (isGridName(name)) {
    e.kind = 'grid';
    if (typeof item.content === 'string') { e.error = 'los archivos de malla son binarios: el lector necesita los bytes originales, no texto'; return e; }
    return { ...e, ...detectAndParse(name, item.content, { kind: 'grid' }), name };
  }
  const text = toText(item.content);
  e.content = text;
  if (/\.jsonl$/i.test(name)) {   // Lua hook log: one JSON object per line
    e.kind = 'live';
    try { e.data = text.split(/\n/).filter((l) => l.trim()).map((l) => JSON.parse(l)); } catch (err) { e.error = 'JSON inválido en ' + name; }
    return e;
  }
  const r = detectAndParse(name, text);
  Object.assign(e, { kind: r.kind, data: r.data, error: r.error ?? null });
  if (r.kind === 'eig') e.linkKey = '';   // read without .KP; relink() re-reads it only if a .KP applies
  if (r.kind === 'dftlab-pack' && r.data) {
    if (!isDftlabPack(r.data)) { e.data = null; e.error = 'no es un paquete de DFT Lab (falta "dftlab": "siesta-pack")'; }
    else {
      try { e.data = await unpackDftlab(r.data); } catch (err) { e.data = null; e.error = 'paquete dañado: ' + msg(err); }
    }
  }
  return e;
}

/** Reason why a parsed .KP cannot supply weights, or null when it can. */
export function kpProblem(kp) {
  if (!kp || !(kp.nk > 0)) return 'no contiene puntos k';
  for (let i = 0; i < kp.nk; i++) {
    const w = kp.weights[i];
    if (!Number.isFinite(w) || w < 0) return `peso no válido en el punto k ${i + 1}`;
    if (!kp.kpointsBohr[i].every(Number.isFinite)) return `coordenadas no válidas en el punto k ${i + 1}`;
  }
  if (!(kp.weightSum > 0)) return 'la suma de pesos no es positiva';
  return null;
}

/** Recompute every .EIG <- .KP link of `files` in place. Only .EIG entries whose link changed are re-read. */
export function relink(files) {
  const kps = new Map();
  for (const f of files) if (f.kind === 'kp') {
    f.link = { usedBy: [] };
    const lab = kpLabel(f.name);
    kps.set(lab, [...(kps.get(lab) || []), f]);
  }
  for (const f of files) {
    if (f.kind !== 'eig') continue;
    const cands = kps.get(eigLabel(f.name)) || [];
    let kp = null, note = null;
    if (cands.length > 1) note = `hay varios .KP para «${eigLabel(f.name)}» (${cands.map((c) => c.name).join(', ')}); no se elige ninguno`;
    else if (cands.length === 1) {
      const c = cands[0], bad = c.data ? kpProblem(c.data) : 'no se pudo leer';
      if (bad) note = `${c.name}: ${bad}`; else kp = c;
    }
    const key = kp ? `${kp.name}#${kp.rev ?? 0}` : '';
    if (f.linkKey !== key) {
      const r = detectAndParse(f.name, f.content, { kind: 'eig', kp: kp ? kp.data : null });
      f.data = r.data; f.error = r.error ?? null; f.linkKey = key;
    }
    const used = !!(kp && f.data && f.data.weightsFromKP);
    if (kp && !used) note = `${kp.name} tiene ${kp.data.nk} puntos k y ${f.name} ${f.data ? f.data.nk : '?'}: no corresponden a la misma malla`;
    if (used) kp.link.usedBy.push(f.name);
    f.link = { kp: used ? kp.name : null, weights: used ? kp.name : 'uniformes (1/nk)', kpoints: used ? kp.name : null, note: note ? note + '; se usan pesos uniformes' : null };
  }
  return files;
}

/** Mutable set of imported files. Additions are serialized and applied only after every file has
 *  been read, so concurrent imports cannot interleave and replacing a file by name is atomic. */
export function createFileSet() {
  const files = [];
  let rev = 0, chain = Promise.resolve();
  const add = (items) => {
    const job = chain.then(async () => {
      const read = await Promise.all(items.map(readEntry));
      for (const e of read) {
        e.rev = ++rev;
        const i = files.findIndex((f) => f.name === e.name);
        if (i >= 0) files.splice(i, 1);
        files.push(e);
      }
      relink(files);
      return read;
    });
    chain = job.catch(() => {});
    return job;
  };
  const removeAt = (i) => { if (i >= 0 && i < files.length) { files.splice(i, 1); relink(files); } };
  return {
    files,
    add,
    removeAt,
    remove: (name) => removeAt(files.findIndex((f) => f.name === basename(name))),
    clear: () => { files.length = 0; },
    get: (kind) => files.filter((f) => f.kind === kind && f.data),
  };
}
