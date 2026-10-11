#!/usr/bin/env node
// Pruebas de tools/cellmesh.js (calculadora celda → malla k / MeshCutoff):  node tests/ui/run_calc_tests.mjs
// Los casos que antes colgaban la pestaña (fftGood con 0, NaN, Infinity, negativos) se ejecutan en un proceso hijo con
// timeout, para que un bucle infinito falle la prueba en vez de colgar el runner.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MOD = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../dftlab/static/js/tools/cellmesh.js');
const { fftGood, validateCellInputs, LIMITS } = await import(pathToFileURL(MOD).href);
let pass = 0, fail = 0; const bad = [];
const check = (n, c, d = '') => { if (c) pass++; else { fail++; bad.push(n + ' ' + d); } };

// --- aislamiento: cada entrada peligrosa en un proceso hijo con timeout ---
function isolated(expr, timeoutMs = 5000) {
  const code = `import(${JSON.stringify(pathToFileURL(MOD).href)}).then(m=>{try{console.log('OK '+JSON.stringify((${expr})(m)))}catch(e){console.log(e.name)}})`;
  const r = spawnSync(process.execPath, ['-e', code], { timeout: timeoutMs, encoding: 'utf8' });
  return { timedOut: r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGTERM', out: (r.stdout || '').trim() };
}
for (const v of ['0', 'NaN', 'Infinity', '-Infinity', '-3', '1.5', '1048577', '"7"', 'null', 'undefined']) {
  const r = isolated(`m=>m.fftGood(${v})`);
  check(`fftGood(${v}) termina y lanza RangeError`, !r.timedOut && r.out === 'RangeError', JSON.stringify(r));
}
{
  const hostile = ['', ' ', '0', '-1', 'NaN', 'Infinity', '-Infinity', 'abc', '1e400', '1e-400', null, undefined];
  const r = isolated(`m=>{const o=[];for(const a of ${JSON.stringify(hostile)}){for(const f of ['L','ang','dk','ec']){
    const raw={L:['3.84','3.84','3.84'],ang:['60','60','60'],dk:'0.2',ec:'200',sh:'0.5'};
    if(f==='L')raw.L[1]=a;else if(f==='ang')raw.ang[2]=a;else raw[f]=a; o.push(m.validateCellInputs(raw).ok);}} return o}`, 10000);
  check('barrido hostil termina y nunca da ok', !r.timedOut && r.out.startsWith('OK ') && !JSON.parse(r.out.slice(3)).includes(true), JSON.stringify(r));
}

// --- fftGood: valores válidos, contra una definición independiente (conjunto ordenado de 2^a 3^b 5^c) ---
const smooth = [];
for (let a = 1; a <= 2 ** 12; a *= 2) for (let b = a; b <= 2 ** 12 * 2; b *= 3) for (let c = b; c <= 2 ** 13; c *= 5) smooth.push(c);
smooth.sort((x, y) => x - y);
let allGood = true, firstBad = null;
for (let n = 1; n <= 4000; n++) { const exp = smooth.find(s => s >= n); if (fftGood(n) !== exp) { allGood = false; firstBad ??= [n, fftGood(n), exp]; } }
check('fftGood(n) = menor 2,3,5-liso ≥ n para n=1..4000', allGood, JSON.stringify(firstBad));
check('fftGood en el límite superior', fftGood(LIMITS.maxFft) === LIMITS.maxFft);

// --- valores válidos: mismas mallas que la implementación previa (ae3f35e); Si/Mg/grafito del propio selector ---
const ok = (L, ang, dk, ec, sh = '0.5') => validateCellInputs({ L, ang, dk, ec, sh });
const BOHR = 0.529177210903;
const mesh = (L, ec) => { const h = Math.PI / Math.sqrt(ec) * BOHR; return L.map(l => fftGood(Math.ceil(l / h))).join(','); };
const presets = { Si: [[3.8403, 3.8403, 3.8403], [60, 60, 60], '36,36,36'], Mg: [[4.52, 4.52, 18.08], [90, 90, 90], '40,40,160'], Gr: [[2.464, 2.464, 6.711], [90, 90, 120], '24,24,60'] };
for (const [k, [L, ang, exp]] of Object.entries(presets)) {
  const r = ok(L, ang, 0.2, 200);
  check(`preset ${k} válido`, r.ok && JSON.stringify(r.values.L) === JSON.stringify(L) && r.values.dk === 0.2 && r.values.ec === 200 && r.values.sh === '0.5');
  check(`preset ${k}: malla real igual a la anterior`, mesh(L, 200) === exp, mesh(L, 200));
}
check('malla real a 300 Ry (Si)', mesh([3.8403, 3.8403, 3.8403], 300) === '45,45,45');
check('malla real grande (123 Ry)', mesh([50, 60.5, 200], 123) === '360,405,1350');
check('acepta números y cadenas', ok(['3', '3', '3'], [90, 90, 90], '0.2', 100).ok && ok([3, 3, 3], ['90', '90', '90'], 0.2, '100').ok);

// --- entradas inválidas: mensaje y no resultado ---
const only = (r) => !r.ok && !r.values;
for (const [field, build] of Object.entries({
  longitud: v => ok(['3.84', v, '3.84'], [60, 60, 60], 0.2, 200),
  ángulo: v => ok([3, 3, 3], [60, 60, v], 0.2, 200),
  dk: v => ok([3, 3, 3], [60, 60, 60], v, 200),
  ec: v => ok([3, 3, 3], [60, 60, 60], 0.2, v),
})) {
  const empty = build('');
  check(`${field} vacío → estado de edición, sin error`, only(empty) && empty.editing === true && empty.errors.length === 0, JSON.stringify(empty));
  for (const v of ['0', '-1', 'NaN', 'Infinity', 'abc']) {
    const r = build(v);
    check(`${field}=${v} rechazado con mensaje`, only(r) && !r.editing && r.errors.length > 0 && r.errors.every(e => typeof e === 'string' && e.length > 10), JSON.stringify(r));
  }
}
check('ángulos fuera de rango (0 y 180)', only(ok([3, 3, 3], [0, 60, 60], 0.2, 200)) && only(ok([3, 3, 3], [60, 180, 60], 0.2, 200)));
check('ángulos geométricamente imposibles (60,60,170)', only(ok([3, 3, 3], [60, 60, 170], 0.2, 200)));
check('celda degenerada (90,90,90 válido; 120,120,120 plano)', ok([3, 3, 3], [90, 90, 90], 0.2, 200).ok && only(ok([3, 3, 3], [120, 120, 120], 0.2, 200)));
check('longitud absurda (1e5 Å)', only(ok([1e5, 3, 3], [90, 90, 90], 0.2, 200)));
check('malla real demasiado grande', only(ok([5000, 3, 3], [90, 90, 90], 0.2, 2000)));

console.log(`calc tests: ${pass} passed, ${fail} failed`);
for (const b of bad) console.log('  FAIL', b);
process.exit(fail ? 1 : 0);
