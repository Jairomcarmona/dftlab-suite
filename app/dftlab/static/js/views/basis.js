// Aprender 4 · Base y mallas: PAO orbitals, basis size, EnergyShift, MeshCutoff (with egg-box) and k-points,
// all from real SIESTA runs on Si.
import { $, $$, css, alpha, onTheme, fmt, seg } from '../core/ui.js';
import { chart, exportBar } from '../core/chart.js';
import C from '../data/conv.json';

const BAS = ['SZ','SZP','DZ','DZP','TZP'];
const LN = ['s','p','d'];

function theory(){ return `
  <h3>Orbitales atómicos numéricos</h3>
  <p>SIESTA desarrolla los orbitales de Kohn–Sham en una base de orbitales atómicos numéricos (PAO): funciones radiales tabuladas por un armónico esférico, con un radio de corte r<sub>c</sub> a partir del cual valen exactamente cero. Gracias a ese corte el hamiltoniano es disperso y el costo puede crecer linealmente con el número de átomos.</p>
  <div class="eq">φ<sub>nlm</sub>(r) = R<sub>nl</sub>(r) Y<sub>lm</sub>(r̂), &nbsp; R<sub>nl</sub>(r ≥ r<sub>c</sub>) = 0</div>
  <h3>El tamaño de la base</h3>
  <p><b>SZ</b> (single-ζ) usa un orbital por estado de valencia: 4 en Si. <b>DZ</b> añade un segundo orbital por canal con el método de split-norm, que da flexibilidad radial. <b>P</b> agrega orbitales de polarización con l + 1 (3d en Si), que permiten deformar la densidad en el enlace. DZP es el estándar razonable; TZP sirve para comprobar.</p>
  <h3>EnergyShift: el radio de corte</h3>
  <p>El primer ζ es la solución del átomo dentro de un pozo infinito en r<sub>c</sub>. <code>PAO.EnergyShift</code> es cuánto sube su energía por el confinamiento: menos energy shift, orbitales más largos, más vecinos que se solapan, mejor energía y más costo. El valor por defecto de SIESTA es 0.02 Ry, unos 272 meV, bastante corto; 20–50 meV es una elección común para producción.</p>
  <h3>La malla real: MeshCutoff</h3>
  <p>La densidad, el potencial de Hartree y el de intercambio-correlación se evalúan en una malla en el espacio real. <code>MeshCutoff</code> es la energía de la onda plana más fina que la malla representa. Como los átomos no están sobre los puntos de malla, la energía cambia un poco al trasladar todo el cristal: es el <b>efecto egg-box</b>. Sube <code>MeshCutoff</code> o usa <code>Mesh.SubDivisions</code> si las fuerzas o los fonones lo sienten.</p>
  <h3>La malla k</h3>
  <p>Las integrales sobre la zona de Brillouin se hacen como sumas sobre una malla de Monkhorst–Pack. En un aislante convergen exponencialmente con el número de puntos; en un metal, la superficie de Fermi exige muchos más y un smearing (sección de calculadoras).</p>
  <h3>Qué converger y cuánto</h3>
  <p>Las energías absolutas casi nunca importan; importan las diferencias. Una diferencia converge antes que cada término, pero comprobarlo cuesta dos cálculos, no uno. Las curvas de esta página son el primer paso de cualquier proyecto con SIESTA.</p>
  <p class="src">Sankey y Niklewski, PRB 40, 3979 (1989) · Artacho et al., PSS(b) 215, 809 (1999) · Junquera et al., PRB 64, 235111 (2001) · Soler et al., JPCM 14, 2745 (2002) · Monkhorst y Pack, PRB 13, 5188 (1976).</p>`; }

