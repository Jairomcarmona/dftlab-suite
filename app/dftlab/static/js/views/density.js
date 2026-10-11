// Aprender 9 · Densidad y cargas: ρ, Δρ = ρ − Σρ_atómica en planos y perfiles, y cargas de Mulliken, Hirshfeld y Voronoi (SIESTA 5.4.2, LDA).
import { $, $$, css, alpha, rgb, onTheme, fmt, esc, seg, download, downloadText, toast } from '../core/ui.js';
import { chart, exportBar } from '../core/chart.js';
import { parseGrid, planeSlice, planarAverage, sampleFrac, gridIntegral } from '../siesta/rho.js';
import D from '../data/rho.json';

const BOHR = 0.529177210903, TO_A3 = 1 / BOHR ** 3;
const SYS = ['si', 'mgo', 'h2o'];
const TITLE = { si: 'Si', mgo: 'MgO', h2o: 'H₂O' };
const KEY_ATOM = { mgo: 0, h2o: 0 };                       // átomo cuya carga se grafica frente a la base: Mg en MgO, O en H₂O
const PLASMA = [[13, 8, 135], [84, 2, 163], [139, 10, 165], [185, 50, 137], [219, 92, 104], [244, 136, 73], [254, 188, 43], [240, 249, 33]];

function theory() { return `
  <h3>Qué es la densidad que calcula SIESTA</h3>
  <p>En Kohn–Sham la densidad es la suma de los orbitales ocupados al cuadrado. SIESTA la guarda como matriz densidad ρ<sub>μν</sub> sobre la base de orbitales atómicos y la evalúa en una malla de espacio real:</p>
  <div class="eq">ρ(<b>r</b>) = Σ<sub>μν</sub> ρ<sub>μν</sub> φ<sub>μ</sub>(<b>r</b>) φ<sub>ν</sub>(<b>r</b>), &nbsp; ∫ρ d³r = N<sub>valencia</sub></div>
  <p>Es la densidad de <em>valencia</em>: el core está dentro del pseudopotencial y no aparece. Por eso el Mg de este módulo (pseudo con semicore 2s2p, 10 e⁻) muestra picos de más de 20 e/Å³ cerca del núcleo y el Si (4 e⁻ por átomo) no. Con <code>SaveRho true</code> sale <code>.RHO</code> y con <code>SaveDeltaRho true</code> sale <code>.DRHO</code>, ambos en e/Bohr³.</p>
  <h3>Dónde se forma el enlace: Δρ</h3>
  <p>La densidad total oculta casi todo: se parece a la de átomos sueltos. La diferencia con los átomos neutros superpuestos sí enseña la química:</p>
  <div class="eq">Δρ(<b>r</b>) = ρ(<b>r</b>) − Σ<sub>A</sub> ρ<sub>A</sub><sup>átomo</sup>(<b>r</b> − <b>R</b><sub>A</sub>), &nbsp; ∫Δρ d³r = 0</div>
  <p>Δρ &gt; 0 es carga que se acumuló, Δρ &lt; 0 la que se fue. La integral es cero porque ambos lados tienen los mismos electrones. En el Si Δρ se acumula en el punto medio del enlace; en el MgO el Mg pierde carga de sus capas externas y el O la gana, con una redistribución dentro de cada ion.</p>
  <h3>Tres maneras de repartir la carga entre átomos</h3>
  <p>La carga de un átomo en una molécula o cristal <em>no es un observable</em>: hay que decidir cómo partir ρ. SIESTA imprime tres:</p>
  <div class="eq">Mulliken: q<sub>A</sub> = Z<sub>A</sub> − Σ<sub>μ∈A</sub> (ρS)<sub>μμ</sub> &nbsp;·&nbsp; Hirshfeld: q<sub>A</sub> = Z<sub>A</sub> − ∫ w<sub>A</sub> ρ, &nbsp; w<sub>A</sub> = ρ<sub>A</sub><sup>átomo</sup> / Σ<sub>B</sub>ρ<sub>B</sub><sup>átomo</sup> &nbsp;·&nbsp; Voronoi: q<sub>A</sub> = Z<sub>A</sub> − ∫<sub>celda de A</sub> ρ</div>
  <p><b>Mulliken</b> reparte por mitades el solapamiento entre funciones de base, así que depende de la base (sube o baja según se agreguen funciones difusas) y puede dar poblaciones orbitales negativas. <b>Hirshfeld</b> usa los átomos neutros como peso y por construcción subestima la transferencia iónica. <b>Voronoi</b> corta el espacio con planos a mitad de camino entre átomos, sin tener en cuenta que un anión es más grande que un catión. Ninguna de las tres es «la» carga; sirven para comparar sistemas con el mismo método, nunca para pegar el número a un estado de oxidación.</p>
  <h3>El dipolo sí es observable</h3>
  <p>El momento dipolar de una molécula se obtiene de la densidad completa, no de cargas puntuales:</p>
  <div class="eq">μ = Σ<sub>A</sub> Z<sub>A</sub><sup>val</sup> <b>R</b><sub>A</sub> − ∫ <b>r</b> ρ(<b>r</b>) d³r</div>
  <p>Con cargas atómicas solo se recupera la parte «de carga puntual» y se pierde la polarización dentro de cada átomo (los dipolos atómicos). Es válido en una caja aislada mientras ρ ≈ 0 en sus caras.</p>
  <p class="src">Mulliken, J. Chem. Phys. 23, 1833 (1955) · Hirshfeld, Theor. Chim. Acta 44, 129 (1977) · Fonseca Guerra et al., J. Comput. Chem. 25, 189 (2004) (deformación de Voronoi) · Soler et al., J. Phys.: Condens. Matter 14, 2745 (2002) (SIESTA) · Clough et al., J. Chem. Phys. 59, 2254 (1973) (dipolo del agua).</p>`; }

