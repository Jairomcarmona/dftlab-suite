// Entry point: sniff a SIESTA output file and parse it.
//   import { detectAndParse } from './siesta/index.js';
//   const { kind, data } = detectAndParse(file.name, await file.arrayBuffer());
import { toText, basename } from './util.js';
import { parseOut, parseFDF } from './out.js';
import { parseBands } from './bands.js';
import { parseEIG, parseKP } from './eig.js';
import { parsePDOS, parsePDOSText } from './pdos.js';
import { parseDOS } from './dos.js';
import { parseEPSIMG, parseContribEPSIMG } from './epsimg.js';
import { parseIonXML, parseIon } from './ion.js';
import { parsePSF, parsePSML } from './pseudo.js';
import { parseMDE, parseANI, parseFA, parseXV, parseStructOut } from './mde.js';
import { parseGrid, isGridName } from './rho.js';
import { parseFC } from './fc.js';
import { parseNativeResult } from './native-results.js';

export * from './out.js';
export * from './bands.js';
export * from './eig.js';
export * from './pdos.js';
export * from './dos.js';
export * from './epsimg.js';
export * from './ion.js';
export * from './pseudo.js';
export * from './mde.js';
export * from './rho.js';
export * from './pack.js';
export * from './fc.js';
export * from './native-results.js';
export { toPlain } from './util.js';

const PARSERS = {
  out: parseOut, fdf: parseFDF, bands: parseBands, eig: parseEIG, kp: parseKP, 'pdos-kp': parseKP,
  pdos: parsePDOS, 'pdos-text': parsePDOSText, dos: parseDOS, epsimg: parseEPSIMG, 'epsimg-contrib': parseContribEPSIMG,
  'ion-xml': parseIonXML, ion: parseIon, psf: parsePSF, psml: parsePSML,
  mde: parseMDE, ani: parseANI, fa: parseFA, xv: parseXV, struct: parseStructOut,
  'dftlab-pack': (t) => JSON.parse(t), fc: (t) => parseFC(t),
  'qraft-native': parseNativeResult,
};

