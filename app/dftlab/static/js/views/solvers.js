// Aprender · 6 — Cómo se resuelve H c = ε S c: diagonalización, OMM y orden N, con corridas reales de SIESTA en Si de 8 a 1000 átomos.
import { $, $$, css, alpha, fmt, downloadText, seg } from '../core/ui.js';
import { chart, exportBar } from '../core/chart.js';
import D from '../data/solvers.json';

const SOL={diag:{name:'Diagonalización',fdf:'SolutionMethod diagon',col:'--accent'},omm:{name:'OMM',fdf:'SolutionMethod OMM\nOMM.Precon -1',col:'--orb-p'},ordern:{name:'Orden N (Kim)',fdf:'SolutionMethod OrderN\nON.Functional Kim\nON.eta  <E_F en eV>\nON.RcLWF 4.0 Ang',col:'--orb-d'}};
const KEYS=['diag','omm','ordern'];

function theory(){ return `
  <h3>El cuello de botella</h3>
  <p>En cada paso del ciclo autoconsistente SIESTA tiene que pasar del hamiltoniano H<sub>μν</sub> y el solapamiento S<sub>μν</sub> (matrices dispersas en la base de orbitales atómicos) a la nueva matriz densidad ρ<sub>μν</sub>. Construir H cuesta O(N): cada orbital solo toca a sus vecinos. Lo que queda es resolver el problema generalizado de autovalores</p>
  <div class="eq">H c<sub>i</sub> = ε<sub>i</sub> S c<sub>i</sub>, &nbsp; ρ<sub>μν</sub> = Σ<sub>i</sub> f(ε<sub>i</sub>) c<sub>μi</sub> c<sub>νi</sub></div>
  <p>y la forma de hacerlo decide cómo escala el costo con el número de átomos N.</p>
  <h3>Diagonalización: O(N³)</h3>
  <p>LAPACK, ScaLAPACK o ELPA reducen S a forma de Cholesky y diagonalizan una matriz densa. Es exacta, funciona igual para metales y aislantes y da todos los autovalores (bandas, DOS, PDOS). Su costo crece como N³ y su memoria como N²: duplicar el sistema lo hace ocho veces más lento. Es la opción por defecto y la correcta por debajo de unos cientos de átomos.</p>
  <h3>OMM: minimización de orbitales</h3>
  <p>El método de minimización de orbitales (Mauri, Galli y Car; Ordejón et al.; libOMM de Corsetti) no busca autovectores: minimiza un funcional de los N<sub>occ</sub> orbitales ocupados sin imponer ortogonalidad,</p>
  <div class="eq">E[C] = 2 Tr[(2I − S<sub>W</sub>) H<sub>W</sub>], &nbsp; S<sub>W</sub> = CᵀSC, H<sub>W</sub> = CᵀHC</div>
  <p>cuyo mínimo coincide con la energía de banda. Sigue siendo cúbico, pero solo trabaja con los estados ocupados y reaprovecha los orbitales del paso SCF anterior, así que cada paso tras el primero es barato. Requiere gap (temperatura cero) y no entrega estados vacíos.</p>
  <h3>Orden N: localización y truncamiento</h3>
  <p>En un aislante la matriz densidad decae exponencialmente con la distancia (Kohn, “nearsightedness”). Si cada orbital de Wannier se trunca a un radio R<sub>c</sub> (<code>ON.RcLWF</code>), las matrices dejan de ser densas y el costo pasa a ser lineal en N. El funcional de Kim, Mauri y Galli añade un potencial químico η (<code>ON.eta</code>, que debe caer en el gap) para no fijar el número de orbitales. El precio es un error variacional que depende de R<sub>c</sub>, una convergencia lenta de los gradientes conjugados en el primer paso y la imposibilidad de tratar metales.</p>
  <h3>Qué usar</h3>
  <p>Diagonalización hasta unos cientos de átomos y siempre para metales; OMM para aislantes de cientos a pocos miles de átomos donde se repiten muchos pasos (dinámica molecular); orden N cuando N es tan grande que lo cúbico no cabe, aceptando un error que hay que medir. Para metales grandes existe PEXSI (expansión en polos), que escala como N<sup>2</sup> o mejor sin necesitar gap.</p>
  <p class="src">Ordejón, Drabold, Martin y Grumbach, PRB 51, 1456 (1995) · Kim, Mauri y Galli, PRB 52, 1640 (1995) · Kohn, PRL 76, 3168 (1996) · Corsetti, Comput. Phys. Commun. 185, 873 (2014) · Lin et al., J. Phys.: Condens. Matter 25, 295501 (2013) · Soler et al., J. Phys.: Condens. Matter 14, 2745 (2002).</p>`; }

