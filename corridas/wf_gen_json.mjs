// Genera js/data/potencial.json a partir de las corridas de láminas (SIESTA 5.4.2).
// Uso: node wf_gen_json.mjs <carpeta con una subcarpeta por corrida> <salida.json>
// Usa el lector de mallas de la propia app (siesta/rho.js); sin Python.
import fs from 'fs';
import path from 'path';
import { parseGrid, planarAverage } from '/mnt/project-files/DFT_App/app/dftlab/static/js/siesta/rho.js';

const [dir, outFile] = process.argv.slice(2);
const RY = 13.605693122994, BOHR = 0.529177210903;
const r3 = (x) => Math.round(x * 1e3) / 1e3;

// Metadatos por corrida: periodo del promedio planar (= distancia entre planos del cristal) y etiqueta.
const SET = {
  al111_n3: { el: 'Al', face: '(111)', n: 3, a: 4.05 }, al111_n5: { el: 'Al', face: '(111)', n: 5, a: 4.05 },
  al111_n7: { el: 'Al', face: '(111)', n: 7, a: 4.05 }, al111_n9: { el: 'Al', face: '(111)', n: 9, a: 4.05 },
  al111_n5_v10: { el: 'Al', face: '(111)', n: 5, a: 4.05 }, al111_n5_v26: { el: 'Al', face: '(111)', n: 5, a: 4.05 },
  al100_n7: { el: 'Al', face: '(100)', n: 7, a: 4.05 }, al110_n11: { el: 'Al', face: '(110)', n: 11, a: 4.05 },
  mg0001_n3: { el: 'Mg', face: '(0001)', n: 3 }, mg0001_n5: { el: 'Mg', face: '(0001)', n: 5 },
  mg0001_n7: { el: 'Mg', face: '(0001)', n: 7 }, mg0001_n9: { el: 'Mg', face: '(0001)', n: 9 },
};
for (const b of ['sz', 'dz', 'tzp', 'm400']) {
  SET['al111_n5_' + b] = { el: 'Al', face: '(111)', n: 5 }; SET['mg0001_n7_' + b] = { el: 'Mg', face: '(0001)', n: 7 };
}
for (const [k, v] of Object.entries({ al111_n5: ['(111)', 5], al111_n9: ['(111)', 9], al100_n7: ['(100)', 7], al110_n11: ['(110)', 11] })) SET[k + '_alda'] = { el: 'Al', face: v[0], n: v[1] };
SET['al111_n9_es5'] = { el: 'Al', face: '(111)', n: 9 };
for (const b of ['es5', 'es1']) { SET['al111_n5_' + b] = { el: 'Al', face: '(111)', n: 5 }; SET['mg0001_n7_' + b] = { el: 'Mg', face: '(0001)', n: 7 }; }
const KEEP_CURVES = new Set(['al111_n5', 'al111_n9', 'al100_n7', 'al110_n11', 'mg0001_n7']);

function macro(z, v, period, L) {            // doble promedio móvil periódico con ventana = period
  const n = v.length, dz = L / n, w = Math.max(1, Math.round(period / dz)), out = new Float64Array(n);
  const pass = (src) => {
    const o = new Float64Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < w; k++) s += src[(i + k - (w >> 1) + n * 4) % n]; o[i] = s / w; }
    return o;
  };
  out.set(pass(pass(v)));
  return out;
}

