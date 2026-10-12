// Oráculo de referencia de pseudopotenciales y especies (ficha docs/scientific-protocols/PSEUDOS.md).
// Reproduce lo que hace SIESTA 5.4.2, comprobado con corridas; no es código de producción.

// Identificadores de libxc que aparecen en la biblioteca y en la tabla de XC.authors de SIESTA que usa la plataforma.
export const LIBXC = { 1: 'LDA_X', 9: 'LDA_C_PZ', 12: 'LDA_C_PW', 101: 'GGA_X_PBE', 130: 'GGA_C_PBE', 116: 'GGA_X_PBE_SOL', 133: 'GGA_C_PBE_SOL' };
export const XC_AUTHORS = { LDA: { CA: [1, 9], PZ: [1, 9], PW92: [1, 12] }, GGA: { PBE: [101, 130], PBESOL: [116, 133] } };

const attr = (tag, name) => (new RegExp(`\\s${name}="([^"]*)"`).exec(tag) || [])[1];

// PS-3: cabecera PSML. Las funciones de libxc se ordenan exchange, correlation; el tipo se escribe «exchange» o «XC_EXCHANGE».
export function psmlInfo(text) {
  const spec = (/<(?:pseudo-atom-spec|header)\b[^>]*>/.exec(text) || [])[0]; // PSML 1.1 y 1.0
  if (!spec) return { error: 'PSML_HEADER_MISSING' };
  const xcBlock = (/<exchange-correlation>([\s\S]*?)<\/exchange-correlation>/.exec(text) || [])[1] || '';
  const funcs = [...xcBlock.matchAll(/<functional\b[^>]*>/g)].map(m => ({ type: attr(m[0], 'type'), id: Number(attr(m[0], 'id')) }));
  const rank = t => (/exchange/i.test(t) ? 0 : /correlation/i.test(t) ? 1 : 2);
  const ids = funcs.sort((a, b) => rank(a.type) - rank(b.type)).map(f => f.id);
  return {
    label: attr(spec, 'atomic-label'), z: Number(attr(spec, 'atomic-number')), z_valence: Number(attr(spec, 'z-pseudo')),
    relativity: attr(spec, 'relativity'), core_corrections: attr(spec, 'core-corrections') === 'yes',
    libxc_ids: ids, xc: ids.map(i => LIBXC[i] ?? `LIBXC_${i}`),
  };
}

// PS-2: el funcional de la corrida (XC.functional, XC.authors) frente al de cada pseudo. SIESTA solo avisa; aquí es FAIL.
export function xcGate(run, pseudos) {
  const ids = XC_AUTHORS[String(run.functional).toUpperCase()]?.[String(run.authors).toUpperCase()];
  if (!ids) return { status: 'FAIL', code: 'XC_UNKNOWN' };
  const mismatched = Object.entries(pseudos).filter(([, p]) => p.libxc_ids.join() !== ids.join()).map(([label]) => label).sort();
  return mismatched.length ? { status: 'FAIL', code: 'PSEUDO_XC_MISMATCH', run_libxc_ids: ids, mismatched } : { status: 'PASS', run_libxc_ids: ids };
}

// PS-2: avisos de xc_check en la salida, para pseudos sin cabecera legible (psf) y como comprobación posterior.
export function stdoutXcWarnings(stdout) {
  return [...stdout.matchAll(/xc_check: WARNING: Pseudopotential generated with (.+?) functional/g)].map(m => m[1].trim());
}

// PS-1: SIESTA busca <etiqueta>.vps, .psf y .psml, en ese orden, y usa el primero sin avisar.
export function resolvePseudoFile(label, files) {
  const found = ['vps', 'psf', 'psml'].map(e => `${label}.${e}`).filter(f => files.includes(f));
  if (!found.length) return { error: 'PSEUDO_FILE_NOT_FOUND' };
  return { file: found[0], ambiguous: found.length > 1 };
}

// D-2: en el manifiesto y en la carpeta de la corrida, el archivo de cada especie es exactamente <etiqueta>.<formato>.
export function manifestCheck(entries) {
  const findings = [];
  for (const e of entries) {
    const stem = e.filename.replace(/\.(psml|psf|vps)$/i, '');
    if (stem !== e.species) findings.push(`SPECIES_FILENAME_MISMATCH:${e.species}:${e.filename}`);
  }
  return { status: findings.length ? 'FAIL' : 'PASS', findings };
}
