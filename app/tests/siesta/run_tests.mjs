#!/usr/bin/env node
// Node test runner for the SIESTA browser parsers (dftlab/static/js/siesta).
//   node tests/siesta/run_tests.mjs
// Parses every fixture and compares key numbers with fixtures/reference.json, which is
// produced independently in Python (sisl / numpy / regex) by make_reference.py.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../../dftlab/static/js/siesta/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures');
const REF = JSON.parse(fs.readFileSync(path.join(FIX, 'reference.json'), 'utf8'));
const read = (...p) => fs.readFileSync(path.join(FIX, ...p));
const txt = (...p) => fs.readFileSync(path.join(FIX, ...p), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) pass++;
  else { fail++; failures.push(`${name} ${detail}`); }
}
function close(name, got, want, tol = 1e-6, rel = false) {
  const ok = Number.isFinite(got) && Number.isFinite(want) && Math.abs(got - want) <= (rel ? tol * Math.max(1, Math.abs(want)) : tol);
  check(name, ok, `got ${got} want ${want} (tol ${tol}${rel ? ' rel' : ''})`);
}
function eq(name, got, want) { check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
const section = (s) => console.log(`\n== ${s}`);

// ------------------------------------------------------------------ 1. every fixture parses
section('detectAndParse on every fixture');
const expectKind = {
  '.out': 'out', '.bands': 'bands', '.EIG': 'eig', '.KP': 'kp', '.PDOS': 'pdos', '.xml': null, '.DOS': 'dos', '.EPSIMG': 'epsimg',
  '.fdf': 'fdf', '.json': 'dftlab-pack', '.ion': 'ion', '.psf': 'psf', '.psml': 'psml', '.MDE': 'mde', '.ANI': 'ani', '.FA': 'fa',
  '.XV': 'xv', '.STRUCT_OUT': 'struct',
};
for (const dir of fs.readdirSync(FIX)) {
  const full = path.join(FIX, dir);
  if (!fs.statSync(full).isDirectory()) continue;
  for (const f of fs.readdirSync(full)) {
    const t0 = performance.now();
    const r = S.detectAndParse(f, read(dir, f));
    const ms = (performance.now() - t0).toFixed(0);
    const ext = path.extname(f);
    let want = expectKind[ext];
    if (f.endsWith('.PDOS.xml')) want = 'pdos';
    if (f.endsWith('.ion.xml')) want = 'ion-xml';
    check(`parse ${dir}/${f}`, !r.error && r.data != null && r.kind !== 'unknown', r.error || r.kind);
    if (want) eq(`kind ${dir}/${f}`, r.kind, want);
    console.log(`  ${dir}/${f.padEnd(26)} -> ${r.kind.padEnd(12)} ${ms} ms${r.error ? '  ERROR ' + r.error : ''}`);
  }
}
// content sniffing without a helpful name
eq('sniff EIG by content', S.detectKind('noname', txt('si', 'si.EIG')), 'eig');
eq('sniff bands by content', S.detectKind('noname', txt('si', 'si.bands')), 'bands');
eq('sniff KP by content', S.detectKind('noname', txt('si', 'si.KP')), 'kp');
eq('sniff PDOS by content', S.detectKind('noname', txt('si', 'si.PDOS.xml')), 'pdos');
eq('sniff out by content', S.detectKind('noname', txt('si', 'si.out')), 'out');
eq('sniff psf by content', S.detectKind('noname', txt('pseudo', 'Si.psf')), 'psf');

// ------------------------------------------------------------------ 2. per-system numbers
for (const lab of ['si', 'fe', 'fesoc']) {
  const R = REF[lab];
  section(`${lab}: .out`);
  const o = S.parseOut(read(lab, `${lab}.out`));
  eq(`${lab} version`, o.program.version, R.out.version);
  close(`${lab} final Etot`, o.final.etot, R.out.total);
  close(`${lab} final FreeEng`, o.final.freeEnergy, R.out.freeEng);
  close(`${lab} Fermi (out)`, o.final.fermi, R.out.fermi);
  eq(`${lab} #SCF rows`, o.scf.length, R.out.nScfRows);
  eq(`${lab} scf converged`, o.final.scfConverged, true);
  eq(`${lab} MeshCutoff`, [o.mesh.cutoffRequired, o.mesh.cutoffUsed], R.out.meshCutoff);
  eq(`${lab} nk`, o.kgrid.nk, R.out.nk);
  eq(`${lab} species`, o.species.length, R.out.nSpecies);
  close(`${lab} nElectrons`, o.nElectrons, R.out.nElectrons);
  eq(`${lab} timer routines`, o.timers.routines.length, R.out.nTimerRoutines);
  if (R.out.lastSpinMoment != null) close(`${lab} last spin moment`, o.scf.at(-1).spinMoment.abs, R.out.lastSpinMoment);
  check(`${lab} energy decomposition`, o.energyDecomposition && Number.isFinite(o.energyDecomposition.Ebs) && Number.isFinite(o.energyDecomposition.Exc));
  close(`${lab} decomposition Etot = Total`, o.energyDecomposition.Etot, R.out.total);
  check(`${lab} Mulliken`, !!o.populations.mulliken && o.populations.mulliken.atoms.length >= 1);
  console.log(`  Etot ${o.final.etot}  Ef ${o.final.fermi}  SCF ${o.scf.length}  spin ${o.spin.config}`);

  section(`${lab}: .bands`);
  const b = S.parseBands(read(lab, `${lab}.bands`));
  eq(`${lab} bands format`, b.format, R.bands.format);
  close(`${lab} bands Ef`, b.fermi, R.bands.fermi);
  eq(`${lab} bands dims`, [b.nk, b.nSpin, b.nBands], [R.bands.nk, R.bands.nSpin, R.bands.nBands]);
  eq(`${lab} bands #labels`, b.labels.length, R.bands.nLabels);
  close(`${lab} bands first E`, b.bands[0][0][0], R.bands.e_first, 1e-4);
  close(`${lab} bands last E`, b.bands.at(-1).at(-1).at(-1), R.bands.e_last, 1e-4);
  close(`${lab} path length (1/Bohr)`, b.xBohr.at(-1), R.bands.pathLength_bohr, 1e-6);
  const be = S.bandEdges(b);
  eq(`${lab} bands metallic`, be.metallic, R.bands.metallic);
  if (!R.bands.metallic) { close(`${lab} bands VBM`, be.vbm.e, R.bands.vbm, 1e-6); close(`${lab} bands CBM`, be.cbm.e, R.bands.cbm, 1e-6); }

  section(`${lab}: .EIG + .KP`);
  const e = S.parseEIG(read(lab, `${lab}.EIG`), txt(lab, `${lab}.KP`));
  close(`${lab} EIG Ef`, e.fermi, R.eig.fermi);
  eq(`${lab} EIG dims`, [e.nk, e.nSpin, e.nBands, e.nSpinFile], [R.eig.nk, R.eig.nChannels, R.eig.nBandsHeader, R.eig.nSpinHeader]);
  check(`${lab} EIG weights from KP`, e.weightsFromKP);
  close(`${lab} electrons (step count)`, S.countElectrons(e), R.eig.electronsStep, 1e-9);
  const g = S.analyzeGap(e);
  eq(`${lab} EIG metallic`, g.metallic, R.eig.metallic);
  close(`${lab} EIG gap`, g.gap, R.eig.gap, 1e-6);
  if (!g.metallic) { close(`${lab} EIG VBM`, g.vbm.e, R.eig.vbm); close(`${lab} EIG CBM`, g.cbm.e, R.eig.cbm); }
  const dosE = S.computeDOS(e, { sigma: 0.1, de: 0.01 });
  close(`${lab} broadened DOS integral ~ N`, dosE.electronsBelowFermi, R.eig.electronsStep, 0.3);
  console.log(`  gap ${g.gap.toFixed(4)} (${g.type})  N(step) ${S.countElectrons(e).toFixed(4)}  N(DOS) ${dosE.electronsBelowFermi.toFixed(4)}`);

  section(`${lab}: .PDOS.xml / .DOS`);
  const p = S.parsePDOS(read(lab, `${lab}.PDOS.xml`));
  eq(`${lab} PDOS dims`, [p.nspin, p.nOrbitals, p.energy.length], [R.pdos.nspin, R.pdos.nOrbitals, R.pdos.nE]);
  close(`${lab} PDOS Ef`, p.fermi, R.pdos.fermi);
  const nP = S.integratePDOS(p);
  close(`${lab} PDOS integral (vs python)`, nP, R.pdos.electronsBelowFermi, 1e-6);
  close(`${lab} PDOS integral ~ N electrons`, nP, o.nElectrons, 0.25);
  for (const [l, v] of Object.entries(R.pdos.byL)) close(`${lab} PDOS l=${l}`, S.integratePDOS(p, S.sumPDOS(p, { l: +l })), v, 1e-6);
  const gsum = S.groupPDOS(p, ['species', 'l']).reduce((a, gg) => a + S.integratePDOS(p, gg.data), 0);
  close(`${lab} sum of groups = total`, gsum, nP, 1e-9);
  if (R.pdos.up != null) {
    close(`${lab} PDOS up`, S.integratePDOS(p, S.totalPDOS(p, 'up')), R.pdos.up, 1e-6);
    close(`${lab} PDOS down`, S.integratePDOS(p, S.totalPDOS(p, 'down')), R.pdos.down, 1e-6);
    if (R.out.lastSpinMoment != null) close(`${lab} PDOS moment ~ spin moment`, S.integratePDOS(p, S.totalPDOS(p, 'mz')), R.out.lastSpinMoment, 0.2);
  }
  const d = S.parseDOS(read(lab, `${lab}.DOS`));
  eq(`${lab} DOS dims`, [d.nspin, d.energy.length], [R.dos.nspin, R.dos.nE]);
  close(`${lab} DOS integral`, S.integrateDOS(d, p.fermi), R.dos.electronsBelowFermi, 1e-6);
  console.log(`  PDOS N(E<Ef) ${nP.toFixed(4)}  (${o.nElectrons} electrons)`);

  section(`${lab}: dftlab_pack JSON`);
  const pack = await S.unpackDftlab(txt(lab, `${lab}.dftlab.json`));
  const RP = R.pack;
  close(`${lab} pack Ef`, pack.fermi, RP.fermi);
  eq(`${lab} pack gap type`, pack.gap.type, RP.gapType);
  close(`${lab} pack gap`, pack.gap.gap, RP.gap);
  eq(`${lab} pack band dims`, pack.bands.energies.shape, [RP.nSpin, RP.nk, RP.nBands]);
  let maxdiff = 0; // gammaSiesta: [spin][band] from the SIESTA .bands file
  for (let s = 0; s < RP.nSpin; s++) for (let i = 0; i < RP.nBands; i++) {
    maxdiff = Math.max(maxdiff, Math.abs(S.at(pack.bands.energies, s, 0, i) - RP.gammaSiesta[s][i]));
  }
  close(`${lab} pack Gamma eigenvalues vs SIESTA .bands (max |dE|)`, maxdiff, 0, 1e-3);
  close(`${lab} pack DOS N(E<Ef) ~ N`, pack.dos.electronsBelowFermi, RP.nElectrons, 0.15);
  const fat = pack.bands.fatbands.bySpecies.data;
  let fmin = Infinity, fmax = -Infinity;
  const [ns_, ng_, nk_, nb_] = fat.shape;
  for (let s = 0; s < ns_; s++) for (let k = 0; k < nk_; k++) for (let n = 0; n < nb_; n++) {
    let t = 0;
    for (let gI = 0; gI < ng_; gI++) t += S.at(fat, s, gI, k, n);
    fmin = Math.min(fmin, t); fmax = Math.max(fmax, t);
  }
  check(`${lab} fat-band weights sum to 1`, Math.abs(fmin - 1) < 1e-3 && Math.abs(fmax - 1) < 1e-3, `${fmin}..${fmax}`);
  if (pack.wavefunctions) {
    for (const st of pack.wavefunctions.states) {
      const comps = st.spinor ? st.components : [st.components];
      let n2 = 0;
      for (const c of comps) { const w = S.dequantizeWF(c); for (let i = 0; i < w.re.length; i++) n2 += w.re[i] ** 2 + w.im[i] ** 2; }
      close(`${lab} wavefunction norm (band ${st.band})`, n2 * st.dV, 1, 0.03);
    }
  }
  console.log(`  pack: Ef ${pack.fermi}  gap ${pack.gap.gap} (${pack.gap.type})  max|dE(Γ)| ${maxdiff.toExponential(2)} eV`);
}

// ------------------------------------------------------------------ 3. variants
section('Si variants');
{
  const o = S.parseOut(read('si', 'si_stdin.out'));
  const R = REF.si.out_stdin;
  close('si stdin Etot', o.final.etot, R.total);
  eq('si stdin #SCF', o.scf.length, R.nScfRows);
  check('si stdin fdf echo', o.fdf && S.fdfGet(o.fdf, 'mesh_cutoff')?.value === '200 Ry' && S.fdfBlock(o.fdf, 'BandLines')?.lines.length === 8);
  eq('si stdin optical polarization', o.input.opticalPolarization, 'polycrystal');
  const bp = S.parseBands(read('si', 'sibp.bands'));
  eq('BandPoints format', bp.format, 'BandPoints');
  eq('BandPoints dims', [bp.nk, bp.nBands], [REF.si.bandpoints.nk, REF.si.bandpoints.nBands]);
  close('BandPoints first E', bp.bands[0][0][0], REF.si.bandpoints.e_first, 1e-4);
  const pold = S.parsePDOS(read('si', 'si.PDOS'));
  close('old-format .PDOS integral', S.integratePDOS(pold), REF.si.pdos_old.electronsBelowFermi, 1e-6);
  eq('old-format .PDOS orbital attrs', [pold.orbitals[12].l, pold.orbitals[12].z, pold.orbitals[12].P], [2, 1, true]);
  const oe = S.parseOut(read('si', 'si.out'));
  eq('si eigenvalues printed in .out', [oe.eigenvalues.nk, oe.eigenvalues.eig[0][0].length], [256, 26]);
}

section('EPSIMG + Kramers-Kronig');
for (const lab of ['si', 'fe']) {
  const R = REF[lab].epsimg;
  const eps = S.parseEPSIMG(read(lab, `${lab}.EPSIMG`));
  eq(`${lab} EPSIMG dims`, [eps.energy.length, eps.eps2.length], [R.nE, R.nCols]);
  eq(`${lab} f-sum`, eps.fsumRule, R.fsum);
  let im = 0; for (let i = 0; i < eps.energy.length; i++) if (eps.eps2Total[i] > eps.eps2Total[im]) im = i;
  close(`${lab} eps2 peak position`, eps.energy[im], R.eps2MaxE, 1e-9);
  const opt = S.opticalSpectrum(eps);
  for (const [w, v] of Object.entries(R.eps1)) {
    const i = eps.energy.findIndex((x) => Math.abs(x - +w) < 1e-6);
    close(`${lab} KK eps1(${w} eV) vs independent python`, opt.eps1[i], v, 0.01, true);
  }
  check(`${lab} optical constants finite`, opt.n.every(Number.isFinite) && opt.reflectivity.every((r) => r >= 0 && r <= 1) && opt.absorption.every((a) => a >= 0));
  if (lab === 'si') console.log(`  Si: eps1(0)=${opt.eps1[0].toFixed(3)}  n(0)=${opt.n[0].toFixed(3)}  R(0)=${opt.reflectivity[0].toFixed(3)}`);
}

section('relaxation / MD trajectories');
{
  const R = REF.relax;
  const o = S.parseOut(read('relax', 'relax.out'));
  eq('relax #steps', o.steps.length, R.out.eKS.length);
  eq('relax E_KS per step', o.steps.map((s) => s.eKS), R.out.eKS);
  eq('relax max force per step', o.steps.map((s) => s.maxForce), R.out.maxForceConstrained);
  close('relax final Etot', o.final.etot, R.out.total);
  check('relax final coordinates', o.finalCoordinates && o.finalCoordinates.coords.length === 8);
  check('relax isRelaxation', o.isRelaxation === true);
  const m = S.parseMDE(read('relax', 'relax.MDE'));
  eq('relax MDE steps', m.nSteps, R.mde.nSteps);
  close('relax MDE last E_KS', m.columns.eKS.at(-1), R.mde.eKS_last);
  const a = S.parseANI(read('relax', 'relax.ANI'));
  eq('relax ANI frames', [a.nFrames, a.nAtoms], [R.ani.nFrames, R.ani.nAtoms]);
  eq('relax ANI last frame atom 1', a.frames.at(-1).positions[0], R.ani.lastFirstAtom);
  const fa = S.parseFA(read('relax', 'relax.FA'));
  close('relax FA max |F|', fa.maxForce, R.fa.maxNorm, 1e-9);
  const xv = S.parseXV(read('relax', 'relax.XV'));
  close('relax XV cell (Ang)', xv.cell[0][0], 5.43, 1e-6);
  const so = S.parseStructOut(read('relax', 'relax.STRUCT_OUT'));
  eq('relax STRUCT_OUT atoms', so.nAtoms, 8);

  const RM = REF.md;
  const om = S.parseOut(read('md', 'md.out'));
  eq('md steps', om.steps.length, RM.out.eKS.length);
  eq('md E_KS per step', om.steps.map((s) => s.eKS), RM.out.eKS);
  check('md isMD + Temp_ion', om.isMD && om.steps[0].temperatureIon === 600);
  const mm = S.parseMDE(read('md', 'md.MDE'));
  eq('md MDE steps', mm.nSteps, RM.mde.nSteps);
  close('md MDE last T', mm.columns.temperature.at(-1), RM.mde.T_last);
  eq('md ANI frames', S.parseANI(read('md', 'md.ANI')).nFrames, RM.ani.nFrames);
}

section('misc outputs (non-converged, OMM, PSML species)');
{
  const mg = S.parseOut(read('misc', 'mg_lin050_notconv.out'));
  eq('mg not converged', mg.final.scfConverged, false);
  eq('mg #SCF rows (fused fixed-width columns)', mg.scf.length, REF.misc.mg.nScfRows);
  check('mg fused row parsed', mg.scf.every((r) => Number.isFinite(r.dHmax) && Number.isFinite(r.Ef)));
  close('mg row 146 Ef', mg.scf[145].Ef, -44.788847);
  close('mg row 146 dHmax', mg.scf[145].dHmax, 315.508565);
  check('mg SCF_NOT_CONV message', mg.convergence.some((c) => /SCF_NOT_CONV/.test(c.text)));
  const omm = S.parseOut(read('misc', 'omm.out'));
  eq('omm #SCF (siesta: iscf = style)', omm.scf.length, REF.misc.omm.nScfRows);
  close('omm final Etot', omm.final.etot, REF.misc.omm.total);
  const gr = S.parseOut(read('misc', 'graphite_vdw_psml.out'));
  eq('graphite species pseudo format', gr.species[0].pseudoFormat, 'PSML');
  eq('graphite libxc ids', gr.species[0].libxcIds, [101, 130]);
  close('graphite Etot', gr.final.etot, REF.misc.graphite.total);
}

section('basis / pseudopotential files');
{
  const ion = S.parseIonXML(read('si', 'Si.ion.xml'));
  const R = REF.si.ion_xml;
  eq('ion.xml #nl orbitals', ion.orbitals.length, R.nOrbNl);
  eq('ion.xml Z/valence', [ion.Z, ion.valence], [R.Z, R.valence]);
  ion.orbitals.forEach((o, i) => { close(`ion.xml cutoff ${i}`, o.cutoff, R.cutoffs[i], 1e-9); close(`ion.xml norm ${i}`, o.norm, R.norms[i], 1e-6); });
  eq('ion.xml #KB', ion.projectors.length, R.nProjectors);
  check('ion.xml Vna/chlocal', ion.vna && ion.chlocal && ion.vna.r.length === 500);
  const ions = S.parseIon(read('fesoc', 'Fe.ion'));
  eq('plain .ion (lj) orbitals/KB', [ions.orbitals.length, ions.projectors.length, ions.ljProjs], [REF.fesoc.ion.nOrb, REF.fesoc.ion.nKB, REF.fesoc.ion.lj]);
  check('plain .ion core charge', !!ions.core && ions.core.r.length === 500);
  const psf = S.parsePSF(read('pseudo', 'Si.psf'));
  const RP = REF.pseudo['Si.psf'];
  eq('psf grid/potentials', [psf.grid.npts, psf.semilocal.down.length, psf.semilocal.up.length], [RP.nr, RP.nDown, RP.nUp]);
  close('psf last r', psf.grid.r.at(-1), RP.rLast, 1e-9, true);
  close('psf valence electrons', psf.valenceElectrons, RP.valenceElectrons, 1e-9);
  close('psf V_l tail = -2Z/r', psf.semilocal.down[0].V.at(-1), -2 * RP.zval / RP.rLast, 1e-6);
  for (const f of ['Si.soft.psml', 'Si_lda_oncv.psml']) {
    const ps = S.parsePSML(read('pseudo', f));
    const RR = REF.pseudo[f];
    eq(`${f} grid`, ps.grid.npts, RR.npts);
    close(`${f} valence electrons`, ps.valenceElectrons, RR.valenceElectrons, 1e-6);
    eq(`${f} #semilocal`, ps.semilocal.reduce((a, s) => a + s.potentials.length, 0), RR.nSemilocal);
    eq(`${f} #projectors`, ps.projectors.reduce((a, s) => a + s.projectors.length, 0), RR.nProjectors);
    check(`${f} libxc info`, ps.header.libxc.length === 2);
  }
}

// ------------------------------------------------------------------ summary
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('\nFailures:'); for (const f of failures) console.log('  - ' + f); process.exit(1); }
