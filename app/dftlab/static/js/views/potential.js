// Aprender 10 · Potencial electrostático y función trabajo: promedio planar y macroscópico de V en láminas de Al y Mg (SIESTA 5.4.2, LDA, DZP).
import { $, $$, css, alpha, fmt, esc, seg, downloadText } from '../core/ui.js';
import { chart, exportBar } from '../core/chart.js';
import { parseGrid, planarAverage } from '../siesta/rho.js';
import D from '../data/potencial.json';

const RY = 13.605693122994, BOHR = 0.529177210903;
const R = D.runs;
// Valores experimentales y de la literatura (eV). Las fuentes están en EXP_SRC y en la nota al pie.
const EXP = {
  'al111': [['Grepstad et al. 1976', 4.24], ['Eastment y Mee 1973', 4.26]],
  'al100': [['Grepstad et al. 1976', 4.41], ['Eastment y Mee 1973', 4.20]],
  'al110': [['Grepstad et al. 1976', 4.28], ['Eastment y Mee 1973', 4.06]],
  'mg0001': [['Michaelson 1977 (citado en arXiv:cond-mat/0307038)', 3.84]],
};
const LDA_LIT = { al111: 4.22, al100: 4.46, al110: 4.26 };      // LDA/CA publicado, tabla I de arXiv:0911.0088
const MG_SENS = ['mg0001_n7_sz', 'mg0001_n7_dz', 'mg0001_n7', 'mg0001_n7_tzp', 'mg0001_n7_es5', 'mg0001_n7_es1'];
const SHOW = [['al111_n9', 'Al(111) · 9 capas'], ['al111_n5', 'Al(111) · 5 capas'], ['al100_n7', 'Al(100) · 7 capas'], ['al110_n11', 'Al(110) · 11 capas'], ['mg0001_n7', 'Mg(0001) · 7 capas']];
const keyOf = (id) => id.replace(/_.*$/, '').replace(/^(al|mg)(\d+)$/, '$1$2');
const faceKey = (r) => (r.el.toLowerCase() + r.face.replace(/[()]/g, ''));
const expMean = (k) => EXP[k].reduce((s, e) => s + e[1], 0) / EXP[k].length;

function theory() { return `
  <h3>El potencial que ve un electrón en un sólido</h3>
  <p>El potencial electrostático V(<b>r</b>) es el de los núcleos (apantallados por el pseudopotencial) más el de los electrones, y cumple la ecuación de Poisson:</p>
  <div class="eq">∇²V<sub>H</sub>(<b>r</b>) = −4π ρ(<b>r</b>) &nbsp;(unidades atómicas), &nbsp; V<sub>el</sub>(<b>r</b>) = V<sub>H</sub>[ρ] + V<sub>NA</sub>(<b>r</b>)</div>
  <p>Con <code>SaveElectrostaticPotential true</code> SIESTA escribe el archivo <code>.VH</code> con ese potencial en la malla de espacio real, en Ry; con <code>SaveTotalPotential true</code> escribe <code>.VT</code>, que además suma el potencial de intercambio y correlación V<sub>xc</sub>. Lejos de la superficie V<sub>xc</sub> → 0 y los dos archivos coinciden: en las corridas de abajo difieren en menos de 10⁻³ eV en el vacío y en ~11 eV dentro del metal.</p>
  <h3>Promedio planar y promedio macroscópico</h3>
  <p>En una lámina periódica en <em>x</em> e <em>y</em> y finita en <em>z</em>, lo que importa es cómo cambia V en la dirección perpendicular. Se promedia sobre el plano:</p>
  <div class="eq">V̄(z) = (1/A) ∬ V(x, y, z) dx dy, &nbsp; &nbsp; V̿(z) = (1/d²) ∫<sub>−d/2</sub><sup>d/2</sup> ∫<sub>−d/2</sub><sup>d/2</sup> V̄(z + s + t) ds dt</div>
  <p>V̄(z) oscila con el periodo d del cristal (la distancia entre planos atómicos). El segundo promedio, <b>macroscópico</b>, con una ventana de ancho d aplicada dos veces, borra esa oscilación y deja la variación suave que importa: un valor constante dentro del metal, una subida cerca de la superficie y otro valor constante en el vacío (Baldereschi, Baroni y Resta 1988).</p>
  <h3>Función trabajo</h3>
  <p>Es la energía mínima para sacar un electrón del metal al vacío justo fuera de la superficie:</p>
  <div class="eq">Φ = V<sub>vac</sub> − E<sub>F</sub></div>
  <p>V<sub>vac</sub> es el valor de la meseta del potencial en el vacío y E<sub>F</sub> la energía de Fermi del <em>mismo</em> cálculo (SIESTA las da en la misma escala, la del potencial total). Φ se puede partir en dos partes con significado distinto (Lang y Kohn 1971):</p>
  <div class="eq">Φ = Δ − μ, &nbsp; Δ = V<sub>vac</sub> − V̿<sub>bulk</sub> (barrera de la doble capa superficial), &nbsp; μ = E<sub>F</sub> − V̿<sub>bulk</sub> (energía de Fermi medida desde el potencial medio del interior)</div>
  <p>μ es una propiedad del volumen; Δ depende de la cara cristalina porque la redistribución de la carga en la superficie (la nube electrónica «se derrama» hacia el vacío y deja detrás una doble capa dipolar) cambia de cara a cara. Por eso un mismo metal tiene una Φ distinta para cada orientación (Smoluchowski 1941): las caras más abiertas tienen más derrame y rugosidad y, en general, menor Φ.</p>
  <h3>Qué hay que cuidar</h3>
  <p><b>Vacío suficiente.</b> El potencial del vacío solo es una meseta si la lámina y su imagen periódica están lejos; se comprueba que V̄ sea plano (aquí, dentro de unos meV en la franja central del vacío).</p>
  <p><b>Espesor.</b> Con pocas capas los estados de la lámina están cuantizados y E<sub>F</sub> y Φ oscilan con el número de capas; hay que graficar Φ frente al espesor.</p>
  <p><b>Simetría.</b> Una lámina simétrica (misma cara arriba y abajo) tiene dipolo neto cero y un solo V<sub>vac</sub>. Si las dos caras son distintas (un adsorbato, por ejemplo) aparece un campo en el vacío que hay que compensar con una corrección dipolar (<code>Slab.DipoleCorrection</code>, Neugebauer y Scheffler 1992); este módulo no la necesita porque todas las láminas son simétricas.</p>
  <p class="src">Lang y Kohn, Phys. Rev. B 3, 1215 (1971) · Smoluchowski, Phys. Rev. 60, 661 (1941) · Baldereschi, Baroni, Resta, Phys. Rev. Lett. 61, 734 (1988) · Neugebauer y Scheffler, Phys. Rev. B 46, 16067 (1992) · Soler et al., J. Phys.: Condens. Matter 14, 2745 (2002) (SIESTA).</p>`; }

