// Read-only inventory checker. --write updates only the two generated inventory files.
// No browser modules are evaluated; registries are read as source, never with eval.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { catalogue } from './catalogue.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '../..');
const base = 'app/dftlab/static/js/';
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const hash = f => createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex');
function files(relative) {
  return fs.readdirSync(path.join(root, relative), {withFileTypes: true}).flatMap(e =>
    e.isDirectory() ? files(`${relative}/${e.name}`) : [`${relative}/${e.name}`]).sort();
}
const code = files(base.slice(0, -1)).filter(f => f.endsWith('.js'));
const registry = read(base + 'views/registry.js');
const views = [...registry.matchAll(/\{id:'([^']+)', group:'([^']+)', num:'([^']*)', title:'([^']+)', load:\(\)=>import\('\.\/(.+?)'\)/g)].map(m => {
  const file = base + 'views/' + m[5];
  assert(file, `Unmapped view ${m[1]}`);
  return {id: m[1], group: m[2], chapter: m[3] || null, title: m[4], file, consumer: 'main.js → registry.VIEWS → load() → mount(el, view)', tests: catalogue.viewTests[m[1]], preservation: 'Conservar montaje, unidades, datasets, navegación y exportaciones observables; migración por equivalencia.'};
});
assert.deepEqual(Object.keys(catalogue.viewTests).sort(), views.map(v => v.id).sort());
const body = read(base + 'siesta/index.js').match(/const PARSERS = \{([\s\S]*?)\n\};/)[1];
const parsers = [...body.matchAll(/(?:^|[,\n])\s*(?:'([^']+)'|(\w+)):\s*(parse\w+|\(t\) => (?:JSON\.parse|parseFC)\(t\))/g)].map(m => {
  const kind = m[1] || m[2];
  const extra = catalogue.readers[kind];
  assert(extra, `Unmapped parser ${kind}`);
  return {kind, ...extra, consumer: 'siesta/index.js → runset.js → postproc.js', preservation: 'Conservar parser, unidades, errores, bytes originales y hash; no convertir binarios en texto.'};
});
parsers.push({kind: 'grid', ...catalogue.readers.grid, consumer: 'postproc.js, density.js, potential.js', preservation: 'Fortran binario, endianness, Bohr/e·Bohr⁻³/Ry y bytes originales.'});
assert.deepEqual(Object.keys(catalogue.readers).sort(), parsers.map(p => p.kind).sort());
const datasets = files(base + 'data').filter(f => f.endsWith('.json')).map(file => {
  const name = path.basename(file);
  assert(catalogue.datasets[name], `Unmapped dataset ${name}`);
  const consumers = code.filter(f => read(f).includes(`data/${name}'`));
  assert(consumers.length, `Orphan dataset ${name}`);
  return {file, bytes: fs.statSync(path.join(root, file)).size, sha256: hash(file), consumers, ...catalogue.datasets[name], preservation: 'Bytes históricos intactos; registrar procedencia y unidades al adaptar, sin elevar ejemplo a resultado nuevo.'};
});
assert.deepEqual(Object.keys(catalogue.datasets).sort(), datasets.map(d => path.basename(d.file)).sort());
const calcFile = base + 'views/calc.js';
const calculators = [...read(calcFile).matchAll(/function (do\w+)\(/g)].map(m => {
  assert(catalogue.calculators[m[1]], `Unmapped calculator ${m[1]}`);
  return {id: m[1], file: calcFile, consumer: 'Vista #calc, entradas del usuario', ...catalogue.calculators[m[1]], preservation: 'Conservar fórmulas y unidades; no afirmar validación independiente donde solo hay smoke UI.'};
});
assert.deepEqual(Object.keys(catalogue.calculators).sort(), calculators.map(c => c.id).sort());
// These are SOURCE call sites, not a claim about the number of downloadable assets.
const exportSites = code.filter(f => f.includes('/views/') || f.endsWith('/core/chart.js')).flatMap(file =>
  read(file).split(/\r?\n/).flatMap((line, i) => [...line.matchAll(/\b(downloadText|download|exportBar)\(/g)]
    .filter(m => !/function\s+$/.test(line.slice(0, m.index)))
    .map(m => ({file, line: i + 1, function: m[1], source: line.trim(), consumer: file.endsWith('/core/chart.js') ? 'Todas las vistas con exportBar' : '#'+views.find(v=>v.file===file)?.id,
      tests: ['app/tests/ui/browser_lifecycle.mjs', 'app/tests/ui/browser_resources.mjs', ...(file.includes('estructura') ? ['app/tests/ui/browser_offline.mjs','app/tests/crystal/browser_smoke.mjs'] : [])],
      preservation: 'Conservar tipo MIME, nombre, datos, unidades y segmentos. Smoke de vista no verifica cada descarga.'}))));
const scientificModules = code.filter(f => /\/(siesta|crystal|physics|tools)\//.test(f)).map(file => ({
  file, sha256: hash(file),
  exports: [...new Set([
    ...[...read(file).matchAll(/export (?:async )?(?:function|const|class) (\w+)/g)].map(m => m[1]),
    ...[...read(file).matchAll(/export\s*\{([^}]+)\}/g)].flatMap(m => m[1].split(',').map(item=>item.trim().split(/\s+as\s+/).at(-1)).filter(Boolean)),
  ])],
  reexports: [...read(file).matchAll(/export\s+(?:\*|\{[^}]+\})\s+from\s+['"]([^'"]+)['"]/g)].map(m => path.posix.normalize(path.posix.join(path.posix.dirname(file),m[1]))),
  consumers: code.filter(f => f !== file && [...read(f).matchAll(/from ['"]([^'"]+)['"]/g)].some(m => path.resolve(root, path.dirname(f), m[1]) === path.resolve(root, file))),
  tests: file.includes('/physics/phonon') ? ['app/tests/siesta/run_fc_tests.mjs']
    : file.includes('/physics/atom') ? ['app/tests/ui/browser_lifecycle.mjs','app/tests/perf/measure_views.mjs']
    : file.includes('/crystal/') ? ['app/tests/crystal/run_tests.mjs','app/tests/crystal/browser_smoke.mjs']
    : file.includes('cellmesh') ? ['app/tests/ui/run_calc_tests.mjs','app/tests/ui/browser_regressions.mjs']
    : file.includes('/siesta/') ? ['app/tests/siesta/run_tests.mjs',
      ...(/rho/.test(file) ? ['app/tests/siesta/run_rho_tests.mjs'] : []),
      ...(/runset|pack/.test(file) ? ['app/tests/siesta/run_import_tests.mjs'] : []),
      ...(/\/fc\.js/.test(file) ? ['app/tests/siesta/run_fc_tests.mjs'] : []),
      ...(/bands/.test(file) ? ['app/tests/siesta/run_bands_path_tests.mjs'] : []),
      ...(/outnotes/.test(file) ? ['app/tests/siesta/run_outnotes_tests.mjs'] : [])]
    : ['app/tests/ui/browser_lifecycle.mjs'],
  preservation: 'Reutilizar módulo y exports; revisar cobertura por símbolo antes de sustituir. Presencia de suite no acredita cada símbolo.',
}));
const structureFormats = catalogue.structureFormats;
const formatsSource = read(base + 'crystal/formats.js');
for (const row of structureFormats) for (const name of row.symbols) assert(formatsSource.includes(`function ${name}(`), `Missing ${name}`);
const sourceFiles = [...code, 'scripts/verify.mjs', 'app/scripts/test-browser.mjs', 'app/package.json', 'app/package-lock.json', '.github/workflows/ci.yml', '.github/workflows/python-references.yml'].map(file => ({file, bytes: fs.statSync(path.join(root,file)).size, sha256: hash(file)}));
const inventory = {schemaVersion: 1, scope: 'T-001: capacidades del frontend actual; no capacidades operativas V2.1', counts: {views: views.length, chapters: views.filter(v=>v.group==='learn').length, toolViews: views.filter(v=>v.group==='tools').length, siestaDispatchKinds: parsers.length, calculatorPanels: calculators.length, structureReaderFamilies: structureFormats.filter(f=>f.direction==='read').length, structureWriterFormats: structureFormats.filter(f=>f.direction==='write').length, datasets: datasets.length, datasetBytes: datasets.reduce((n,d)=>n+d.bytes,0), ownJavascriptFiles: code.length, ownJavascriptLines: code.reduce((n,f)=>n+read(f).split('\n').length-(read(f).endsWith('\n')?1:0),0), exportSourceCalls: exportSites.length, scientificModules: scientificModules.length}, views, readers: parsers, calculators, structureFormats, datasets, scientificModules, exportSites, sourceFiles};
for (const row of [...views,...parsers,...calculators,...structureFormats,...datasets,...scientificModules,...exportSites]) {
  assert(fs.existsSync(path.join(root,row.file)), `Missing source ${row.file}`);
  assert(row.tests?.length, 'Every inventory entry must declare evidence or its limited coverage');
  for (const test of row.tests) assert(fs.existsSync(path.join(root,test)), `Missing evidence ${test}`);
}
const cell = value => String(Array.isArray(value) ? value.join('<br>') : value ?? '').replaceAll('|','\\|').replaceAll('\n',' ');
function table(rows, columns) { return `| ${columns.map(c=>c[0]).join(' | ')} |\n| ${columns.map(()=> '---').join(' | ')} |\n`+rows.map(r=>'| '+columns.map(c=>cell(r[c[1]])).join(' | ')+' |').join('\n')+'\n'; }
const matrix = `# Matriz T-001 (generada)\n\nGenerada por \`node docs/inventory/audit.mjs --write\`. No editar a mano; editar \`catalogue.mjs\`, revisar las fuentes y regenerar. El checker falla si cambia el contenido inventariado. Los SHA-256 son de los bytes reales (\`.gitattributes\` preserva los originales).\n\n## Conteos y alcance\n\n${table(Object.entries(inventory.counts).map(([name,value])=>({name,value})),[['Concepto','name'],['Conteo','value']])}\nLas 19 vistas son portada + 15 capítulos + 2 herramientas + postproceso. No hay \`temario.js\` en esta fuente. Los 23 tipos SIESTA incluyen 22 entradas PARSERS y la ruta binaria grid; sus extensiones y aliases no son 23 formatos científicos independientes. Las siete calculadoras son los paneles de #calc; el resto de operaciones de ciencia se inventaría también por módulo/export. Las llamadas de exportación son sitios del código, no archivos únicos: una barra exporta SVG/PNG/CSV, y los nombres dependen de los datos.\n\n## Vistas\n\n${table(views,[['ID','id'],['Capítulo','chapter'],['Archivo','file'],['Consumidor','consumer'],['Prueba / límite','tests'],['Conservación','preservation']])}\n## Lectores SIESTA y aliases\n\n${table(parsers,[['Tipo','kind'],['Archivo','file'],['Símbolo','symbol'],['Entrada','formats'],['Consumidor','consumer'],['Prueba / límite','tests'],['Conservación','preservation']])}\n## Calculadoras de #calc\n\n${table(calculators,[['Símbolo','id'],['Operación/unidades','description'],['Archivo','file'],['Consumidor','consumer'],['Prueba / límite','tests'],['Conservación','preservation']])}\n## Formatos estructurales\n\n${table(structureFormats,[['Dirección','direction'],['Familia/aliases','format'],['Archivo','file'],['Símbolos','symbols'],['Consumidor','consumer'],['Prueba','tests'],['Conservación','preservation']])}\n## Datasets empaquetados\n\n${table(datasets,[['Archivo','file'],['Bytes','bytes'],['Consumidores','consumers'],['Origen conservado / límite','origin'],['Prueba / límite','tests'],['Conservación','preservation']])}\nLos hashes individuales están en \`inventory.json\`. Procedencia identificada por cercanía de archivo no equivale a una regeneración bit a bit demostrada. La calificación de referencias Python del bloque F es independiente, en \`tools/reference-env/\`.\n\n## Módulos científicos y todas sus exportaciones nominales\n\n${table(scientificModules,[['Archivo','file'],['Exports nominales','exports'],['Reexporta','reexports'],['Consumidores directos','consumers'],['Prueba / límite','tests'],['Conservación','preservation']])}\n## Exportaciones: sitios concretos\n\n${table(exportSites,[['Archivo','file'],['Línea','line'],['Función','function'],['Consumidor','consumer'],['Prueba / límite','tests'],['Conservación','preservation']])}\nLa expresión completa de cada llamada está en \`inventory.json\`. El generador de estructura exporta CIF, XYZ, extXYZ, POSCAR, FDF y STRUCT_IN, script shell local/SLURM/PBS/SGE y hook Lua; genera texto y no envía trabajos. Postproceso exporta geometría, Markdown, JSON y gráficas CSV/SVG/PNG. Los CSV de bandas preservan la columna segment del bloque G. Las demás vistas descargan entradas FDF, PSML, resultados KS TXT, E(V)/formación TXT, potencial/densidad/gaps CSV y gráficas; las llamadas anteriores permiten localizar cada salida.\n`;
for (const [name, contents] of [['inventory.json',JSON.stringify(inventory,null,2)+'\n'],['MATRIX.md',matrix]]) {
  const target = path.join(dir,name);
  if (process.argv.includes('--write')) fs.writeFileSync(target,contents);
  else assert.equal(fs.readFileSync(target,'utf8'), contents, `${name} is stale; review sources and run --write`);
}
console.log(JSON.stringify({ok:true,counts:inventory.counts},null,2));
