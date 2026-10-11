// Aprender 12 · Lectura anotada del .out: un .out real de SIESTA bloque por bloque, con cada línea explicada y un diagnóstico.
// También acepta el .out del usuario (arrastrar o elegir): usa los mismos lectores que «Mis archivos de SIESTA».
import { $, $$, css, alpha, esc, fmt, onTheme, downloadText, seg, toast } from '../core/ui.js';
import { chart, exportBar } from '../core/chart.js';
import { analyzeOut, BLOCKS, reportMarkdown } from '../siesta/outnotes.js';
import D from '../data/out_fe.json';

const LVL = { bad: '✘', warn: '⚠', info: 'ℹ', ok: '✔' };
const LVL_NAME = { bad: 'Problema', warn: 'Atención', info: 'Dato', ok: 'Correcto' };
const MAXLINES = 400;           // por bloque, antes de pedir «mostrar todo»
const MAXBYTES = 200e6;

let cleanup = [];

export function mount(root) {
  let A = null, name = '', isExample = false, cur = 0, pinned = -1, inline = false, showAll = false;
  root.innerHTML = `
  <div class="pghead"><div>
    <div class="kicker">Aprender · 12</div><h1>Lectura anotada del .out</h1>
    <p class="lede">Un <code>.out</code> real de SIESTA 5.4.2 (Fe bcc ferromagnético, PBE, DZP, 23 iteraciones SCF, 144 s) mostrado bloque por bloque. Pasa el cursor o toca una línea: el panel explica qué significa y, cuando hay números, los compara con las tolerancias del propio archivo. También puedes arrastrar el tuyo.</p>
  </div></div>
  <div class="pgrid">
    <article class="panel theory sticky">
      <h3>Cómo se lee un .out</h3>
      <p>El <code>.out</code> es el diario de la corrida: SIESTA escribe lo que leyó, lo que decidió y lo que midió, en el orden en que lo hizo. Casi todos los problemas se ven ahí antes que en cualquier gráfica.</p>
      <h3>Orden de lectura</h3>
      <ol class="lr-steps">
        <li><b>¿Terminó?</b> Busca <code>Job completed</code> al final. Sin eso, nada de lo demás es un resultado.</li>
        <li><b>¿Es la corrida que pedí?</b> Los bloques <code>redata:</code> muestran los valores efectivos, con defaults. Compáralos con tu fdf: MeshCutoff, espín, funcional, temperatura electrónica, tolerancias.</li>
        <li><b>¿Convergió el SCF?</b> <code>SCF cycle converged after N iterations</code>; dDmax y dHmax deben caer por debajo de sus tolerancias sin saltos repetidos.</li>
        <li><b>¿Son plausibles la energía, las fuerzas y el estrés?</b> Fuerzas ≈ 0 en sitios de simetría; presión cerca de 0 si la celda es la de equilibrio.</li>
        <li><b>¿Dónde se fue el tiempo?</b> La tabla final dice si domina la diagonalización (puntos k) o la malla (MeshCutoff).</li>
      </ol>
      <h3>Qué es y qué no es este lector</h3>
      <p>Las reglas leen el <em>formato</em> de SIESTA 4 y 5 por patrones de texto. Una línea sin nota no es una línea sin importancia: es una que las reglas no reconocen. Los diagnósticos son heurísticas (por ejemplo, «más de 60 iteraciones» o «un salto de ×10 en dDmax»), no veredictos: el .out original manda.</p>
      <p class="src">Fuente de los formatos: manual de SIESTA 5.4 y salidas de la propia corrida. Fórmulas citadas: Anglada et al., PRB 66, 205101 (2002) para la presión de la base.</p>
    </article>
    <div class="charts one">
      <section class="panel wide"><div class="ph"><h2>Archivo</h2><div class="btnrow">
        <div class="seg" id="srcSeg"><button data-v="ex" aria-pressed="true">Ejemplo: Fe FM</button><button data-v="own" aria-pressed="false" disabled>Mi archivo</button></div>
        <button class="tiny" id="repBtn">Exportar diagnóstico (.md)</button></div></div>
        <div class="pb">
          <label class="drop" id="drop"><input type="file" id="fileIn" accept=".out,.txt,.log,text/plain" hidden>
            <b>Suelta aquí tu .out</b> o haz clic para elegirlo<br><span class="tiny-t">Se lee en tu navegador; no se sube a ningún lado. Hasta 200 MB.</span></label>
          <div class="readout" id="fileInfo" style="margin-top:10px"></div>
        </div></section>
      <section class="panel wide"><div class="ph"><h2>Diagnóstico</h2><div class="btnrow"><span class="sub" id="diagSum"></span></div></div>
        <div class="pb"><div id="diag"></div></div></section>
      <section class="panel wide"><div class="ph"><h2>Lectura por bloques</h2><div class="btnrow"><label class="lr-chk"><input type="checkbox" id="inl"> notas en línea</label></div></div>
        <div class="pb lr-reader">
          <nav class="lr-nav" id="nav" aria-label="Bloques del .out"></nav>
          <div class="lr-main" id="main"></div>
        </div></section>
    </div>
  </div>
  <footer class="prov">Ejemplo: <code>fe_fm_2.866.out</code> de <code>corridas/espin.tar.gz</code> (SIESTA 5.4.2 <code>nompi</code>, PBE, DZP, PAO.EnergyShift 50 meV, MeshCutoff 300 Ry, malla k 16×16×16, Methfessel–Paxton orden 1 a 1160 K, mezcla Pulay 0.1/8). Se omitieron ${D.omitted.toLocaleString('es')} líneas de eigenvalores (el mismo dato va en el .EIG). Lector: <code>siesta/out.js</code> y <code>siesta/outnotes.js</code>; pruebas en <code>tests/siesta/run_outnotes_tests.mjs</code>.</footer>`;

  const q = s => $(s, root);
  const drop = q('#drop'), inp = q('#fileIn');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });
  inp.addEventListener('change', () => { if (inp.files[0]) loadFile(inp.files[0]); inp.value = ''; });
  let own = null, redraw = null;
  onTheme(() => { if (redraw && root.isConnected) redraw(); });
  const setSrc = seg(q('#srcSeg'), 'ex', v => { if (v === 'ex') load(D.text, D.name, true); else if (own) load(own.text, own.name, false); });
  q('#inl').addEventListener('change', e => { inline = e.target.checked; renderMain(); });
  q('#repBtn').onclick = () => { if (A) downloadText(reportMarkdown(name, A), name.replace(/\.[^.]*$/, '') + '_lectura.md', 'text/markdown'); };

  async function loadFile(f) {
    if (f.size > MAXBYTES) { toast('Archivo de más de 200 MB: no se carga.'); return; }
    const text = await f.text();
    if (!/siesta|SIESTA|Start of run|redata:|initatom:/.test(text.slice(0, 200000))) { toast('Eso no parece un .out de SIESTA.'); return; }
    own = { name: f.name, text };
    const b = q('#srcSeg button[data-v="own"]'); b.disabled = false; b.textContent = f.name.length > 22 ? f.name.slice(0, 20) + '…' : f.name;
    setSrc('own'); load(text, f.name, false);
  }

  function load(text, nm, ex) {
    name = nm; isExample = ex;
    try { A = analyzeOut(text, { example: ex }); } catch (e) { toast('No se pudo leer: ' + e.message); return; }
    cur = Math.max(0, A.blocks.findIndex(b => b.id === 'scf')); if (cur < 0) cur = 0;
    pinned = -1; showAll = false;
    const P = A.P;
    q('#fileInfo').innerHTML = `<b>${esc(nm)}</b> · ${A.lines.length.toLocaleString('es')} líneas · ${A.blocks.length} bloques · SIESTA ${esc((P.program && P.program.version) || '?')} · ${P.nAtoms ?? '?'} átomo(s), ${P.nOrbitals ?? '?'} orbitales${P.run && P.run.completed ? '' : ' · <span class="bad">sin «Job completed»</span>'}`;
    renderDiag(); renderNav(); renderMain();
  }

  function worst(id) { const l = A.checks.filter(c => c.block === id).map(c => c.level); return l.includes('bad') ? 'bad' : l.includes('warn') ? 'warn' : l.length ? (l.includes('ok') ? 'ok' : 'info') : ''; }

  function renderDiag() {
    const n = { bad: 0, warn: 0, info: 0, ok: 0 }; A.checks.forEach(c => n[c.level]++);
    q('#diagSum').textContent = `${n.ok} correcto · ${n.warn} atención · ${n.bad} problema`;
    const order = ['bad', 'warn', 'ok', 'info'];
    const rows = [...A.checks].sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level));
    const li = c => `<li class="lvl-${c.level}"><span class="ic" title="${LVL_NAME[c.level]}">${LVL[c.level]}</span><div><b>${esc(c.title)}</b><span class="lr-where"><button class="lr-go" data-b="${c.block}">${BLOCKS[c.block].title}</button></span><p>${esc(c.detail)}</p></div></li>`;
    const main = rows.filter(c => c.level !== 'info'), inf = rows.filter(c => c.level === 'info');
    q('#diag').innerHTML = `<ul class="lr-checks">${main.map(li).join('')}</ul>${inf.length ? `<details class="lr-more"><summary>${inf.length} datos informativos</summary><ul class="lr-checks">${inf.map(li).join('')}</ul></details>` : ''}`;
    $$('.lr-go', root).forEach(b => b.onclick = () => { const i = A.blocks.findIndex(x => x.id === b.dataset.b); if (i >= 0) { go(i); q('#nav').scrollIntoView({ behavior: 'smooth', block: 'start' }); } });
  }

  function renderNav() {
    q('#nav').innerHTML = A.blocks.map((b, i) => {
      const w = worst(b.id); const n = b.to - b.from + 1;
      return `<button data-i="${i}" aria-current="${i === cur}"><span class="dot ${w}" aria-hidden="true"></span><span class="t">${esc(b.title)}</span><span class="n">${n.toLocaleString('es')}</span></button>`;
    }).join('');
    $$('#nav button', root).forEach(b => b.onclick = () => go(+b.dataset.i));
  }
  function go(i) { cur = i; pinned = -1; showAll = false; $$('#nav button', root).forEach(b => b.setAttribute('aria-current', +b.dataset.i === cur)); renderMain(); }

  function noteHTML(i) {
    const nt = A.notes[i]; if (!nt) return '<span class="muted">Sin nota para esta línea: no coincide con ninguna regla del lector.</span>';
    return `${nt.h ? `<div class="lr-n ${nt.k}">${nt.h}</div>` : ''}${nt.x ? `<div class="lr-x">${nt.x}</div>` : ''}`;
  }

  function renderMain() {
    const b = A.blocks[cur], info = BLOCKS[b.id];
    const checks = A.checks.filter(c => c.block === b.id);
    const total = b.to - b.from + 1; const end = (showAll || total <= MAXLINES) ? b.to : b.from + MAXLINES - 1;
    const nNotes = A.notes.slice(b.from, b.to + 1).filter(Boolean).length;
    let lines = '';
    for (let i = b.from; i <= end; i++) {
      const nt = A.notes[i];
      lines += `<div class="ln${nt ? ' has ' + nt.k : ''}" data-i="${i}" tabindex="${nt ? 0 : -1}"><span class="no">${i + 1}</span><span class="tx">${esc(A.lines[i]) || ' '}</span>${inline && nt ? `<div class="inl">${noteHTML(i)}</div>` : ''}</div>`;
    }
    q('#main').innerHTML = `
      <h3 class="lr-title">${esc(b.title)} <span class="lr-rng">líneas ${(b.from + 1).toLocaleString('es')}–${(b.to + 1).toLocaleString('es')} · ${nNotes} con nota</span></h3>
      <p class="lr-intro">${info.intro}</p>
      ${info.look ? `<div class="callout"><b>Qué mirar.</b> ${info.look}</div>` : ''}
      ${checks.length ? `<ul class="lr-checks sm">${checks.map(c => `<li class="lvl-${c.level}"><span class="ic">${LVL[c.level]}</span><div><b>${esc(c.title)}</b><p>${esc(c.detail)}</p></div></li>`).join('')}</ul>` : ''}
      ${b.id === 'scf' ? '<div class="lr-fig"><canvas data-export="lectura_scf" id="cvScf" style="height:230px"></canvas><p class="note" id="scfNote"></p></div>' : ''}
      ${b.id === 'timer' ? '<div class="lr-fig" id="bars"></div>' : ''}
      <div class="lr-note" id="notePane" aria-live="polite"><span class="muted">Pasa el cursor o toca una línea con barra de color.</span></div>
      <div class="lr-lines" id="lines" role="list">${lines}</div>
      ${end < b.to ? `<button class="tiny" id="more" style="margin-top:8px">Mostrar las ${(b.to - end).toLocaleString('es')} líneas restantes</button>` : ''}`;
    const pane = q('#notePane');
    const show = i => { pane.innerHTML = `<span class="lr-lno">línea ${i + 1}</span>` + noteHTML(i); };
    const lv = q('#lines');
    lv.addEventListener('mouseover', e => { const l = e.target.closest('.ln'); if (l && pinned < 0) show(+l.dataset.i); });
    lv.addEventListener('focusin', e => { const l = e.target.closest('.ln'); if (l) show(+l.dataset.i); });
    lv.addEventListener('click', e => {
      const l = e.target.closest('.ln'); if (!l) return; const i = +l.dataset.i;
      $$('.ln.sel', lv).forEach(x => x.classList.remove('sel'));
      if (pinned === i) { pinned = -1; return; }
      pinned = i; l.classList.add('sel'); show(i);
    });
    const more = q('#more'); if (more) more.onclick = () => { showAll = true; renderMain(); };
    if (b.id === 'scf') drawScf(b);
    if (b.id === 'timer') drawBars();
  }

  function drawScf(b) {
    const cv = q('#cvScf'); if (!cv) return;
    const P = A.P, ctx = A.ctx;
    const multi = P.steps.length > 1;
    const rows = multi ? P.scf.filter(r => r.step === b.step - 1) : P.scf;
    if (!rows.length) { cv.closest('.lr-fig').hidden = true; return; }
    const pan = cv.closest('.lr-fig'); const ph = document.createElement('div'); ph.className = 'export-wrap'; pan.insertBefore(ph, cv); ph.append(exportBar(cv, 'lectura_scf'));
    const draw = () => {
      const dD = rows.map((r, i) => [i + 1, Math.max(r.dDmax, 1e-12)]), dH = rows.map((r, i) => [i + 1, Math.max(r.dHmax, 1e-12)]);
      const hl = [];
      if (ctx.tolDM != null) hl.push({ y: ctx.tolDM, label: 'tol. dDmax', color: css('--accent'), dash: [4, 3] });
      if (ctx.tolH != null) hl.push({ y: ctx.tolH, label: 'tol. dHmax (eV)', color: css('--warn'), dash: [4, 3] });
      const all = [...dD, ...dH].map(p => p[1]), lo = Math.min(...all, ...(hl.map(h => h.y))), hi = Math.max(...all, ...(hl.map(h => h.y)));
      chart(cv, { logy: true, xlabel: 'iteración SCF', ylabel: 'dDmax (adim.) · dHmax (eV)', xlim: [1, Math.max(rows.length, 2)], ylim: [10 ** Math.floor(Math.log10(lo) - 0.2), 10 ** Math.ceil(Math.log10(hi) + 0.2)], legend: true, hlines: hl,
        series: [{ d: dD, color: css('--accent'), width: 1.8, label: 'dDmax' }, { d: dH, color: css('--warn'), width: 1.8, label: 'dHmax (eV)' }],
        read: x => { if (x == null) return 'Pasa el cursor sobre una iteración.'; const r = rows[Math.round(x) - 1]; return r ? `iteración ${r.iscf}: dDmax ${r.dDmax.toExponential(2)} · dHmax ${r.dHmax.toExponential(2)} eV · E_KS ${fmt(r.E_KS, 5)} eV` : ''; } });
    };
    redraw = draw; draw();
    q('#scfNote').textContent = 'Cada punto es una fila «scf:» del bloque. Las líneas discontinuas son las tolerancias leídas del propio archivo; el ciclo termina cuando ambas curvas bajan de la suya.';
  }

  function drawBars() {
    const tm = A.P.timers; const box = q('#bars'); if (!box || !tm || !tm.routines) { if (box) box.hidden = true; return; }
    const top = tm.routines.filter(r => r.name !== 'siesta' && r.percent > 0.5).sort((a, b) => b.percent - a.percent).slice(0, 12);
    box.innerHTML = `<h4 class="lr-h4">Rutinas más pesadas (% del tiempo total)</h4>` + top.map(r => `<div class="lr-bar"><span class="nm">${esc(r.name)}</span><span class="tr"><i style="width:${Math.min(100, r.percent)}%"></i></span><span class="pc">${r.percent.toFixed(1)} %</span></div>`).join('') + `<p class="note">Las rutinas anidadas se cuentan también dentro de su padre, por eso los porcentajes suman más de 100.</p>`;
  }

  load(D.text, D.name, true);
}

export function destroy() { cleanup.forEach(f => f()); cleanup = []; }
