// SIESTA total DOS file (SystemLabel.DOS), written together with the PDOS.
// Columns: E (eV) then 1 (unpolarized; per spin channel), 2 (up, down) or 4 (non-collinear: uu, dd, c3, c4) DOS columns.
// Lines starting with '#' are ignored. Units: eV and states/eV.
import { lines as splitLines, ffloat, trapz } from './util.js';

export function parseDOS(text) {
  const rows = [];
  const comments = [];
  for (const ln of splitLines(text)) {
    const t = ln.trim();
    if (!t) continue;
    if (t[0] === '#') { comments.push(t); continue; }
    const v = t.split(/\s+/).map(ffloat);
    if (v.length < 2 || v.some(Number.isNaN)) continue;
    rows.push(v);
  }
  const ncol = rows.length ? Math.min(...rows.map((r) => r.length)) : 0;
  const nspin = ncol - 1;
  const energy = Float64Array.from(rows, (r) => r[0]);
  const dos = [];
  for (let c = 1; c < ncol; c++) dos.push(Float64Array.from(rows, (r) => r[c]));
  let total;
  // nspin=1: SIESTA writes the DOS of one spin channel (integrates to N/2); total = 2x
  if (nspin === 1) total = Float64Array.from(dos[0], (v) => 2 * v);
  else { total = new Float64Array(energy.length); for (let i = 0; i < total.length; i++) total[i] = dos[0][i] + dos[1][i]; }
  return {
    nspin,
    noncollinear: nspin === 4,
    components: nspin === 1 ? ['perSpin'] : nspin === 2 ? ['up', 'down'] : ['uu', 'dd', 'c3', 'c4'],
    energy,
    dos,      // [component] Float64Array
    total,    // both spins: 2x column for nspin=1, up+down (uu+dd) otherwise
    comments,
    units: { energy: 'eV', dos: 'states/eV' },
  };
}

export function integrateDOS(d, upto, curve = d.total) { return trapz(d.energy, curve, upto); }