const runs = {};
for (const name of Object.keys(SET)) {
  const d = path.join(dir, name);
  if (!fs.existsSync(path.join(d, name + '.VH')) || !fs.existsSync(path.join(d, name + '.out'))) { console.error('falta', name); continue; }
  const out = fs.readFileSync(path.join(d, name + '.out'), 'utf8');
  const fdf = fs.readFileSync(path.join(d, name + '.fdf'), 'utf8');
  const fermi = +/siesta:\s+Fermi =\s+(\S+)/.exec(out)[1];
  const vacSiesta = /Vacuum level \(max, mean\) =\s+(\S+)\s+(\S+)/.exec(out);
  const etot = +/siesta:\s+Total =\s+(\S+)/.exec(out)[1];
  const scf = [...out.matchAll(/scf:\s+(\d+)\s/g)].map((m) => +m[1]);
  const nscf = Math.max(...scf);
  const conv = /SCF Convergence by DM criterion/.test(out);
    const gVH = parseGrid(fs.readFileSync(path.join(d, name + '.VH')), '.VH');
  const gVT = parseGrid(fs.readFileSync(path.join(d, name + '.VT')), '.VT');
  const gRho = parseGrid(fs.readFileSync(path.join(d, name + '.RHO')), '.RHO');
  const L = Math.hypot(...gVH.cell[2]);
  const area = Math.abs(gVH.cell[0][0] * gVH.cell[1][1] - gVH.cell[0][1] * gVH.cell[1][0]);
  const vh = planarAverage(gVH, 2).map((p) => p[1] * RY), vt = planarAverage(gVT, 2).map((p) => p[1] * RY);
  const rho = planarAverage(gRho, 2).map((p) => p[1] / BOHR ** 3 * area);   // e/Å (integra a N electrones)
  const n = vh.length, dz = L / n;
  // posiciones z de los átomos (Å) desde el fdf
  const lines = fdf.split('%block AtomicCoordinatesAndAtomicSpecies')[1].split('%endblock')[0].trim().split('\n');
  const zs = lines.map((l) => +l.trim().split(/\s+/)[2]);
  const nl = zs.length, dLay = (zs[nl - 1] - zs[0]) / (nl - 1);
  const ztop = zs[nl - 1], zbot = zs[0];
  // plano de vacío: puntos a menos de 1.5 Å del borde de la celda (z=0 ≡ L), lejos del último átomo por >= vac/2 - 1.5
  const vacIdx = [];
  for (let i = 0; i < n; i++) { const z = i * dz, dist = Math.min(z, L - z); if (dist < 1.5) vacIdx.push(i); }
  const vVac = vacIdx.reduce((s, i) => s + vh[i], 0) / vacIdx.length;
  const vacRange = Math.max(...vacIdx.map((i) => vh[i])) - Math.min(...vacIdx.map((i) => vh[i]));
  // promedio macroscópico en el centro de la lámina
  const mac = macro(null, Float64Array.from(vh), dLay, L);
  const mid = zs.reduce((a, b) => a + b, 0) / nl, iMid = Math.round(mid / dz) % n;
  const vBulk = mac[iMid];
  const macSpread = (() => { const lo = Math.round((mid - dLay) / dz), hi = Math.round((mid + dLay) / dz); let a = 1e9, b = -1e9; for (let i = lo; i <= hi; i++) { a = Math.min(a, mac[i]); b = Math.max(b, mac[i]); } return b - a; })();
  const wf = vVac - fermi;
  const ke = SET[name];
  const rec = {
    el: ke.el, face: ke.face, nLayers: ke.n, nAtoms: nl, area: r3(area), L: r3(L), vacuum: r3(L - (ztop - zbot)), dLayer: r3(dLay),
    fermi: r3(fermi), vVacuum: r3(vVac), vacuumFlat: Math.round(vacRange * 1e6) / 1e6, vacuumSiesta: vacSiesta ? { max: +vacSiesta[1], mean: +vacSiesta[2] } : null,
    workFunction: r3(wf), vBulk: r3(vBulk), macroSpread: r3(macSpread), barrier: r3(vVac - vBulk), mu: r3(fermi - vBulk), // Φ = (V_vac − V̄) − (E_F − V̄)
    etot: r3(etot), nscf, converged: conv, mesh: gVH.mesh, nElectrons: r3(rho.reduce((s, x) => s + x, 0) * dz),
    zAtoms: zs.map(r3),
    energyShiftMeV: (/PAO.EnergyShift (\d+) meV/.exec(fdf) || [0, 272])[1] * 1, basis: /PAO.BasisSize (\w+)/.exec(fdf)[1], meshCutoff: +/MeshCutoff (\d+)/.exec(fdf)[1],
    kgrid: fdf.match(/kgrid_Monkhorst_Pack\n\s*(\d+) 0 0[^\n]*\n\s*0 (\d+) 0/).slice(1).map(Number),
  };
  if (KEEP_CURVES.has(name)) {
    const step = Math.max(1, Math.round(0.1 / dz));   // un punto cada ~0.1 Å
    const pick = (arr, f = r3) => Array.from({ length: Math.ceil(n / step) }, (_, i) => f(arr[i * step]));
    rec.fdf = fdf.trim();
    rec.curve = { dz: r3(dz * step), vh: pick(vh), vt: pick(vt), macro: pick(mac), rho: pick(rho, (x) => Math.round(x * 1e4) / 1e4) };
  }
  runs[name] = rec;
  console.log(name, 'Φ', rec.workFunction, 'Ef', rec.fermi, 'Vvac', rec.vVacuum, 'plano', rec.vacuumFlat, 'SIESTA', rec.vacuumSiesta?.mean, 'nscf', nscf, 'N e', rec.nElectrons);
}
fs.writeFileSync(outFile, JSON.stringify({ siesta: '5.4.2', xc: 'LDA (CA)', basis: 'DZP', runs }));
console.log(fs.statSync(outFile).size, 'bytes');
