// Genera app/dftlab/static/js/data/si_fonones.json a partir de la corrida de fonones del Si (SIESTA 5.4.2).
//   node fonones_gen_json.mjs <carpeta fonones extraída> <salida.json>
// La carpeta contiene fc/ (si_fc.fdf, si_fc.FC, si_fc.out, time.txt), fc_shifted/ (la misma con k desplazada) y eos/ (a<a>.fdf/.out, celda de 2 átomos).
// Usa los mismos lectores que la app (siesta/fc.js, crystal/formats.js). El JSON guarda el .FC tal cual:
// la diagonalización se hace en el navegador.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const APP = process.env.DFTLAB_JS || '/mnt/project-files/DFT_App/app/dftlab/static/js';
const S = await import(pathToFileURL(path.join(APP, 'siesta/index.js')).href);
const C = await import(pathToFileURL(path.join(APP, 'crystal/formats.js')).href);
const [dir, outFile = 'si_fonones.json'] = process.argv.slice(2);
const rd = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

const fdf = rd('fc/si_fc.fdf'), fcText = rd('fc/si_fc.FC'), out = rd('fc/si_fc.out');
const cell = C.readFDF(fdf);
const fc = S.parseFC(fcText);
const kw = (k) => (new RegExp('^\\s*' + k + '\\s+(\\S+)', 'mi').exec(fdf) || [])[1];
const wall = +(/wall\s+(\d+)/.exec(rd('fc/time.txt')) || [])[1];
const version = (/Siesta Version\s*:\s*(\S+)/.exec(out) || [])[1] || '5.4.2';
const a = Math.hypot(...cell.lattice[0]) / 2 * Math.SQRT2;   // supercelda 2×2×2 de la fcc: |A₁| = 2·a/√2
const eos = fs.readdirSync(path.join(dir, 'eos')).filter((f) => /^a[\d.]+\.out$/.test(f)).sort().map((f) => {
  const o = S.parseOut(rd('eos/' + f)); return { a: +f.slice(1, -4), E: o.final.etot };
});
// misma corrida con la malla k desplazada (0.5): rompe la simetría cúbica; se guarda solo el resultado en Γ y X
let shifted = null;
if (fs.existsSync(path.join(dir, 'fc_shifted/si_fc.FC'))) {
  const P = await import(pathToFileURL(path.join(APP, 'physics/phonon.js')).href);
  const M = P.phononModel({ superCell: cell, n: [2, 2, 2], masses: cell.numbers.map(() => 28.085), phi: S.fcRows(S.parseFC(rd('fc_shifted/si_fc.FC'))) });
  const f = (q) => P.frequencies(M, P.qCart(M, q)).nu.map((x) => +x.toFixed(3));
  shifted = { G: f([0, 0, 0]), X: f([0.5, 0, 0.5]), L: f([0.5, 0.5, 0.5]) };
}
const D = {
  meta: { version, xc: 'LDA (Ceperley–Alder, Perdew–Zunger)', basis: kw('PAO.BasisSize'), pseudo: 'Si.psf (Troullier–Martins, ATM3)',
    mesh: +kw('MeshCutoff'), dmTol: kw('DM.Tolerance'), kgrid: '4×4×4 centrada en Γ en la supercelda (equivale a 8×8×8 en la primitiva)',
    displ: fc.displ, natoms: fc.nAtoms, ndisp: fc.nDisplaced, n: [2, 2, 2], a: +a.toFixed(4), wall_s: wall, eos, shifted },
  cell: { lattice: cell.lattice.map((v) => v.map((x) => +x.toFixed(6))), positions: cell.positions.map((v) => v.map((x) => +x.toFixed(6))), numbers: cell.numbers },
  fc: { nAtoms: fc.nAtoms, displ: fc.displ, blocks: fc.blocks.map((b) => [...b].map((x) => +x.toPrecision(9))) },
  fcText, fdf,
};
fs.writeFileSync(outFile, JSON.stringify(D));
console.log(outFile, (fs.statSync(outFile).size / 1024).toFixed(1), 'KB', 'a =', D.meta.a, 'eos', JSON.stringify(eos));
