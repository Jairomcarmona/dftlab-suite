#!/usr/bin/env node
// Pruebas de inserción segura (bloque E):  node tests/ui/run_escape_tests.mjs
// Nivel Node (sin DOM): esc() y las notas HTML del lector anotado con metadatos hostiles de un .out.
// La comprobación en navegador de las pantallas está en tests/ui/browser_regressions.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const JS = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../dftlab/static/js');
const imp = p => import(pathToFileURL(path.join(JS, p)).href);
const { esc } = await imp('core/escape.js');
const { annotateLines } = await imp('siesta/outnotes.js');
const { parseOut } = await imp('siesta/out.js');
const D = JSON.parse(fs.readFileSync(path.join(JS, 'data/out_fe.json'), 'utf8'));
let pass = 0, fail = 0; const bad = [];
const check = (n, c, d = '') => { if (c) pass++; else { fail++; bad.push(n + ' ' + d); } };

// --- esc: contenido y atributos con ambas comillas ---
check('esc escapa & < > " \'', esc(`&<>"'`) === '&amp;&lt;&gt;&quot;&#39;');
check('esc no cambia texto sin caracteres especiales', esc('Fe bcc 2.866') === 'Fe bcc 2.866');
check('esc acepta números y null', esc(3.5) === '3.5' && esc(null) === 'null');
const attack = `x" onmouseover="alert(1)" '`;
const inAttr = `<canvas data-export="${esc(attack)}">`, inAttr2 = `<canvas data-export='${esc(attack)}'>`;
check('esc impide salir de un atributo " o \'', /^<canvas data-export="[^"]*">$/.test(inAttr) && /^<canvas data-export='[^']*'>$/.test(inAttr2), inAttr);

// --- notas del lector anotado: el texto del .out entra escapado ---
const PAYLOADS = [
  '<b data-audit-label="yes">audit</b>',
  '"><img src=x onerror=alert(1)>',
  `<script>alert('x')</script>`,
  `'onmouseover='alert(1)`,
];
// etiquetas permitidas en las notas propias: b, code, sub, sup, i; cualquier otra, o con atributos, es del archivo
const hasForeignTag = h => /<(?!\/?(b|code|sub|sup|i)>)/i.test(h);
for (const pl of PAYLOADS) {
  const lines = [
    `reinit: System Label: ${pl}`,
    `Species number:   1 Atomic number:   26 Label: ${pl}`,
    `xc_check: ${pl}`,
    `redata: ${pl}`,
    `Using libxc ids: ${pl}`,
    `stepf: ${pl}`,
    `SCF Convergence by ${pl}`,
    `    Begin ${pl} 1`,
    `diag: Algorithm = ${pl}`,
    `${pl}  1  2.0  3.0  4.0`,
  ];
  const shown = annotateLines(lines, {}).map(n => n && n.h).filter(Boolean);
  check(`hay notas para los metadatos (${pl.slice(0, 12)})`, shown.length >= 4, String(shown.length));
  check(`ninguna nota inserta etiquetas del archivo (${pl.slice(0, 12)})`, shown.every(h => !hasForeignTag(h)), shown.find(hasForeignTag));
}
{ // la nota legítima conserva su formato (el HTML propio sigue siendo HTML)
  const [n] = annotateLines([D.text.split('\n').find(l => /^reinit: System Label/.test(l))], {});
  check('nota legítima del SystemLabel intacta', /SystemLabel «fe_fm_2\.866»/.test(n.h), n.h);
  const t = annotateLines(['siesta: Etot    =     -1.0'], {})[0];
  check('HTML propio (<b>) se conserva', t && /<b>Etot<\/b>/.test(t.h), t && t.h);
}
{ // el lector devuelve el texto original; escapar es responsabilidad de quien lo pinta
  const o = parseOut(D.text.replace(/^reinit: System Label:.*$/m, 'reinit: System Label: <b data-audit-label="yes">audit</b>'));
  check('parseOut conserva el texto sin escapar', typeof o.systemLabel === 'string', String(o.systemLabel));
}

console.log(`escape tests: ${pass} passed, ${fail} failed`);
for (const b of bad) console.log('  FAIL', b);
process.exit(fail ? 1 : 0);
