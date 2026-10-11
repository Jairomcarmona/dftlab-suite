// Aprender 9 · DFT+U: NiO antiferromagnético con SIESTA, barrido de U y U por respuesta lineal (Cococcioni).
import { $, $$, css, alpha, fmt, downloadText, seg } from '../core/ui.js';
import { chart, exportBar } from '../core/chart.js';
import N from '../data/nio.json';

function theory(){ return `
  <h3>El problema: electrones d y f demasiado deslocalizados</h3>
  <p>En LDA y GGA cada electrón siente una parte de su propia repulsión (error de autointeracción). La energía como función del número de electrones en una capa resulta convexa en lugar de lineal a trozos, y el funcional premia las ocupaciones fraccionarias: los estados d y f se deslocalizan, los gaps se cierran y los momentos magnéticos salen pequeños. El NiO es el ejemplo de libro: PBE da un gap de ~1 eV y el experimento 3.8–4.3 eV.</p>
  <h3>La corrección de Hubbard</h3>
  <p>DFT+U añade a la energía un término tomado del modelo de Hubbard que penaliza la ocupación fraccionaria de orbitales localizados. En la forma rotacionalmente invariante simplificada de Dudarev:</p>
  <div class="eq">E<sub>U</sub> = (U<sub>eff</sub>/2) Σ<sub>I,σ</sub> Tr[n<sup>Iσ</sup>(1 − n<sup>Iσ</sup>)], &nbsp; V<sub>U</sub> = U<sub>eff</sub>(½ − n<sub>m</sub>)</div>
  <p>Los orbitales con ocupación mayor que ½ bajan en energía y los de menos de ½ suben: se abre un gap de orden U entre estados d llenos y vacíos. n<sup>Iσ</sup> es la matriz de ocupación del átomo I proyectada sobre orbitales tipo d; en SIESTA esos proyectores se definen en <code>%block DFTU.Proj</code> y se generan como orbitales confinados del átomo.</p>
  <h3>¿Cuánto vale U?</h3>
  <p>A menudo se ajusta a un experimento (gap, momento, entalpía de formación), con el riesgo de mejorar una cantidad y empeorar otra. La alternativa de Cococcioni y de Gironcoli calcula U desde primeros principios: se aplica un potencial pequeño α sobre los d de un átomo y se mide cuánto cambia su ocupación, una vez sin dejar relajar al resto (respuesta desnuda χ<sub>0</sub>) y otra de forma autoconsistente (χ).</p>
  <div class="eq">U = χ<sub>0</sub><sup>−1</sup> − χ<sup>−1</sup>, &nbsp; χ = dN<sub>d</sub>/dα</div>
  <p>La diferencia elimina la parte de la respuesta que ya tendría un sistema no interactuante, y deja la curvatura espuria que hay que corregir. El valor depende de los proyectores, así que U no se puede copiar de un código a otro.</p>
  <h3>Lo que DFT+U no hace</h3>
  <p>No arregla la autointeracción de los estados s y p, no da energías de excitación correctas por sí misma y cambia la energía total de forma que solo se pueden comparar cálculos con el mismo U y los mismos proyectores. Para el gap de un óxido, un híbrido o GW suele ser más fiable; DFT+U es la opción barata que mantiene el costo de una GGA.</p>
  <p class="src">Anisimov, Zaanen y Andersen, PRB 44, 943 (1991) · Dudarev et al., PRB 57, 1505 (1998) · Cococcioni y de Gironcoli, PRB 71, 035105 (2005) · Sawatzky y Allen, PRL 53, 2339 (1984) · Cheetham y Hope, PRB 27, 6964 (1983).</p>`; }

