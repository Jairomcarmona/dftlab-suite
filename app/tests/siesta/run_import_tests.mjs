#!/usr/bin/env node
// Bloques C y D: importación coherente de archivos en Postproceso (sin DOM).
//   node app/tests/siesta/run_import_tests.mjs
// C: el .EIG recibe pesos y coordenadas del .KP del mismo SystemLabel sea cual sea el orden de carga,
//    y se recalcula al añadir, sustituir o quitar el .KP; no se emparejan archivos incompatibles.
// D: las mallas binarias llegan como bytes, los textuales como texto; .dftlab.json se desempaqueta
//    y expone lo que se puede visualizar; archivos truncados o malformados dan un error, no un resultado.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const JS = path.resolve(HERE, '../../dftlab/static/js/siesta');
const S = await import(pathToFileURL(path.join(JS, 'index.js')).href);
const R = await import(pathToFileURL(path.join(JS, 'runset.js')).href);
const FX = path.join(HERE, 'fixtures');
const bytes = (...p) => new Uint8Array(fs.readFileSync(path.join(...p)));
const text = (...p) => fs.readFileSync(path.join(...p), 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d = '') => { if (c) pass++; else { fail++; console.log('  FAIL', n, d); } };
const same = (a, b) => a && b && a.length === b.length && Array.from(a).every((v, i) => v === b[i]);

const EIG = text(FX, 'si', 'si.EIG'), KP = text(FX, 'si', 'si.KP');
// .KP sintético con pesos no uniformes (misma malla): el primero vale 0.005
const kpLines = KP.split('\n');
const nk = parseInt(kpLines[0], 10);
const KPW = [kpLines[0], ...kpLines.slice(1, nk + 1).map((l, i) => {
  const t = l.trim().split(/\s+/); t[4] = (i === 0 ? 0.005 : (1 - 0.005) / (nk - 1)).toExponential(9); return '  ' + t.join('  ');
})].join('\n') + '\n';

const ref = S.parseEIG(EIG, KPW);   // lector puro con ambos contenidos
check('referencia: el lector puro usa los pesos del .KP', ref.weightsFromKP && Math.abs(ref.weights[0] - 0.005) < 1e-12, ref.weights[0]);

async function load(steps) {
  const set = R.createFileSet();
  for (const s of steps) {
    if (s.rm) set.remove(s.rm);
    else await set.add(s.map(([name, content]) => ({ name, content })));
  }
  return set;
}
const eigOf = (set) => set.files.find((f) => f.kind === 'eig');