export function mount(root){
  const S={bas:'DZP'};
  root.innerHTML=`
  <div class="pghead"><div>
    <div class="kicker">Aprender · 4</div><h1>Base, malla real y puntos k</h1>
    <p class="lede">Los tres parámetros de convergencia de SIESTA, medidos en ${C.mesh.length+Object.values(C.egg).reduce((s,a)=>s+a.length,0)+Object.values(C.basis).reduce((s,b)=>s+b.a.length,0)+C.es.length+Object.values(C.esa).reduce((s,b)=>s+b.a.length,0)+C.k.length} corridas reales del silicio. Cada punto de cada curva es un cálculo.</p>
  </div></div>
  <div class="pgrid">
    <article class="panel theory sticky">${theory()}</article>
    <div class="charts">
      <section class="panel"><div class="ph"><h2>Los orbitales de la base</h2><div class="seg" id="bSel">${BAS.map(b=>`<button data-v="${b}">${b}</button>`).join('')}</div></div>
        <div class="pb"><canvas data-export="Si_orbitales_PAO" id="cvPao" style="height:270px"></canvas><div class="readout" id="paoRead"></div>
        <p class="note">R(r) de cada orbital de Si, leído del archivo <code>Si.ion</code> que escribe SIESTA. El segundo ζ coincide con el primero fuera de su radio de split y es r<sup>l</sup>(a − br²) dentro.</p></div></section>

      <section class="panel"><div class="ph"><h2>EnergyShift y el radio de corte</h2></div>
        <div class="pb"><canvas data-export="Si_energyshift_3s" id="cvEs" style="height:270px"></canvas><div class="readout" id="esRead"></div>
        <p class="note">Primer ζ del orbital 3s para cada <code>PAO.EnergyShift</code>, en meV.</p></div></section>

      <section class="panel wide"><div class="ph"><h2>Convergencia con la base</h2></div>
        <div class="pb"><div class="tblwrap"><table class="tbl" id="basTab"></table></div><canvas data-export="Si_EOS_por_base" id="cvBas" style="height:260px;margin-top:10px"></canvas>
        <p class="note">a₀ y B₀ salen de un ajuste Birch–Murnaghan a 7 parámetros de red por base. El experimento da a₀ = 5.431 Å y B₀ = 98 GPa; la LDA converge a algo un poco menor en a₀, como se espera de ella.</p></div></section>

      <section class="panel"><div class="ph"><h2>MeshCutoff</h2></div>
        <div class="pb"><canvas data-export="Si_meshcutoff" id="cvMesh" style="height:260px"></canvas><div class="readout" id="meshRead"></div></div></section>

      <section class="panel"><div class="ph"><h2>Efecto egg-box</h2></div>
        <div class="pb"><canvas data-export="Si_eggbox" id="cvEgg" style="height:260px"></canvas><div class="readout" id="eggRead"></div>
        <p class="note">Energía al trasladar los dos átomos juntos a lo largo de x. Físicamente no debería cambiar nada; el rizo es la huella de la malla.</p></div></section>

      <section class="panel"><div class="ph"><h2>Puntos k</h2></div>
        <div class="pb"><canvas data-export="Si_kpuntos" id="cvK" style="height:260px"></canvas><div class="readout" id="kRead"></div></div></section>

      <section class="panel"><div class="ph"><h2>EnergyShift y la constante de red</h2></div>
        <div class="pb"><canvas data-export="Si_energyshift_a0" id="cvEsa" style="height:260px"></canvas><div class="readout" id="esaRead"></div>
        <p class="note">Orbitales más cortos dan enlaces más rígidos y un sólido más comprimido.</p></div></section>
    </div>
  </div>
  <footer class="prov">Si diamante, 2 átomos, LDA (Ceperley–Alder), pseudo Si.psf de los tests de SIESTA, mezcla Pulay. Salvo lo que se varía: DZP, EnergyShift por defecto (0.02 Ry), MeshCutoff 200 Ry, k 6×6×6 desplazada, a = 5.431 Å. SIESTA 5.4.2 en serie, un hilo; los tiempos son de esa máquina y sirven solo para comparar.</footer>`;

  const pal=()=>[css('--orb-s'),css('--orb-p'),css('--orb-d')];
  const bcol=b=>[css('--faint'),css('--orb-s'),css('--orb-p'),css('--accent'),css('--orb-d')][BAS.indexOf(b)];
  function drawPao(){
    const orbs=C.ion[S.bas], dash=[[],[6,3],[2,2]];
    const series=orbs.map(o=>({d:o.d,color:pal()[o.l],width:2,dash:dash[o.z-1],label:`3${LN[o.l]} ζ${o.z}${o.pol?' (pol.)':''} · r_c ${fmt(o.rc,2)} Bohr`}));
    const rmax=Math.max(...orbs.map(o=>o.rc))*1.05;
    chart($('#cvPao',root),{xlim:[0,rmax],ylim:[-0.6,1.3],xlabel:'r (Bohr)',ylabel:'R(r)',series,legend:true,hlines:[{y:0}],vlines:orbs.filter(o=>o.z===1).map(o=>({x:o.rc,dash:[2,3],color:pal()[o.l]})),
      read:x=>x==null?`${orbs.length} funciones radiales, ${C.basis[S.bas].norb/2} orbitales por átomo contando m`:series.map(s=>{ const p=s.d.reduce((b,q)=>Math.abs(q[0]-x)<Math.abs(b[0]-x)?q:b,s.d[0]); return `<span><span class="sw" style="background:${s.color}"></span>${s.label.split(' ·')[0]} <b>${fmt(p[1],3)}</b></span>`; }).join(''),readEl:$('#paoRead',root)});
  }
  function drawEs(){
    const ess=[500,200,50,20,5], cols=[css('--bad'),css('--warn'),css('--orb-p'),css('--accent'),css('--orb-d')];
    const series=ess.map((e,i)=>{ const o=C.ion['es'+e][0]; return {d:o.d,color:cols[i],width:2,label:`${e} meV · r_c ${fmt(o.rc,2)}`}; });
    chart($('#cvEs',root),{xlim:[0,Math.max(...ess.map(e=>C.ion['es'+e][0].rc))*1.05],ylim:[-0.1,0.9],xlabel:'r (Bohr)',ylabel:'R_3s(r)',series,legend:true,hlines:[{y:0}],nohover:true});
    $('#esRead',root).innerHTML=C.es.map(e=>`<span>${e.es} meV <b>${fmt(e.rc[0],2)}</b></span>`).join('')+'<span>r_c del 3s (Bohr)</span>';
  }
  function basis(){
    const ref=C.basis.TZP.E0;
    $('#basTab',root).innerHTML=`<thead><tr><th>Base</th><th>orb./átomo</th><th>a₀ (Å)</th><th>B₀ (GPa)</th><th>E₀ − E₀(TZP)</th><th>tiempo</th></tr></thead><tbody>${BAS.map(b=>{ const d=C.basis[b]; return `<tr${b==='DZP'?' class="hl"':''}><td>${b}</td><td>${d.norb/2}</td><td>${fmt(d.a0,3)}</td><td>${fmt(d.B0,0)}</td><td>${fmt((d.E0-ref)*1000/2,0)} meV/át.</td><td>${fmt(d.t[3],1)} s</td></tr>`; }).join('')}</tbody>`;
    const series=BAS.map(b=>{ const d=C.basis[b]; return {d:d.a.map((a,i)=>[a,(d.E[i]-ref)/2]),color:bcol(b),width:2,label:b}; });
    const ys=series.flatMap(s=>s.d.map(p=>p[1]));
    chart($('#cvBas',root),{xlim:[5.28,5.62],ylim:[Math.min(...ys)-0.05,Math.max(...ys)+0.05],xlabel:'a (Å)',ylabel:'E − E₀(TZP)  (eV/átomo)',series,legend:true,
      points:BAS.map(b=>({x:C.basis[b].a0,y:(C.basis[b].E0-ref)/2,color:bcol(b),r:3.5}))});
  }
  function drawMesh(){
    const m=C.mesh, ref=m[m.length-1].E;
    const d=m.slice(0,-1).map(x=>[x.ec,Math.max(Math.abs(x.E-ref)*1000/2,1e-3)]);
    chart($('#cvMesh',root),{xlim:[30,620],ylim:[1e-3,1e4],logy:true,xlabel:'MeshCutoff (Ry)',ylabel:'|E − E(600 Ry)|  (meV/átomo)',legend:false,
      series:[{d,color:css('--accent'),width:2,label:'error de energía'}],points:d.map(p=>({x:p[0],y:p[1],color:css('--accent'),r:3})),hlines:[{y:1,dash:[3,3],label:'1 meV'}],
      read:x=>{ if(x==null) return 'Pasa el cursor por los puntos.'; const r=m.reduce((b,q)=>Math.abs(q.ec-x)<Math.abs(b.ec-x)?q:b,m[0]); return `<span>${r.ec} Ry</span><span>malla <b>${r.mesh.join('×')}</b></span><span>E <b>${fmt(r.E,4)} eV</b></span><span>tiempo <b>${fmt(r.t,1)} s</b></span>`; },readEl:$('#meshRead',root)});
  }
  function drawEgg(){
    const cols={100:css('--bad'),300:css('--accent')};
    const series=Object.entries(C.egg).map(([m,a])=>{ const mean=a.reduce((s,x)=>s+x.E,0)/a.length; return {d:a.map(x=>[x.dx,(x.E-mean)*1000]),color:cols[m],width:2,label:`${m} Ry · amplitud ${fmt((Math.max(...a.map(x=>x.E))-Math.min(...a.map(x=>x.E)))*1000,2)} meV`}; });
    const ys=series.flatMap(s=>s.d.map(p=>p[1])), A=Math.max(...ys.map(Math.abs))*1.3||1;
    chart($('#cvEgg',root),{xlim:[0,0.5],ylim:[-A,A],xlabel:'desplazamiento rígido en x (Å)',ylabel:'E − ⟨E⟩  (meV por celda)',series,legend:true,hlines:[{y:0}],
      points:series.flatMap(s=>s.d.map(p=>({x:p[0],y:p[1],color:s.color,r:2.5}))),nohover:true});
    const sp=m=>{ const ec=+m, h=Math.PI/Math.sqrt(ec)*0.529177; return h; };
    $('#eggRead',root).innerHTML=Object.keys(C.egg).map(m=>`<span>${m} Ry: espaciado ≈ <b>${fmt(sp(m),3)} Å</b></span>`).join('');
  }
  function drawK(){
    const k=C.k, ref=k[k.length-1].E; const d=k.slice(0,-1).map(x=>[x.k,Math.max(Math.abs(x.E-ref)*1000/2,1e-4)]);
    chart($('#cvK',root),{xlim:[0.5,13],ylim:[1e-4,1e5],logy:true,xlabel:'n (malla n×n×n desplazada)',ylabel:'|E − E(14³)|  (meV/átomo)',series:[{d,color:css('--orb-p'),width:2,label:'error'}],
      points:d.map(p=>({x:p[0],y:p[1],color:css('--orb-p'),r:3})),hlines:[{y:1,dash:[3,3],label:'1 meV'}],legend:false,
      read:x=>{ if(x==null) return 'Un aislante converge rápido: con 6×6×6 el error ya es menor a 1 meV.'; const r=k.reduce((b,q)=>Math.abs(q.k-x)<Math.abs(b.k-x)?q:b,k[0]); return `<span>${r.k}×${r.k}×${r.k}</span><span>E <b>${fmt(r.E,4)} eV</b></span><span>tiempo <b>${fmt(r.t,1)} s</b></span>`; },readEl:$('#kRead',root)});
  }
  function drawEsa(){
    const ks=Object.keys(C.esa).map(Number).sort((a,b)=>b-a);
    const d=ks.map(e=>[e,C.esa[e].a0]), d2=ks.map(e=>[e,C.esa[e].B0]);
    chart($('#cvEsa',root),{xlim:[3,400],logx:true,ylim:[Math.min(...d.map(p=>p[1]))-0.02,Math.max(...d.map(p=>p[1]))+0.02],xlabel:'PAO.EnergyShift (meV)',ylabel:'a₀ (Å)',legend:false,
      series:[{d,color:css('--accent'),width:2,label:'a0'}],points:d.map(p=>({x:p[0],y:p[1],color:css('--accent'),r:3.5})),hlines:[{y:5.431,dash:[3,3],label:'exp. 5.431'}],nohover:true});
    $('#esaRead',root).innerHTML=ks.map(e=>`<span>${e} meV: a₀ <b>${fmt(C.esa[e].a0,3)}</b>, B₀ <b>${fmt(C.esa[e].B0,0)}</b> GPa</span>`).join('');
  }
  seg($('#bSel',root),S.bas,v=>{ S.bas=v; drawPao(); });
  $$('canvas[data-export]',root).forEach(cv=>{ const ph=cv.closest('.panel').querySelector('.ph .btnrow')||cv.closest('.panel').querySelector('.ph'); ph.append(exportBar(cv,cv.dataset.export)); });
  const all=()=>{ drawPao(); drawEs(); basis(); drawMesh(); drawEgg(); drawK(); drawEsa(); };
  onTheme(all); all();
}
