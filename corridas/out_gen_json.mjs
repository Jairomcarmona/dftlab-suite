// Genera js/data/out_fe.json: el .out de Fe bcc FM (a = 2.866 Å, PBE/DZP, SIESTA 5.4.2) de corridas/espin.tar.gz
// sin las 8 769 líneas de eigenvalores (se sustituyen por una marca). Uso: node out_gen_json.mjs <fe_fm_2.866.out> <salida.json>
import { readFileSync, writeFileSync } from 'node:fs';
const [,, src, dst] = process.argv;
const L = readFileSync(src, 'utf8').split('\n');
const i0 = L.findIndex(l => /^siesta: Eigenvalues \(eV\)/.test(l));
const i1 = L.findIndex((l, i) => i > i0 && /^siesta: Fermi energy/.test(l));
const kept = [...L.slice(0, i0 + 2), `siesta: [omitted by DFT Lab: ${i1 - i0 - 2} lines of eigenvalues, 2192 k-points x 2 spins]`, '', ...L.slice(i1)];
writeFileSync(dst, JSON.stringify({ name: 'fe_fm_2.866.out', desc: 'Fe bcc ferromagnético, a = 2.866 Å, PBE, DZP, SIESTA 5.4.2 (corridas/espin.tar.gz → fe_fm_2.866)', omitted: i1 - i0 - 2, text: kept.join('\n') }));
console.log(kept.length, 'lines; omitted', i1 - i0 - 2);
