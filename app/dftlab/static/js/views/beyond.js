// Aprender 15 · Más allá de DFT. Escalera de Jacob y gaps LDA/GGA/meta-GGA/híbrido/GW frente al experimento.
// Todo viene de la literatura (data/beyond_dft.json, con referencia por columna); solo el gap del Si de SIESTA es propio.
import { $, $$, css, alpha, esc, seg, downloadText } from '../core/ui.js';
import { chart, exportBar } from '../core/chart.js';
import B from '../data/beyond_dft.json';
import X from '../data/pseudo_xc.json';

const M = B.methods, MAT = B.materials, SRC = B.sources;
const SUB = '<sub>', f2 = v => v==null ? '—' : (v<10 ? v.toFixed(2) : v.toFixed(1));
const COMMON = MAT.filter(m => m.lsda != null);       // Ge, Si, GaAs, C, MgO: los que tienen todas las columnas
function stats(id, set){
  const r = set.filter(m => m[id] != null); if (!r.length) return null;
  const me = r.reduce((a,m)=>a+(m[id]-m.exp),0)/r.length, mae = r.reduce((a,m)=>a+Math.abs(m[id]-m.exp),0)/r.length;
  const mare = r.reduce((a,m)=>a+Math.abs(m[id]-m.exp)/m.exp,0)/r.length;
  return {n:r.length, me, mae, mare};
}
const mcol = () => ({lsda:css('--e1'), pbesol:css('--orb-p'), tpss:css('--orb-d'), hse:css('--warn'), hse03:css('--orb-f'), g0w0:css('--ok'), gw0:css('--accent'), gw:css('--up')});