// ---------------- C: orden de carga
const orders = {
  'EIG→KP': [[['si.EIG', EIG]], [['si.KP', KPW]]],
  'KP→EIG': [[['si.KP', KPW]], [['si.EIG', EIG]]],
  'EIG+KP juntos': [[['si.EIG', EIG], ['si.KP', KPW]]],
  'KP+EIG juntos': [[['si.KP', KPW], ['si.EIG', EIG]]],
};
for (const [tag, steps] of Object.entries(orders)) {
  const e = eigOf(await load(steps));
  check(`C ${tag}: pesos del .KP`, e.data.weightsFromKP && e.link.weights === 'si.KP', JSON.stringify(e.link));
  check(`C ${tag}: mismo resultado que el lector puro`, same(e.data.weights, ref.weights) && e.data.nk === ref.nk, e.data.weights[0]);
  check(`C ${tag}: conserva coordenadas k`, e.data.kpoints && e.data.kpoints.length === ref.nk && same(e.data.kpoints[5], ref.kpoints[5]) && e.link.kpoints === 'si.KP');
  check(`C ${tag}: DOS idéntica`, same(S.computeDOS(e.data, { sigma: 0.1, de: 0.01 }).total, S.computeDOS(ref, { sigma: 0.1, de: 0.01 }).total));
  const kp = (await load(steps)).files.find((f) => f.kind === 'kp');
  check(`C ${tag}: el .KP indica a quién da pesos`, kp.link.usedBy.join() === 'si.EIG');
}
{ // parseMany (lectura conjunta) sigue igual
  const pm = S.parseMany([{ name: 'si.EIG', content: EIG }, { name: 'si.KP', content: KPW }])[0];
  check('C parseMany conjunto sin cambios', same(pm.data.weights, ref.weights));
}
{ // quitar el .KP vuelve a pesos uniformes; sustituirlo recalcula
  const set = await load([[['si.EIG', EIG], ['si.KP', KPW]]]);
  set.remove('si.KP');
  const e = eigOf(set);
  check('C quitar .KP: pesos uniformes', !e.data.weightsFromKP && e.data.kpoints === null && Math.abs(e.data.weights[0] - 1 / nk) < 1e-15 && e.link.kp === null);
  await set.add([{ name: 'si.KP', content: KPW }]);
  check('C volver a añadir .KP: pesos del .KP', same(eigOf(set).data.weights, ref.weights));
  await set.add([{ name: 'si.KP', content: KP }]);   // sustitución por nombre con otros pesos
  const uni = S.parseEIG(EIG, KP);
  check('C sustituir .KP: recalcula con el nuevo', same(eigOf(set).data.weights, uni.weights) && eigOf(set).data.weightsFromKP && set.files.filter((f) => f.kind === 'kp').length === 1);
  await set.add([{ name: 'si.EIG', content: EIG }]);  // sustituir el .EIG conserva el enlace
  check('C sustituir .EIG: conserva el .KP', eigOf(set).data.weightsFromKP && set.files.filter((f) => f.kind === 'eig').length === 1);
  set.removeAt(set.files.findIndex((f) => f.kind === 'eig'));
  check('C quitar .EIG: el .KP queda sin uso', set.files.find((f) => f.kind === 'kp').link.usedBy.length === 0);
}
// ---------------- C: incompatibilidades
{
  const fe = text(FX, 'fe', 'fe.KP');   // 560 puntos frente a 256
  const e = eigOf(await load([[['si.EIG', EIG]], [['si.KP', fe]]]));
  check('C .KP de otra malla: no se empareja', !e.data.weightsFromKP && /560 puntos k y si\.EIG 256/.test(e.link.note || ''), e.link.note);
  const e2 = eigOf(await load([[['si.EIG', EIG], ['fe.KP', KPW]]]));
  check('C .KP de otra etiqueta: no se empareja', !e2.data.weightsFromKP && e2.link.note === null);
  const bad = KPW.replace(/0\.500000000e-2|5\.000000000e-3/i, 'NaN');
  const e3 = eigOf(await load([[['si.EIG', EIG], ['si.KP', bad]]]));
  check('C .KP con peso NaN: rechazado con motivo', !e3.data.weightsFromKP && /peso no válido en el punto k 1/.test(e3.link.note || ''), e3.link.note);
  const neg = KPW.replace(/5\.000000000e-3/i, '-5.000000000e-3');
  const e4 = eigOf(await load([[['si.EIG', EIG], ['si.KP', neg]]]));
  check('C .KP con peso negativo: rechazado', !e4.data.weightsFromKP && /peso no válido/.test(e4.link.note || ''), e4.link.note);
  const e5 = eigOf(await load([[['si.EIG', EIG], ['si.KP', KPW], ['si.kp', KP]]]));
  check('C dos .KP con la misma etiqueta: ninguno se elige', !e5.data.weightsFromKP && /varios \.KP/.test(e5.link.note || ''), e5.link.note);
  const e6 = eigOf(await load([[['si.EIG', EIG], ['si.KP', 'basura\n']]]));
  check('C .KP ilegible: pesos uniformes con motivo', !e6.data.weightsFromKP && /si\.KP/.test(e6.link.note || ''), e6.link.note);
  const e7 = eigOf(await load([[['si.EIG', EIG], ['si.PDOS.KP', KPW]]]));
  check('C .PDOS.KP no da pesos al .EIG', !e7.data.weightsFromKP);
}

