// Verifica las compuertas del backlog (docs/development/backlog_gates.json).
// Una idea no avanza de estado mientras haya dudas lógicas abiertas o falten evidencias.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATES = ['PROPUESTO', 'PREPARADO', 'EN_CONSTRUCCION', 'BLOQUEADO', 'VERIFICADO', 'ACEPTADO'];
const rank = (s) => ['PROPUESTO', 'PREPARADO', 'EN_CONSTRUCCION', 'VERIFICADO', 'ACEPTADO'].indexOf(s);
const filled = (s) => typeof s === 'string' && s.trim().length > 0;

export function checkGates(data) {
  const errors = [];
  const doubts = new Map();
  for (const d of data.dudas ?? []) {
    if (doubts.has(d.id)) errors.push(`${d.id}: duda duplicada`);
    doubts.set(d.id, d);
    if (!filled(d.afirmacion) || !filled(d.verificacion)) errors.push(`${d.id}: falta afirmación o verificación`);
    if (!['ABIERTA', 'RESUELTA'].includes(d.estado)) errors.push(`${d.id}: estado de duda inválido (${d.estado})`);
    if (d.estado === 'RESUELTA' && !filled(d.evidencia)) errors.push(`${d.id}: resuelta sin evidencia`);
  }
  const ids = new Set();
  for (const it of data.ideas ?? []) {
    const tag = `idea ${it.id}`;
    if (ids.has(it.id)) errors.push(`${tag}: duplicada`);
    ids.add(it.id);
    if (!STATES.includes(it.estado)) { errors.push(`${tag}: estado inválido (${it.estado})`); continue; }
    if (!it.entrada?.length || !it.salida?.length) errors.push(`${tag}: debe tener compuertas de entrada y de salida`);
    for (const dl of it.dudas ?? []) if (!doubts.has(dl)) errors.push(`${tag}: duda inexistente ${dl}`);
    if (it.estado === 'BLOQUEADO') {
      if (!filled(it.bloqueo)) errors.push(`${tag}: BLOQUEADO sin motivo`);
      continue;
    }
    const r = rank(it.estado);
    if (r >= 1) for (const g of it.entrada ?? []) if (!g.cumplida || !filled(g.evidencia)) errors.push(`${tag}: ${it.estado} con compuerta de entrada sin evidencia (${g.criterio})`);
    if (r >= 2) for (const dl of it.dudas ?? []) if (doubts.get(dl)?.estado !== 'RESUELTA') errors.push(`${tag}: ${it.estado} con duda abierta ${dl}`);
    if (r >= 3) for (const g of it.salida ?? []) if (!filled(g.evidencia)) errors.push(`${tag}: ${it.estado} con compuerta de salida sin evidencia (${g.criterio})`);
  }
  return errors;
}

function selfTest() {
  const base = {
    dudas: [{ id: 'DL-X', afirmacion: 'a', verificacion: 'v', estado: 'ABIERTA' }],
    ideas: [{ id: 1, estado: 'PROPUESTO', dudas: ['DL-X'], entrada: [{ criterio: 'e', cumplida: false, evidencia: '' }], salida: [{ criterio: 's', evidencia: '' }] }],
  };
  const clone = () => JSON.parse(JSON.stringify(base));
  const cases = [
    ['propuesto con duda abierta pasa', (d) => d, 0],
    ['en construcción con duda abierta falla', (d) => { d.ideas[0].estado = 'EN_CONSTRUCCION'; return d; }, 1],
    ['preparado sin evidencia de entrada falla', (d) => { d.ideas[0].estado = 'PREPARADO'; return d; }, 1],
    ['verificado sin evidencia de salida falla', (d) => { d.ideas[0].estado = 'VERIFICADO'; d.dudas[0].estado = 'RESUELTA'; d.dudas[0].evidencia = 'ok'; d.ideas[0].entrada[0] = { criterio: 'e', cumplida: true, evidencia: 'ok' }; return d; }, 1],
    ['duda resuelta sin evidencia falla', (d) => { d.dudas[0].estado = 'RESUELTA'; return d; }, 1],
    ['bloqueado sin motivo falla', (d) => { d.ideas[0].estado = 'BLOQUEADO'; return d; }, 1],
    ['duda inexistente falla', (d) => { d.ideas[0].dudas = ['DL-Z']; return d; }, 1],
  ];
  let bad = 0;
  for (const [name, mutate, expected] of cases) {
    const got = checkGates(mutate(clone())).length;
    const ok = expected === 0 ? got === 0 : got > 0;
    if (!ok) { console.error(`FALLA autoprueba: ${name} (errores: ${got})`); bad++; }
  }
  console.log(`Autoprueba de compuertas: ${cases.length - bad}/${cases.length}`);
  return bad === 0;
}

if (!selfTest()) process.exit(1);
const file = path.join(root, 'docs', 'development', 'backlog_gates.json');
const errors = checkGates(JSON.parse(readFileSync(file, 'utf8')));
if (errors.length) { for (const e of errors) console.error(`- ${e}`); process.exit(1); }
console.log('Compuertas del backlog: correctas');