function powfit(pts){ const p=pts.filter(q=>q[0]>=64); if(p.length<2) return null; const xs=p.map(q=>Math.log(q[0])), ys=p.map(q=>Math.log(q[1])); const n=xs.length, mx=xs.reduce((a,b)=>a+b)/n, my=ys.reduce((a,b)=>a+b)/n; let sxy=0,sxx=0; xs.forEach((x,i)=>{sxy+=(x-mx)*(ys[i]-my); sxx+=(x-mx)**2;}); const b=sxy/sxx; return {b,a:Math.exp(my-b*mx)}; }

export function mount(root, view){
  const R=D.runs.filter(r=>r.rc==null||r.rc===4);
  const by=k=>R.filter(r=>r.solver===k).sort((a,b)=>a.nat-b.nat);
  const fits={}; KEYS.forEach(k=>fits[k]=powfit(by(k).map(r=>[r.nat,r.time])));
  const rcScan=D.runs.filter(r=>r.solver==='ordern'&&r.nat===64).sort((a,b)=>a.rc-b.rc);
  const big=Math.max(...R.map(r=>r.nat));
  const S={step:KEYS.some(k=>by(k).some(r=>r.nat===512))?512:big, N:2000};
  root.innerHTML=`
  <div class="pghead"><div>
    <div class="kicker">Aprender · 6</div><h1>Resolver el hamiltoniano: diagonalización, OMM y orden N</h1>
    <p class="lede">El mismo silicio diamante, de 8 a ${big} átomos, con los tres métodos de SIESTA. Se mide el tiempo, el número de pasos SCF y el error en la energía frente a la diagonalización exacta.</p>
  </div></div>
  <div class="pgrid">
    <article class="panel theory sticky">${theory()}</article>
    <div class="charts">
      <section class="panel wide"><div class="ph"><h2>Tiempo total frente a número de átomos</h2></div>
        <div class="pb"><canvas data-export="solvers_tiempo" id="cvT" style="height:320px"></canvas><div class="readout" id="tRead"></div>
        <p class="note">Escalas logarítmicas: una ley de potencias t ∝ N<sup>b</sup> es una recta de pendiente b. Las pendientes se ajustan desde 64 átomos, porque en sistemas pequeños domina el costo fijo (malla real, lectura de pseudos). La pendiente de la diagonalización sale muy por debajo de 3: con base SZ, 512 átomos son solo 2048 orbitales, y una matriz densa de ese tamaño se diagonaliza en uno o dos segundos, mientras que cada paso SCF tardó ~16 s. El resto es trabajo O(N) en la malla real (densidad, potencial de Hartree, matrices de H), así que el régimen cúbico todavía no ha llegado. Es una inferencia a partir de los tiempos, no un desglose medido. Por la misma razón OMM no gana aquí: ahorra en la parte cúbica, que todavía es pequeña. Su ventaja se espera en sistemas más grandes, con bases más ricas y en dinámica molecular, donde cada paso reutiliza los orbitales del anterior.</p></div></section>

      <section class="panel"><div class="ph"><h2>Error en la energía total</h2></div>
        <div class="pb"><canvas data-export="solvers_error" id="cvE" style="height:260px"></canvas><div class="readout" id="eRead"></div></div></section>
      <section class="panel"><div class="ph"><h2>Radio de localización en orden N</h2></div>
        <div class="pb"><canvas data-export="ordern_RcLWF" id="cvRc" style="height:260px"></canvas><div class="readout" id="rcRead"></div></div></section>

      <section class="panel wide"><div class="ph"><h2>Dónde se va el tiempo, paso a paso</h2><div class="seg" id="stSel">${[...new Set(R.map(r=>r.nat))].filter(n=>n>8).map(n=>`<button data-v="${n}">${n} átomos</button>`).join('')}</div></div>
        <div class="pb"><canvas data-export="solvers_pasos" id="cvS" style="height:280px"></canvas><div class="readout" id="sRead"></div>
        <p class="note">Tiempo acumulado al final de cada paso SCF. En orden N el número junto a cada punto es la cantidad de iteraciones de gradiente conjugado que necesitaron los orbitales localizados; el primer paso parte de orbitales aleatorios y suele agotar el límite <code>ON.MaxNumIter</code>.</p></div></section>

      <section class="panel"><div class="ph"><h2>Calculadora · extrapolar a otro tamaño</h2></div>
        <div class="pb"><label class="sl">átomos de Si <input type="number" id="nIn" min="8" max="200000" step="8" value="2000" style="width:9em"></label>
        <div id="extra"></div>
        <p class="note">Extrapolación con las leyes de potencias medidas aquí (SZ, Γ, 2 hilos). Con DZP el número de orbitales por átomo se triplica (13 frente a 4 en Si) y la parte cúbica crece ~27 veces; con más hilos o MPI los tiempos bajan pero las pendientes se mantienen. Es una estimación de orden de magnitud, no una promesa.</p></div></section>

      <section class="panel"><div class="ph"><h2>Bloques .fdf</h2><div class="btnrow"><button class="tiny" id="dlS">exportar .fdf</button></div></div>
        <div class="pb"><pre class="code" id="fdfS" style="overflow-x:auto"></pre></div></section>
    </div>
  </div>
  <footer class="prov">${D.meta}. Celdas cúbicas de 8n³ átomos (n = 1…${Math.round(Math.cbrt(big/8))}), a = 5.431 Å, Pulay 0.25, DM.Tolerance 10⁻⁴. Orden N con funcional de Kim, η = nivel de Fermi de la corrida diagonalizada, ON.Etol 10⁻⁸, ON.MaxNumIter 1000. Tiempos de reloj de pared en un contenedor compartido: tómalos como tendencias.</footer>`;

  const col=k=>css(SOL[k].col);
  function drawT(){
    const series=[], points=[];
    KEYS.forEach(k=>{ const d=by(k).map(r=>[r.nat,r.time]); if(!d.length) return; series.push({d,color:col(k),width:2,label:SOL[k].name+(fits[k]?` · N^${fmt(fits[k].b,2)}`:'')}); d.forEach(p=>points.push({x:p[0],y:p[1],color:col(k),r:3.5})); });
    chart($('#cvT',root),{logx:true,logy:true,xlim:[6,1400],ylim:[0.5,5000],xlabel:'átomos',ylabel:'tiempo de pared (s)',series,points,legend:true,
      read:x=>{ if(x==null) return 'Pasa el cursor para leer cada tamaño.'; const n=[...new Set(R.map(r=>r.nat))].reduce((b,v)=>Math.abs(Math.log(v/x))<Math.abs(Math.log(b/x))?v:b); return `<span>${n} átomos</span>`+KEYS.map(k=>{ const r=R.find(q=>q.solver===k&&q.nat===n); return r?`<span><span class="sw" style="background:${col(k)}"></span>${SOL[k].name} <b>${fmt(r.time,1)} s</b> · ${r.nscf} pasos</span>`:''; }).join(''); },readEl:$('#tRead',root)});
  }
  function drawE(){
    const ks=['omm','ordern'], series=[], points=[];
    ks.forEach(k=>{ const d=by(k).filter(r=>r.dE_meV!=null).map(r=>[r.nat,Math.max(Math.abs(r.dE_meV),1e-4)]); if(!d.length) return; series.push({d,color:col(k),width:2,label:SOL[k].name}); d.forEach(p=>points.push({x:p[0],y:p[1],color:col(k),r:3.5})); });
    chart($('#cvE',root),{logx:true,logy:true,xlim:[6,1400],ylim:[1e-4,3000],xlabel:'átomos',ylabel:'|E − E_diag| (meV/átomo)',series,points,legend:true,hlines:[{y:1,label:'1 meV/átomo',dash:[4,3]}],nohover:true});
    $('#eRead',root).innerHTML=KEYS.slice(1).map(k=>by(k).filter(r=>r.dE_meV!=null).map(r=>`<span>${SOL[k].name} ${r.nat}: <b>${fmt(r.dE_meV,r.dE_meV>1?1:4)}</b></span>`).join('')).join('')+'<span>OMM es exacto (mismo mínimo); orden N con R<sub>c</sub> = 4 Å queda por encima: el truncamiento es variacional.</span>';
  }
  function drawRc(){
    if(rcScan.length<2){ $('#cvRc',root).closest('.panel').hidden=true; return; }
    const d=rcScan.map(r=>[r.rc,Math.max(r.dE_meV,1e-3)]);
    chart($('#cvRc',root),{logy:true,xlim:[3.5,Math.max(...d.map(p=>p[0]))+0.5],ylim:[0.01,300],xlabel:'ON.RcLWF (Å) · 64 átomos',ylabel:'error (meV/átomo)',series:[{d,color:col('ordern'),width:2,label:'orden N frente a diagonalización'}],points:d.map(p=>({x:p[0],y:p[1],color:col('ordern'),r:3.5})),hlines:[{y:1,label:'1 meV/átomo',dash:[4,3]}],legend:true,nohover:true});
    $('#rcRead',root).innerHTML=rcScan.map(r=>`<span>R<sub>c</sub> ${r.rc} Å: <b>${fmt(r.dE_meV,r.dE_meV<1?3:1)} meV</b> · ${fmt(r.time,0)} s · ${r.nscf} pasos</span>`).join('')+'<span>El error cae unas mil veces de 4 a 7 Å y el cálculo se vuelve más rápido, porque los gradientes conjugados convergen antes. Pero la celda de 64 átomos mide 10.9 Å: con 7 Å cada orbital ya cubre casi toda la celda y la ventaja lineal desaparece. En orden N el radio se elige midiendo este error en un sistema chico y luego se escala.</span>';
  }
  function drawS(){
    const n=S.step, series=[], points=[];
    KEYS.forEach(k=>{ const r=R.find(q=>q.solver===k&&q.nat===n); if(!r) return; const d=r.clock.map((c,i)=>[i+1,c]); series.push({d,color:col(k),width:2,label:SOL[k].name}); d.forEach((p,i)=>points.push({x:p[0],y:p[1],color:col(k),r:3.2,label:k==='ordern'&&r.cg[i]>1?String(r.cg[i]):undefined})); });
    const ymax=Math.max(...series.flatMap(s=>s.d.map(p=>p[1])));
    const xmax=Math.max(...series.flatMap(s=>s.d.map(p=>p[0])));
    chart($('#cvS',root),{logy:true,xlim:[0.5,xmax+0.8],ylim:[0.3,ymax*2],xlabel:'paso SCF',ylabel:'tiempo acumulado (s)',series,points,legend:true,nohover:true});
    $('#sRead',root).innerHTML=KEYS.map(k=>{ const r=R.find(q=>q.solver===k&&q.nat===n); return r?`<span><span class="sw" style="background:${col(k)}"></span>${SOL[k].name}: <b>${r.nscf}</b> pasos, <b>${fmt(r.time,1)} s</b></span>`:''; }).join('');
  }
  function drawX(){
    const N=S.N, t=k=>fits[k]?fits[k].a*N**fits[k].b:null;
    const h=s=>s<120?`${fmt(s,0)} s`:s<7200?`${fmt(s/60,1)} min`:s<172800?`${fmt(s/3600,1)} h`:`${fmt(s/86400,1)} días`;
    $('#extra',root).innerHTML=`<table class="tbl"><thead><tr><th>método</th><th>pendiente b</th><th>tiempo estimado</th></tr></thead><tbody>${KEYS.filter(k=>fits[k]).map(k=>`<tr><td><span class="sw" style="background:${col(k)}"></span>${SOL[k].name}</td><td>${fmt(fits[k].b,2)}</td><td><b>${h(t(k))}</b></td></tr>`).join('')}</tbody></table>`;
  }
  const fdf=`# Elige uno de los tres bloques\n\n# 1) Exacta, metales y aislantes\n${SOL.diag.fdf}\n\n# 2) Aislantes, cientos a miles de átomos\n${SOL.omm.fdf}\n\n# 3) Aislantes muy grandes; medir el error frente a R_c\n${SOL.ordern.fdf}\nON.MaxNumIter 1000\nON.Etol 1.e-8\n`;
  $('#fdfS',root).textContent=fdf; $('#dlS',root).onclick=()=>downloadText(fdf,'solvers.fdf');
  $('#nIn',root).oninput=e=>{ S.N=Math.max(8,+e.target.value||8); drawX(); };
  seg($('#stSel',root),String(S.step),v=>{ S.step=+v; drawS(); });
  $$('canvas[data-export]',root).forEach(cv=>{ const p=cv.closest('.panel').querySelector('.ph'); p.append(exportBar(cv,cv.dataset.export)); });
  const all=()=>{ drawT(); drawE(); drawRc(); drawS(); drawX(); };
  view.onTheme(all); all();
}
