// Comprueba que los vectores de cada ficha de protocolo concuerdan con su oráculo de referencia.
// Los vectores son el contrato que debe reproducir la implementación en el motor dueño (ADR-018).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'docs/scientific-protocols/vectors');
let failures = 0, total = 0;

function close(actual, expected, tol, where) {
  if (expected === null || typeof expected !== 'object') {
    if (typeof expected === 'number') {
      const ok = typeof actual === 'number' && (Math.abs(actual - expected) <= tol.rel * Math.abs(expected)
        || (where.endsWith('rms_meV') && Math.abs(actual - expected) <= tol.abs_meV));
      return ok ? [] : [`${where}: ${actual} ≠ ${expected}`];
    }
    return actual === expected ? [] : [`${where}: ${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`];
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return [`${where}: ${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`];
    return expected.flatMap((e, i) => close(actual[i], e, tol, `${where}[${i}]`));
  }
  if (actual === null || typeof actual !== 'object') return [`${where}: falta`];
  return Object.keys(expected).flatMap(k => close(actual[k], expected[k], tol, `${where}.${k}`));
}

const runners = {
  async 'WF-EOS'(doc) {
    const o = await import(pathToFileURL(path.join(root, doc.oracle)));
    return c => {
      if (c.kind === 'deformation') {
        const own = c.expect === null ? o.checkDeformation(c.reference, o.deform(c.reference, c.factor), c.factor, c.tolerance) : null;
        const got = o.checkDeformation(c.reference, c.candidate, c.factor, c.tolerance);
        return [...(own ? [`deform() propio rechazado: ${own}`] : []), ...close(got, c.expect, doc.arithmetic_tolerance, 'resultado')];
      }
      if (c.kind === 'energy') return close(o.finalEnergy(c.stdout, c.quantity), c.expect, doc.arithmetic_tolerance, 'energía');
      if (c.kind === 'table') return close(o.evaluate(c.table, c.policy), c.expect, doc.arithmetic_tolerance, 'veredicto');
      return [`tipo desconocido ${c.kind}`];
    };
  },
  async PRESETS(doc) {
    const o = await import(pathToFileURL(path.join(root, doc.oracle)));
    const tol = doc.arithmetic_tolerance;
    return c => {
      if (c.kind === 'image') return close(o.imageInteraction(c.geometry, c.radii), c.expect, tol, 'imagen');
      if (c.kind === 'parse') return close(o.parseRun(c.stdout), c.expect, tol, 'lectura');
      if (c.kind === 'madelung') {
        const got = { parsed_eV: o.parseRun(c.stdout).emadel_eV, formula_eV: o.madelungSC(c.charge, c.box_A) };
        const errors = close(got, c.expect, tol, 'madelung');
        // La línea de SIESTA tiene 6 decimales: debe coincidir con la fórmula a 1 µeV.
        if (Math.abs(got.parsed_eV - got.formula_eV) > 1.5e-6) errors.push(`Emadel ${got.parsed_eV} ≠ fórmula ${got.formula_eV}`);
        return errors;
      }
      if (c.kind === 'molecule') return close(o.evaluateMolecule(o.parseRun(c.stdout), c.intent), c.expect, tol, 'veredicto');
      if (c.kind === 'relaxation') return close(o.evaluateRelaxation(o.parseRun(c.stdout), c.intent), c.expect, tol, 'veredicto');
      if (c.kind === 'vibrations')
        return close(o.evaluateVibrations(o.parseRun(c.stdout), o.parseFC(c.fc), c.cart, c.masses, c.policy), c.expect, tol, 'veredicto');
      return [`tipo desconocido ${c.kind}`];
    };
  },
};

for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.cases.json')).sort()) {
  const doc = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  const runner = runners[doc.protocol];
  if (!runner) { console.error(`${file}: protocolo sin oráculo ${doc.protocol}`); failures++; continue; }
  const run = await runner(doc);
  const ids = new Set();
  for (const c of doc.cases) {
    total++;
    if (ids.has(c.id)) { console.error(`${file} ${c.id}: id repetido`); failures++; continue; }
    ids.add(c.id);
    const errors = run(c);
    if (errors.length) { failures++; console.error(`FALLA ${file} ${c.id} (${c.title})\n  ${errors.join('\n  ')}`); }
  }
}
console.log(`Vectores de protocolo: ${total - failures}/${total}`);
if (failures) process.exit(1);