/** Doble promedio móvil periódico: ventana de ancho w (Å) aplicada dos veces. v tiene n puntos sobre una celda de largo L. */
function macroAvg(v, L, w) {
  const n = v.length, k = Math.max(1, Math.round(w / (L / n)));
  const pass = (s) => { const o = new Float64Array(n); for (let i = 0; i < n; i++) { let t = 0; for (let j = 0; j < k; j++) t += s[(i + j - (k >> 1) + 4 * n) % n]; o[i] = t / k; } return o; };
  return pass(pass(Float64Array.from(v)));
}

export function mount(root, view) {
  const S = { run: 'al111_n9', q: 'vh', exp: 0 };
  const bySeries = (r) => r.curve;
  root.innerHTML = `
  <div class="pghead"><div>
    <div class="kicker">Aprender · 10</div><h1>Potencial electrostático y función trabajo</h1>
    <p class="lede" id="lede"></p>
  </div></div>
  <div class="pgrid">
    <article class="panel theory sticky">${theory()}</article>
    <div class="charts">
      <section class="panel wide"><div class="ph"><h2>Potencial a través de la lámina</h2></div>
        <div class="pb">
          <div class="btnrow" style="gap:10px;flex-wrap:wrap;margin-bottom:8px">
            <div class="seg" id="sysSel">${SHOW.map(([k, l]) => `<button data-v="${k}">${l}</button>`).join('')}</div>
            <div class="seg" id="qSel"><button data-v="vh">V electrostático (.VH)</button><button data-v="vt">V total (.VT)</button></div>
          </div>
          <canvas data-export="potencial_planar" id="cvV" style="height:340px"></canvas>
          <div class="readout" id="rdV"></div><p class="note" id="noteV"></p>
        </div></section>

      <section class="panel"><div class="ph"><h2>Densidad planar</h2></div>
        <div class="pb"><canvas data-export="densidad_planar_lamina" id="cvRho" style="height:260px"></canvas><div class="readout" id="rdRho"></div>
        <p class="note" id="noteRho"></p></div></section>
      <section class="panel"><div class="ph"><h2>Φ frente al número de capas</h2><div class="seg" id="expSel"></div></div>
        <div class="pb"><canvas data-export="phi_vs_capas" id="cvN" style="height:260px"></canvas><div class="readout" id="rdN"></div>
        <p class="note" id="noteN"></p></div></section>

      <section class="panel wide"><div class="ph"><h2>Cuánto depende Φ de los parámetros del cálculo</h2></div>
        <div class="pb"><div class="tblwrap" id="tblSens"></div><p class="note" id="noteSens"></p></div></section>

      <section class="panel wide"><div class="ph"><h2>Descomposición Φ = Δ − μ</h2><div class="btnrow"><button class="tiny" id="dlCsv">CSV</button></div></div>
        <div class="pb"><div class="tblwrap" id="tblDec"></div><p class="note" id="noteDec"></p></div></section>

      <section class="panel wide"><div class="ph"><h2>Caras del aluminio frente al experimento</h2></div>
        <div class="pb"><div class="tblwrap" id="tblFace"></div><p class="note" id="noteFace"></p></div></section>

      <section class="panel"><div class="ph"><h2>Cuánto vacío hace falta</h2></div>
        <div class="pb"><div class="tblwrap" id="tblVac"></div><p class="note" id="noteVac"></p></div></section>
      <section class="panel"><div class="ph"><h2>Entrada de SIESTA usada</h2><div class="btnrow"><button class="tiny" id="dlFdf">exportar .fdf</button></div></div>
        <div class="pb"><pre class="code" style="max-height:300px;overflow:auto" id="fdfPre"></pre>
        <p class="note">Las palabras clave que producen los archivos son <code>SaveElectrostaticPotential</code> (.VH), <code>SaveTotalPotential</code> (.VT) y <code>SaveRho</code> (.RHO). El .out imprime la energía de Fermi y, desde SIESTA 5.x, una línea <code>Vacuum level</code> con el máximo y la media del potencial en la celda.</p></div></section>

      <section class="panel wide"><div class="ph"><h2>Tu propia lámina · .VH, .VT y .out</h2></div>
        <div class="pb">
          <label class="drop" id="drop"><input type="file" id="fileIn" multiple accept=".VH,.VT,.VNA,.out,.OUT" hidden>Arrastra aquí el .VH o .VT de tu lámina (y su .out para leer la energía de Fermi), o haz clic. Nada se ejecuta ni se envía: se lee en el navegador.</label>
          <div id="userBox" hidden>
            <div class="btnrow" style="gap:12px;flex-wrap:wrap;margin:10px 0">
              <div class="seg" id="uAxis"><button data-v="2">normal a lo largo de c</button><button data-v="1">b</button><button data-v="0">a</button></div>
              <label class="sl">ventana d (Å) <input type="number" id="uD" min="0.5" max="8" step="0.01" value="2.34" style="width:70px"></label>
              <label class="sl">E<sub>F</sub> (eV) <input type="number" id="uEf" step="0.001" style="width:90px" placeholder="del .out"></label>
            </div>
            <dl class="kv two" id="userInfo"></dl>
            <canvas data-export="promedio_planar_usuario" id="cvUser" style="height:300px"></canvas>
            <div class="readout" id="userRead"></div>
            <p class="note" id="userNote">El nivel de vacío se toma como el máximo del promedio planar, que es correcto si el vacío es plano y la lámina es simétrica. La ventana d debe ser la distancia entre planos atómicos del cristal (en Al(111): a/√3 ≈ 2.34 Å).</p>
          </div>
          <p class="note" id="userErr" hidden></p>
        </div></section>
    </div>
  </div>
  <footer class="prov">SIESTA ${D.siesta}, ${D.xc}, base DZP, pseudos ONCV de la biblioteca de DFT Lab (Al: 3 e⁻ de valencia; Mg: 10 e⁻ con semicore 2s2p, LDA), MeshCutoff 250 Ry, malla k de 12×12×1 (8×12×1 en Al(110)) sin desplazamiento, ElectronicTemperature 300 K, DM.Tolerance 10⁻⁶, láminas simétricas con ≥18 Å de vacío (salvo la serie de vacío), geometrías ideales de volumen sin relajar: Al fcc a = 4.05 Å, Mg hcp a = 3.209 Å, c = 5.211 Å. El nivel de vacío es la media del promedio planar de V<sub>H</sub>+V<sub>NA</sub> a ≤1.5 Å del borde de la celda. Experimento: Grepstad, Garland y Slagsvold, Surf. Sci. 57, 348 (1976) y Eastment y Mee, J. Phys. F 3, 1738 (1973) para Al (valores y LDA publicado tomados de la tabla I de arXiv:0911.0088); Mg(0001): Michaelson, J. Appl. Phys. 48 (1977), tal como lo cita arXiv:cond-mat/0307038. Entradas y salidas en corridas/wf.tar.gz.</footer>`;
  $$('canvas[data-export]', root).forEach((cv) => cv.closest('.panel').querySelector('.ph').append(exportBar(cv, cv.dataset.export)));

  const run = () => R[S.run];
  const key = (r) => faceKey(r);
  const label = (id) => (SHOW.find((s) => s[0] === id) || [0, id])[1];

  // ---------- lede ----------
  (() => {
    const a = R.al111_n9, m = R.mg0001_n7;
    $('#lede', root).innerHTML = `Láminas simétricas de Al y Mg calculadas con SIESTA (LDA, DZP): el promedio planar del potencial da el nivel de vacío y, restándole la energía de Fermi, la función trabajo. Con la base por defecto Al(111) de 9 capas da <b>${fmt(a.workFunction, 2)} eV</b> (experimento 4.24–4.26; con orbitales más extendidos, <b>${fmt(R.al111_n9_es5.workFunction, 2)} eV</b>) y Mg(0001) de 7 capas <b>${fmt(m.workFunction, 2)} eV</b> (experimento 3.84); el resultado depende más del alcance de los orbitales (hasta ${fmt(Math.max(...MG_SENS.map((i) => R[i].workFunction)) - Math.min(...MG_SENS.map((i) => R[i].workFunction)), 1)} eV en Mg) que del espesor, el vacío o la malla.`;
  })();

  // ---------- potencial ----------
  function drawV() {
    const r = run(), c = bySeries(r), dz = c.dz, L = r.L;
    const v = c[S.q].map((y, i) => [i * dz, y]);
    const mac = c.macro.map((y, i) => [i * dz, y]);
    if (S.q === 'vt') {
      const wV = Float64Array.from(c.vt); const m2 = macroAvg(wV, L, r.dLayer); mac.forEach((p, i) => (p[1] = m2[i]));
    }
    const vals = v.map((p) => p[1]);
    const lo = Math.min(...vals), hi = r.vVacuum;
    const ymin = Math.floor((lo - 2) / 5) * 5, ymax = Math.ceil((Math.max(hi, r.fermi) + 3) / 5) * 5;
    const z0 = r.zAtoms[0], z1 = r.zAtoms[r.zAtoms.length - 1];
    chart($('#cvV', root), {
      xlim: [0, L], ylim: [ymin, ymax], xlabel: 'z (Å), normal a la lámina', ylabel: 'potencial promediado en el plano (eV)', legend: 'left',
      series: [
        { d: v, color: css('--accent'), width: 1.8, label: S.q === 'vh' ? 'V̄(z) electrostático (.VH)' : 'V̄(z) total (.VT)' },
        { d: mac, color: css('--psi-pos'), width: 2.4, label: 'V̿(z) macroscópico' },
      ],
      hlines: [{ y: r.vVacuum, label: `V vacío = ${fmt(r.vVacuum, 2)} eV`, color: css('--ink'), dash: [5, 3] }, { y: r.fermi, label: `E_F = ${fmt(r.fermi, 2)} eV`, color: css('--bad'), dash: [5, 3] }],
      vlines: r.zAtoms.map((x) => ({ x, color: alpha(css('--faint'), 0.7), dash: [2, 3] })),
      shade: [{ x0: z0, x1: z1, color: alpha(css('--accent'), 0.06) }],
      read: (x) => {
        if (x == null) return `${label(S.run)} · Φ = <b>${fmt(r.workFunction, 3)}</b> eV = ${fmt(r.vVacuum, 3)} − (${fmt(r.fermi, 3)})`;
        const i = Math.max(0, Math.min(v.length - 1, Math.round(x / dz)));
        return `z = ${fmt(x, 2)} Å · V̄ = <b>${fmt(v[i][1], 2)}</b> eV · V̿ = <b>${fmt(mac[i][1], 2)}</b> eV`;
      },
      readEl: $('#rdV', root),
    });
    const flat = r.vacuumFlat;
    $('#noteV', root).innerHTML = `<b>Qué se ve.</b> El potencial oscila con el periodo de los planos atómicos (azul, d = ${fmt(r.dLayer, 3)} Å), el promedio macroscópico (naranja) lo suaviza, y fuera de la lámina sube hasta la meseta del vacío. La distancia vertical entre la línea de E<sub>F</sub> (rojo) y la de V<sub>vac</sub> (negro) es la función trabajo: <b>${fmt(r.workFunction, 2)} eV</b>. La meseta es plana a ${fmt(flat * 1e6, 0)} μeV en la franja de vacío usada; el valor que imprime SIESTA, máx/media de la celda, ${r.vacuumSiesta ? fmt(r.vacuumSiesta.mean, 3) : '—'} eV, coincide con V<sub>vac</sub> = ${fmt(r.vVacuum, 3)} eV. El potencial total (.VT) tiene el mismo vacío pero una profundidad mayor dentro del metal por V<sub>xc</sub>.`;
  }

  // ---------- densidad ----------
  function drawRho() {
    const r = run(), c = bySeries(r), dz = c.dz, L = r.L;
    const d = c.rho.map((y, i) => [i * dz, y]);
    const zr = r.zAtoms, zc = zr.reduce((a, b) => a + b, 0) / zr.length;
    const lo = zr[0] - 6, hi = zr[zr.length - 1] + 6;
    const sub = d.filter((p) => p[0] >= lo && p[0] <= hi);
    const ymax = Math.max(...sub.map((p) => p[1]));
    chart($('#cvRho', root), {
      xlim: [lo, hi], ylim: [0, ymax * 1.1], xlabel: 'z (Å)', ylabel: 'ρ promediada en el plano × área (e/Å)', legend: false,
      series: [{ d: sub, color: css('--accent'), width: 2, fill: 0, fillAlpha: 0.12 }],
      vlines: zr.map((x) => ({ x, color: alpha(css('--faint'), 0.8), dash: [2, 3] })),
      read: (x) => { if (x == null) return `${label(S.run)} · ∫ρ dz = ${fmt(r.nElectrons, 3)} e (esperado ${fmt(r.nAtoms * (r.el === 'Al' ? 3 : 10), 0)})`; const i = Math.max(0, Math.min(d.length - 1, Math.round(x / dz))); return `z = ${fmt(x, 2)} Å · ρ = <b>${fmt(d[i][1], 4)}</b> e/Å`; },
      readEl: $('#rdRho', root),
    });
    $('#noteRho', root).textContent = 'Carga de valencia por unidad de altura (ρ integrada en el plano). Dentro del metal oscila con los planos; hacia afuera cae de forma suave pero no abrupta: ese «derrame» de electrones sobre la última capa, con el defecto de carga positiva que deja detrás, es la doble capa que produce la barrera Δ.';
  }

  // ---------- Φ vs capas ----------
  function drawN() {
    const sets = { 'Al(111)': ['al111_n3', 'al111_n5', 'al111_n7', 'al111_n9'], 'Mg(0001)': ['mg0001_n3', 'mg0001_n5', 'mg0001_n7', 'mg0001_n9'] };
    const cols = { 'Al(111)': css('--accent'), 'Mg(0001)': css('--orb-d') };
    const series = [], points = [];
    for (const [nm, ids] of Object.entries(sets)) {
      const d = ids.filter((i) => R[i]).map((i) => [R[i].nLayers, R[i].workFunction]);
      series.push({ d, color: cols[nm], width: 2, label: nm });
      d.forEach(([x, y]) => points.push({ x, y, color: cols[nm], r: 3.6 }));
    }
    const ex = S.exp;
    const alRef = EXP.al111[ex] || EXP.al111[0];
    const hl = [{ y: alRef[1], color: cols['Al(111)'], dash: [4, 3], label: `exp. Al(111) ${fmt(alRef[1], 2)}` }, { y: EXP.mg0001[0][1], color: cols['Mg(0001)'], dash: [4, 3], label: `exp. Mg(0001) ${fmt(EXP.mg0001[0][1], 2)}` }];
    const all = series.flatMap((s) => s.d.map((p) => p[1])).concat(hl.map((h) => h.y));
    chart($('#cvN', root), {
      xlim: [2, 10], ylim: [Math.floor(Math.min(...all) * 5 - 1) / 5, Math.ceil(Math.max(...all) * 5 + 1) / 5], xlabel: 'capas atómicas en la lámina', ylabel: 'función trabajo Φ (eV)', legend: 'left',
      series, points, hlines: hl, xticks: [3, 5, 7, 9].map((x) => ({ x, label: String(x) })),
      read: (x) => { if (x == null) return 'Φ de láminas de 3 a 9 capas (cada punto es un cálculo)'; const n = Math.round(x), f = (k, nm) => { const o = R[k + '_n' + n]; return o ? `${nm} <b>${fmt(o.workFunction, 3)}</b>` : null; }; return `${n} capas: ` + [f('al111', 'Al(111)'), f('mg0001', 'Mg(0001)')].filter(Boolean).join(' · '); },
      readEl: $('#rdN', root),
    });
    const a = ['al111_n3', 'al111_n5', 'al111_n7', 'al111_n9'].map((i) => R[i].workFunction), m = ['mg0001_n3', 'mg0001_n5', 'mg0001_n7', 'mg0001_n9'].map((i) => R[i].workFunction);
    const rg = (x) => Math.max(...x) - Math.min(...x);
    $('#noteN', root).innerHTML = `Φ de Al(111) varía ${fmt(rg(a) * 1000, 0)} meV entre 3 y 9 capas (de ${fmt(a[0], 3)} a ${fmt(a[3], 3)} eV) y la de Mg(0001) ${fmt(rg(m) * 1000, 0)} meV (de ${fmt(m[0], 3)} a ${fmt(m[3], 3)} eV). La línea discontinua es el experimento; el selector cambia entre las dos medidas citadas para Al(111). Con una sola serie por metal no se separa cuánto es cuantización de la lámina y cuánto otros efectos; solo se muestra que con 7–9 capas el cambio entre dos espesores consecutivos es de ${fmt(Math.abs(a[3] - a[2]) * 1000, 0)} meV (Al) y ${fmt(Math.abs(m[3] - m[2]) * 1000, 0)} meV (Mg).`;
  }

  // ---------- tablas ----------
  const rowDec = (id) => {
    const r = R[id];
    return `<tr><td style="text-align:left">${label(id)}</td><td>${fmt(r.fermi, 3)}</td><td>${fmt(r.vVacuum, 3)}</td><td>${fmt(r.vBulk, 3)}</td><td>${fmt(r.barrier, 3)}</td><td>${fmt(r.mu, 3)}</td><td><b>${fmt(r.workFunction, 3)}</b></td></tr>`;
  };
  function drawTables() {
    $('#tblDec', root).innerHTML = `<table class="tbl"><thead><tr><th style="text-align:left">lámina</th><th>E<sub>F</sub></th><th>V<sub>vac</sub></th><th>V̿<sub>bulk</sub></th><th>Δ = V<sub>vac</sub> − V̿<sub>bulk</sub></th><th>μ = E<sub>F</sub> − V̿<sub>bulk</sub></th><th>Φ = Δ − μ</th></tr></thead><tbody>${SHOW.map(([id]) => rowDec(id)).join('')}</tbody></table>
      <p class="tiny" style="margin:6px 0 0;color:var(--muted)">Todos los valores en eV, en la escala del potencial electrostático de SIESTA (V<sub>H</sub>+V<sub>NA</sub>). V̿<sub>bulk</sub> es el promedio macroscópico en el centro de la lámina.</p>`;
    const a = R.al111_n9, m = R.mg0001_n7;
    $('#noteDec', root).innerHTML = `Al(111): Δ = ${fmt(a.barrier, 2)} eV y μ = ${fmt(a.mu, 2)} eV dan Φ = ${fmt(a.barrier, 2)} − ${fmt(a.mu, 2)} = ${fmt(a.workFunction, 2)} eV. Mg(0001): Δ = ${fmt(m.barrier, 2)} y μ = ${fmt(m.mu, 2)}, Φ = ${fmt(m.workFunction, 2)} eV. Φ es una diferencia pequeña de dos números grandes (~10 y ~6 eV), por eso un error de décimas en cualquiera de las dos partes se nota. Aquí μ se mide desde el potencial <em>electrostático</em> medio (V<sub>H</sub>+V<sub>NA</sub>, sin V<sub>xc</sub>), así que incluye energía cinética e intercambio-correlación. El promedio macroscópico en la capa central varía ${fmt(a.macroSpread * 1000, 0)} meV en Al(111) y ${fmt(m.macroSpread * 1000, 0)} meV en Mg(0001), y ${fmt(R.al100_n7.macroSpread * 1000, 0)} meV en Al(100), la lámina con el valor menos plano.`;
    const faces = [['al111_n9', 'al111'], ['al100_n7', 'al100'], ['al110_n11', 'al110'], ['mg0001_n7', 'mg0001']];
    $('#tblFace', root).innerHTML = `<table class="tbl"><thead><tr><th style="text-align:left">cara</th><th>capas</th><th>Φ SIESTA (LDA, DZP)</th><th>LDA publicado</th><th>experimento</th><th>Φ − exp. (media)</th></tr></thead><tbody>${faces.map(([id, k]) => {
      const r = R[id], e = EXP[k], mean = e.reduce((s, x) => s + x[1], 0) / e.length;
      return `<tr><td style="text-align:left">${r.el}${r.face}</td><td>${r.nLayers}</td><td><b>${fmt(r.workFunction, 2)}</b></td><td>${LDA_LIT[k] ? fmt(LDA_LIT[k], 2) : '—'}</td><td>${e.map((x) => fmt(x[1], 2)).join(' · ')}</td><td>${fmt(r.workFunction - mean, 2)}</td></tr>`;
    }).join('')}</tbody></table>
    <p class="tiny" style="margin:6px 0 0;color:var(--muted)">Experimento Al: Grepstad et al. (1976) · Eastment y Mee (1973), en ese orden; Mg(0001): Michaelson (1977). LDA publicado: LDA/CA, tabla I de arXiv:0911.0088.</p>`;
    const ord = faces.slice(0, 3).map(([id]) => [id, R[id].workFunction]).sort((a, b) => b[1] - a[1]).map((x) => R[x[0]].face);
    $('#noteFace', root).innerHTML = `Orden calculado de mayor a menor Φ: Al${ord.join(' > Al')}. Los dos conjuntos experimentales no concuerdan entre sí para (100) y (110) (4.41 frente a 4.20 y 4.28 frente a 4.06 eV): la diferencia entre ellos, hasta 0.21 eV, es comparable a la desviación del cálculo, de modo que con estos datos no se puede decir que el cálculo reproduzca el orden experimental; el motivo que citan los autores del segundo conjunto es la contaminación con oxígeno (inferencia de la fuente, no verificada aquí). El LDA publicado difiere del nuestro en hasta ${fmt(Math.max(...['al111', 'al100', 'al110'].map((k, i) => Math.abs(R[['al111_n9', 'al100_n7', 'al110_n11'][i]].workFunction - LDA_LIT[k]))), 2)} eV, y no se aisló la causa: pueden contribuir la base (ver la tabla de sensibilidad), el pseudopotencial y la geometría sin relajar.`;
    const vac = ['al111_n5_v10', 'al111_n5', 'al111_n5_v26'].filter((i) => R[i]);
    $('#tblVac', root).innerHTML = `<table class="tbl"><thead><tr><th style="text-align:left">vacío (Å)</th><th>celda c (Å)</th><th>Φ (eV)</th><th>meseta plana a (μeV)</th></tr></thead><tbody>${vac.map((i) => `<tr><td style="text-align:left">${fmt(R[i].vacuum, 1)}</td><td>${fmt(R[i].L, 1)}</td><td><b>${fmt(R[i].workFunction, 3)}</b></td><td>${fmt(R[i].vacuumFlat * 1e6, 0)}</td></tr>`).join('')}</tbody></table>
      <p class="tiny" style="margin:6px 0 0;color:var(--muted)">Al(111), 5 capas; el vacío es la distancia entre la última capa y la imagen periódica.</p>`;
    const vv = vac.map((i) => R[i].workFunction), dv = Math.max(...vv) - Math.min(...vv);
    $('#noteVac', root).textContent = `Φ cambia ${fmt(dv * 1000, 0)} meV entre ${fmt(R[vac[0]].vacuum, 0)} y ${fmt(R[vac[vac.length - 1]].vacuum, 0)} Å de vacío. ${R[vac[0]].vacuumFlat > 0.01 ? 'Con el vacío más corto el potencial todavía no es una meseta (columna de la derecha), así que su Φ es menos fiable.' : ''}`;
  }
  function drawSens() {
    const rows = [
      ['SZ', 'al111_n5_sz', 'mg0001_n7_sz'], ['DZ', 'al111_n5_dz', 'mg0001_n7_dz'], ['DZP, alcance por defecto (EnergyShift 0.02 Ry ≈ 272 meV)', 'al111_n5', 'mg0001_n7'], ['TZP, alcance por defecto', 'al111_n5_tzp', 'mg0001_n7_tzp'],
      ['DZP, MeshCutoff 400 Ry (en vez de 250)', 'al111_n5_m400', 'mg0001_n7_m400'], ['DZP, EnergyShift 5 meV (orbitales más extendidos)', 'al111_n5_es5', 'mg0001_n7_es5'], ['DZP, EnergyShift 1 meV', 'al111_n5_es1', 'mg0001_n7_es1'],
      ['DZP, Al con a = 3.9865 Å (LDA con estos pseudos)', 'al111_n5_alda', null],
    ].filter((r) => R[r[1]]);
    const cell = (id, ref) => (id && R[id] ? `${fmt(R[id].workFunction, 2)} <span style="color:var(--muted)">(${R[id].workFunction - R[ref].workFunction >= 0 ? '+' : '−'}${fmt(Math.abs(R[id].workFunction - R[ref].workFunction), 2)})</span>` : '—');
    $('#tblSens', root).innerHTML = `<table class="tbl"><thead><tr><th style="text-align:left">cambio</th><th>Al(111), 5 capas</th><th>Mg(0001), 7 capas</th></tr></thead><tbody>${rows.map((r) => `<tr${r[1] === 'al111_n5' ? ' style="font-weight:600"' : ''}><td style="text-align:left;white-space:normal">${r[0]}</td><td>${cell(r[1], 'al111_n5')}</td><td>${cell(r[2], 'mg0001_n7')}</td></tr>`).join('')}</tbody></table>
      <p class="tiny" style="margin:6px 0 0;color:var(--muted)">Φ en eV; entre paréntesis, la diferencia con la fila por defecto.</p>`;
    const mg = MG_SENS.filter((i) => R[i]).map((i) => R[i].workFunction), al = ['al111_n5_sz', 'al111_n5_dz', 'al111_n5', 'al111_n5_tzp', 'al111_n5_es5', 'al111_n5_es1'].filter((i) => R[i]).map((i) => R[i].workFunction);
    const extra = R.al111_n9_es5 ? ` Con orbitales extendidos (5 meV) y 9 capas Al(111) da ${fmt(R.al111_n9_es5.workFunction, 2)} eV, a ${fmt(Math.abs(R.al111_n9_es5.workFunction - 4.25), 2)} eV del experimento (4.24–4.26).` : '';
    $('#noteSens', root).innerHTML = `<b>La malla y la constante de red casi no importan; la base sí.</b> Subir MeshCutoff de 250 a 400 Ry cambia Φ en menos de 3 meV, y pasar de la constante experimental del Al a la de la LDA con estos pseudos (−1.6 %) la cambia ≤0.02 eV en las cuatro caras probadas (1 meV a 5 capas). En cambio Φ pasa de ${fmt(Math.min(...al), 2)} a ${fmt(Math.max(...al), 2)} eV en Al y de ${fmt(Math.min(...mg), 2)} a ${fmt(Math.max(...mg), 2)} eV en Mg según el tamaño de la base y el alcance de los orbitales. Es esperable: Φ depende de la cola de la densidad en el vacío, que una base de alcance corto representa mal. SZ y DZ no sirven para esta propiedad; DZP y TZP con el alcance por defecto dan casi lo mismo entre sí (≤0.05 eV) pero no están convergidos respecto al alcance: al extenderlo, Al(111) sube ${fmt(R.al111_n5_es5.workFunction - R.al111_n5.workFunction, 2)} eV y se queda ahí (5 y 1 meV difieren ${fmt(Math.abs(R.al111_n5_es1.workFunction - R.al111_n5_es5.workFunction) * 1000, 0)} meV), pero Mg sigue subiendo (de ${fmt(R.mg0001_n7_es5.workFunction, 2)} a ${fmt(R.mg0001_n7_es1.workFunction, 2)} eV) y queda por encima del experimento (3.84); no se investigó por qué.${extra} Las gráficas de arriba usan la base por defecto, que subestima Φ; los valores absolutos de este módulo deben leerse con esa reserva, y las tendencias (espesor, vacío, caras) con menos.`;
  }
  const csv = () => {
    let t = `# DFT Lab · potencial electrostático · SIESTA ${D.siesta} ${D.xc} DZP · eV\nlamina,capas,E_F,V_vac,V_bulk,Delta,mu,Phi,vacio_A\n`;
    for (const [id, r] of Object.entries(R)) t += `${id},${r.nLayers},${r.fermi},${r.vVacuum},${r.vBulk},${r.barrier},${r.mu},${r.workFunction},${r.vacuum}\n`;
    return t;
  };
  $('#dlCsv', root).onclick = () => downloadText(csv(), 'funcion_trabajo_laminas.csv', 'text/csv');
  $('#dlFdf', root).onclick = () => downloadText(run().fdf, `${S.run}.fdf`);
  const drawFdf = () => ($('#fdfPre', root).textContent = run().fdf);

  // ---------- experimento ----------
  $('#expSel', root).innerHTML = `<button data-v="0">exp. Al(111): ${fmt(EXP.al111[0][1], 2)}</button><button data-v="1">${fmt(EXP.al111[1][1], 2)}</button>`;
  seg($('#expSel', root), '0', (v) => { S.exp = +v; drawN(); });

  // ---------- usuario ----------
  let U = { grid: null, ef: null, name: '' };
  const uState = () => ({ axis: +$('#uAxis', root).querySelector('[aria-pressed="true"]').dataset.v, w: +$('#uD', root).value || 2.34, ef: $('#uEf', root).value === '' ? null : +$('#uEf', root).value });
  function drawUser() {
    const g = U.grid; if (!g) return;
    const { axis, w, ef } = uState();
    const toEv = g.units === 'Ry' ? RY : 1;
    const avg = planarAverage(g, axis, 0, toEv), L = Math.hypot(...g.cell[axis]);
    const mac = macroAvg(avg.map((p) => p[1]), L, w), macD = avg.map((p, i) => [p[0], mac[i]]);
    const vmax = Math.max(...avg.map((p) => p[1])), vmin = Math.min(...avg.map((p) => p[1]));
    const useEf = ef != null ? ef : U.ef;
    const unit = g.units === 'Ry' ? 'eV' : g.units;
    chart($('#cvUser', root), {
      xlim: [0, L], ylim: [vmin - (vmax - vmin) * 0.05, vmax + (vmax - vmin) * 0.12], xlabel: `posición a lo largo de ${'abc'[axis]} (Å)`, ylabel: `promedio planar (${unit})`, legend: 'left',
      series: [{ d: avg, color: css('--accent'), width: 1.8, label: 'promedio planar' }, { d: macD, color: css('--psi-pos'), width: 2.2, label: `macroscópico (d = ${fmt(w, 2)} Å)` }],
      hlines: [{ y: vmax, label: `máx = ${fmt(vmax, 3)}`, color: css('--ink'), dash: [5, 3] }].concat(useEf != null && g.units === 'Ry' ? [{ y: useEf, label: `E_F = ${fmt(useEf, 3)}`, color: css('--bad'), dash: [5, 3] }] : []),
      read: (x) => { if (x == null) return ''; const i = Math.max(0, Math.min(avg.length - 1, Math.round(x / L * avg.length))); return `${fmt(avg[i][0], 2)} Å · ${fmt(avg[i][1], 3)} ${unit}`; },
      readEl: $('#userRead', root),
    });
    const phi = useEf != null && g.units === 'Ry' ? vmax - useEf : null;
    $('#userInfo', root).innerHTML = [['archivo', esc(U.name)], ['malla', g.mesh.join(' × ')], ['celda a, b, c', g.cell.map((v) => fmt(Math.hypot(...v), 3)).join(', ') + ' Å'], ['unidades', g.units === 'Ry' ? 'Ry → eV' : g.units],
      ['máx. del promedio planar', fmt(vmax, 4) + ' ' + unit], ['E_F', useEf == null ? 'sin dato: sube el .out o escríbela' : fmt(useEf, 4) + ' eV'], ['Φ = máx − E_F', phi == null ? '—' : `<b>${fmt(phi, 3)} eV</b>`]]
      .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  }
  function addFiles(files) {
    const err = $('#userErr', root); err.hidden = true;
    Promise.all([...files].map((f) => f.arrayBuffer().then((b) => [f, b]))).then(view.guard((list) => {
      try {
        for (const [f, buf] of list) {
          if (/\.out$/i.test(f.name)) {
            const m = /siesta:\s+Fermi =\s+(\S+)/.exec(new TextDecoder().decode(buf));
            if (!m) throw new Error('el .out no tiene la línea «siesta: Fermi =»');
            U.ef = +m[1]; $('#uEf', root).value = '';
          } else { U.grid = parseGrid(buf, f.name); U.name = f.name; }
        }
        if (!U.grid) throw new Error('falta un archivo de malla (.VH o .VT)');
        $('#userBox', root).hidden = false; drawUser();
      } catch (e) { err.hidden = false; err.textContent = 'No se pudo leer: ' + e.message; }
    }));
  }
  const drop = $('#drop', root), inp = $('#fileIn', root);
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
  inp.addEventListener('change', () => { if (inp.files.length) addFiles(inp.files); });
  seg($('#uAxis', root), '2', drawUser);
  $('#uD', root).addEventListener('input', drawUser);
  $('#uEf', root).addEventListener('input', drawUser);

  // ---------- controles ----------
  seg($('#sysSel', root), S.run, (v) => { S.run = v; drawV(); drawRho(); drawFdf(); });
  seg($('#qSel', root), S.q, (v) => { S.q = v; drawV(); });
  const all = () => { drawV(); drawRho(); drawN(); drawTables(); drawSens(); drawFdf(); };
  view.onTheme(() => { drawV(); drawRho(); drawN(); drawUser(); });
  all();
  view.observer(new ResizeObserver(view.guard(() => { if (root.offsetParent) { drawV(); drawRho(); drawN(); drawUser(); } }))).observe(root);
}
export function destroy() {}
