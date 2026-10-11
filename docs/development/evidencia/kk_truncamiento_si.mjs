import fs from 'fs';
import { kramersKronig } from '../../../app/dftlab/static/js/siesta/epsimg.js';
const rows = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(l => l && !l.startsWith('#')).map(l => l.trim().split(/\s+/).map(Number));
const all = rows.filter(r => r.length === 2);
const res = [];
for (const Emax of [6, 8, 10, 12]) {
  const sub = all.filter(r => r[0] <= Emax);
  const E = Float64Array.from(sub, r => r[0]), e2 = Float64Array.from(sub, r => r[1]);
  const e1 = kramersKronig(E, e2);
  const k = sub.findIndex(r => r[0] >= 0.5);
  console.log(`Emax=${Emax} eV  eps1(0.5 eV)=${e1[k].toFixed(3)}  (eps2 en el corte=${e2[e2.length-1].toFixed(3)})`);
}