// ---------- color maps ----------
const lerp3 = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t));
function seqColor(t) { t = Math.max(0, Math.min(1, t)); const x = t * (PLASMA.length - 1), i = Math.min(PLASMA.length - 2, Math.floor(x)); return lerp3(PLASMA[i], PLASMA[i + 1], x - i); }
function divColor(t) {                                       // t∈[−1,1]: azul (pérdida) · neutro · naranja (ganancia)
  const mid = rgb(css('--panel-2')), neg = rgb(css('--psi-neg')), pos = rgb(css('--psi-pos'));
  t = Math.max(-1, Math.min(1, t)); return t < 0 ? lerp3(mid, neg, -t) : lerp3(mid, pos, t);
}
function tickStep(span) { const raw = span / 6, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p; }
const fmtT = (v) => { const a = Math.abs(v); const s = a === 0 ? '0' : a >= 100 ? a.toFixed(0) : a >= 1 ? String(+a.toFixed(2)) : String(+a.toPrecision(2)); return (v < 0 ? '−' : '') + s; };
const percentile = (arr, p) => { const s = Float32Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

/** Mapa en color de un campo en un plano con ejes en Å, átomos y barra de color. Devuelve utilidades para la lectura con el cursor. */
function heat(cv, bar, o) {
  const { n1, n2, len1, len2, values, mode, lo, hi, scale, atoms, ref, xlabel, ylabel, unit } = o;
  const r = cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.max(200, r.width), PL = 44, PR = 12, PT = 8, PB = 30, aw = W - PL - PR, ah = Math.min(aw * len2 / len1, 520);
  const H = ah + PT + PB; cv.style.height = H + 'px';
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
  const color = (v) => {
    if (mode === 'div') return divColor(v / hi);
    const t = scale === 'sqrt' ? Math.sqrt(Math.max(0, v - lo) / (hi - lo)) : (v - lo) / (hi - lo);
    return seqColor(t);
  };
  const img = c.createImageData(n1, n2);
  for (let j = 0; j < n2; j++) for (let i = 0; i < n1; i++) {
    const col = color(values[j * n1 + i]), p = ((n2 - 1 - j) * n1 + i) * 4;
    img.data[p] = col[0]; img.data[p + 1] = col[1]; img.data[p + 2] = col[2]; img.data[p + 3] = 255;
  }
  const off = document.createElement('canvas'); off.width = n1; off.height = n2; off.getContext('2d').putImageData(img, 0, 0);
  c.imageSmoothingEnabled = true; c.drawImage(off, PL, PT, aw, ah);
  const X = (s) => PL + s / len1 * aw, Y = (t) => PT + ah - t / len2 * ah;
  c.strokeStyle = css('--line'); c.lineWidth = 1; c.strokeRect(PL - 0.5, PT - 0.5, aw + 1, ah + 1);
  c.fillStyle = css('--muted'); c.font = '11px ' + css('--f-data');
  const st = tickStep(Math.max(len1, len2));
  c.textAlign = 'center'; c.textBaseline = 'top';
  for (let v = Math.ceil((-ref[0]) / st) * st; v + ref[0] <= len1 + 1e-9; v += st) { const x = X(v + ref[0]); c.fillText(fmtT(+v.toFixed(6)), x, PT + ah + 4); c.beginPath(); c.moveTo(x, PT + ah); c.lineTo(x, PT + ah + 3); c.strokeStyle = css('--faint'); c.stroke(); }
  c.textAlign = 'right'; c.textBaseline = 'middle';
  for (let v = Math.ceil((-ref[1]) / st) * st; v + ref[1] <= len2 + 1e-9; v += st) { const y = Y(v + ref[1]); c.fillText(fmtT(+v.toFixed(6)), PL - 6, y); c.beginPath(); c.moveTo(PL - 3, y); c.lineTo(PL, y); c.stroke(); }
  c.fillStyle = css('--muted'); c.font = '11px ' + css('--f-label'); c.textAlign = 'center'; c.textBaseline = 'bottom';
  c.fillText(xlabel, PL + aw / 2, H - 1); c.save(); c.translate(11, PT + ah / 2); c.rotate(-Math.PI / 2); c.textBaseline = 'top'; c.fillText(ylabel, 0, -11); c.restore();
  for (const a of atoms) {
    const x = X(a.s), y = Y(a.t); c.beginPath(); c.arc(x, y, 5, 0, 7); c.fillStyle = css('--ink'); c.fill(); c.lineWidth = 1.5; c.strokeStyle = css('--panel'); c.stroke();
    if (a.el) { c.font = '600 11px ' + css('--f-label'); c.textAlign = 'left'; c.textBaseline = 'middle'; c.lineWidth = 3; c.strokeStyle = alpha(css('--panel'), .85); c.strokeText(a.el, x + 8, y - 8); c.fillStyle = css('--ink'); c.fillText(a.el, x + 8, y - 8); }
  }
  if (o.hover) { const x = X(o.hover.s), y = Y(o.hover.t); c.strokeStyle = css('--ink'); c.lineWidth = 1.2; c.beginPath(); c.arc(x, y, 6.5, 0, 7); c.stroke(); }
  // barra de color
  const rb = bar.getBoundingClientRect(), BW = Math.max(100, rb.width), BH = 44; bar.width = Math.round(BW * dpr); bar.height = Math.round(BH * dpr);
  const b = bar.getContext('2d'); b.setTransform(dpr, 0, 0, dpr, 0, 0); b.clearRect(0, 0, BW, BH);
  const bw = Math.min(aw, BW - 8), bx = (BW - bw) / 2;
  for (let i = 0; i < bw; i++) { const u = i / (bw - 1); const col = mode === 'div' ? divColor((2 * u - 1) * 1) : seqColor(scale === 'sqrt' ? u : u); b.fillStyle = `rgb(${col})`; b.fillRect(bx + i, 0, 1.5, 10); }
  b.fillStyle = css('--muted'); b.font = '11px ' + css('--f-data'); b.textBaseline = 'top';
  const L = mode === 'div' ? -hi : lo, Rr = hi;
  b.textAlign = 'left'; b.fillText(fmtT(L), bx, 14); b.textAlign = 'right'; b.fillText(fmtT(Rr), bx + bw, 14);
  b.textAlign = 'center'; b.fillText(mode === 'div' ? '0' : (scale === 'sqrt' ? 'escala √' : 'escala lineal'), bx + bw / 2, 14);
  b.font = '11px ' + css('--f-label'); b.fillText(unit, bx + bw / 2, 28);
  return {
    at(ev) {
      const rr = cv.getBoundingClientRect(), s = (ev.clientX - rr.left - PL) / aw * len1, t = (PT + ah - (ev.clientY - rr.top)) / ah * len2;
      if (s < 0 || t < 0 || s > len1 || t > len2) return null;
      const i = Math.min(n1 - 1, Math.round(s / len1 * (n1 - 1))), j = Math.min(n2 - 1, Math.round(t / len2 * (n2 - 1)));
      return { s, t, v: values[j * n1 + i], x: s - ref[0], y: t - ref[1] };
    },
  };
}

function csvOfPlane(P, vals, ref, name) {
  let out = `# DFT Lab · ${name}\n# x(Å), y(Å) relativos al átomo 1; una fila por punto del plano\nx,y,valor\n`;
  for (let j = 0; j < P.n2; j++) for (let i = 0; i < P.n1; i++) out += `${(P.len1 * i / (P.n1 - 1) - ref[0]).toFixed(4)},${(P.len2 * j / (P.n2 - 1) - ref[1]).toFixed(4)},${vals[j * P.n1 + i]}\n`;
  return out;
}
function pngOf(cv, name) { cv.toBlob((b) => b && download(b, name + '.png'), 'image/png'); }

export function mount(root) {
  const S = { sys: 'mgo', field: 'drho', scale: 'sqrt', sat: 0, basis: 'DZP', hover: null };
  let heatApi = null, userGrid = null;
  const sysBtn = (list, id) => `<div class="seg" id="${id}">${list.map(([v, l]) => `<button data-v="${v}">${l}</button>`).join('')}</div>`;
  root.innerHTML = `
  <div class="pghead"><div>
    <div class="kicker">Aprender · 9</div><h1>Densidad y cargas</h1>
    <p class="lede">La densidad electrónica de Si, MgO y H₂O calculada con SIESTA (LDA, DZP), la diferencia con los átomos libres que muestra dónde está el enlace, y las cargas de Mulliken, Hirshfeld y Voronoi: para MgO la carga del Mg va de +0.30 a +1.34 e según el método y la base.</p>
  </div></div>
  <div class="pgrid">
    <article class="panel theory sticky">${theory()}</article>
    <div class="charts">
      <section class="panel wide"><div class="ph"><h2>Mapa de densidad en un plano</h2><div class="btnrow"><button class="tiny" id="dlPng">PNG</button><button class="tiny" id="dlCsv">CSV</button></div></div>
        <div class="pb">
          <div class="btnrow" style="gap:10px;flex-wrap:wrap;margin-bottom:8px">
            ${sysBtn(SYS.map((k) => [k, TITLE[k]]), 'sysSel')}
            ${sysBtn([['rho', 'ρ'], ['at', 'Σρ átomos'], ['drho', 'Δρ']], 'fldSel')}
            <span id="scaleWrap">${sysBtn([['sqrt', 'escala √'], ['lin', 'lineal']], 'scaleSel')}</span>
            <label class="sl">saturación <input type="range" id="satIn" min="-2" max="2" step="0.1" value="0"><output id="satOut"></output></label>
          </div>
          <canvas id="cvMap" style="width:100%;display:block;cursor:crosshair" aria-label="Mapa de densidad"></canvas><canvas id="cvBar" style="width:100%;height:44px;display:block"></canvas>
          <div class="readout" id="mapRead"></div><p class="note" id="mapNote"></p>
        </div></section>

      <section class="panel"><div class="ph"><h2>Perfil a lo largo del enlace</h2><div class="seg" id="yScale"><button data-v="lin">lineal</button><button data-v="log">log</button></div></div>
        <div class="pb"><canvas data-export="densidad_perfil" id="cvLine" style="height:260px"></canvas><div class="readout" id="lineRead"></div></div></section>
      <section class="panel"><div class="ph"><h2>Δρ a lo largo del enlace</h2></div>
        <div class="pb"><canvas data-export="deltarho_perfil" id="cvDl" style="height:260px"></canvas><p class="note" id="dlNote"></p></div></section>

      <section class="panel wide"><div class="ph"><h2>Cargas atómicas: tres definiciones</h2><div class="seg" id="basisSel">${['SZ', 'DZ', 'DZP', 'TZP'].map((b) => `<button data-v="${b}">${b}</button>`).join('')}</div></div>
        <div class="pb"><div class="split2" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))"><div id="chTbl"></div><div><canvas data-export="cargas_vs_base" id="cvCh" style="height:270px"></canvas><div class="readout" id="chRead"></div></div></div>
          <p class="note" id="chNote"></p></div></section>

      <section class="panel" id="orbPanel"><div class="ph"><h2>Poblaciones orbitales de Mulliken</h2></div>
        <div class="pb"><div class="tblwrap" id="orbTbl"></div><p class="note" id="orbNote"></p></div></section>
      <section class="panel" id="dipPanel"><div class="ph"><h2>Dipolo del agua</h2></div>
        <div class="pb"><div class="tblwrap" id="dipTbl"></div><p class="note" id="dipNote"></p></div></section>

      <section class="panel wide"><div class="ph"><h2>Tu propia malla · .RHO, .DRHO, .VH…</h2></div>
        <div class="pb">
          <label class="drop" id="drop"><input type="file" id="fileIn" accept=".RHO,.DRHO,.VH,.VT,.VNA,.RHOXC,.LDOS,.IORHO,.TOTAL_CHARGE,.BADER" hidden>Arrastra aquí un archivo de malla de SIESTA (o haz clic). Nada se ejecuta ni se envía: se lee en el navegador.</label>
          <div id="userBox" hidden>
            <div class="btnrow" style="gap:10px;flex-wrap:wrap;margin:10px 0">
              ${sysBtn([['2', 'plano a–b'], ['0', 'plano b–c'], ['1', 'plano a–c']], 'uAxis')}
              <label class="sl">posición <input type="range" id="uPos" min="0" max="1" step="0.01" value="0"><output id="uPosOut"></output></label>
            </div>
            <dl class="kv two" id="userInfo"></dl>
            <canvas id="cvUser" style="width:100%;display:block"></canvas><canvas id="cvUserBar" style="width:100%;height:44px;display:block"></canvas>
            <canvas data-export="promedio_planar" id="cvUserAvg" style="height:220px"></canvas>
            <p class="note">El plano se dibuja en coordenadas fraccionarias de la celda (a, b, c); si la celda no es ortogonal la imagen se ve deformada. El promedio planar es la media sobre las otras dos direcciones.</p>
          </div>
          <p class="note" id="userErr" hidden></p>
        </div></section>

      <section class="panel"><div class="ph"><h2>Entrada de SIESTA usada</h2><div class="btnrow"><button class="tiny" id="dlFdf">exportar .fdf</button></div></div>
        <div class="pb"><pre class="code" style="max-height:300px;overflow:auto" id="fdfPre"></pre><p class="note">Las palabras clave que producen los archivos son <code>SaveRho</code> (.RHO), <code>SaveDeltaRho</code> (.DRHO), <code>WriteMullikenPop 1</code>, <code>WriteHirshfeldPop</code> y <code>WriteVoronoiPop</code>.</p></div></section>
    </div>
  </div>
  <footer class="prov">SIESTA ${D.siesta}, ${D.xc}, base DZP salvo la serie SZ/DZ/DZP/TZP, pseudos ONCV de la biblioteca de DFT Lab (Si: Si.psf; Mg, O, H: .psml LDA), MeshCutoff 300 Ry, k 8×8×8 (Si) y 6×6×6 (MgO) con desplazamiento, H₂O en caja cúbica de 10 Å en Γ, DM.Tolerance 10⁻⁶. Geometrías: Si a = 5.431 Å; MgO a = 4.212 Å; H₂O experimental (O–H 0.9572 Å, H–O–H 104.52°), sin relajar. Las densidades son de valencia (el core está en el pseudopotencial). Entradas y salidas en corridas/rho.tar.gz.</footer>`;
  $$('canvas[data-export]', root).forEach((cv) => cv.closest('.panel').querySelector('.ph').append(exportBar(cv, cv.dataset.export)));

  const sys = () => D.systems[S.sys];
  const fieldValues = () => {
    const P = sys().plane;
    if (S.field === 'rho') return P.rho;
    if (S.field === 'drho') return P.drho;
    return P.rho.map((v, i) => v - P.drho[i]);
  };
  const autoRange = () => {
    const P = sys().plane, v = fieldValues();
    if (S.field === 'drho') return { mode: 'div', lo: 0, hi: percentile(v.map(Math.abs), 0.98) };
    return { mode: 'seq', lo: 0, hi: percentile(v, 0.995) };
  };
  const fieldLabel = { rho: 'ρ', at: 'Σρ átomos', drho: 'Δρ' };

  function drawMap() {
    const sy = sys(), P = sy.plane, vals = fieldValues(), a = autoRange();
    const hi = a.hi * 2 ** S.sat;
    $('#satOut', root).textContent = S.sat === 0 ? 'auto' : '×' + fmtT(2 ** S.sat);
    $('#scaleWrap', root).style.display = a.mode === 'div' ? 'none' : '';
    heatApi = heat($('#cvMap', root), $('#cvBar', root), { n1: P.n1, n2: P.n2, len1: P.len1, len2: P.len2, values: vals, mode: a.mode, lo: a.lo, hi, scale: S.scale,
      atoms: P.atoms, ref: P.ref, xlabel: 'x (Å, origen en el átomo 1)', ylabel: 'y (Å)', unit: fieldLabel[S.field] + ' (e/Å³)', hover: S.hover });
    const notes = {
      rho: 'Densidad total de valencia. Se concentra alrededor de los núcleos y en los enlaces; con escala √ se distingue la zona de enlace de la de los cores. En MgO el pico del Mg es su semicore 2s2p.',
      at: 'Suma de átomos neutros aislados puestos en las posiciones del cristal (ρ − Δρ). Es la referencia de Δρ: no sabe nada de los enlaces.',
      drho: S.sys === 'si' ? 'Naranja: carga ganada; azul: perdida. En el Si la carga se acumula en el punto medio de cada enlace y se vacía de los cores y de los huecos del diamante: es el enlace covalente.'
        : S.sys === 'mgo' ? 'Naranja: carga ganada; azul: perdida. El mayor cambio (azul intenso) está en el núcleo del Mg, donde la base y el cristal reajustan su semicore 2s2p respecto al átomo libre; alrededor del O y entre los iones hay ganancia moderada. Qué parte de esto es transferencia Mg→O y qué parte reajuste interno no se separa mirando solo Δρ.'
        : 'Naranja: carga ganada; azul: perdida. Mira la distribución alrededor del O y de los H en el plano de la molécula: la forma depende de la base (compara con la serie de cargas más abajo).',
    };
    $('#mapNote', root).textContent = notes[S.field];
    $('#mapRead', root).innerHTML = `<span>${esc(sy.name)} · ${esc(P.desc)}</span><span>∫ρ = <b>${fmt(sy.check.intRho, 4)}</b> e (esperado ${sy.nElectrons})</span><span>∫Δρ = <b>${fmt(sy.check.intDrho, 4)}</b> e</span><span>Δρ mín <b>${fmt(P.drhoMin, 3)}</b> · máx <b>${fmt(P.drhoMax, 3)}</b> e/Å³</span>`;
  }
  function readHover(v) {
    $('#mapRead', root).innerHTML = v ? `<span>x <b>${fmt(v.x, 2)}</b> Å · y <b>${fmt(v.y, 2)}</b> Å</span><span>${fieldLabel[S.field]} = <b>${fmt(v.v, S.field === 'drho' ? 4 : 3)}</b> e/Å³ (${fmt(v.v * BOHR ** 3, 5)} e/Bohr³)</span>` : '';
    if (!v) drawMap();
  }
  const mapCv = $('#cvMap', root);
  mapCv.addEventListener('pointermove', (ev) => { const v = heatApi && heatApi.at(ev); S.hover = v; if (v) { drawMap(); readHover(v); } else readHover(null); });
  mapCv.addEventListener('pointerleave', () => { S.hover = null; drawMap(); });

  function drawLines() {
    const L = sys().line, lg = $('#yScale', root).querySelector('[aria-pressed="true"]').dataset.v === 'log';
    const at = L.rho.map(([x, y], i) => [x, y - L.drho[i][1]]);
    const clamp = (arr) => lg ? arr.map(([x, y]) => [x, Math.max(y, 1e-3)]) : arr;
    const ymax = Math.max(...L.rho.map((p) => p[1]));
    const X = L.rho[L.rho.length - 1][0];
    const mk = (a) => ({ x: a.x, label: a.el, color: css('--faint'), dash: [3, 3] });
    chart($('#cvLine', root), {
      xlim: [0, X], ylim: lg ? [1e-3, ymax * 2] : [0, ymax * 1.08], logy: lg, xlabel: 'distancia a lo largo del enlace (Å)', ylabel: 'ρ (e/Å³)', legend: true,
      series: [{ d: clamp(L.rho), color: css('--accent'), width: 2, label: 'ρ (SIESTA)' }, { d: clamp(at), color: css('--faint'), width: 1.6, dash: [5, 4], label: 'Σρ átomos' }],
      vlines: L.atoms.map(mk),
      read: (x) => { if (x == null) return `${esc(L.desc)} · longitud del enlace ${fmt(L.bond, 3)} Å`; const i = L.rho.reduce((b, p, j) => Math.abs(p[0] - x) < Math.abs(L.rho[b][0] - x) ? j : b, 0); return `x = ${fmt(L.rho[i][0], 2)} Å · ρ = <b>${fmt(L.rho[i][1], 3)}</b> · Σρ átomos = ${fmt(at[i][1], 3)} e/Å³`; },
      readEl: $('#lineRead', root),
    });
    const dmax = Math.max(...L.drho.map((p) => Math.abs(p[1])));
    chart($('#cvDl', root), {
      xlim: [0, X], ylim: [-dmax * 1.1, dmax * 1.1], xlabel: 'distancia a lo largo del enlace (Å)', ylabel: 'Δρ (e/Å³)',
      series: [{ d: L.drho, color: css('--psi-pos'), width: 2, label: 'Δρ', fill: 0, fillAlpha: 0.18 }], hlines: [{ y: 0 }], vlines: L.atoms.map(mk), legend: false,
      read: (x) => { if (x == null) return 'Δρ = ρ − Σρ átomos'; const i = L.drho.reduce((b, p, j) => Math.abs(p[0] - x) < Math.abs(L.drho[b][0] - x) ? j : b, 0); return `x = ${fmt(L.drho[i][0], 2)} Å · Δρ = ${fmt(L.drho[i][1], 4)} e/Å³`; },
    });
    $('#dlNote', root).textContent = S.sys === 'si' ? 'Entre los dos átomos Δρ es positiva (carga en el enlace) y cerca de cada núcleo es negativa: la carga sale del core y de la región del átomo para formar el enlace.'
      : S.sys === 'mgo' ? 'El pozo profundo cerca del Mg (x ≈ 1 Å) está en la región del semicore 2s2p, no entre los iones; probablemente es reajuste de esa capa frente al átomo libre y no transferencia (inferencia).'
      : 'Sobre el eje O–H la densidad cambia de signo cerca del O y gana en la región del enlace; la forma depende de la base (ver pestaña de cargas).';
  }

  // ---------- cargas ----------
  const species = () => sys().atoms.map((a) => a.el);
  function chargeRow(basisId, id) { return D.basis[id].find((b) => b.basis === basisId); }
  function drawCharges() {
    const id = S.sys, sy = sys(), el = species();
    const tbl = $('#chTbl', root), note = $('#chNote', root);
    let ch = sy.charges, tag = 'DZP';
    if (id !== 'si') { const row = chargeRow(S.basis, id); ch = row; tag = row.basis; }
    const rows = el.map((e, i) => `<tr><td>${e}${i + 1}</td><td>${fmt(ch.mulliken[i], 3)}</td><td>${fmt(ch.hirshfeld[i], 3)}</td><td>${fmt(ch.voronoi[i], 3)}</td></tr>`).join('');
    tbl.innerHTML = `<div class="tblwrap"><table class="tbl"><thead><tr><th style="text-align:left">átomo</th><th>Mulliken</th><th>Hirshfeld</th><th>Voronoi</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="tiny" style="margin:6px 0 0;color:var(--muted)">Carga neta q = Z<sub>val</sub> − N<sub>población</sub> (e), base ${tag}. Positiva: el átomo perdió electrones.</p>`;
    $$('#basisSel button', root).forEach((b) => (b.disabled = id === 'si'));
    const cv = $('#cvCh', root);
    if (id === 'si') {
      cv.style.display = 'none'; $('#chRead', root).innerHTML = '';
      note.textContent = 'En el Si los dos átomos son equivalentes por simetría y las tres cargas dan 0 (a 10⁻⁶ e). No hay transferencia de carga en un cristal elemental: lo que se ve en Δρ es redistribución dentro del enlace, que ninguno de estos repartos de carga por átomo puede describir.';
      return;
    }
    cv.style.display = '';
    const k = KEY_ATOM[id], rowsB = D.basis[id], lab = `${el[k]}`;
    const pts = (key) => rowsB.map((b, i) => [i, b[key][k]]);
    const all = rowsB.flatMap((b) => [b.mulliken[k], b.hirshfeld[k], b.voronoi[k]]);
    const lo = Math.min(...all, id === 'mgo' ? 0 : -0.1) - 0.1, hi = Math.max(...all, id === 'mgo' ? 2 : 0.1) + 0.1;
    chart(cv, {
      xlim: [-0.3, 3.3], ylim: [lo, hi], xlabel: 'base', ylabel: `carga neta del ${lab} (e)`, legend: 'left',
      xticks: rowsB.map((b, i) => ({ x: i, label: b.basis })),
      series: [{ d: pts('mulliken'), color: css('--orb-d'), width: 2, label: 'Mulliken' }, { d: pts('hirshfeld'), color: css('--orb-s'), width: 2, label: 'Hirshfeld' }, { d: pts('voronoi'), color: css('--orb-p'), width: 2, label: 'Voronoi' }],
      points: ['mulliken', 'hirshfeld', 'voronoi'].flatMap((key, ki) => pts(key).map(([x, y]) => ({ x, y, color: [css('--orb-d'), css('--orb-s'), css('--orb-p')][ki], r: 3.4 }))),
      hlines: id === 'mgo' ? [{ y: 2, label: 'iónico formal +2', color: css('--faint'), dash: [4, 3] }, { y: 0 }] : [{ y: 0 }],
      vlines: [{ x: ['SZ', 'DZ', 'DZP', 'TZP'].indexOf(S.basis), color: css('--accent'), dash: [2, 3] }],
      read: (x) => { const i = x == null ? ['SZ', 'DZ', 'DZP', 'TZP'].indexOf(S.basis) : Math.max(0, Math.min(3, Math.round(x))), b = rowsB[i]; return `${b.basis}: Mulliken <b>${fmt(b.mulliken[k], 2)}</b> · Hirshfeld <b>${fmt(b.hirshfeld[k], 2)}</b> · Voronoi <b>${fmt(b.voronoi[k], 2)}</b> e`; },
      readEl: $('#chRead', root),
    });
    const mm = rowsB.map((b) => b.mulliken[k]), span = Math.max(...mm) - Math.min(...mm);
    note.textContent = id === 'mgo'
      ? `Con la misma densidad física (cambia la base) la carga de Mulliken del Mg va de ${fmt(Math.min(...mm), 2)} a ${fmt(Math.max(...mm), 2)} e (rango ${fmt(span, 2)}), sin ordenarse con la calidad de la base; Hirshfeld y Voronoi se mueven mucho menos entre DZ, DZP y TZP. Ninguna llega a +2: Hirshfeld, que parte de átomos neutros, es la más baja (inferencia: sus pesos neutros atribuyen demasiada densidad a cada átomo).`
      : `En el agua el signo de la carga de Mulliken del O cambia de ${fmt(Math.min(...mm), 2)} (SZ) a ${fmt(Math.max(...mm), 2)} (TZP) al añadir funciones de polarización, aunque el O es el átomo más electronegativo. Hirshfeld y Voronoi dan O negativo en todas las bases (−0.25 a −0.30 y −0.20 a −0.36 e).`;
  }
  function drawOrb() {
    const sy = sys(), panel = $('#orbPanel', root), dp = $('#dipPanel', root);
    dp.hidden = S.sys !== 'h2o';
    if (!sy.mullikenOrbitals) { panel.hidden = true; return; }
    panel.hidden = false;
    const rows = sy.mullikenOrbitals.map((b) => `<tr><td>${b.species}</td>${''}<td style="text-align:left;font-family:var(--f-data);white-space:normal">${b.orbitals.map((o, i) => `${o}: <b style="${b.q[i] < 0 ? 'color:var(--bad)' : ''}">${fmt(b.q[i], 2)}</b>`).join(' · ')}</td></tr>`).join('');
    $('#orbTbl', root).innerHTML = `<table class="tbl"><thead><tr><th style="text-align:left">especie</th><th style="text-align:left">población por orbital (e), base DZP</th></tr></thead><tbody>${rows}</tbody></table>`;
    $('#orbNote', root).textContent = S.sys === 'mgo'
      ? 'El orbital 3s de segunda zeta del Mg tiene población negativa (−0.29 e): es un artefacto de repartir el solapamiento por mitades y confirma que las poblaciones de Mulliken por orbital no son probabilidades.'
      : 'Las funciones de polarización (3Pd del O) reciben población que, físicamente, pertenece a los enlaces con los hidrógenos; por eso Mulliken cambia tanto al añadirlas.';
    if (S.sys === 'h2o') {
      const dip = sy.dipole, rowsB = D.basis.h2o;
      const q = (key) => { const c = sy.atoms; const H = c[1].pos.map((x, i) => x - c[0].pos[i]), H2 = c[2].pos.map((x, i) => x - c[0].pos[i]); const ch = sy.charges[key]; return Math.hypot(...[0, 1, 2].map((i) => ch[1] * H[i] + ch[2] * H2[i])) * 4.80320471; };
      $('#dipTbl', root).innerHTML = `<table class="tbl"><thead><tr><th style="text-align:left">cálculo</th><th>dipolo (D)</th></tr></thead><tbody>
        ${rowsB.map((b) => `<tr><td style="text-align:left">densidad completa · ${b.basis}</td><td>${fmt(b.dipole, 2)}</td></tr>`).join('')}
        <tr><td style="text-align:left">cargas puntuales Mulliken (DZP)</td><td>${fmt(q('mulliken'), 2)}</td></tr>
        <tr><td style="text-align:left">cargas puntuales Hirshfeld (DZP)</td><td>${fmt(q('hirshfeld'), 2)}</td></tr>
        <tr><td style="text-align:left">cargas puntuales Voronoi (DZP)</td><td>${fmt(q('voronoi'), 2)}</td></tr>
        <tr><td style="text-align:left"><b>experimento</b> (fase gas)</td><td><b>1.855</b></td></tr></tbody></table>`;
      $('#dipNote', root).textContent = `Calculado como Σ Z·R − ∫rρ sobre la malla (ρ en las caras de la caja ≈ ${dip.boundaryRho}). El dipolo de la densidad completa depende de la base (2.2 con SZ, 2.3 con DZ, 1.48 con DZP y TZP) y con DZP/TZP queda por debajo del experimental; las cargas puntuales dan mucho menos aún porque omiten los dipolos atómicos. La causa de la subestimación con DZP/TZP no está aislada aquí: base, LDA y pseudopotencial son sospechosos (inferencia).`;
    }
  }

  // ---------- entrada ----------
  function drawFdf() { $('#fdfPre', root).textContent = sys().fdfText; }

  // ---------- malla del usuario ----------
  function drawUser() {
    const g = userGrid; if (!g) return;
    const axis = +$('#uAxis', root).querySelector('[aria-pressed="true"]').dataset.v, pos = +$('#uPos', root).value;
    const [i1, i2] = axis === 2 ? [0, 1] : axis === 0 ? [1, 2] : [0, 2];
    const n1 = Math.min(160, g.mesh[i1]), n2 = Math.min(160, g.mesh[i2]);
    const vals = new Float32Array(n1 * n2), sc = g.units === 'e/Bohr³' ? TO_A3 : 1;
    for (let j = 0; j < n2; j++) for (let i = 0; i < n1; i++) { const f = [0, 0, 0]; f[i1] = i / n1; f[i2] = j / n2; f[axis] = pos; vals[j * n1 + i] = sampleFrac(g, f) * sc; }
    const l1 = Math.hypot(...g.cell[i1]), l2 = Math.hypot(...g.cell[i2]);
    const mn = Math.min(...vals), mx = Math.max(...vals), div = mn < 0 && mx > 0;
    const unit = (g.units === 'e/Bohr³' ? 'e/Å³' : g.units);
    $('#uPosOut', root).textContent = fmt(pos, 2);
    heat($('#cvUser', root), $('#cvUserBar', root), { n1, n2, len1: l1, len2: l2, values: vals, mode: div ? 'div' : 'seq', lo: div ? 0 : mn, hi: div ? Math.max(-mn, mx) : mx, scale: 'lin', atoms: [], ref: [0, 0],
      xlabel: `${'abc'[i1]} (Å)`, ylabel: `${'abc'[i2]} (Å)`, unit });
    const avg = planarAverage(g, axis, 0, sc);
    chart($('#cvUserAvg', root), { xlim: [0, Math.hypot(...g.cell[axis])], ylim: [Math.min(...avg.map((p) => p[1])) * (Math.min(...avg.map((p) => p[1])) < 0 ? 1.1 : 0.9), Math.max(...avg.map((p) => p[1])) * 1.1], xlabel: `posición a lo largo de ${'abc'[axis]} (Å)`, ylabel: `promedio planar (${unit})`,
      series: [{ d: avg, color: css('--accent'), width: 2, label: 'promedio planar' }], legend: false });
  }
  function loadUser(file) {
    const err = $('#userErr', root); err.hidden = true;
    file.arrayBuffer().then((buf) => {
      try {
        userGrid = parseGrid(buf, file.name);
        const g = userGrid, tot = gridIntegral(g);
        $('#userBox', root).hidden = false;
        $('#userInfo', root).innerHTML = [['archivo', esc(file.name)], ['malla', g.mesh.join(' × ') + (g.nspin > 1 ? ` · ${g.nspin} espines` : '')], ['volumen', fmt(g.volume, 2) + ' Å³'], ['unidades', g.units],
          ['∫ sobre la celda', fmt(tot, 4) + (g.units === 'e/Bohr³' ? ' e' : '')], ['celda a, b, c', g.cell.map((v) => fmt(Math.hypot(...v), 3)).join(', ') + ' Å']].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
        drawUser();
      } catch (e) { userGrid = null; $('#userBox', root).hidden = true; err.hidden = false; err.textContent = 'No se pudo leer ' + file.name + ': ' + e.message; }
    });
  }
  const drop = $('#drop', root), inp = $('#fileIn', root);
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) loadUser(e.dataTransfer.files[0]); });
  inp.addEventListener('change', () => { if (inp.files[0]) loadUser(inp.files[0]); });
  seg($('#uAxis', root), '2', () => drawUser());
  $('#uPos', root).addEventListener('input', drawUser);

  // ---------- controles ----------
  const setSys = seg($('#sysSel', root), S.sys, (v) => { S.sys = v; if (v === 'si') S.basis = 'DZP'; S.sat = 0; $('#satIn', root).value = 0; all(); });
  seg($('#fldSel', root), S.field, (v) => { S.field = v; S.sat = 0; $('#satIn', root).value = 0; drawMap(); });
  seg($('#scaleSel', root), S.scale, (v) => { S.scale = v; drawMap(); });
  seg($('#yScale', root), 'lin', drawLines);
  seg($('#basisSel', root), S.basis, (v) => { S.basis = v; drawCharges(); });
  $('#satIn', root).addEventListener('input', (e) => { S.sat = +e.target.value; drawMap(); });
  $('#dlPng', root).onclick = () => pngOf($('#cvMap', root), `densidad_${S.sys}_${S.field}`);
  $('#dlCsv', root).onclick = () => downloadText(csvOfPlane(sys().plane, fieldValues(), sys().plane.ref, `${sys().name} · ${fieldLabel[S.field]} (e/Å³) · SIESTA ${D.siesta} ${D.xc}`), `densidad_${S.sys}_${S.field}.csv`, 'text/csv');
  $('#dlFdf', root).onclick = () => downloadText(sys().fdfText, `${sys().formula.replace(/[₀-₉]/g, (c) => c.charCodeAt(0) - 8320)}_densidad.fdf`);
  function all() { drawMap(); drawLines(); drawCharges(); drawOrb(); drawFdf(); }
  const redraw = () => { drawMap(); drawLines(); drawCharges(); drawUser(); };
  onTheme(redraw); all();
  new ResizeObserver(() => { if (root.isConnected && root.offsetParent) { drawMap(); drawUser(); } }).observe(root);
}
export function destroy() {}