export function mount(root, view){
  const S = {on: new Set(['lsda','hse03','g0w0','gw']), log:false};
  root.innerHTML = `
  <div class="pghead"><div>
    <div class="kicker">Aprender · 15</div><h1>Más allá de DFT</h1>
    <p class="lede">LDA y GGA subestiman el gap por una razón de principio, no por falta de afinación: Si 0.51 eV (LSDA) frente a 1.17 eV (exp.), MgO 4.90 frente a 7.83. Los híbridos recuperan una parte (HSE03: Si 1.04, MgO 6.22) y GW casi todo (G₀W₀: Si 1.32, MgO 7.94). Esta pantalla pone los números de la literatura lado a lado, con la fuente de cada columna. Aquí no se calcula nada de esto: SIESTA 5.4.2 no trae híbridos ni GW.</p>
  </div></div>
  <div class="pgrid">
    <article class="panel theory" id="bTheory"></article>
    <div class="charts">
      <section class="panel wide"><div class="ph"><h2>La escalera de Jacob</h2><span class="sub">qué añade cada peldaño</span></div><div class="pb" id="bLadder"></div></section>
      <section class="panel wide"><div class="ph"><h2>Gap calculado frente a experimental</h2><span class="sub">literatura, eV</span></div>
        <div class="pb"><div class="btnrow" id="bSel" style="flex-wrap:wrap;margin-bottom:8px"></div>
        <canvas data-export="gaps_calculado_vs_experimental" id="bSc" style="height:360px"></canvas><div class="readout" id="bRd"></div>
        <p class="note">Cada punto es un material; la diagonal es el acuerdo perfecto. Por debajo de ella el método subestima. La escala logarítmica separa los aislantes de gap pequeño de los de gap grande. Los métodos de una misma fuente usan la misma geometría y pseudos; entre fuentes distintas la comparación es solo orientativa.</p>
        <label class="tiny"><input type="checkbox" id="bLog"> escala logarítmica</label></div></section>
      <section class="panel wide"><div class="ph"><h2>Error medio por método</h2><span class="sub">calculado aquí a partir de la tabla</span></div><div class="pb" id="bErr"></div></section>
      <section class="panel wide"><div class="ph"><h2>Tabla de gaps (eV)</h2><div class="btnrow"><button class="tiny" id="bCsv">descargar CSV</button></div></div><div class="pb" id="bTab"></div></section>
      <section class="panel"><div class="ph"><h2>El punto de partida importa</h2><span class="sub">LDA y PBE0: gap KS generalizado</span></div><div class="pb" id="bStart"></div></section>
      <section class="panel"><div class="ph"><h2>Este laboratorio frente a la literatura</h2><span class="sub">Si, SIESTA</span></div><div class="pb" id="bOwn"></div></section>
      <section class="panel wide"><div class="ph"><h2>Referencias</h2></div><div class="pb" id="bRefs"></div></section>
    </div>
  </div>
  <footer class="prov">Procedencia: tabla de gaps copiada de ${esc(SRC.F.full)} · ${esc(SRC.L.full)} · el gap del Si de SIESTA es de la pantalla 3 (SIESTA 5.4.2, DZP, MeshCutoff 300 Ry, k 8×8×8). Los valores dependen de geometría, pseudos o PAW, número de bandas y acoplamiento espín-órbita; no hay corrección de punto cero ni de temperatura, salvo la que traiga la fuente.</footer>`;

  $('#bTheory').innerHTML = `
    <h3>Por qué la DFT falla en el gap</h3>
    <p>El gap fundamental es una diferencia de energías totales, E<sub>g</sub> = I − A = E(N−1) + E(N+1) − 2E(N). En Kohn–Sham, el gap de los orbitales es otra cosa. La diferencia es la <b>discontinuidad de la derivada</b> del funcional de intercambio y correlación al pasar el número de electrones por un entero:</p>
    <div class="eq">E<sub>g</sub> = ε<sub>c</sub><sup>KS</sup> − ε<sub>v</sub><sup>KS</sup> + Δ<sub>xc</sub></div>
    <p>LDA y GGA son funcionales de la densidad local o semilocal y no tienen esa discontinuidad (Δ<sub>xc</sub> = 0), así que su gap de bandas es solo el gap KS. Ese es el resultado de Perdew y Levy y de Sham y Schlüter (1983); incluso el funcional exacto tendría un gap KS distinto del fundamental. Es una limitación del tipo de aproximación, no de su parametrización. A eso se suma la autointeracción, que deslocaliza los estados d y f.</p>
    <h3>Híbridos</h3>
    <p>Mezclan una fracción α de intercambio exacto (Fock) con el de GGA. HSE separa el intercambio en corto y largo alcance con la función de error y mezcla el exacto solo a corto alcance:</p>
    <div class="eq">E<sub>xc</sub><sup>HSE</sup> = E<sub>xc</sub><sup>PBE</sup> + α (E<sub>x</sub><sup>HF,corto</sup>(ω) − E<sub>x</sub><sup>PBE,corto</sup>(ω)), &nbsp; α = 1/4, &nbsp; ω ≈ 0.11 bohr<sup>−1</sup></div>
    <p>Con α = 1/4 y ω ≈ 0.11 bohr⁻¹ (≈ 0.2 Å⁻¹) se obtiene HSE06 (Krukau et al. 2006); HSE03 usa un ω ligeramente distinto, de ahí que las dos columnas de la tabla no coincidan. El parámetro α es empírico: ajustado a moléculas, no a un gap. Por eso los resultados en sólidos son buenos para sp con gaps medianos y empeoran en aislantes de gap grande (MgO, LiF), donde el apantallamiento real es distinto del que impone un α fijo.</p>
    <h3>GW</h3>
    <p>En lugar de funcional, usa la autoenergía como producto de la función de Green y la interacción apantallada (Hedin 1965):</p>
    <div class="eq">Σ(r,r′;ω) = (i/2π) ∫ G(r,r′;ω+ω′) W(r,r′;ω′) dω′, &nbsp; (T + V<sub>ext</sub> + V<sub>H</sub> + Σ) ψ<sup>QP</sup> = ε<sup>QP</sup> ψ<sup>QP</sup></div>
    <p><b>G₀W₀</b> evalúa Σ una sola vez con orbitales y energías de un cálculo previo (LDA o PBE) y corrige las energías a primer orden: depende del punto de partida (tabla «El punto de partida importa»). <b>GW₀</b> actualiza G, y «GW (QP)» (autoconsistente en cuasipartículas) actualiza también W. La tabla muestra una tendencia conocida: autoconsistir sin vértice <i>sobreestima</i> los gaps, porque W queda demasiado pequeño al omitir los efectos electrón-hueco (Shishkin y Kresse 2007).</p>
    <h3>Lo que esta pantalla no hace</h3>
    <p>No hay cálculo propio de híbridos, GW ni BSE. Los valores son de la literatura. SIESTA 5.4.2 en este laboratorio llega hasta LDA, GGA, vdW-DF/VV10 y DFT+U (pantalla 8). Para híbridos y GW se usan otros códigos (VASP, Quantum ESPRESSO con WEST o Yambo, BerkeleyGW…); los costes de la escalera son órdenes de magnitud generales, no mediciones mías.</p>
    <p class="src">Perdew y Schmidt, AIP Conf. Proc. 577, 1 (2001) · Perdew y Levy, PRL 51, 1884 (1983) · Sham y Schlüter, PRL 51, 1888 (1983) · Hedin, PR 139, A796 (1965) · Hybertsen y Louie, PRB 34, 5390 (1986) · Onida, Reining y Rubio, RMP 74, 601 (2002) · Heyd, Scuseria y Ernzerhof, JCP 118, 8207 (2003) · Krukau et al., JCP 125, 224106 (2006) · Shishkin y Kresse, PRB 75, 235102 (2007).</p>`;

  // ---- escalera
  const R = [
    [5,'RPA, doble híbridos','+ orbitales vacíos','RPA, B2PLYP','dispersión, reacciones','N⁴–N⁵','no'],
    [4,'Híbridos','+ orbitales ocupados (intercambio exacto)','PBE0, HSE06, B3LYP','sube el gap y arregla estados localizados','N³–N⁴ con aceleración; típicamente 10–100× más caro que GGA','no'],
    [3,'meta-GGA','+ τ (densidad de energía cinética)','TPSS, SCAN, r²SCAN','enlaces de distinto tipo con un funcional; el gap casi no cambia (Si 0.74, MgO 4.58 con TPSS)','algo más caro que GGA','no verificado'],
    [2,'GGA','+ ∇ρ','PBE, PBEsol, revPBE','estructuras de moléculas y superficies','N³','sí'],
    [1,'LDA','ρ','PW92, PZ81','sólidos compactos','N³','sí']];
  $('#bLadder').innerHTML = `<div class="heaven">precisión química</div><div class="ladder">${R.map(r=>`<div class="rung${r[0]<=2?' here':''}"><span class="n">${r[0]}</span><span class="nm">${r[1]}</span><span class="ing">usa: ${r[2]}</span><span class="ex"><b>${r[3]}</b> · ${r[4]}</span><span class="ing">coste (orden de magnitud, no medido): ${r[5]}</span></div>`).join('')}</div><div class="heaven">Hartree (sin XC)</div>
    <p class="note">Los peldaños resaltados son los que SIESTA usa en producción. No verifiqué si SIESTA 5.4 admite meta-GGA. GW no es un peldaño de la escalera: usa la función de Green y el apantallamiento, y se suele colocar «al lado», como método de cuasipartículas. Los costes son los órdenes habituales de la literatura; no los medí.</p>`;

  // ---- selector
  const sel = $('#bSel');
  sel.innerHTML = M.map(m=>`<button class="tiny" data-m="${m.id}" aria-pressed="${S.on.has(m.id)}"><span class="sw" data-sw="${m.id}"></span> ${m.label}</button>`).join('');
  $$('button', sel).forEach(b=>b.addEventListener('click',()=>{ const k=b.dataset.m; S.on.has(k)?S.on.delete(k):S.on.add(k); b.setAttribute('aria-pressed',S.on.has(k)); drawSc(); }));
  $('#bLog').addEventListener('change',e=>{ S.log=e.target.checked; drawSc(); });

  function drawSc(){
    const C = mcol(); $$('[data-sw]',sel).forEach(s=>s.style.background=C[s.dataset.sw]);
    const lo = S.log ? 0.3 : 0, hi = S.log ? 30 : 23;
    const clip = v => S.log ? Math.max(v, lo*1.01) : v;
    const series = [{d:[[lo,lo],[hi,hi]], color:css('--faint'), dash:[4,3], width:1.2, label:'acuerdo perfecto'}];
    M.filter(m=>S.on.has(m.id)).forEach(m=>{
      series.push({d: MAT.filter(t=>t[m.id]!=null).map(t=>[t.exp, clip(t[m.id])]), color:C[m.id], width:0, label:m.label, _pts:true});
    });
    const points = []; series.forEach(s=>{ if(s._pts) s.d.forEach(([x,y])=>points.push({x,y,color:s.color,r:4})); });
    chart($('#bSc'),{series, points, logx:S.log, logy:S.log, xlim:[lo,hi], ylim:[lo,hi], xlabel:'gap experimental (eV)', ylabel:'gap calculado (eV)', legend:true,
      readEl:$('#bRd'), read:(x)=>{ if(x==null) return 'Pasa el cursor sobre la gráfica: se muestra el material más cercano en el eje experimental.';
        const t = MAT.reduce((a,b)=>Math.abs(b.exp-x)<Math.abs(a.exp-x)?b:a);
        return `<span><b>${t.name}</b> (${t.gap}) · exp. <b>${f2(t.exp)}</b></span>` + M.filter(m=>S.on.has(m.id)&&t[m.id]!=null).map(m=>`<span>${m.label} <b>${f2(t[m.id])}</b> (${t[m.id]-t.exp>=0?'+':'−'}${Math.abs(t[m.id]-t.exp).toFixed(2)})</span>`).join(''); }});
  }

  // ---- error por método
  function errTab(){
    const rows = M.map(m=>({m, a:stats(m.id,COMMON), b:stats(m.id,MAT)}));
    const maxm = Math.max(...rows.map(r=>r.b?r.b.mare:r.a.mare));
    $('#bErr').innerHTML = `<div class="tblwrap"><table class="tbl"><thead><tr><th>método</th><th>fuente</th><th>5 comunes: error medio</th><th>MAE</th><th>MARE</th><th>15 materiales: MAE</th><th>MARE</th></tr></thead><tbody>${rows.map(({m,a,b})=>`<tr><td>${m.label}</td><td>${SRC[m.src].short}</td>
      <td class="${a.me<0?'bad':'warnc'}">${a.me>=0?'+':'−'}${Math.abs(a.me).toFixed(2)}</td><td>${a.mae.toFixed(2)}</td><td>${(100*a.mare).toFixed(0)} %</td>
      <td>${b&&b.n===15?b.mae.toFixed(2):'—'}</td><td>${b&&b.n===15?(100*b.mare).toFixed(0)+' %':'—'}</td></tr>`).join('')}</tbody></table></div>
    <p class="note">«5 comunes» son Ge, Si, GaAs, C y MgO, los únicos materiales para los que existen las ocho columnas. MAE en eV; MARE es el error relativo absoluto medio (|calc − exp| / exp). El error medio con signo negativo indica subestimación sistemática. Estas cifras las calculo yo con los valores de la tabla; no vienen de los artículos. Con solo cinco materiales y una mezcla de fuentes, valen para ver la tendencia, no como estadística publicable. Ge con LSDA da 0.00 eV (metal), lo que pesa mucho en el MARE.</p>`;
  }

  // ---- tabla completa
  function table(){
    const cols = M;
    $('#bTab').innerHTML = `<div class="tblwrap"><table class="tbl"><thead><tr><th>material</th><th>tipo</th>${cols.map(m=>`<th title="${esc(SRC[m.src].short)}">${m.label}<br><span style="font-weight:400">${m.src}</span></th>`).join('')}<th>exp.</th></tr></thead><tbody>${MAT.map(t=>`<tr><td>${t.name}</td><td>${t.gap}</td>${cols.map(m=>{ const v=t[m.id]; const e=v==null?null:v-t.exp; return `<td class="${e==null?'':Math.abs(e)<0.3?'good':e<-1?'bad':''}">${f2(v)}</td>`; }).join('')}<td class="good">${f2(t.exp)}${t.expNote?'<sup>†</sup>':''}</td></tr>`).join('')}</tbody></table></div>
    <p class="note"><b>F</b> = ${esc(SRC.F.full)}<br><b>L</b> = ${esc(SRC.L.full)}<br>Verde: dentro de 0.3 eV del experimento; rojo: más de 1 eV por debajo. Casillas con «—»: la fuente no da ese valor. ${MAT.find(t=>t.expNote).name}<sup>†</sup>: ${esc(MAT.find(t=>t.expNote).expNote)}. Los experimentales de L son de baja temperatura y difieren de los de F en C (5.50 frente a 5.48), MgO (7.90 frente a 7.83) y los demás a menos de 0.1 eV; aquí se usa siempre el de F. «HSE (Lucero)» y «HSE03» son dos cálculos distintos de dos grupos con códigos distintos; no se espera que coincidan (MgO: 6.40 y 6.22). No se muestra PBE porque ninguna de las dos fuentes lo lista en su tabla; Lucero et al. indican que PBE y PBEsol dan gaps de magnitud parecida.</p>`;
    $('#bCsv').onclick = () => downloadText(['material;tipo;'+cols.map(m=>m.id+'_'+m.src).join(';')+';exp'].concat(MAT.map(t=>[t.id,t.gap].concat(cols.map(m=>t[m.id]??''),[t.exp]).join(';'))).join('\n'), 'gaps_mas_alla_de_dft.csv');
  }

  // ---- punto de partida y laboratorio
  const SP = B.startingPoint;
  $('#bStart').innerHTML = `<div class="tblwrap"><table class="tbl"><thead><tr><th>material</th>${SP.cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead><tbody>${SP.rows.map(r=>`<tr>${r.map((v,i)=>`<td${i===5?' class="good"':''}>${i?f2(v):v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <p class="note">G₀W₀ cambia mucho según de dónde parte: en el Si, 1.08 eV desde LDA y 1.65 eV desde PBE0 (exp. 1.17); en ZnO, 2.14 y 3.24 (exp. 3.44). Un resultado G₀W₀ sin decir su punto de partida no se puede comparar. El InN muestra algo más fuerte: con LDA el gap KS es negativo (−0.38 eV) y G₀W₀ lo deja en 0.00 eV, con PBE0 sale 0.78 (exp. 0.61). Fuente: Fuchs et al. 2007, Tablas II y III.</p>`;
  const gl = X.eos.lda.gap0, gp = X.eos.pbe.gap0, si = MAT.find(t=>t.id==='Si');
  $('#bOwn').innerHTML = `<dl class="kv"><dt>LDA (SIESTA, aquí)</dt><dd>${gl.toFixed(2)} eV</dd><dt>PBE (SIESTA, aquí)</dt><dd>${gp.toFixed(2)} eV</dd><dt>LSDA (literatura, L)</dt><dd>${f2(si.lsda)} eV</dd><dt>HSE03 (F)</dt><dd>${f2(si.hse03)} eV</dd><dt>G₀W₀ (F)</dt><dd>${f2(si.g0w0)} eV</dd><dt>exp.</dt><dd>${f2(si.exp)} eV</dd></dl>
    <p class="note">El gap de SIESTA es el de la pantalla 3, con base DZP y el parámetro de red propio de cada funcional: ${gl.toFixed(2)} frente a 0.51 de la literatura en LSDA. No analicé de dónde sale la diferencia de 0.07 eV (base, pseudos y constante de red influyen). Lo que sí es claro: ambos funcionales de SIESTA caen muy por debajo del experimental, y el híbrido y GW no son un ajuste fino sino otra física.</p>`;
  $('#bRefs').innerHTML = `<ol class="refs" style="margin:0;padding-left:1.2em">${B.refs.map(r=>`<li><b>${esc(r.k)}.</b> ${esc(r.t)}</li>`).join('')}</ol>
    <p class="note">Marcado como no verificado: la referencia de revista de Lucero et al. (solo se leyó el preprint). Las demás referencias de la lista las escribí de memoria y no las comprobé contra la revista; las tablas de gaps sí se leyeron directamente en los dos preprints indicados. Las ecuaciones de la teoría son las estándar, también de memoria.</p>`;

  $$('canvas[data-export]',root).forEach(cv=>cv.closest('.panel').querySelector('.ph').append(exportBar(cv,cv.dataset.export)));
  errTab(); table();
  const draw=()=>drawSc(); view.onTheme(draw); draw();
}
export function destroy(){}