export function mount(root, view){
  const S={U:4};
  const sc=N.scan, lr=N.lr, Umax=Math.max(...sc.map(s=>s.U));
  root.innerHTML=`
  <div class="pghead"><div>
    <div class="kicker">Aprender · 8</div><h1>DFT+U en NiO</h1>
    <p class="lede">Óxido de níquel antiferromagnético (AFM-II, celda romboédrica de 4 átomos) calculado con SIESTA y PBE para U de 0 a ${fmt(Umax,1)} eV, más el cálculo de U por respuesta lineal con <code>DFTU.PotentialShift</code>. El gap pasa de ${fmt(sc[0].gap,1)} a ${fmt(sc[sc.length-1].gap,1)} eV y el momento del Ni de ${fmt(sc[0].mom,2)} a ${fmt(sc[sc.length-1].mom,2)} μ<sub>B</sub>; el U calculado por respuesta lineal resulta ${lr?fmt(lr.U,1):'—'} eV.</p>
  </div></div>
  <div class="pgrid">
    <article class="panel theory sticky">${theory()}</article>
    <div class="charts">
      <section class="panel wide"><div class="ph"><h2>Densidad de estados proyectada</h2><div class="seg" id="uSel">${sc.map(s=>`<button data-v="${s.U}">U = ${s.U} eV</button>`).join('')}</div></div>
        <div class="pb"><canvas data-export="NiO_PDOS" id="cvPd" style="height:340px"></canvas><div class="readout" id="pdRead"></div>
        <p class="note">Arriba espín ↑, abajo espín ↓, del Ni1 (momento positivo) y del O. Con U = 0 el gap queda entre estados d del Ni (gap de Mott–Hubbard); al subir U los d ocupados bajan bajo la banda p del O y el borde de valencia se vuelve de carácter O 2p, como dicen la fotoemisión y el modelo de Zaanen–Sawatzky–Allen para un aislante de transferencia de carga.</p></div></section>

      <section class="panel"><div class="ph"><h2>Gap frente a U</h2></div>
        <div class="pb"><canvas data-export="NiO_gap_U" id="cvGap" style="height:260px"></canvas><div class="readout" id="gapRead"></div></div></section>
      <section class="panel"><div class="ph"><h2>Momento magnético del Ni</h2></div>
        <div class="pb"><canvas data-export="NiO_momento_U" id="cvMom" style="height:260px"></canvas><p class="note" id="momRead"></p></div></section>

      <section class="panel wide" id="lrPanel"><div class="ph"><h2>U por respuesta lineal</h2></div>
        <div class="pb"><div class="split2"><div><canvas data-export="NiO_respuesta_lineal" id="cvLr" style="height:280px"></canvas><div class="readout" id="lrRead"></div></div><div id="lrTxt"></div></div></div></section>

      <section class="panel"><div class="ph"><h2>Calculadora · el término de Hubbard</h2></div>
        <div class="pb"><label class="sl">U<sub>eff</sub> (eV) <input type="range" id="uIn" min="0" max="10" step="0.1" value="4"><output id="uOut"></output></label>
          <canvas data-export="hubbard_un" id="cvH" style="height:240px"></canvas><div class="readout" id="hRead"></div>
          <p class="note">Energía E<sub>U</sub> = (U/2) n(1 − n) y potencial V<sub>U</sub> = U(½ − n) para un orbital con ocupación n. La corrección es máxima en n = ½ y nula en 0 y 1: empuja hacia ocupaciones enteras.</p></div></section>

      <section class="panel"><div class="ph"><h2>Entrada de SIESTA usada</h2><div class="btnrow"><button class="tiny" id="dlFdf">exportar .fdf (U = 4 eV)</button></div></div>
        <div class="pb"><pre class="code" style="max-height:300px;overflow:auto" id="fdfPre"></pre></div></section>
    </div>
  </div>
  <footer class="prov">SIESTA 5.4.2, PBE, pseudos ONCV de la biblioteca de DFT Lab (Ni con semicore 3s3p, 18 e⁻; O, 6 e⁻), base DZP con EnergyShift 50 meV, MeshCutoff 300 Ry, k 6×6×6 (PDOS 12×12×12), a = 4.17 Å, 100 K, espín colineal con Ni1 ↑ y Ni2 ↓. U de Dudarev (J = 0) sobre los 3d de ambos Ni. Gap desde los autovalores de la malla k (.EIG). Experimento: gap 3.8–4.3 eV (Sawatzky y Allen 1984), momento 1.64–1.90 μ<sub>B</sub> (Cheetham y Hope 1983; Fender et al. 1968).</footer>`;

  const cur=()=>sc.find(s=>s.U===S.U);
  function drawPd(){
    const s=cur(), E=s.E, P=s.pdos;
    const K=[['Ni1-d',css('--orb-d'),'Ni 3d'],['O-p',css('--orb-p'),'O 2p']];
    const series=[];
    K.forEach(([k,c,l])=>{ series.push({d:E.map((e,i)=>[e,P[k].up[i]]),color:c,width:1.8,label:l,fill:0,fillAlpha:0.15}); series.push({d:E.map((e,i)=>[e,-P[k].dn[i]]),color:c,width:1.8,fill:0,fillAlpha:0.15}); });
    chart($('#cvPd',root),{xlim:[-9,6],ylim:[-6,6],xlabel:'E − E_F (eV)',ylabel:'estados/eV (↓ negativo)',series,legend:true,hlines:[{y:0}],vlines:[{x:0,dash:[4,3]}],
      shade:[{x0:0,x1:s.gap,color:alpha(css('--accent'),0.08),label:'gap '+fmt(s.gap,2)+' eV'}],
      read:x=>{ if(x==null) return `U = ${s.U} eV · gap ${fmt(s.gap,2)} eV (${s.type==='indirect'?'indirecto':s.type}) · μ(Ni) ${fmt(s.mom,2)} μB · ${s.nscf} iteraciones SCF`; const i=E.reduce((b,e,j)=>Math.abs(e-x)<Math.abs(E[b]-x)?j:b,0); return K.map(([k,c,l])=>`<span><span class="sw" style="background:${c}"></span>${l} ↑ <b>${fmt(P[k].up[i],2)}</b> ↓ <b>${fmt(P[k].dn[i],2)}</b></span>`).join('')+`<span>E <b>${fmt(x,2)} eV</b></span>`; },readEl:$('#pdRead',root)});
  }
  function drawGap(){
    const d=sc.map(s=>[s.U,s.gap]);
    chart($('#cvGap',root),{xlim:[-0.3,Umax+0.5],ylim:[0,4.6],xlabel:'U (eV)',ylabel:'gap (eV)',series:[{d,color:css('--accent'),width:2,label:'SIESTA PBE+U'}],points:d.map(p=>({x:p[0],y:p[1],color:p[0]===S.U?css('--bad'):css('--accent'),r:p[0]===S.U?5:3.5})),
      shade:[{y0:3.8,y1:4.3,color:alpha(css('--ok'),0.15),label:'experimento'}],legend:false,nohover:true});
    $('#gapRead',root).innerHTML=sc.map(s=>`<span>U ${s.U}: <b>${fmt(s.gap,2)}</b></span>`).join('')+(lr?`<span>U lineal ≈ <b>${fmt(lr.U,1)} eV</b></span>`:'');
  }
  function drawMom(){
    const d=sc.map(s=>[s.U,s.mom]);
    chart($('#cvMom',root),{xlim:[-0.3,Umax+0.5],ylim:[1.2,2.0],xlabel:'U (eV)',ylabel:'μ(Ni) Mulliken (μB)',series:[{d,color:css('--orb-d'),width:2,label:'SIESTA'}],points:d.map(p=>({x:p[0],y:p[1],color:p[0]===S.U?css('--bad'):css('--orb-d'),r:p[0]===S.U?5:3.5})),
      shade:[{y0:1.64,y1:1.90,color:alpha(css('--ok'),0.15),label:'experimento'}],legend:false,nohover:true});
    $('#momRead',root).innerHTML='Momento de espín de Mulliken del Ni1. El experimento incluye una contribución orbital de ~0.3 μ<sub>B</sub> que un cálculo sin espín-órbita no tiene.';
  }
  function drawLr(){
    if(!lr){ $('#lrPanel',root).hidden=true; return; }
    const pts=k=>lr[k].map(p=>[p.alpha,p.N-lr.N0]);
    const line=(k,c)=>{ const s=lr['chi'+(k==='bare'?'0':'')]; return [-0.12,0.12].map(a=>[a,s*a]); };
    chart($('#cvLr',root),{xlim:[-0.12,0.12],ylim:[-0.032,0.032],xlabel:'α (eV) sobre los 3d del Ni1',ylabel:'ΔN_d(Ni1)',legend:true,hlines:[{y:0}],vlines:[{x:0}],
      series:[{d:line('bare'),color:css('--orb-p'),width:1.6,dash:[5,3],label:`desnuda χ0 = ${fmt(lr.chi0,4)} /eV`},{d:line('scf'),color:css('--accent'),width:1.6,dash:[5,3],label:`autoconsistente χ = ${fmt(lr.chi,4)} /eV`}],
      points:[...pts('bare').map(p=>({x:p[0],y:p[1],color:css('--orb-p'),r:4})),...pts('scf').map(p=>({x:p[0],y:p[1],color:css('--accent'),r:4}))],nohover:true});
    $('#lrTxt',root).innerHTML=`<dl class="kv"><dt>N<sub>d</sub>(Ni1) sin perturbar</dt><dd>${fmt(lr.N0,4)}</dd><dt>χ<sub>0</sub></dt><dd>${fmt(lr.chi0,4)} eV⁻¹</dd><dt>χ</dt><dd>${fmt(lr.chi,4)} eV⁻¹</dd><dt>U escalar = 1/χ₀ − 1/χ</dt><dd><b>${fmt(lr.U,2)} eV</b></dd>${lr.Umat?`<dt>U con la matriz 2×2 de sitios</dt><dd><b>${fmt(lr.Umat,2)} eV</b></dd>`:''}</dl>
      ${lr.cells?`<table class="tbl"><thead><tr><th>celda</th><th>átomos</th><th style="text-transform:none">χ₀ (eV⁻¹)</th><th style="text-transform:none">χ (eV⁻¹)</th><th>U (eV)</th></tr></thead><tbody>${lr.cells.map(c=>`<tr><td>${c.cell}</td><td>${c.nat}</td><td>${fmt(c.chi0,4)}</td><td>${fmt(c.chi,4)}</td><td><b>${fmt(c.U,2)}</b></td></tr>`).join('')}</tbody></table>`:''}
      <p class="note">En la celda de 4 átomos se usaron cuatro valores de α (±0.05 y ±0.1 eV) aplicados con <code>DFTU.PotentialShift T</code> solo al Ni1, partiendo de la densidad convergida con U = 0; la respuesta es lineal. La desnuda es la primera diagonalización sin mezclar; la autoconsistente, el SCF completo. ${lr.cells&&lr.cells.length>1?'Al repetir el cálculo en superceldas el valor apenas cambia, así que no es un efecto del tamaño de la celda.':''}</p>
      <p class="note">El resultado, cerca de 14 eV, es más del doble de los 4.6–6.3 eV publicados con proyectores de onda plana. U es la curvatura espuria medida sobre unos proyectores concretos: los de SIESTA son orbitales d confinados y muy localizados, y un proyector más compacto da una ocupación más sensible y un U mayor. Por eso un U calculado así solo vale para los mismos proyectores${sc.some(s=>s.U>8)?`, y el barrido incluye U = ${fmt(Umax,1)} eV para ver qué gap y momento produce`:''}. Es una inferencia razonable sobre la causa, no algo que estas corridas demuestren por sí solas.</p>`;
  }
  function drawH(){
    const U=S.uh; $('#uOut',root).textContent=U.toFixed(1);
    const n=[]; for(let i=0;i<=100;i++) n.push(i/100);
    chart($('#cvH',root),{xlim:[0,1],ylim:[-U/2-0.2,U/2+0.2],xlabel:'ocupación n',ylabel:'eV',legend:true,hlines:[{y:0}],
      series:[{d:n.map(x=>[x,U/2*x*(1-x)]),color:css('--accent'),width:2.2,label:'E_U'},{d:n.map(x=>[x,U*(0.5-x)]),color:css('--orb-d'),width:2,dash:[5,3],label:'V_U'}],
      read:x=>x==null?'Pasa el cursor sobre la ocupación.':`<span>n <b>${fmt(x,2)}</b></span><span>E_U <b>${fmt(U/2*x*(1-x),3)} eV</b></span><span>V_U <b>${fmt(U*(0.5-x),3)} eV</b></span>`,readEl:$('#hRead',root)});
  }
  S.uh=4; $('#uIn',root).oninput=e=>{ S.uh=+e.target.value; drawH(); };
  seg($('#uSel',root),String(S.U),v=>{ S.U=+v; drawPd(); drawGap(); drawMom(); });
  $('#fdfPre',root).textContent=N.fdf; $('#dlFdf',root).onclick=()=>downloadText(N.fdf,'NiO_U4.fdf');
  $$('canvas[data-export]',root).forEach(cv=>{ const ph=cv.closest('.panel').querySelector('.ph .btnrow')||cv.closest('.panel').querySelector('.ph'); ph.append(exportBar(cv,cv.dataset.export)); });
  const all=()=>{ drawPd(); drawGap(); drawMom(); drawLr(); drawH(); };
  view.onTheme(all); all();
}
