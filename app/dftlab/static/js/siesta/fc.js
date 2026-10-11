// Lector del archivo .FC de SIESTA (MD.TypeOfRun FC): constantes de fuerza por diferencias finitas.
//
// Formato (SIESTA 4.x–5.x): una línea de encabezado
//   "Force constants matrix. n_atoms, displacement [Ang]:   16  0.02"   (versiones antiguas: solo "Force constants matrix")
// y luego, para cada átomo desplazado ia = MD.FCFirst … MD.FCLast, cada dirección x, y, z y cada signo (−, +),
// un bloque de n_atoms líneas con tres números: −ΔF_{jβ}/Δu_{iα} en eV/Å² (fuerza del átomo j al mover i).
// Promediar − y + da la derivada centrada y cancela la fuerza residual de la geometría sin desplazar.

/**
 * parseFC(text, {nAtoms?}) → {nAtoms, displ (Å|null), nDisplaced, blocks: [Float64Array(3·nAtoms)] en orden de archivo}
 * nAtoms se lee del encabezado; en archivos antiguos hay que pasarlo (o se deduce si se desplazaron todos los átomos).
 */
export function parseFC(text, { nAtoms = null } = {}) {
  const lines = text.split(/\r?\n/);
  let i = 0; while (i < lines.length && !lines[i].trim()) i++;
  const head = lines[i] || '';
  if (!/force\s+constant/i.test(head)) throw new Error('No parece un .FC de SIESTA: falta "Force constants matrix" en la primera línea.');
  const m = /:\s*(\d+)\s+([-+0-9.eEdD]+)/.exec(head);
  let na = nAtoms ?? (m ? +m[1] : null);
  const displ = m ? parseFloat(m[2].replace(/[dD]/, 'e')) : null;
  const nums = [];
  for (const l of lines.slice(i + 1)) {
    const t = l.trim(); if (!t) continue;
    const v = t.split(/\s+/).map(s => parseFloat(s.replace(/[dD]/, 'e')));
    if (v.length !== 3 || v.some(x => !Number.isFinite(x))) throw new Error(`Línea no reconocida en el .FC: "${t.slice(0, 60)}"`);
    nums.push(v);
  }
  if (!na) { const r = Math.sqrt(nums.length / 6); if (Number.isInteger(r)) na = r; else throw new Error('El encabezado no trae el número de átomos: indícalo.'); }
  if (nums.length % (6 * na)) throw new Error(`${nums.length} filas no es múltiplo de 6·${na}: ¿la corrida terminó? (un bloque por átomo, dirección y signo)`);
  const blocks = [];
  for (let b = 0; b < nums.length / na; b++) { const f = new Float64Array(3 * na); for (let j = 0; j < na; j++) for (let k = 0; k < 3; k++) f[3 * j + k] = nums[b * na + j][k]; blocks.push(f); }
  return { nAtoms: na, displ, nDisplaced: blocks.length / 6, blocks };
}

/**
 * Filas de constantes de fuerza promediando ±: [{atom (0-based), rows[α] = Float64Array(3·nAtoms), asym}]
 * first = MD.FCFirst (1-based, por defecto 1). asym = máx |Φ⁻ − Φ⁺| / 2, refleja la fuerza residual sin desplazar y la anarmonicidad.
 */
export function fcRows(fc, first = 1) {
  const out = [], na = fc.nAtoms;
  for (let d = 0; d < fc.nDisplaced; d++) {
    const rows = []; let asym = 0;
    for (let al = 0; al < 3; al++) {
      const mi = fc.blocks[6 * d + 2 * al], pl = fc.blocks[6 * d + 2 * al + 1], r = new Float64Array(3 * na);
      for (let k = 0; k < 3 * na; k++) { r[k] = (mi[k] + pl[k]) / 2; asym = Math.max(asym, Math.abs(mi[k] - pl[k]) / 2); }
      rows.push(r);
    }
    out.push({ atom: first - 1 + d, rows, asym });
  }
  return out;
}