/** Guess the file kind from its name and the first few KB of content. */
export function detectKind(fileName, text) {
  const name = basename(fileName || '');
  const lower = name.toLowerCase();
  const head = text.slice(0, 4096);
  const ext = (re) => re.test(lower);

  if (lower.endsWith('.json') && /"policy_id"\s*:\s*"qraft\.(electronic|eos)\.policy@1"/.test(head)) return 'qraft-native';
  if (ext(/\.dftlab\.json$/) || (lower.endsWith('.json') && /"dftlab"/.test(head))) return 'dftlab-pack';
  if (ext(/\.ion\.xml$/) || /^\s*<ion[\s>]/.test(head)) return 'ion-xml';
  if (ext(/\.psml$/) || /<psml[\s>]/.test(head)) return 'psml';
  if (ext(/\.pdos\.kp$/)) return 'pdos-kp';
  if (ext(/\.pdos(\.xml)?$/) || /<pdos>/.test(head)) return 'pdos';
  if (ext(/\.contrib\.epsimg$/)) return 'epsimg-contrib';
  if (ext(/\.epsimg$/) || /^##\s*Minimum and maximum energy/m.test(head)) return 'epsimg';
  if (ext(/\.ion$/) || /#\s*Symbol\s*$/m.test(head)) return 'ion';
  if (ext(/\.psf$/) || /Radial grid follows/.test(head)) return 'psf';
  if (ext(/\.bands$/)) return 'bands';
  if (ext(/\.eig$/)) return 'eig';
  if (ext(/\.kp$/) || ext(/\.bz_kp$/)) return 'kp';
  if (ext(/\.dos$/)) return 'dos';
  if (ext(/\.mde$/) || /^#\s*Step\s+T\s*\(K\)/m.test(head)) return 'mde';
  if (ext(/\.ani$/)) return 'ani';
  if (ext(/\.fa$/) || ext(/\.fac$/)) return 'fa';
  if (ext(/\.fc$/) || /^\s*Force constants matrix/.test(head)) return 'fc';
  if (ext(/\.xv$/)) return 'xv';
  if (ext(/\.struct_(out|in|next_iter)$/)) return 'struct';
  if (ext(/\.fdf$/)) return 'fdf';
  if (ext(/\.(out|log|stdout)$/) || /WELCOME TO SIESTA|Siesta Version|^Executable\s*:/m.test(head)) return 'out';
  if (ext(/\.(dat|txt)$/) && /^\s*#/.test(head) && /pdos|PDOS|dos/i.test(head)) return 'pdos-text';
  return sniffNumeric(head);
}

function sniffNumeric(head) {
  const L = head.split(/\r?\n/).filter((l) => l.trim());
  if (L.length < 3) return 'unknown';
  const t = (i) => L[i].trim().split(/\s+/);
  const isInt = (s) => /^[-+]?\d+$/.test(s);
  const isFloat = (s) => /^[-+]?(\d+\.?\d*|\.\d+)([eEdD][-+]?\d+)?$/.test(s);
  // EIG: float / "nb ns nk" / "1 e e e ..."
  if (t(0).length === 1 && isFloat(t(0)[0]) && t(1).length === 3 && t(1).every(isInt)) return 'eig';
  // bands: float / two floats / (two floats | three ints)
  if (t(0).length === 1 && isFloat(t(0)[0]) && t(1).length === 2 && t(1).every(isFloat)) return 'bands';
  // KP: nk / "ik kx ky kz w"
  if (t(0).length === 1 && isInt(t(0)[0]) && t(1).length === 5 && isInt(t(1)[0])) return 'kp';
  // FA: na / "ia fx fy fz"
  if (t(0).length === 1 && isInt(t(0)[0]) && t(1).length === 4 && isInt(t(1)[0])) return 'fa';
  // XYZ / ANI
  if (t(0).length === 1 && isInt(t(0)[0]) && /^[A-Z][a-z]?$/.test(t(2)[0] ?? '')) return 'ani';
  // DOS: 2-5 float columns
  if (L.slice(0, 5).every((l) => { const x = l.trim().split(/\s+/); return x.length >= 2 && x.length <= 5 && x.every(isFloat); })) return 'dos';
  return 'unknown';
}

/** Detect the file type and parse it. Returns {kind, name, data} (data = null for unknown). */
export function detectAndParse(fileName, textOrArrayBuffer, opts = {}) {
  if ((opts.kind ?? (isGridName(fileName) ? 'grid' : null)) === 'grid') {   // binary Fortran grids: never decode as text
    try { return { kind: 'grid', name: basename(fileName), data: parseGrid(textOrArrayBuffer, fileName) }; }
    catch (err) { return { kind: 'grid', name: basename(fileName), data: null, error: String(err && err.message ? err.message : err) }; }
  }
  const text = toText(textOrArrayBuffer);
  const kind = opts.kind ?? detectKind(fileName, text);
  const fn = PARSERS[kind];
  if (!fn) return { kind: 'unknown', name: basename(fileName), data: null };
  try {
    const data = kind === 'eig' ? parseEIG(text, opts.kp ?? null) : fn(text);
    return { kind, name: basename(fileName), data };
  } catch (err) {
    return { kind, name: basename(fileName), data: null, error: String(err && err.message ? err.message : err) };
  }
}

/** Parse several dropped files together, linking .EIG with .KP (weights) when both are present. */
export function parseMany(files) {
  // files: [{name, content}]
  const res = files.map((f) => ({ ...f, kind: isGridName(f.name) ? 'grid' : detectKind(f.name, toText(f.content)) }));
  const kpByLabel = new Map();
  for (const f of res) if (f.kind === 'kp') kpByLabel.set(basename(f.name).replace(/\.kp$/i, ''), toText(f.content));
  return res.map((f) => {
    const label = basename(f.name).replace(/\.[^.]+$/, '');
    const opts = { kind: f.kind };
    if (f.kind === 'eig' && kpByLabel.has(label)) opts.kp = kpByLabel.get(label);
    return detectAndParse(f.name, f.content, opts);
  });
}

