// Aprender 5 · Ciclo SCF: replay of real SIESTA runs, mixer comparison, energy terms, mixing-stability calculator.
import { $, $$, css, alpha, onTheme, esc, fmt, downloadText, seg } from '../core/ui.js';
import { chart, exportBar } from '../core/chart.js';
import D from '../data/scf_runs.json';

export const LUA_HOOK = `-- DFT Lab: registra cada iteración SCF de SIESTA en live.jsonl
-- Uso: añade  Lua.Script scf_hook.lua  al .fdf. Funciona en laptop o en cluster.
local Ry=13.605693122994
local names={"E.total","E.fermi","E.kinetic","E.harris","E.band_structure","E.exchange_correlation",
  "E.electrostatic","E.neutral_atom","E.ions","E.free","SCF.dD","SCF.dH","SCF.iteration","SCF.Mixer.Weight"}
local function num(x) if x==nil then return "null" end return string.format("%.10g",x) end
function siesta_comm()
  if siesta.state == siesta.SCF_LOOP then
    siesta.receive(names)
    local E=siesta.E
    local f=io.open("live.jsonl","a")
    f:write(string.format('{"it":%d,"Etot":%s,"Eharris":%s,"Efree":%s,"EF":%s,"Ekin":%s,"Ebs":%s,"Exc":%s,"Eel":%s,"Ena":%s,"dD":%s,"dH":%s,"w":%s}\\n',
      siesta.SCF.iteration or -1, num(E.total and E.total*Ry), num(E.harris and E.harris*Ry), num(E.free and E.free*Ry),
      num(E.fermi and E.fermi*Ry), num(E.kinetic and E.kinetic*Ry), num(E.band_structure and E.band_structure*Ry),
      num(E.exchange_correlation and E.exchange_correlation*Ry), num(E.electrostatic and E.electrostatic*Ry),
      num(E.neutral_atom and E.neutral_atom*Ry), num(siesta.SCF.dD), num(siesta.SCF.dH and siesta.SCF.dH*Ry),
      num(siesta.SCF.Mixer.Weight)))
    f:close()
    -- opcional: cambiar el peso de mezcla en vivo escribiendo un número en control.txt
    local c=io.open("control.txt","r")
    if c then local w=tonumber(c:read("*l")); c:close(); os.remove("control.txt")
      if w then siesta.SCF.Mixer.Weight=w; siesta.send({"SCF.Mixer.Weight"}) end end
  end
end
`;

const label = r => `${r.method==='linear'?'lineal':r.method} ${r.weight}${r.mix==='DM'?' · DM':''}`;

function theory(){ return `
  <h3>Un problema de punto fijo</h3>
  <p>Las ecuaciones de Kohn–Sham dependen de su propia solución: el hamiltoniano necesita la densidad y la densidad sale de los orbitales del hamiltoniano. Se resuelven por iteración hasta que la entrada y la salida coinciden (<i>self-consistent field</i>, SCF).</p>
  <div class="eq">ρ<sub>in</sub> → V<sub>H</sub>+V<sub>xc</sub> → H → ψ<sub>n</sub>, ε<sub>n</sub> → ρ<sub>out</sub> = Σ f<sub>n</sub>|ψ<sub>n</sub>|²</div>
  <p>SIESTA mezcla por defecto el hamiltoniano (<code>SCF.Mix Hamiltonian</code>) y puede mezclar la matriz densidad (<code>SCF.Mix density</code>). Termina cuando el mayor cambio de un elemento de H es menor que <code>SCF.H.Tolerance</code> (10⁻³ eV) y el de la matriz densidad menor que <code>SCF.DM.Tolerance</code> (10⁻⁴).</p>
  <h3>Mezcla lineal y por qué falla en metales</h3>
  <div class="eq">x<sub>n+1</sub> = x<sub>n</sub> + w (x<sub>out</sub> − x<sub>n</sub>), &nbsp; δx<sub>n+1</sub> ≈ (1 − w ε) δx<sub>n</sub></div>
  <p>El error de cada componente de Fourier se multiplica por 1 − w ε(q), con ε la función dieléctrica. Converge solo si w &lt; 2/ε<sub>máx</sub>. En un aislante ε está acotada (ε<sub>∞</sub> = 11.7 en Si) y casi cualquier peso funciona en una celda chica. En un metal ε(q) ≈ 1 + k<sub>TF</sub>²/q² crece sin límite a q pequeño: cuanto más larga la celda, menor el q mínimo y menor el peso admisible. Es el <b>charge sloshing</b>: la carga va y viene de un extremo a otro de la celda.</p>
  <h3>Pulay y Broyden</h3>
  <p>Pulay (DIIS) busca la combinación de las últimas <code>SCF.Mixer.History</code> entradas que minimiza el residuo; Broyden construye una aproximación al jacobiano inverso. Los dos aprenden ε sobre la marcha y convergen en pocas iteraciones incluso en metales. El precondicionador de Kerker, q²/(q²+q₀²), amortigua los q pequeños antes de mezclar.</p>
  <h3>Harris y Kohn–Sham</h3>
  <p>SIESTA imprime en cada iteración la energía de Harris–Foulkes (columna 2 de <code>scf:</code>) y la de Kohn–Sham (columna 3). Las dos coinciden en el punto fijo, pero el error de Harris es de segundo orden en δρ: converge antes y sirve para vigilar el ciclo.</p>
  <h3>Qué hacer cuando no converge</h3>
  <p>Bajar el peso solo ayuda con mezcla lineal. Lo habitual es Pulay o Broyden con peso 0.1–0.3 e historia 6–8, subir <code>ElectronicTemperature</code> en metales, o empezar desde una matriz densidad guardada (<code>DM.UseSaveDM</code>). Si oscila entre dos valores sin bajar, como el grafito con VV10 a 3.1 Å del curso, la tolerancia pedida está por debajo del ruido numérico de la malla.</p>
  <p class="src">Pulay, CPL 73, 393 (1980) · Johnson, PRB 38, 12807 (1988) · Kerker, PRB 23, 3082 (1981) · Kresse y Furthmüller, PRB 54, 11169 (1996) · Harris, PRB 31, 1770 (1985).</p>`; }