// ---------------- D: mallas binarias
{
  const rho = bytes(HERE, 'fixtures_grid', 'mgo.RHO');
  const direct = S.parseGrid(rho, 'mgo.RHO');
  const [g] = (await load([[['mgo.RHO', rho.buffer.slice(rho.byteOffset, rho.byteOffset + rho.byteLength)]]])).files;
  check('D .RHO leído desde bytes', g.kind === 'grid' && g.data && !g.error, g.error);
  check('D .RHO igual al lector directo', g.data && same(g.data.mesh, direct.mesh) && same(g.data.data[0], direct.data[0]) && g.data.units === 'e/Bohr³');
  check('D .RHO conserva los bytes originales', g.content instanceof ArrayBuffer && g.content.byteLength === rho.byteLength);
  const [t] = (await load([[['mgo.RHO', new TextDecoder().decode(rho)]]])).files;
  check('D .RHO como texto: error explícito, sin resultado', t.data === null && /binarios/.test(t.error), t.error);
  const [tr] = (await load([[['mgo.RHO', rho.slice(0, 5000)]]])).files;
  check('D .RHO truncado: error explícito, sin resultado', tr.data === null && /truncado/.test(tr.error || ''), tr.error);
  const [gb] = (await load([[['x.VH', new Uint8Array(400).fill(7)]]])).files;
  check('D malla malformada: error, sin resultado', gb.data === null && /no es un archivo de malla/.test(gb.error || ''), gb.error);
  const [dr] = (await load([[['mgo.DRHO', bytes(HERE, 'fixtures_grid', 'mgo.DRHO')]]])).files;
  check('D .DRHO leído desde bytes', dr.data && !dr.error);
}
// ---------------- D: los textuales siguen por su lector de texto
{
  const set = await load([[['si.out', bytes(FX, 'si', 'si.out')], ['si.bands', bytes(FX, 'si', 'si.bands')]]]);
  const o = set.files.find((f) => f.kind === 'out'), b = set.files.find((f) => f.kind === 'bands');
  check('D .out desde bytes = desde texto', o.data && o.data.final.etot === S.parseOut(text(FX, 'si', 'si.out')).final.etot && typeof o.content === 'string');
  check('D .bands desde bytes = desde texto', b.data && same(b.data.bands[0][3], S.parseBands(text(FX, 'si', 'si.bands')).bands[0][3]));
  const [lv] = (await load([[['live.jsonl', '{"it":1,"Etot":-1}\n{"it":2,"Etot":-2}\n']]])).files;
  check('D live.jsonl', lv.kind === 'live' && lv.data.length === 2);
  const [lb] = (await load([[['live.jsonl', '{"it":1\n']]])).files;
  check('D live.jsonl malformado: error', lb.data === null && /JSON inválido/.test(lb.error));
}
// ---------------- D: paquetes .dftlab.json
for (const lab of ['si', 'fe', 'fesoc']) {
  const raw = text(FX, lab, `${lab}.dftlab.json`);
  const [p] = (await load([[[`${lab}.dftlab.json`, raw]]])).files;
  check(`D ${lab}.dftlab.json desempaquetado`, p.kind === 'dftlab-pack' && p.data && !p.error && ArrayBuffer.isView(p.data.bands.energies.data), p.error);
  const B = S.packBands(p.data), D = S.packDOS(p.data), C = S.packStructure(p.data), K = S.packContents(p.data);
  const [ns, nkb, nb] = p.data.bands.energies.shape;
  check(`D ${lab} bandas: forma`, B && B.nSpin === ns && B.nk === nkb && B.nBands === nb && B.x.length === nkb);
  let maxd = 0; for (let s = 0; s < ns; s++) for (let n = 0; n < nb; n++) for (let k = 0; k < nkb; k += 7) maxd = Math.max(maxd, Math.abs(B.bands[s][n][k] - S.at(p.data.bands.energies, s, k, n)));
  check(`D ${lab} bandas: valores originales sin desplazar`, maxd === 0 && B.fermi === p.data.fermi, maxd);
  check(`D ${lab} bandas: etiquetas`, B.labels.length === p.data.bands.labels.length && B.labels[0].label === p.data.bands.labels[0].label);
  check(`D ${lab} DOS: canales y energía`, D && D.nChannels === p.data.dos.total.shape[0] && D.energy.length === p.data.dos.energy.shape[0] && D.byL && D.byL.names.length === p.data.dos.byL.names.length);
  check(`D ${lab} DOS: valores originales`, D.total[D.nChannels - 1][100] === S.at(p.data.dos.total, D.nChannels - 1, 100));
  check(`D ${lab} estructura`, C && C.numbers.length === p.data.structure.nAtoms && C.lattice.length === 3);
  check(`D ${lab} contenido no visualizable nombrado`, K.bands && K.dos && K.structure && K.extras.some((x) => x.key === 'fatbands') && (lab !== 'si' || K.extras.some((x) => x.key === 'wavefunctions') && K.extras.some((x) => x.key === 'coop')), JSON.stringify(K.extras));
}
{
  const raw = text(FX, 'si', 'si.dftlab.json');
  const [t] = (await load([[['si.dftlab.json', raw.slice(0, raw.length >> 1)]]])).files;
  check('D paquete truncado: error, sin resultado', t.kind === 'dftlab-pack' && t.data === null && !!t.error, t.error);
  const [m] = (await load([[['x.dftlab.json', '{"dftlab":"otro","bands":{}}']]])).files;
  check('D JSON que no es paquete: error explícito', m.data === null && /siesta-pack/.test(m.error || ''), m.error);
  const o = JSON.parse(raw); o.dos.energy.data = o.dos.energy.data.slice(0, 40);   // base64/gzip dañado
  const [c] = (await load([[['si.dftlab.json', JSON.stringify(o)]]])).files;
  check('D paquete con arreglo dañado: error', c.data === null && /paquete dañado/.test(c.error || ''), c.error);
  const o2 = JSON.parse(raw); o2.dos.energy.shape = [o2.dos.energy.shape[0] + 3];   // forma incoherente con los datos
  const [c2] = (await load([[['si.dftlab.json', JSON.stringify(o2)]]])).files;
  check('D paquete con forma incoherente: error', c2.data === null && /expected/.test(c2.error || ''), c2.error);
  const o3 = JSON.parse(raw); delete o3.bands; delete o3.coop; delete o3.wavefunctions;
  const [c3] = (await load([[['si.dftlab.json', JSON.stringify(o3)]]])).files;
  const K3 = S.packContents(c3.data);
  check('D paquete sin bandas: lo declara', c3.data && !K3.bands && K3.dos && K3.extras.length === 0);
  const inl = { dftlab: 'siesta-pack', fermi: 0, bands: { x: [0, 1], energies: [[[1, 2], [3, 4]]], labels: [] } };
  const B = S.packBands(await S.unpackDftlab(inl));
  check('D arreglos pequeños en línea', B && B.nk === 2 && B.nBands === 2 && B.bands[0][1][1] === 4);
}

console.log(`\nimport (C/D): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
