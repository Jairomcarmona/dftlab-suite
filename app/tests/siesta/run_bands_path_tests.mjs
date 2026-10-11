#!/usr/bin/env node
// Bloque G: tramos y discontinuidades del camino k en las bandas (sin DOM).
//   node app/tests/siesta/run_bands_path_tests.mjs
// Los cortes salen del formato: en BandLines, dos etiquetas en puntos k consecutivos (línea de 1 punto
// tras un punto etiquetado, p. ej. U → "1 ... K"); en el paquete, un punto inicial repetido en la misma x
// con etiqueta "A|B". BandPoints no trae tramos: un solo tramo y la limitación declarada.
// Unidades, referencia de energía y valores originales no cambian.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const S = await import(pathToFileURL(path.resolve(HERE, '../../dftlab/static/js/siesta/index.js')).href);
const FX = path.join(HERE, 'fixtures');
const text = (...p) => fs.readFileSync(path.join(FX, ...p), 'utf8');
const pack = async (...p) => S.packBands(await S.unpackDftlab(JSON.parse(text(...p))));

let pass = 0, fail = 0;
const check = (n, c, d = '') => { if (c) pass++; else { fail++; console.log('  FAIL', n, d); } };
const J = JSON.stringify;
// filas del archivo: "x e1 e2 ..." de BandLines (primer número de cada bloque de punto k)
const kRows = (t) => { const L = t.split(/\r?\n/), nk = +L[3].trim().split(/\s+/)[2], out = [];
  for (let i = 4; i < L.length && out.length < nk; i++) if (/^\s*\S/.test(L[i]) && !/^\s{10,}/.test(L[i])) out.push(L[i].trim().split(/\s+/).map(Number));
  return out; };

// ---------------- BandLines con salto U|K (Si, SIESTA 5.4) ----------------
{
  const raw = text('si', 'si.bands'), b = S.parseBands(raw), P = b.path;
  check('Si .bands: origen BandLines', P && P.source === 'BandLines', J(P?.source));
  check('Si .bands: etiquetas sobre sus puntos k', J(b.labels.map((l) => l.kIndex)) === J([0, 30, 60, 61, 91, 121, 151, 181]), J(b.labels.map((l) => l.kIndex)));
  check('Si .bands: un corte, entre U (60) y K (61)', J(P.breaks) === J([61]) && P.jumps.length === 1 && P.jumps[0].from === 'U' && P.jumps[0].to === 'K', J(P.jumps));
  check('Si .bands: dos tramos Γ…U y K…X que cubren todos los puntos',
    J(P.segments) === J([{ start: 0, end: 60, from: 'Γ', to: 'U' }, { start: 61, end: 181, from: 'K', to: 'X' }]), J(P.segments));
  check('Si .bands: el salto se declara', /U\|K/.test(P.note || ''), P.note);
  check('Si .bands: sin avisos', b.warnings.length === 0, J(b.warnings));
  // valores originales: x de U y K tal como los escribió SIESTA (1/Bohr), energías absolutas en eV
  const rows = kRows(raw);
  check('Si .bands: x original conservada (1/Bohr)', b.xBohr[60] === 0.828660 && b.xBohr[61] === 1.203562 && b.xBohr.length === 182, `${b.xBohr[60]} ${b.xBohr[61]}`);
  check('Si .bands: x en 1/Å = x/Bohr sin desplazar el salto', b.x[61] === 1.203562 / 0.529177210903);
  check('Si .bands: energías absolutas sin cambiar', b.bands[0][0][61] === rows[61][1] && b.bands[0][0][0] === rows[0][1], `${b.bands[0][0][61]} vs ${rows[61][1]}`);
  check('Si .bands: unidades y E_F intactas', b.units.energy === 'eV' && b.units.x === '1/Ang' && b.fermi === -4.4732074468734409);
  const sh = S.shiftToFermi(b);
  check('Si .bands: shiftToFermi conserva el camino', sh.path === b.path && sh.energyReference === 'E_F');

  // serie dibujable: un [x, NaN] antes de K y ninguno más; los puntos finitos son exactamente los del archivo
  const y = Array.from(b.bands[0][3]), d = S.segmentSeries(Array.from(b.x), y, P.breaks);
  const nanAt = d.map((p, i) => (Number.isFinite(p[1]) ? -1 : i)).filter((i) => i >= 0);
  check('serie: un separador', nanAt.length === 1 && d.length === b.nk + 1, J(nanAt));
  check('serie: separador justo entre U y K', d[nanAt[0] - 1][0] === b.x[60] && d[nanAt[0] + 1][0] === b.x[61]);
  check('serie: valores finitos iguales a la banda', J(d.filter((p) => Number.isFinite(p[1])).map((p) => p[1])) === J(y));
  // pares unidos por la regla del gráfico (puntos finitos consecutivos): ninguno cruza U→K
  const joined = []; for (let i = 1; i < d.length; i++) if (Number.isFinite(d[i - 1][1]) && Number.isFinite(d[i][1])) joined.push([d[i - 1][0], d[i][0]]);
  check('serie: U y K no se unen', !joined.some(([a, c]) => a === b.x[60] && c === b.x[61]) && joined.length === b.nk - 2, joined.length);
  const seg = S.segmentIndex(b.nk, P.breaks);
  check('exportación: tramo 1 hasta U, tramo 2 desde K', seg[0] === 1 && seg[60] === 1 && seg[61] === 2 && seg[181] === 2);
}

