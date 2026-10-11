// Parser for the main SIESTA standard output (SystemLabel.out / stdout), SIESTA 4.x - 5.x.
// Energies in eV, lengths in Ang, forces in eV/Ang, stress in eV/Ang^3 and kbar (as printed).
// The parser is a single pass line scanner; unknown lines are ignored, so truncated or
// crashed runs still yield everything printed up to the point of failure.
import { lines as splitLines, ffloat, nums, BOHR_ANG } from './util.js';

// ---------------------------------------------------------------- fdf helpers
/** fdf labels are case-insensitive and ignore '.', '-' and '_'. */
export function fdfKey(name) { return String(name).toLowerCase().replace(/[._-]/g, ''); }

/** Parse fdf text into {keys:{norm:{name,value,tokens}}, blocks:{norm:{name,lines}}, includes:[]} */
export function parseFDF(text) {
  const keys = {}, blocks = {}, includes = [], order = [];
  let block = null;
  for (const raw of splitLines(text)) {
    const ln = raw.replace(/[#!;].*$/, '').trim();
    if (!ln) continue;
    let m;
    if ((m = /^%block\s+(\S+)/i.exec(ln))) {
      block = { name: m[1], lines: [] };
      const rest = ln.slice(m[0].length).trim();
      if (rest.startsWith('<')) block.include = rest.slice(1).trim();
      blocks[fdfKey(m[1])] = block;
      order.push({ type: 'block', name: m[1] });
      continue;
    }
    if (/^%endblock/i.test(ln)) { block = null; continue; }
    if (block) { block.lines.push(ln); continue; }
    if ((m = /^%include\s+(\S+)/i.exec(ln))) { includes.push(m[1]); continue; }
    const toks = ln.split(/\s+/);
    const name = toks[0];
    const value = toks.slice(1).join(' ');
    keys[fdfKey(name)] = { name, value, tokens: toks.slice(1) };
    order.push({ type: 'key', name });
  }
  return { keys, blocks, includes, order };
}

/** Lookup helper: fdfGet(fdf, 'MeshCutoff') -> {name,value,tokens} | undefined */
export function fdfGet(fdf, name) { return fdf?.keys?.[fdfKey(name)]; }
export function fdfBlock(fdf, name) { return fdf?.blocks?.[fdfKey(name)]; }

// ---------------------------------------------------------------- small helpers
const stripPrefix = (s) => s.replace(/^\s*(siesta|timer|scf):\s?/, '');
const isIntTok = (t) => /^[-+]?\d+$/.test(t);
const LSYM = { s: 0, p: 1, d: 2, f: 3, g: 4 };

function normCol(name) {
  return name.replace(/\(.*?\)/g, '').replace(/[^\w]/g, '').replace(/^Eks$/i, 'E_KS') || name;
}

/** Split an SCF row's float part, coping with fused fixed-width fields ("33.736569-44.788847315.508565"). */
function splitScfValues(s, nExpected) {
  const ws = s.trim().split(/\s+/).filter(Boolean);
  if (ws.length === nExpected) return ws.map(ffloat);
  const six = s.match(/\*{4,}|[-+]?\d+\.\d{6}/g) || [];
  if (six.length === nExpected) return six.map(ffloat);
  return ws.length >= six.length ? ws.map(ffloat) : six.map(ffloat);
}

function parseSpinMoment(t) {
  const v = nums(t.replace(/[{},=|]/g, ' ').replace(/[A-Za-z:]+/g, ' '));
  if (/\|S\|\s*=\s*\{/.test(t) && v.length >= 4) return { S: v.slice(0, 3), abs: v[3] };
  if (v.length >= 4) return { abs: v[0], S: v.slice(1, 4) };
  if (v.length === 1) return { abs: Math.abs(v[0]), S: [0, 0, v[0]] };
  return null;
}

// ---------------------------------------------------------------- main parser
export function parseOut(text) {
  const L = splitLines(text);
  const R = {
    program: { version: null, executable: null, architecture: null, compiler: null, compilerFlags: null, parallelisations: null, features: [] },
    run: { start: null, end: null, directory: null, mode: null, nodes: 1, threads: null, parallelLines: [], completed: false, reading: null },
    systemName: null, systemLabel: null,
    fdf: null, fdfText: null,
    species: [],
    redata: {},
    spin: { config: null, nComponents: null },
    nAtoms: null, nOrbitals: null, nProjectors: null, nElectrons: null, ionicCharge: null, systemType: null,
    kgrid: null, pdosKgrid: null,
    mesh: null,
    mixing: {},
    optical: null,
    initialGeometry: null,
    steps: [],
    scf: [],
    energyDecomposition: null,
    finalEnergy: null,
    fermi: null,
    forces: null,
    stress: null,
    populations: { mulliken: null, mullikenOrbital: null, hirshfeld: null, voronoi: null },
    spinMoment: null,
    eigenvalues: null,
    basisBlock: null,
    timers: null,
    convergence: [],
    warnings: [],
    notes: [],
    units: { energy: 'eV', length: 'Ang', force: 'eV/Ang', stress: 'eV/Ang^3 (tensor), kbar (Voigt, pressure)', meshCutoff: 'Ry', kCutoff: 'Ang' },
  };

  let step = null;
  const newStep = (type, index) => {
    step = {
      index: R.steps.length, type, number: index,
      coordinates: null, cell: null, scf: [], scfConverged: null, scfIterations: null,
      eKS: null, eKSeggbox: null, freeEnergy: null, energyDecomposition: null,
      forces: null, maxForce: null, resForce: null, stressVoigtKbar: null, stress: null, pressure: null,
      enthalpy: null, temperatureIon: null, mesh: null,
    };
    R.steps.push(step);
    return step;
  };
  const ensureStep = () => step || newStep('single-point', 0);

  let curSpecies = null;
  const speciesBy = (label) => R.species.find((s) => s.label === label);
  let scfCols = null;
  let scfOldStyle = false;
  let kgridTarget = 'kgrid';
  let mullSpin = null;

  const readCell = (i) => {
    const cell = [];
    for (let k = 1; k <= 3; k++) cell.push(nums(stripPrefix(L[i + k] ?? '')).slice(0, 3));
    return cell;
  };

  for (let i = 0; i < L.length; i++) {
    const line = L[i];
    const t = line.trim();
    if (!t) continue;
    let m;

    // ---------------- header / program info
    if (i < 60) {
      if ((m = /^Version\s*:\s*(.*)$/.exec(t)) || (m = /^Siesta Version\s*:?\s*(.*)$/i.exec(t))) { R.program.version = m[1].trim(); continue; }
      if ((m = /^Executable\s*:\s*(.*)$/.exec(t))) { R.program.executable = m[1].trim(); continue; }
      if ((m = /^Architecture\s*:\s*(.*)$/.exec(t))) { R.program.architecture = m[1].trim(); continue; }
      if ((m = /^Compiler version\s*:\s*(.*)$/.exec(t))) { R.program.compiler = m[1].trim(); continue; }
      if ((m = /^Compiler flags\s*:\s*(.*)$/.exec(t))) { R.program.compilerFlags = m[1].trim(); continue; }
      if ((m = /^Parallelisations\s*:\s*(.*)$/.exec(t))) { R.program.parallelisations = m[1].trim(); continue; }
      if (/^(NetCDF|NetCDF-4|Lua|DFT-D3|ELPA|ELSI|PEXSI|MRRR|Wannier90|libxc|flook|fdict)[\w\s-]*support/i.test(t)) { R.program.features.push(t); continue; }
    }
    if (t.startsWith('*')) {
      if ((m = /^\*\s*Directory\s*:\s*(.*)$/.exec(t))) { R.run.directory = m[1].trim(); continue; }
      if (/Running in serial mode/i.test(t)) { R.run.mode = 'serial'; R.run.parallelLines.push(t); continue; }
      if ((m = /Running on\s+(\d+)\s+nodes in parallel/i.exec(t))) { R.run.mode = 'MPI'; R.run.nodes = +m[1]; R.run.parallelLines.push(t); continue; }
      if ((m = /Running\s+(\d+)\s+OpenMP threads/i.exec(t))) { R.run.threads = +m[1]; R.run.parallelLines.push(t); continue; }
      if (/OpenMP|MPI|processes|threads|nodes/i.test(t) && !/\*{5}/.test(t)) { R.run.parallelLines.push(t); continue; }
    }
    if ((m = /^>>\s*Start of run:\s*(.*)$/.exec(t))) { R.run.start = m[1].trim().replace(/\s+/g, ' '); continue; }
    if ((m = /^>>\s*End of run:\s*(.*)$/.exec(t))) { R.run.end = m[1].trim().replace(/\s+/g, ' '); continue; }
    if (/^Job completed/.test(t)) { R.run.completed = true; continue; }
    if ((m = /^reinit: Reading from (.*)$/.exec(t))) { R.run.reading = m[1].trim(); continue; }

    // ---------------- input echo
    if (/\*+\s*Dump of input data file\s*\*+/.test(t)) {
      const buf = [];
      let j = i + 1;
      for (; j < L.length; j++) { if (/\*+\s*End of input data file\s*\*+/.test(L[j])) break; buf.push(L[j]); }
      R.fdfText = buf.join('\n');
      R.fdf = parseFDF(R.fdfText);
      i = j;
      continue;
    }
    if ((m = /^reinit: System Name:\s*(.*)$/.exec(t))) { R.systemName = m[1].trim() || null; continue; }
    if ((m = /^reinit: System Label:\s*(.*)$/.exec(t))) { R.systemLabel = m[1].trim(); continue; }

    // ---------------- species / pseudopotentials / basis
    if ((m = /^Species number:\s*(\d+)\s+Atomic number:\s*(-?\d+)\s+Label:\s*(\S+)/.exec(t))) {
      R.species.push({
        index: +m[1], Z: +m[2], label: m[3], pseudoFile: null, pseudoFormat: null, psmlVersion: null, libxcIds: null,
        generationMethod: null, xc: null, valenceCharge: null, pseudizedShells: [], groundStateConfig: null,
        kb: [], nKB: null, basis: [], nOrbitals: null, vnaCutoff: null, warnings: [],
      });
      continue;
    }
    if ((m = /^---- Processing specs for species:\s*(\S+)/.exec(t)) || (m = /^atom: Called for\s+(\S+)/.exec(t))) {
      curSpecies = speciesBy(m[1]) || curSpecies;
      continue;
    }
    if ((m = /^Ground state valence configuration.*?:\s*(.*)$/.exec(t))) {
      const sp = R.species[R.species.length - 1];
      if (sp) sp.groundStateConfig = m[1].trim();
      continue;
    }
    if ((m = /^Reading pseudopotential information in (.*?) (?:form )?from:?/.exec(t))) {
      if (curSpecies) { curSpecies.pseudoFormat = m[1].trim(); curSpecies.pseudoFile = (L[i + 1] || '').trim(); }
      i++;
      continue;
    }
    if (curSpecies) {
      if ((m = /^PSML file version:\s*(\S+)/.exec(t))) { curSpecies.psmlVersion = m[1]; continue; }
      if ((m = /^Using libxc ids:\s*(.*)$/.exec(t))) { curSpecies.libxcIds = nums(m[1]); continue; }
      if (/^Pseudized shells:/.test(t)) {
        for (let j = i + 1; j < L.length; j++) {
          const mm = /^\s*(\d)([spdfg])\(\s*([-\d.]+)\)\s*rc:\s*([-\d.]+)/.exec(L[j]);
          if (!mm) { i = j - 1; break; }
          curSpecies.pseudizedShells.push({ n: +mm[1], l: LSYM[mm[2]], lsym: mm[2], occupation: ffloat(mm[3]), rc: ffloat(mm[4]) });
        }
        continue;
      }
      if (/^read_vps: Pseudopotential generation method:/.test(t)) {
        curSpecies.generationMethod = (L[i + 1] || '').replace(/^read_vps:\s*/, '').trim().replace(/\s+/g, ' ');
        i++; continue;
      }
      if ((m = /^Valence charge in pseudo generation:\s*(\S+)/.exec(t)) || (m = /^Valence configuration for ps generation:.*Total charge:\s*(\S+)/.exec(t))) {
        curSpecies.valenceCharge = ffloat(m[1]); continue;
      }
      if (/^xc_check: Exchange-correlation functional:/.test(t)) {
        curSpecies.xc = (L[i + 1] || '').replace(/^xc_check:\s*/, '').trim(); i++; continue;
      }
      if ((m = /^xc_check: (WARNING.*)$/.exec(t))) { curSpecies.warnings.push(m[1]); R.warnings.push({ line: i + 1, text: t }); continue; }
      if ((m = /^l=\s*(\d+)\s+rc=\s*(\S+)\s+(?:el=\s*(\S+)\s+)?Ekb=\s*(\S+)(?:\s+kbcos=\s*(\S+))?/.exec(t))) {
        curSpecies.kb.push({ l: +m[1], rc: ffloat(m[2]), el: m[3] != null ? ffloat(m[3]) : null, ekb: ffloat(m[4]), kbcos: m[5] != null ? ffloat(m[5]) : null });
        continue;
      }
      if ((m = /Total number of\s+Kleinman-Bylander projectors:\s*(\d+)/.exec(t))) { curSpecies.nKB = +m[1]; continue; }
      if ((m = /^(SPLIT|POLgen|NODES|NONODES|FILTERET|USER): (?:Basis orbitals for state|Polarization orbital for state)\s+(\S+)/.exec(t))) {
        const st = m[2];
        const mm = /^(\d)([spdfg])$/.exec(st);
        curSpecies.basis.push({ state: st, n: mm ? +mm[1] : null, l: mm ? LSYM[mm[2]] : null, polarization: m[1] === 'POLgen', zetas: [] });
        continue;
      }
      if ((m = /^izeta\s*=\s*(\d+)/.exec(t))) {
        const sh = curSpecies.basis[curSpecies.basis.length - 1];
        if (sh) {
          const z = { izeta: +m[1] };
          for (let j = i + 1; j < Math.min(L.length, i + 10); j++) {
            const kv = /^\s*([\w() ]+?)\s*=\s*(\S+)\s*$/.exec(L[j]);
            if (!kv || /izeta/.test(L[j])) break;
            z[kv[1].trim().replace(/\s+/g, '_')] = ffloat(kv[2]);
          }
          sh.zetas.push(z);
        }
        continue;
      }
      if ((m = /^atom: Total number of Sankey-type orbitals:\s*(\d+)/.exec(t))) { curSpecies.nOrbitals = +m[1]; continue; }
      if ((m = /^Vna:\s*Cut-off radius for the neutral-atom potential:\s*(\S+)/.exec(t))) { curSpecies.vnaCutoff = ffloat(m[1]); continue; }
    }
    if (/^%block PAO\.Basis/i.test(t)) {
      const buf = [t];
      let j = i + 1;
      for (; j < L.length; j++) { buf.push(L[j].trimEnd()); if (/^\s*%endblock/i.test(L[j])) break; }
      R.basisBlock = buf.join('\n');
      i = j; continue;
    }

    // ---------------- system setup
    if ((m = /^initatomlists: Number of atoms, orbitals, and projectors:\s*(\d+)\s+(\d+)\s+(\d+)/.exec(t))) {
      R.nAtoms = +m[1]; R.nOrbitals = +m[2]; R.nProjectors = +m[3]; continue;
    }
    if ((m = /^Total number of electrons:\s*(\S+)/.exec(t))) { R.nElectrons = ffloat(m[1]); continue; }
    if ((m = /^Total ionic charge:\s*(\S+)/.exec(t))) { R.ionicCharge = ffloat(m[1]); continue; }
    if ((m = /^siesta: System type\s*=\s*(\S+)/.exec(t))) { R.systemType = m[1]; continue; }
    if ((m = /^redata:\s*(.+?)\s*=\s*(.*)$/.exec(t))) {
      const k = m[1].trim(), v = m[2].trim();
      R.redata[k] = v;
      if (/^Spin configuration/.test(k)) R.spin.config = v;
      if (/^Number of spin components/.test(k)) R.spin.nComponents = parseInt(v, 10);
      if (/^Mesh Cutoff/.test(k)) R.mesh = { ...(R.mesh || {}), cutoffInput: ffloat(v) };
      if (/^Electronic Temperature/.test(k)) R.electronicTemperature = { value: ffloat(v), unit: v.replace(/^[\d.eE+-]+\s*/, '') };
      if (/^Method of Calculation/.test(k)) R.method = v;
      if (/^Dynamics option/.test(k)) R.dynamics = v;
      continue;
    }
    if ((m = /^redata: (.+?)\s*$/.exec(t))) { R.redata[m[1]] = true; continue; }
    if ((m = /^mix\.SCF:\s*(.+?)\s*=\s*(.*)$/.exec(t))) { R.mixing[m[1].trim()] = m[2].trim(); continue; }
    if ((m = /^siesta: (PDOS )?k-grid: Number of k-points\s*=\s*(\d+)/.exec(t))) {
      kgridTarget = m[1] ? 'pdosKgrid' : 'kgrid';
      R[kgridTarget] = { nk: +m[2], supercell: [], displacement: [], cutoff: null };
      continue;
    }
    if ((m = /^siesta: (PDOS )?k-cutoff \(effective\)\s*=\s*(\S+)/.exec(t))) {
      const g = R[m[1] ? 'pdosKgrid' : 'kgrid']; if (g) g.cutoff = ffloat(m[2]); continue;
    }
    if ((m = /^siesta: k-grid:\s+(.*)$/.exec(t))) {
      const g = R[kgridTarget];
      const v = nums(m[1]);
      if (g && v.length === 4 && g.supercell.length < 3) { g.supercell.push(v.slice(0, 3)); g.displacement.push(v[3]); }
      continue;
    }
    if ((m = /^siesta: (PDOS )?k-points from (.*)$/.exec(t))) { const g = R[m[1] ? 'pdosKgrid' : 'kgrid']; if (g) g.source = m[2].trim(); continue; }
    if ((m = /^InitMesh: MESH\s*=\s*(\d+)\s*x\s*(\d+)\s*x\s*(\d+)/.exec(t))) {
      R.mesh = { ...(R.mesh || {}), mesh: [+m[1], +m[2], +m[3]] };
      if (step) step.mesh = [+m[1], +m[2], +m[3]];
      continue;
    }
    if ((m = /^InitMesh: Mesh cutoff \(required, used\)\s*=\s*(\S+)\s+(\S+)/.exec(t))) {
      R.mesh = { ...(R.mesh || {}), cutoffRequired: ffloat(m[1]), cutoffUsed: ffloat(m[2]), unit: 'Ry' }; continue;
    }
    if ((m = /^Optical:\s*(.+?)\s*=\s*(.*)$/.exec(t))) { R.optical = R.optical || {}; R.optical[m[1].trim()] = m[2].trim(); continue; }
    if ((m = /^Optical: Checking f-sum rule\s+(\S+)/.exec(t))) { R.optical = R.optical || {}; R.optical.fSumRule = ffloat(m[1]); continue; }

    // ---------------- geometry
    if (/^siesta: Atomic coordinates \(Bohr\) and species/.test(t)) {
      const pos = [], sp = [];
      for (let j = i + 1; j < L.length; j++) {
        const mm = /^siesta:\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\d+)\s*$/.exec(L[j]);
        if (!mm) { i = j - 1; break; }
        pos.push([ffloat(mm[1]), ffloat(mm[2]), ffloat(mm[3])].map((v) => v * BOHR_ANG));
        sp.push(+mm[4]);
      }
      R.initialGeometry = { positions: pos, species: sp, units: 'Ang' };
      continue;
    }
    if ((m = /^\s*Begin\s+(.+?)\s*=\s*(\d+)\s*$/.exec(line)) || (m = /^\s*(Single-point calculation)\s*$/.exec(line))) {
      newStep(m[1].trim(), m[2] != null ? +m[2] : 0);
      continue;
    }
    if ((m = /^outcoor:\s*(.*?)atomic coordinates\s*\((\w+)\)/i.exec(t))) {
      const kind = m[1].trim() || 'Atomic';
      const unit = m[2].toLowerCase();
      const coords = [], labels = [], spIdx = [];
      let j = i + 1;
      for (; j < L.length; j++) {
        const toks = L[j].trim().split(/\s+/);
        if (toks.length < 3 || !toks.slice(0, 3).every((x) => !Number.isNaN(ffloat(x)) && /\d/.test(x))) break;
        coords.push(toks.slice(0, 3).map(ffloat));
        spIdx.push(toks[3] != null ? parseInt(toks[3], 10) : null);
        labels.push(toks[5] ?? null);
      }
      i = j - 1;
      const entry = { kind, unit, coords, species: spIdx, labels };
      if (/relaxed|final/i.test(kind)) { R.finalCoordinates = entry; R.convergence.push({ line: i + 1, text: t }); }
      else ensureStep().coordinates = entry;
      continue;
    }
    if (/^outcell: Unit cell vectors \(Ang\):/.test(t)) {
      const cell = readCell(i);
      if (step) step.cell = cell;
      R.cell = cell;
      i += 3; continue;
    }
    if ((m = /^outcell: Cell volume \(Ang\*\*3\)\s*:\s*(\S+)/.exec(t))) { R.volume = ffloat(m[1]); if (step) step.volume = ffloat(m[1]); continue; }
    if ((m = /^outcell: Cell vector modules \(Ang\)\s*:\s*(.*)$/.exec(t))) { R.cellLengths = nums(m[1]); continue; }
    if ((m = /^outcell: Cell angles \(23,13,12\) \(deg\):\s*(.*)$/.exec(t))) { R.cellAngles = nums(m[1]); continue; }

    // ---------------- SCF table
    if (/\biscf\b/.test(t) && /E_?KS|Eharris|FreeEng/i.test(t) && !/=/.test(t)) {
      const toks = stripPrefix(t).replace(/^scf:\s*/, '').trim().split(/\s+/);
      scfCols = toks.map(normCol);
      scfOldStyle = /^siesta:/.test(t);
      continue;
    }
    if (scfCols && ((m = /^scf:\s*(\d+)(.*)$/.exec(t)) || (scfOldStyle && (m = /^siesta:\s+(\d+)\s+([-\d.\s*]+)$/.exec(t))))) {
      const vals = splitScfValues(m[2], scfCols.length - 1);
      const row = { iscf: +m[1] };
      scfCols.slice(1).forEach((c, k) => { row[c] = vals[k] ?? NaN; });
      const st = ensureStep();
      row.step = st.index;
      st.scf.push(row);
      R.scf.push(row);
      continue;
    }
    if ((m = /^siesta: iscf\s*=\s*(\d+)/.exec(t))) {
      // order-N / OMM style: next line "Eharris(eV) = x E_KS(eV) = y dDmax = z"
      const row = { iscf: +m[1] };
      const nx = L[i + 1] || '';
      const re = /([\w()]+)\s*=\s*(\S+)/g;
      let mm;
      while ((mm = re.exec(nx))) row[normCol(mm[1])] = ffloat(mm[2]);
      const st = ensureStep();
      row.step = st.index;
      st.scf.push(row); R.scf.push(row);
      i++; continue;
    }
    if (/spin moment:/i.test(t)) {
      const sm = parseSpinMoment(t);
      const st = ensureStep();
      const last = st.scf[st.scf.length - 1];
      if (sm && last) last.spinMoment = sm;
      if (sm) R.spinMoment = sm;
      continue;
    }
    if ((m = /Total spin polarization.*=\s*(\S+)/i.exec(t))) { R.spinMoment = { abs: Math.abs(ffloat(m[1])), S: [0, 0, ffloat(m[1])] }; continue; }
    if ((m = /^SCF cycle converged after\s+(\d+)\s+iterations/.exec(t))) {
      const st = ensureStep(); st.scfConverged = true; st.scfIterations = +m[1];
      R.convergence.push({ line: i + 1, text: t }); continue;
    }
    if (/SCF_NOT_CONV|SCF did not converge|SCF cycle not converged/i.test(t)) {
      const st = ensureStep(); st.scfConverged = false; st.scfIterations = st.scf.length;
      R.convergence.push({ line: i + 1, text: t }); continue;
    }
    if ((m = /^SCF Convergence by (.*) criterion/.exec(t))) { R.convergence.push({ line: i + 1, text: t }); ensureStep().scfCriterion = m[1]; continue; }
    if ((m = /^max \|(DM|H|EDM)_out - \1_in\|.*?:\s*(\S+)/.exec(t))) { ensureStep()[`max_d${m[1]}`] = ffloat(m[2]); continue; }
    if (/converged|Converged|convergence/.test(t) && /^(cgvc|outcoor|siesta|fire|broyden|cell|geom|relax)/i.test(t)) { R.convergence.push({ line: i + 1, text: t }); continue; }
    if (/^cgvc: Finished line minimization/.test(t)) { R.convergence.push({ line: i + 1, text: t }); continue; }

    // ---------------- energies
    if (/Program's energy decomposition \(eV\):/.test(t)) {
      const dec = {};
      let j = i + 1;
      for (; j < L.length; j++) {
        const mm = /^siesta:\s+(\S+(?:\s\S+)?)\s*=\s*(\S+)\s*$/.exec(L[j].trim());
        if (!mm) break;
        dec[mm[1].trim()] = ffloat(mm[2]);
      }
      i = j - 1;
      R.energyDecomposition = dec;
      if (step) step.energyDecomposition = dec;
      continue;
    }
    if (/^siesta: Final energy \(eV\):/.test(t)) {
      const fe = {};
      let j = i + 1;
      for (; j < L.length; j++) {
        const mm = /^siesta:\s+(.+?)\s*=\s*(\S+)\s*$/.exec(L[j].trim());
        if (!mm) break;
        fe[mm[1].trim()] = ffloat(mm[2]);
      }
      i = j - 1;
      R.finalEnergy = fe;
      if (fe.Fermi != null) R.fermi = fe.Fermi;
      continue;
    }
    if ((m = /^siesta: E_KS\(eV\)\s*=\s*(\S+)/.exec(t))) { ensureStep().eKS = ffloat(m[1]); continue; }
    if ((m = /^siesta: E_KS - E_eggbox\s*=\s*(\S+)/.exec(t))) { ensureStep().eKSeggbox = ffloat(m[1]); continue; }
    if ((m = /^siesta: Fermi energy\s*=\s*(\S+)/.exec(t))) { R.fermi = ffloat(m[1]); continue; }
    if ((m = /^siesta: Temp_ion\s*=\s*(\S+)/.exec(t))) { ensureStep().temperatureIon = ffloat(m[1]); continue; }
    if ((m = /^\(Free\)E \+ p\*V \(eV\/cell\)\s+(\S+)/.exec(t))) { ensureStep().freeEnthalpy = ffloat(m[1]); continue; }
    if ((m = /^Target enthalpy \(eV\/cell\)\s+(\S+)/.exec(t))) { ensureStep().enthalpy = ffloat(m[1]); continue; }

    // ---------------- forces & stress
    if (/^(siesta: )?Atomic forces \(eV\/Ang\):/.test(t)) {
      const f = [];
      const res = { atoms: f, total: null, max: null, res: null, maxConstrained: null };
      let j = i + 1;
      for (; j < L.length; j++) {
        const s = stripPrefix(L[j]).trim();
        if (!s) break;
        if (/^-{5,}/.test(s)) continue;
        const toks = s.split(/\s+/);
        if (isIntTok(toks[0]) && toks.length >= 4) { f.push(toks.slice(1, 4).map(ffloat)); continue; }
        if (toks[0] === 'Tot') { res.total = toks.slice(1, 4).map(ffloat); continue; }
        if (toks[0] === 'Max') { if (/constrained/.test(s)) res.maxConstrained = ffloat(toks[1]); else res.max = ffloat(toks[1]); continue; }
        if (toks[0] === 'Res') { res.res = ffloat(toks[1]); continue; }
        break;
      }
      i = j - 1;
      if (f.length) {
        const norms = f.map((v) => Math.hypot(...v));
        res.maxNorm = Math.max(...norms);
        if (res.max == null) res.max = Math.max(...f.flat().map(Math.abs));
      }
      R.forces = res;
      const st = ensureStep();
      if (!/^siesta:/.test(t) || !st.forces) {
        st.forces = res;
        st.maxForce = res.maxConstrained ?? res.max;
        st.maxForceNorm = res.maxNorm ?? null;
        st.resForce = res.res;
      }
      continue;
    }
    if ((m = /^Stress tensor Voigt\[x,y,z,yz,xz,xy\] \(kbar\):\s*(.*)$/.exec(t))) {
      const v = nums(m[1]);
      ensureStep().stressVoigtKbar = v;
      R.stressVoigtKbar = v;
      continue;
    }
    if ((m = /^siesta: Stress tensor \((static|total)\) \(eV\/Ang\*\*3\):/.exec(t))) {
      const tens = readCell(i);
      R.stress = R.stress || {};
      R.stress[m[1]] = tens;
      if (step) { step.stress = step.stress || {}; step.stress[m[1]] = tens; }
      i += 3; continue;
    }
    if ((m = /^siesta: Pressure \((static|total)\):\s*(\S+)?\s*(kBar)?/.exec(t))) {
      const kind = m[1];
      let p = null;
      if (m[2] && m[3]) p = { kbar: ffloat(m[2]) };
      else {
        for (let j = i + 1; j < Math.min(L.length, i + 6); j++) {
          const mm = /^siesta:\s+(\S+)\s+(\S+)\s+kBar/.exec(L[j].trim());
          if (mm) { p = { kbar: ffloat(mm[1]), kbarMolecule: ffloat(mm[2]) }; i = j; break; }
        }
      }
      if (p) {
        R.pressure = R.pressure || {}; R.pressure[kind] = p;
        if (step) { step.pressure = step.pressure || {}; step.pressure[kind] = p; }
      }
      continue;
    }
    if ((m = /^siesta: Cell volume\s*=\s*(\S+)/.exec(t))) { R.volume = ffloat(m[1]); continue; }

    // ---------------- populations
    if ((m = /^(Mulliken|Hirshfeld|Voronoi)\s+(?:Net\s+)?Atomic Populations:/.exec(t))) {
      const kind = m[1].toLowerCase();
      const hdr = (L[i + 1] || '').trim();
      const names = hdr.replace(/^Atom\s*#?/, '').replace(/\[[^\]]*\]/g, ' ').trim().split(/\s+/).filter((x) => x && x !== 'Species');
      const atoms = [];
      let total = null;
      let j = i + 2;
      for (; j < L.length; j++) {
        const s = L[j].trim();
        if (!s) break;
        if (/^-{5,}/.test(s)) continue;
        const toks = s.split(/\s+/);
        if (toks[0] === 'Total') { total = toks.slice(1).map(ffloat); continue; }
        if (!isIntTok(toks[0])) break;
        const row = { atom: +toks[0] };
        const numeric = toks.slice(1).filter((x) => !Number.isNaN(ffloat(x)) && /\d/.test(x));
        names.forEach((nm, k) => { row[nm.replace(/\W/g, '')] = ffloat(numeric[k]); });
        const last = toks[toks.length - 1];
        if (Number.isNaN(ffloat(last))) row.species = last;
        atoms.push(row);
      }
      i = j - 1;
      R.populations[kind] = { columns: names, atoms, total };
      continue;
    }
    if (/^mulliken: Atomic and Orbital Populations:/.test(t)) { mullSpin = null; R.populations.mullikenOrbital = []; continue; }
    if ((m = /^mulliken: Spin (UP|DOWN)/i.exec(t))) { mullSpin = m[1].toLowerCase(); continue; }
    if ((m = /^Species:\s*(\S+)/.exec(t)) && R.populations.mullikenOrbital) {
      const spLabel = m[1];
      let j = i + 1;
      while (j < L.length && !L[j].trim()) j++;
      const hdr = (L[j] || '').trim();
      if (/^Atom\s+Qatom\s+Qorb/.test(hdr)) {
        const orbNames = [];
        j++;
        for (; j < L.length; j++) {
          const toks = L[j].trim().split(/\s+/);
          if (!toks[0] || isIntTok(toks[0])) break;
          orbNames.push(...toks);
        }
        const atoms = [];
        let cur = null;
        for (; j < L.length; j++) {
          const s = L[j].trim();
          if (!s || /^mulliken:/.test(s) || /^Species:/.test(s)) break;
          const toks = s.split(/\s+/);
          if (isIntTok(toks[0]) && (!cur || cur.qorb.length >= orbNames.length)) {
            cur = { atom: +toks[0], qatom: ffloat(toks[1]), qorb: toks.slice(2).map(ffloat) };
            atoms.push(cur);
          } else if (cur) cur.qorb.push(...toks.map(ffloat));
        }
        R.populations.mullikenOrbital.push({ spin: mullSpin, species: spLabel, orbitals: orbNames, atoms });
        i = j - 1;
      } else if (/^Atom\s+Orb\s+Charge\s+Spin\s+Svec/.test(hdr)) {
        const rows = [];
        for (j = j + 1; j < L.length; j++) {
          const s = L[j].trim();
          if (!s) continue;
          if (/^-{5,}/.test(s)) continue;
          const toks = s.split(/\s+/);
          if (toks[0] === 'Total') break;
          if (!isIntTok(toks[0])) break;
          if (toks[1] === 'Total') rows.push({ atom: +toks[0], orbital: 'Total', charge: ffloat(toks[2]), spin: ffloat(toks[3]), Svec: toks.slice(4, 7).map(ffloat) });
          else rows.push({ atom: +toks[0], index: +toks[1], orbital: toks[2], charge: ffloat(toks[3]), spin: ffloat(toks[4]), Svec: toks.slice(5, 8).map(ffloat) });
        }
        R.populations.mullikenOrbital.push({ spin: 'noncollinear', species: spLabel, rows });
        i = j;
      }
      continue;
    }
    if ((m = /^mulliken: Qtot\s*=\s*(\S+)/.exec(t))) { R.populations.mullikenQtot = R.populations.mullikenQtot || {}; R.populations.mullikenQtot[mullSpin || 'total'] = ffloat(m[1]); continue; }

    // ---------------- eigenvalues printed in the output
    if (/^siesta: Eigenvalues \(eV\):/.test(t)) {
      const eig = [];
      let j = i + 1;
      if (/ik\s+is\s+eps/.test(L[j] || '')) j++;
      let cur = null;
      for (; j < L.length; j++) {
        const s = L[j].trim();
        if (!s || /^siesta:/.test(s)) break;
        const toks = s.split(/\s+/);
        const startsRow = isIntTok(toks[0]) && isIntTok(toks[1]);
        if (startsRow) {
          const ik = +toks[0], is = +toks[1];
          cur = { ik, is, e: toks.slice(2).map(ffloat) };
          eig.push(cur);
        } else if (cur) cur.e.push(...toks.map(ffloat));
        else break;
      }
      i = j - 1;
      const ns = Math.max(...eig.map((r) => r.is));
      R.eigenvalues = { nSpin: ns, nk: Math.max(...eig.map((r) => r.ik)), eig: Array.from({ length: ns }, (_, s) => eig.filter((r) => r.is === s + 1).map((r) => r.e)) };
      continue;
    }

    // ---------------- timers
    if ((m = /^timer: Elapsed wall time \(sec\)\s*=\s*(\S+)/.exec(t))) { R.timers = R.timers || { routines: [] }; R.timers.wallTime = ffloat(m[1]); continue; }
    if (/Routine\s+Calls\s+Time\/call\s+Tot\.time\s+%/.test(t)) {
      R.timers = R.timers || { routines: [] };
      R.timers.routines = [];
      let j = i + 1;
      for (; j < L.length; j++) {
        const s = stripPrefix(L[j]).trim();
        const toks = s.split(/\s+/);
        if (toks.length < 5 || !isIntTok(toks[toks.length - 4])) break;
        const n = toks.length;
        R.timers.routines.push({ name: toks.slice(0, n - 4).join(' '), calls: +toks[n - 4], timePerCall: ffloat(toks[n - 3]), total: ffloat(toks[n - 2]), percent: ffloat(toks[n - 1]) });
      }
      i = j - 1;
      continue;
    }
    if ((m = /^timer: Routine,Calls,Time,% = (\S+)\s+(\d+)\s+(\S+)\s+(\S+)/.exec(t))) {
      R.timers = R.timers || { routines: [] };
      (R.timers.inline = R.timers.inline || []).push({ name: m[1], calls: +m[2], time: ffloat(m[3]), percent: ffloat(m[4]) });
      continue;
    }

    // ---------------- warnings / notes
    if (/WARNING|Warning:|^ERROR|Stopping Program|^\*\*\* /.test(t) && !/TS CHECKS AND WARNINGS/.test(t)) { R.warnings.push({ line: i + 1, text: t }); continue; }
    if (/^NOTE[: ]/.test(t)) { R.notes.push({ line: i + 1, text: t }); continue; }
  }

  // ---------------- post-processing
  for (const st of R.steps) {
    const last = st.scf[st.scf.length - 1];
    if (last) {
      st.freeEnergy = last.FreeEng ?? null;
      st.fermi = last.Ef ?? null;
      if (st.eKS == null && last.E_KS != null) st.eKS = last.E_KS;
    }
    // the decomposition printed inside a step is the pre-SCF one; the converged energy is E_KS
    st.etot = st.eKS ?? st.energyDecomposition?.Etot ?? null;
    if (!st.pressure && st.stressVoigtKbar) {
      const v = st.stressVoigtKbar;
      st.pressure = { fromVoigt: { kbar: -(v[0] + v[1] + v[2]) / 3 } };
    }
  }
  if (R.steps.length && R.finalEnergy?.Total != null) R.steps.at(-1).etot = R.finalEnergy.Total;
  R.nSteps = R.steps.length;
  R.final = {
    etot: R.finalEnergy?.Total ?? R.energyDecomposition?.Etot ?? R.steps.at(-1)?.eKS ?? null,
    freeEnergy: R.energyDecomposition?.FreeEng ?? R.steps.at(-1)?.freeEnergy ?? null,
    eHarris: R.energyDecomposition?.Eharris ?? null,
    fermi: R.fermi ?? R.steps.at(-1)?.fermi ?? null,
    scfConverged: R.steps.length ? R.steps.at(-1).scfConverged : null,
    maxForce: R.steps.at(-1)?.maxForce ?? null,
    pressureKbar: R.pressure?.total?.kbar ?? R.pressure?.static?.kbar ?? null,
  };
  if (R.fermi == null) R.fermi = R.final.fermi;
  // geometry-optimization / MD trajectory summary
  R.trajectory = R.steps.map((s) => ({
    step: s.number, type: s.type, eKS: s.eKS, etot: s.etot, freeEnergy: s.freeEnergy, maxForce: s.maxForce,
    scfIterations: s.scfIterations ?? s.scf.length, scfConverged: s.scfConverged, temperatureIon: s.temperatureIon,
    pressureKbar: s.pressure?.total?.kbar ?? s.pressure?.static?.kbar ?? s.pressure?.fromVoigt?.kbar ?? null, volume: s.volume ?? null,
  }));
  // a few fdf conveniences
  if (R.fdf) {
    const g = (k) => fdfGet(R.fdf, k)?.value;
    R.input = {
      systemLabel: g('SystemLabel'), systemName: g('SystemName'), xcFunctional: g('XC.functional'), xcAuthors: g('XC.authors'),
      basisSize: g('PAO.BasisSize'), meshCutoff: g('MeshCutoff'), spin: g('Spin') ?? g('SpinPolarized'),
      opticalPolarization: g('Optical.PolarizationType'), mdType: g('MD.TypeOfRun'),
    };
  }
  R.spin.polarized = R.spin.nComponents != null ? R.spin.nComponents > 1 : (R.scf.some((r) => r.spinMoment) || null);
  R.spin.noncollinear = R.spin.nComponents != null ? R.spin.nComponents > 2 : null;
  R.isRelaxation = R.steps.length > 1 && /CG|FIRE|Broyden|opt/i.test(R.steps[1]?.type ?? R.dynamics ?? '');
  R.isMD = /MD step/i.test(R.steps[0]?.type ?? '');
  return R;
}