let cleanup=[];
export function destroy(){ cleanup.forEach(f=>f()); cleanup=[]; }

export function mount(root){
  const runs=D.runs, lua=D.lua;
  const S={sys:'Si', sel:new Set(['lin005','lin025','lin095','pulay025','broyden025']), replay:'lin025', step:1e9, playing:0, w:0.25, L:18.08, metal:true, kerker:false, ytab:'dH'};
  const systems={Si:runs.filter(r=>r.id.indexOf('mg_')!==0), Mg:runs.filter(r=>r.id.indexOf('mg_')===0)};
  root.innerHTML=`
  <div class="pghead"><div>
    <div class="kicker">Aprender · 5</div><h1>El ciclo autoconsistente</h1>
    <p class="lede">Doce corridas reales de SIESTA con el mismo sistema y distinto mezclador. El silicio converge casi con cualquier cosa; una lámina de magnesio metálico de 18 Å diverge con mezcla lineal y converge en 5 iteraciones con Pulay. Aquí se ve por qué.</p>
  </div></div>
  <div class="pgrid">
    <article class="panel theory sticky">${theory()}</article>
    <div class="charts">
      <section class="panel wide"><div class="ph"><h2>Convergencia por mezclador</h2>
        <div class="btnrow"><div class="seg" id="sysSel"><button data-v="Si">Si aislante</button><button data-v="Mg">Mg metal</button></div>
        <div class="seg" id="ySel"><button data-v="dH">dH<sub>máx</sub></button><button data-v="dD">dD<sub>máx</sub></button><button data-v="dE">|E − E<sub>final</sub>|</button></div></div></div>
        <div class="pb"><div class="chips" id="runChips"></div><canvas data-export="scf_convergencia" id="cvConv" style="height:300px"></canvas><div class="readout" id="convRead"></div>
        <div class="tblwrap"><table class="tbl" id="runTab"></table></div></div></section>

      <section class="panel wide"><div class="ph"><h2>Repetición de una corrida</h2><div class="btnrow"><select id="repSel" class="tiny"></select><button class="tiny" id="repPlay">▶ reproducir</button><button class="tiny" id="repFdf">exportar .fdf</button></div></div>
        <div class="pb"><label class="sl" style="width:100%">iteración <input type="range" id="repIt" min="0" max="1" value="0" style="flex:1;width:auto"><output id="repOut">1</output></label>
        <canvas data-export="scf_harris_ks" id="cvRep" style="height:250px"></canvas>
        <pre class="code" id="repLog" style="max-height:180px;overflow:auto"></pre></div></section>

      <section class="panel"><div class="ph"><h2>Calculadora · estabilidad de la mezcla lineal</h2><span class="sub">modelo dieléctrico</span></div>
        <div class="pb"><div class="btnrow"><div class="seg" id="matSel"><button data-v="metal">metal (Mg, r<sub>s</sub> 2.66)</button><button data-v="ins">aislante (Si, ε<sub>∞</sub> 11.7)</button></div><button class="tiny" id="kerk" aria-pressed="false">Kerker</button></div>
        <div class="btnrow" style="margin-top:8px"><label class="sl">peso w <input type="range" id="wIn" min="0.01" max="1" step="0.01" value="0.25"><output id="wOut"></output></label>
        <label class="sl">celda L (Å) <input type="range" id="LIn" min="3" max="60" step="0.1" value="18.08"><output id="LOut"></output></label></div>
        <canvas data-export="scf_factor_mezcla" id="cvMix" style="height:250px"></canvas><div class="readout" id="mixRead"></div>
        <p class="note">El factor |1 − w ε(q)| por iteración para cada vector de onda q = 2πn/L. Por encima de 1 ese componente crece. Modelo de Thomas–Fermi para el metal y de Resta simplificado para el aislante; es una estimación, no el ε de SIESTA.</p></div></section>

      <section class="panel"><div class="ph"><h2>Energía total del Si por términos</h2><span class="sub">bloque «Final energy» de SIESTA</span></div>
        <div class="pb"><canvas data-export="Si_terminos_energia" id="cvTerms" style="height:250px"></canvas><div class="readout" id="termRead"></div>
        <p class="note">E<sub>KS</sub> = T<sub>s</sub> + E<sub>H</sub> + E<sub>xc</sub> + E<sub>ion-e</sub> + E<sub>ion-ion</sub>. Dos términos enormes y de signo opuesto (cinética e ion–ion) casi se cancelan; por eso las diferencias de energía que importan, de meV, exigen converger cada uno con cuidado.</p></div></section>

      <section class="panel wide"><div class="ph"><h2>Cada término iteración a iteración</h2><span class="sub">registrado en vivo con un hook Lua de SIESTA</span><div class="btnrow"><button class="tiny" id="luaDl">exportar hook .lua</button></div></div>
        <div class="pb"><canvas data-export="scf_terminos_por_iteracion" id="cvLua" style="height:270px"></canvas><div class="readout" id="luaRead"></div>
        <p class="note">Si con mezcla lineal de peso 0.25; en la iteración 10 el hook subió el peso a 0.7 leyendo <code>control.txt</code>, sin reiniciar el cálculo. El hook funciona igual en una laptop o en un cluster; el archivo <code>live.jsonl</code> que escribe se puede cargar en Postproceso.</p></div></section>
    </div>
  </div>
  <footer class="prov">Si: diamante, 2 átomos, DZP, LDA, MeshCutoff 150 Ry, pseudo Si.psf del test de SIESTA. Mg: lámina fcc de 16 átomos (4.52 × 4.52 × 18.08 Å), DZP, LDA, k 6×6×2, 300 K, tope de 150 iteraciones. SIESTA 5.4.2. Las corridas lineales de Mg terminaron sin converger y con energías de +15 000 eV.</footer>`;

  const pal=()=>[css('--accent'),css('--orb-p'),css('--orb-d'),css('--up'),css('--dn'),css('--orb-s'),css('--warn'),css('--e1')];
  const colorOf=id=>{ const l=systems[id.indexOf('mg_')===0?'Mg':'Si'].map(r=>r.id); return pal()[l.indexOf(id)%8]; };
  const col=k=>runs[0].cols.indexOf(k);
  const yval=(r,row)=>{ if(S.ytab==='dH') return row[col('dHmax')]; if(S.ytab==='dD') return row[col('dDmax')];
    const ef=r.converged?r.iters[r.iters.length-1][col('Etot')]:NaN; return Math.abs(row[col('Etot')]-ef)||1e-7; };

  function chips(){
    const list=systems[S.sys];
    $('#runChips',root).innerHTML=list.map(r=>`<button class="tiny" data-id="${r.id}" aria-pressed="${S.sel.has(r.id)}"><span class="sw" style="background:${colorOf(r.id)}"></span>${esc(label(r))}</button>`).join('');
    $$('#runChips button',root).forEach(b=>b.onclick=()=>{ const id=b.dataset.id; S.sel.has(id)?S.sel.delete(id):S.sel.add(id); b.setAttribute('aria-pressed',S.sel.has(id)); drawConv(); });
    $('#runTab',root).innerHTML=`<thead><tr><th>Mezclador</th><th>Mezcla</th><th>Peso</th><th>Historia</th><th>Iteraciones</th><th>Resultado</th><th>E<sub>KS</sub> final (eV)</th></tr></thead><tbody>${list.map(r=>{ const last=r.iters[r.iters.length-1];
      return `<tr><td>${esc(r.method==='linear'?'Lineal':r.method)}</td><td>${r.mix==='DM'?'matriz densidad':'hamiltoniano'}</td><td>${r.weight}</td><td>${r.method==='linear'?'—':r.history}</td><td>${r.iters.length}</td><td style="color:${r.converged?css('--ok'):css('--bad')}">${r.converged?'convergió':'no convergió'}</td><td>${r.converged?fmt(last[col('Etot')],6):fmt(last[col('Etot')],1)}</td></tr>`; }).join('')}</tbody>`;
  }
  function drawConv(){
    const list=systems[S.sys].filter(r=>S.sel.has(r.id));
    const series=list.map(r=>({d:r.iters.map(row=>[row[0],Math.max(yval(r,row),1e-7)]).filter(p=>isFinite(p[1])),color:colorOf(r.id),width:1.8,label:label(r)}));
    const maxIt=Math.max(10,...list.map(r=>r.iters.length));
    const tol=S.ytab==='dH'?1e-3:S.ytab==='dD'?(S.sys==='Mg'?1e-5:1e-4):null;
    chart($('#cvConv',root),{xlim:[1,maxIt],ylim:[1e-7, S.sys==='Mg'?1e3:10],logy:true,xlabel:'iteración SCF',
      ylabel:S.ytab==='dH'?'máx |ΔH| (eV)':S.ytab==='dD'?'máx |ΔDM|':'|E_KS − E_final| (eV)',series,legend:true,
      hlines:tol?[{y:tol,label:'tolerancia',dash:[4,3]}]:[],
      read:(x)=>x==null?'Pasa el cursor sobre las curvas.':list.map(r=>{ const row=r.iters[Math.round(x)-1]; return row?`<span><span class="sw" style="background:${colorOf(r.id)}"></span>${esc(label(r))} <b>${yval(r,row).toExponential(1)}</b></span>`:''; }).join(''),readEl:$('#convRead',root)});
  }
  // replay
  const repSel=$('#repSel',root); repSel.innerHTML=runs.map(r=>`<option value="${r.id}">${r.system.split(' ')[0]} · ${esc(label(r))}</option>`).join(''); repSel.value=S.replay;
  const cur=()=>runs.find(r=>r.id===S.replay);
  function drawRep(){
    const r=cur(), n=r.iters.length, k=Math.min(S.step,n-1); S.step=k;
    const it=$('#repIt',root); it.max=n-1; it.value=k; $('#repOut',root).textContent=k+1;
    const ref=r.converged?r.iters[n-1][col('Etot')]:null;
    const vals=r.iters.map(row=>ref==null?row[col('Etot')]:Math.abs(row[col('Etot')]-ref)||1e-7);
    const har=r.iters.map(row=>ref==null?row[col('Eharris')]:Math.abs(row[col('Eharris')]-ref)||1e-7);
    const upto=a=>a.slice(0,k+1).map((v,i)=>[i+1,v]);
    const log=ref!=null;
    const all=[...vals,...har].filter(isFinite); const lo=log?1e-7:Math.min(...all), hi=log?Math.max(1,...all)*2:Math.max(...all);
    chart($('#cvRep',root),{xlim:[1,Math.max(n,2)],ylim:log?[lo,hi]:[lo-(hi-lo)*0.05,hi+(hi-lo)*0.05],logy:log,xlabel:'iteración SCF',ylabel:log?'|E − E_final| (eV)':'E (eV)',legend:true,
      series:[{d:upto(vals),color:css('--accent'),width:2,label:'Kohn–Sham'},{d:upto(har),color:css('--orb-d'),width:1.6,dash:[5,3],label:'Harris–Foulkes'}],
      points:[{x:k+1,y:vals[k],color:css('--accent'),r:4}]});
    const lines=['        iscf     Eharris(eV)        E_KS(eV)     FreeEng(eV)     dDmax  Ef(eV) dHmax(eV)'];
    r.iters.slice(0,k+1).forEach(row=>lines.push(`   scf: ${String(row[0]).padStart(4)} ${row[1].toFixed(6).padStart(15)} ${row[2].toFixed(6).padStart(15)} ${row[3].toFixed(6).padStart(15)} ${row[4].toFixed(6).padStart(9)} ${row[5].toFixed(4).padStart(9)} ${row[6].toFixed(6).padStart(9)}`));
    if(k===n-1) lines.push(r.converged?'\nSCF Convergence by DM+H criterion':`\nSCF_NOT_CONV: alcanzó MaxSCFIterations = ${r.maxit}`);
    const pre=$('#repLog',root); pre.textContent=lines.join('\n'); pre.scrollTop=pre.scrollHeight;
  }
  function stop(){ clearInterval(S.playing); S.playing=0; $('#repPlay',root).textContent='▶ reproducir'; }
  $('#repPlay',root).onclick=()=>{ if(S.playing){ stop(); return; } const n=cur().iters.length; if(S.step>=n-1) S.step=0;
    $('#repPlay',root).textContent='❚❚ pausa'; S.playing=setInterval(()=>{ S.step++; if(S.step>=cur().iters.length-1){ S.step=cur().iters.length-1; stop(); } drawRep(); }, Math.max(40,2400/n)); };
  repSel.onchange=()=>{ stop(); S.replay=repSel.value; S.step=1e9; drawRep(); };
  $('#repIt',root).oninput=e=>{ stop(); S.step=+e.target.value; drawRep(); };
  $('#repFdf',root).onclick=()=>downloadText(cur().fdf, cur().id+'.fdf');
  cleanup.push(stop);

  // mixing calculator
  const BOHR=0.529177;
  function eps(q){ // q in 1/Å
    if(S.metal){ const rs=2.66, kF=1.919/rs, kTF=Math.sqrt(4*kF/Math.PI)/BOHR; return 1+kTF*kTF/(q*q); }
    const einf=11.7, kTF=2.08; return 1+1/(1/(einf-1)+q*q/(kTF*kTF));
  }
  const factor=q=>{ let e=eps(q); if(S.kerker){ const q0=1.5; e*=q*q/(q*q+q0*q0); } return Math.abs(1-S.w*e); };
  function drawMix(){
    $('#wOut',root).textContent=S.w.toFixed(2); $('#LOut',root).textContent=S.L.toFixed(1);
    const qmin=2*Math.PI/S.L, d=[]; for(let i=0;i<=300;i++){ const q=0.05+i*(6-0.05)/300; d.push([q,factor(q)]); }
    const pts=[]; for(let n=1;n*qmin<=6;n++){ const q=n*qmin, f=factor(q); pts.push({x:q,y:Math.min(f,4),color:f>1?css('--bad'):css('--ok'),r:3.5}); }
    const worst=Math.max(...pts.map(p=>factor(p.x)));
    let e0=eps(qmin); if(S.kerker){ e0*=qmin*qmin/(qmin*qmin+2.25); }
    chart($('#cvMix',root),{xlim:[0,6],ylim:[0,4],xlabel:'q (1/Å)',ylabel:'|1 − w ε(q)|',series:[{d:d.map(([x,y])=>[x,Math.min(y,4)]),color:css('--accent'),width:2,label:'factor por iteración'}],
      shade:[{y0:1,y1:4,color:alpha(css('--bad'),0.08)}],vlines:[{x:qmin,label:'2π/L',dash:[3,3]}],points:pts,legend:false,nohover:true});
    $('#mixRead',root).innerHTML=`<span>peor factor <b style="color:${worst>1?css('--bad'):css('--ok')}">${worst.toFixed(2)}</b></span><span>w máx estable ≈ <b>${(2/Math.max(...pts.map(p=>{ let e=eps(p.x); if(S.kerker) e*=p.x*p.x/(p.x*p.x+2.25); return e; }))).toFixed(3)}</b></span><span>${worst>1?'diverge':'converge'}${worst<1?` en ~${Math.ceil(Math.log(1e-4)/Math.log(Math.max(worst,1e-6)))} iteraciones (10⁻⁴)`:''}</span>`;
  }
  seg($('#matSel',root),'metal',v=>{ S.metal=v==='metal'; if(!S.metal){ S.L=3.84; } else S.L=18.08; $('#LIn',root).value=S.L; drawMix(); });
  $('#kerk',root).onclick=e=>{ S.kerker=!S.kerker; e.currentTarget.setAttribute('aria-pressed',S.kerker); drawMix(); };
  $('#wIn',root).oninput=e=>{ S.w=+e.target.value; drawMix(); };
  $('#LIn',root).oninput=e=>{ S.L=+e.target.value; drawMix(); };

  // energy terms (waterfall)
  function drawTerms(){
    const f=runs.find(r=>r.id==='lin025').final;
    const T=[['Cinética T_s',f['Kinetic']],['Hartree',f['Hartree']],['Intercambio',f['Exch.']],['Correlación',f['Corr.']],['Ion–electrón',f['Ion-electron']],['Ion–ion',f['Ion-ion']]];
    let acc=0; const segs=[], pts=[]; const xt=[];
    const SH=['T_s','E_H','E_x','E_c','E_ie','E_ii'];
    T.forEach(([n,v],i)=>{ const a=acc; acc+=v; segs.push({x0:i+0.5,x1:i+1.5,y0:Math.min(a,acc),y1:Math.max(a,acc),color:alpha(v>0?css('--up'):css('--dn'),0.55)}); xt.push({x:i+1,label:SH[i]}); });
    segs.push({x0:T.length+0.5,x1:T.length+1.5,y0:acc,y1:0,color:alpha(css('--accent'),0.7)}); xt.push({x:T.length+1,label:'Total'});
    chart($('#cvTerms',root),{xlim:[0.4,T.length+1.6],ylim:[-260,110],ylabel:'eV',xticks:xt,shade:segs.map(s=>({x0:s.x0+0.08,x1:s.x1-0.08,y0:s.y0,y1:s.y1,color:s.color})),hlines:[{y:0}],series:[],nohover:false,
      csv:()=>'termino,eV\n'+T.map(([n,v])=>`${n},${v}`).join('\n')+`\nTotal,${f['Total']}\n`,
      read:x=>{ if(x==null) return `E<sub>KS</sub> = <b>${fmt(f['Total'],4)} eV</b> para 2 átomos`; const i=Math.round(x)-1; if(i>=0&&i<T.length) return `${T[i][0]} <b>${fmt(T[i][1],4)} eV</b>`; return `Total <b>${fmt(f['Total'],4)} eV</b>`; },readEl:$('#termRead',root)});
  }
  // Lua per-iteration
  function drawLua(){
    const last=lua[lua.length-1];
    const K=[['Ekin','T_s',css('--up')],['Ebs','E banda',css('--orb-p')],['Exc','E_xc',css('--orb-d')],['Ena','E átomo neutro',css('--orb-s')],['Eel','E electrostática',css('--warn')],['Etot','E_KS',css('--ink')]];
    const series=K.map(([k,n,c])=>({d:lua.map(r=>[r.it,r[k]-last[k]]),color:c,width:k==='Etot'?2.4:1.6,label:n}));
    const wch=lua.findIndex((r,i)=>i>0&&r.w!==lua[i-1].w);
    chart($('#cvLua',root),{xlim:[1,lua.length],ylim:[-0.8,0.8],yticksStep:0.2,xlabel:'iteración SCF',ylabel:'E(it) − E(final)  (eV)',series,legend:true,
      vlines:wch>0?[{x:lua[wch].it,label:'w → '+lua[wch].w,dash:[3,3]}]:[],
      read:x=>{ if(x==null) return 'Pasa el cursor: cada término respecto a su valor final.'; const r=lua[Math.round(x)-1]; return r?K.map(([k,n])=>`<span>${n} <b>${fmt(r[k]-last[k],4)}</b></span>`).join('')+`<span>w <b>${r.w}</b></span>`:''; },readEl:$('#luaRead',root)});
  }
  $('#luaDl',root).onclick=()=>downloadText(LUA_HOOK,'dftlab_scf_hook.lua');

  seg($('#sysSel',root),S.sys,v=>{ S.sys=v; S.sel=new Set(systems[v].map(r=>r.id)); chips(); drawConv(); });
  seg($('#ySel',root),S.ytab,v=>{ S.ytab=v; drawConv(); });
  $$('canvas[data-export]',root).forEach(cv=>{ const ph=cv.closest('.panel').querySelector('.ph .btnrow')||cv.closest('.panel').querySelector('.ph'); ph.append(exportBar(cv,cv.dataset.export)); });
  const all=()=>{ chips(); drawConv(); drawRep(); drawMix(); drawTerms(); drawLua(); };
  onTheme(all); all();
}