// ---------------- BandLines sin saltos (Fe, camino Γ–H–N–Γ–P–H continuo) ----------------
{
  const b = S.parseBands(text('fe', 'fe.bands'));
  check('Fe .bands: sin cortes inventados', b.path.source === 'BandLines' && b.path.breaks.length === 0 && b.path.segments.length === 1 && b.path.note === null, J(b.path));
  check('Fe .bands: etiquetas en sus puntos k', J(b.labels.map((l) => l.kIndex)) === J([0, 25, 43, 61, 83, 96]));
  const d = S.segmentSeries(Array.from(b.x), Array.from(b.bands[1][4]), b.path.breaks);
  check('Fe .bands: serie sin separadores', d.length === b.nk && d.every((p) => Number.isFinite(p[1])));
}

// ---------------- BandPoints: sin información de tramos ----------------
{
  const b = S.parseBands(text('si', 'sibp.bands'));
  check('BandPoints: un tramo y la limitación declarada', b.path.source === 'none' && b.path.breaks.length === 0 && b.path.segments.length === 1 && /BandPoints/.test(b.path.note), J(b.path));
}

// ---------------- etiquetas que no caen en ningún punto k: no se inventan tramos ----------------
{
  const raw = text('si', 'si.bands').replace("    0.828660   'U'", "    0.800000   'U'");
  const b = S.parseBands(raw);
  check('etiqueta desalineada: camino desconocido, sin cortes', b.path.source === 'none' && b.path.breaks.length === 0 && b.warnings.some((w) => /does not match/.test(w)), J(b.warnings));
}

// ---------------- un tramo de un paso al inicio del camino no es un salto ----------------
{
  // "1 Γ" seguido de "1 X": no hay un tramo previo que termine en un punto etiquetado
  const b = S.parseBands(text('si', 'si.bands').replace("    0.612211   'X'", "    0.020407   'X'"));
  check('paso inicial de un punto: solo el corte U|K', b.path.source === 'BandLines' && J(b.path.breaks) === J([61]) && b.labels[1].kIndex === 1, J(b.path.breaks));
}

// ---------------- paquetes .dftlab.json ----------------
{
  const si = await pack('si', 'si.dftlab.json'), fe = await pack('fe', 'fe.dftlab.json');
  check('paquete Si: corte U|K', si.path.source === 'dftlab-pack' && J(si.path.breaks) === J([62]) && si.path.jumps[0].from === 'U' && si.path.jumps[0].to === 'K', J(si.path));
  check('paquete Si: tramos Γ…U y K…X', J(si.path.segments) === J([{ start: 0, end: 61, from: 'Γ', to: 'U' }, { start: 62, end: 202, from: 'K', to: 'X' }]), J(si.path.segments));
  check('paquete Fe: corte H|P', J(fe.path.breaks) === J([178]) && fe.path.jumps[0].from === 'H' && fe.path.jumps[0].to === 'P', J(fe.path));
  check('paquete Fe: tramos Γ…H y P…N', J(fe.path.segments) === J([{ start: 0, end: 177, from: 'Γ', to: 'H' }, { start: 178, end: 200, from: 'P', to: 'N' }]), J(fe.path.segments));
  check('paquete Fe: x conservada (inicio nuevo en la misma x)', fe.x[177] === fe.x[178] && fe.labels.find((l) => l.label === 'H|P'));
  check('paquete Fe: etiqueta H|P intacta para el eje', fe.labels.map((l) => l.label).join(' ') === 'Γ H N Γ P H|P N');
  for (const [tag, B] of [['Si', si], ['Fe', fe]]) {
    const at = B.path.breaks[0];
    for (let s = 0; s < B.nSpin; s++) {
      const d = S.segmentSeries(Array.from(B.x), Array.from(B.bands[s][0]), B.path.breaks);
      const k = d.findIndex((p) => !Number.isFinite(p[1]));
      check(`paquete ${tag} canal ${s + 1}: separador antes del nuevo inicio`, k === at && d[k][0] === B.x[at] && d.length === B.nk + 1, `${k} vs ${at}`);
    }
  }
  // un paquete sin "|" en la x repetida no se corta (no hay respaldo en los metadatos)
  const raw = JSON.parse(text('fe', 'fe.dftlab.json'));
  raw.bands.labels = raw.bands.labels.map((l) => ({ ...l, label: l.label.replace('H|P', 'H') }));
  const fe2 = S.packBands(await S.unpackDftlab(raw));
  check('paquete sin etiqueta A|B: sin corte', fe2.path.breaks.length === 0 && fe2.path.segments.length === 1, J(fe2.path.breaks));
}

console.log(`bands path: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
