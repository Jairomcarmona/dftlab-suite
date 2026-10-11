// Herramientas · Calculadoras: unidades, celda → malla k y MeshCutoff, Birch–Murnaghan, masa efectiva,
// smearing, gas de electrones y energía de formación. Todo corre en el navegador; cada resultado se exporta.
import { $, $$, css, alpha, onTheme, esc, fmt, downloadText, seg } from '../core/ui.js';
import { chart, exportBar } from '../core/chart.js';
import { fftGood, validateCellInputs, LIMITS } from '../tools/cellmesh.js';
import X from '../data/pseudo_xc.json';
import SI from '../data/si_lda.json';

const HBAR2_ME = 7.619964; // ħ²/m_e in eV·Å²
const BOHR = 0.529177210903, RY = 13.605693122994, HA = 27.211386245988;
const EV_A3_GPA = 160.21766208;

// ---------- small numerics ----------
function solve(A, b){ const n=b.length, M=A.map((r,i)=>[...r,b[i]]);
  for(let c=0;c<n;c++){ let p=c; for(let r=c+1;r<n;r++) if(Math.abs(M[r][c])>Math.abs(M[p][c])) p=r; [M[c],M[p]]=[M[p],M[c]];
    for(let r=0;r<n;r++){ if(r===c) continue; const f=M[r][c]/M[c][c]; for(let k=c;k<=n;k++) M[r][k]-=f*M[c][k]; } }
  return M.map((r,i)=>r[n]/r[i]); }
function polyfit(xs, ys, deg){ const n=deg+1, A=Array.from({length:n},()=>Array(n).fill(0)), b=Array(n).fill(0);
  xs.forEach((x,i)=>{ for(let r=0;r<n;r++){ b[r]+=ys[i]*x**r; for(let c=0;c<n;c++) A[r][c]+=x**(r+c); } }); return solve(A,b); }
const peval=(c,x)=>c.reduce((s,ci,i)=>s+ci*x**i,0);
function erfc(x){ const z=Math.abs(x), t=1/(1+0.5*z); const r=t*Math.exp(-z*z-1.26551223+t*(1.00002368+t*(0.37409196+t*(0.09678418+t*(-0.18628806+t*(0.27886807+t*(-1.13520398+t*(1.48851587+t*(-0.82215223+t*0.17087277))))))))); return x>=0?r:2-r; }
function parseCols(text){ return text.split(/\n/).map(l=>l.replace(/#.*/,'').trim()).filter(Boolean).map(l=>l.split(/[\s,;]+/).map(Number)).filter(r=>r.length>=2&&r.every(isFinite)); }
function cellMatrix(a,b,c,al,be,ga){ const r=Math.PI/180, ca=Math.cos(al*r), cb=Math.cos(be*r), cg=Math.cos(ga*r), sg=Math.sin(ga*r);
  const v1=[a,0,0], v2=[b*cg,b*sg,0], cx=c*cb, cy=c*(ca-cb*cg)/sg; return [v1,v2,[cx,cy,Math.sqrt(Math.max(c*c-cx*cx-cy*cy,0))]]; }
const cross=(u,v)=>[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]], dot=(u,v)=>u[0]*v[0]+u[1]*v[1]+u[2]*v[2], norm=u=>Math.hypot(...u);
function recip(M){ const V=dot(M[0],cross(M[1],M[2])); return {V, B:[cross(M[1],M[2]),cross(M[2],M[0]),cross(M[0],M[1])].map(v=>v.map(x=>2*Math.PI*x/V))}; }

// ---------- unit converter ----------
const UNITS={energy:{eV:1,Ry:RY,Ha:HA,meV:1e-3,'kJ/mol':1/96.485332,'kcal/mol':1/23.060548,'cm⁻¹':1/8065.54393,'K (k_B T)':8.617333262e-5,'THz (h ν)':4.135667696e-3},
  length:{'Å':1,Bohr:BOHR,nm:10,pm:0.01},
  pressure:{GPa:1,'eV/Å³':EV_A3_GPA,kbar:0.1,'Ry/Bohr³':RY/BOHR**3*EV_A3_GPA/ (1) /1,atm:1.01325e-4},
  force:{'eV/Å':1,'Ry/Bohr':RY/BOHR,'Ha/Bohr':HA/BOHR,nN:1/1.602176634}};
const UNIT_NAMES={energy:'Energía',length:'Longitud',pressure:'Presión y estrés',force:'Fuerza'};

function theory(){ return `
  <h3>Para qué son</h3>
  <p>Son las cuentas que se hacen a mano antes y después de cada cálculo: qué malla k pedir para una celda, qué <code>MeshCutoff</code> da qué espaciado de malla real, cómo sacar B<sub>0</sub> de una curva E(V) o una masa efectiva de una banda. Todas corren en el navegador y cada resultado se puede exportar, como bloque <code>.fdf</code>, CSV o figura.</p>
  <h3>Malla k</h3>
  <p>Con un espaciado Δk en el espacio recíproco, el número de puntos a lo largo de b<sub>i</sub> es n<sub>i</sub> = ⌈|b<sub>i</sub>| / Δk⌉. Un espaciado de 0.2 Å⁻¹ (con el 2π incluido) es razonable para aislantes; los metales piden 0.1 o menos. SIESTA también acepta <code>kgrid.Cutoff</code>: una longitud en espacio real que la supercelda de puntos k debe alcanzar.</p>
  <h3>MeshCutoff</h3>
  <p>SIESTA proyecta ρ y los potenciales en una malla real. Su energía de corte equivale a un espaciado h = π / √E<sub>c</sub> (Bohr, E<sub>c</sub> en Ry), y SIESTA redondea el número de puntos a un producto de 2, 3 y 5 para la FFT.</p>
  <div class="eq">h = π / √E<sub>c</sub>, &nbsp; n<sub>i</sub> ≥ |a<sub>i</sub>| / h</div>
  <h3>Birch–Murnaghan</h3>
  <p>La ecuación de estado de tercer orden es un polinomio cúbico en x = V<sup>−2/3</sup>, así que se ajusta por mínimos cuadrados lineales sin semilla inicial. B<sub>0</sub> = V E″(V<sub>0</sub>) y B′ = −1 − V<sub>0</sub> E‴/E″.</p>
  <div class="eq">E(V) = E<sub>0</sub> + 9V<sub>0</sub>B<sub>0</sub>/16 {[(V<sub>0</sub>/V)<sup>2/3</sup> − 1]³ B′ + [(V<sub>0</sub>/V)<sup>2/3</sup> − 1]² [6 − 4(V<sub>0</sub>/V)<sup>2/3</sup>]}</div>
  <h3>Masa efectiva</h3>
  <div class="eq">1/m* = (1/ħ²) d²E/dk², &nbsp; m*/m<sub>e</sub> = 7.620 eV·Å² / (d²E/dk²)</div>
  <p>Se ajusta una parábola a los puntos de la banda cerca del extremo. La ventana importa: muy ancha mete no parabolicidad; muy angosta, ruido de la interpolación.</p>
  <h3>Smearing</h3>
  <p>En metales la ocupación se suaviza con una función de ancho σ para que la integral sobre k converja con menos puntos. Fermi–Dirac es física a temperatura T; Gauss converge rápido pero sesga la energía; Methfessel–Paxton y Marzari–Vanderbilt (<i>cold smearing</i>) cancelan el error de orden más bajo a cambio de ocupaciones fuera de [0, 1].</p>
  <p class="src">Monkhorst y Pack, PRB 13, 5188 (1976) · Moreno y Soler, PRB 45, 13891 (1992) · Birch, PR 71, 809 (1947) · Methfessel y Paxton, PRB 40, 3616 (1989) · Marzari et al., PRL 82, 3296 (1999).</p>`; }

export function mount(root){
  root.innerHTML=`
  <div class="pghead"><div>
    <div class="kicker">Herramientas</div><h1>Calculadoras</h1>
    <p class="lede">Las cuentas de antes y después de un cálculo de SIESTA, con ejemplos tomados de las corridas del curso. Escribe tus propios valores en cualquier campo; los resultados se exportan como bloques .fdf, CSV o figuras.</p>
  </div></div>
  <div class="pgrid">
    <article class="panel theory sticky">${theory()}</article>
    <div class="charts">
      <section class="panel wide"><div class="ph"><h2>Celda → malla k y MeshCutoff</h2><div class="btnrow"><button class="tiny" id="cellSi">Si fcc</button><button class="tiny" id="cellMg">lámina Mg</button><button class="tiny" id="cellGr">grafito</button></div></div>
        <div class="pb"><div class="fields">
          ${['a','b','c'].map((k,i)=>`<label class="field">${k} (Å)<input id="c_${k}" type="number" step="0.001" value="3.840"></label>`).join('')}
          ${['α','β','γ'].map((k,i)=>`<label class="field">${k} (°)<input id="ang_${'abg'[i]}" type="number" step="0.01" value="60"></label>`).join('')}
          <label class="field">Δk (Å⁻¹, con 2π)<input id="c_dk" type="number" step="0.01" value="0.20"></label>
          <label class="field">MeshCutoff (Ry)<input id="c_ec" type="number" step="10" value="200"></label>
          <label class="field">desplazamiento<select id="c_sh"><option value="0.0">Γ centrada (0.0)</option><option value="0.5" selected>Monkhorst–Pack (0.5)</option></select></label>
        </div>
        <dl class="kv two" id="cellOut" style="margin-top:12px"></dl>
        <div class="btnrow" style="margin-top:8px"><button class="tiny" id="cellFdf">exportar bloque .fdf</button></div>
        <pre class="code" id="cellPre"></pre></div></section>

      <section class="panel wide"><div class="ph"><h2>Ecuación de estado · Birch–Murnaghan</h2><div class="btnrow"><button class="tiny" id="bmLda">Si LDA</button><button class="tiny" id="bmPbe">Si PBE</button><button class="tiny" id="bmRep">exportar informe</button></div></div>
        <div class="pb"><div class="split2">
          <div><div class="fields"><label class="field">columna 1<select id="bmX"><option value="a_fcc">a (Å), red fcc</option><option value="a_bcc">a (Å), red bcc</option><option value="a_sc">a (Å), cúbica simple</option><option value="V">V (Å³)</option></select></label>
            <label class="field">átomos por celda<input id="bmN" type="number" value="2" min="1"></label></div>
            <label class="field" style="margin-top:8px">datos: columna 1, E (eV)<textarea id="bmData" rows="10" style="font-family:var(--f-data);font-size:12px"></textarea></label></div>
          <div><canvas data-export="birch_murnaghan" id="cvBM" style="height:270px"></canvas><dl class="kv two" id="bmOut"></dl></div></div></div></section>

      <section class="panel"><div class="ph"><h2>Masa efectiva</h2><div class="seg" id="mSel"><button data-v="cb">e⁻ Si, Γ→X</button><button data-v="hh">h⁺ Si, Γ→X</button><button data-v="hl">h⁺ Si, Γ→L</button><button data-v="own">mis datos</button></div></div>
        <div class="pb"><label class="sl">ventana ±Δk <input type="range" id="mWin" min="0.03" max="0.3" step="0.005" value="0.10"><output id="mWinO"></output></label>
          <textarea id="mData" rows="5" hidden placeholder="k (Å⁻¹)  E (eV), una fila por punto" style="width:100%;font-family:var(--f-data);font-size:12px;margin-top:6px"></textarea>
          <canvas data-export="masa_efectiva" id="cvM" style="height:240px"></canvas><div class="readout" id="mOut"></div>
          <p class="note">Bandas de Si con LDA y base DZP del curso. El experimento da m<sub>l</sub> = 0.92 y m<sub>hh</sub>[100] ≈ 0.28–0.46 según la referencia; la LDA las aproxima, el gap no.</p></div></section>

      <section class="panel"><div class="ph"><h2>Funciones de smearing</h2><div class="seg" id="smSel"><button data-v="f">ocupación f</button><button data-v="d">δ̃ = −df/dε</button></div></div>
        <div class="pb"><label class="sl">σ (eV) <input type="range" id="smS" min="0.005" max="0.5" step="0.005" value="0.1"><output id="smSO"></output></label>
          <canvas data-export="smearing" id="cvSm" style="height:240px"></canvas><div class="readout" id="smOut"></div>
          <p class="note">En SIESTA: <code>OccupationFunction FD</code> o <code>MP</code> (con <code>OccupationMPOrder</code>) y <code>ElectronicTemperature</code> = σ. Fermi–Dirac usa σ = k<sub>B</sub>T.</p></div></section>

      <section class="panel"><div class="ph"><h2>Conversor de unidades</h2><div class="seg" id="uSel">${Object.keys(UNITS).map(k=>`<button data-v="${k}">${UNIT_NAMES[k]}</button>`).join('')}</div></div>
        <div class="pb"><div class="fields"><label class="field">valor<input id="uVal" type="number" value="1" step="any"></label><label class="field">unidad<select id="uFrom"></select></label></div>
          <div class="tblwrap"><table class="tbl" id="uTab"></table></div></div></section>

      <section class="panel"><div class="ph"><h2>Gas de electrones</h2><span class="sub">a partir de electrones de valencia y volumen</span></div>
        <div class="pb"><div class="fields"><label class="field">electrones de valencia<input id="gN" type="number" value="8" step="any"></label><label class="field">volumen de celda (Å³)<input id="gV" type="number" value="40.048" step="any"></label></div>
          <dl class="kv two" id="gOut" style="margin-top:10px"></dl>
          <p class="note">Valores del Si del curso (8 electrones en 40.05 Å³). El plasmón de valencia libre sale 16.6 eV; el pico de pérdida de energía medido en Si está en 16.7 eV.</p></div></section>

      <section class="panel wide"><div class="ph"><h2>Energía de formación</h2><div class="btnrow"><button class="tiny" id="fAdd">+ elemento</button><button class="tiny" id="fRep">exportar informe</button></div></div>
        <div class="pb"><div class="fields"><label class="field">E total del compuesto (eV)<input id="fE" type="number" step="any" placeholder="del .out: siesta: Total ="></label></div>
          <div class="tblwrap"><table class="tbl" id="fTab"></table></div><div class="readout" id="fOut"></div>
          <div class="eq">ΔH<sub>f</sub> = [E(compuesto) − Σ n<sub>i</sub> μ<sub>i</sub>] / Σ n<sub>i</sub></div>
          <p class="note">μ<sub>i</sub> es la energía por átomo de cada elemento en su fase de referencia, calculada con el mismo funcional, base, pseudo y MeshCutoff que el compuesto. Mezclar parámetros entre cálculos produce errores mayores que la propia ΔH.</p></div></section>
    </div>
  </div>
  <footer class="prov">Ejemplos: Si LDA y PBE del curso (SIESTA 5.4.2, DZP, 10 puntos E(a) por funcional, pseudos ONCV propios). Bandas de Si con LDA, base DZP y pseudo Si.psf de los tests de SIESTA. Las demás cuentas son analíticas.</footer>`;

  // ===== cell / k-mesh / mesh =====
  const PRE={Si:[3.8403,3.8403,3.8403,60,60,60],Mg:[4.52,4.52,18.08,90,90,90],Gr:[2.464,2.464,6.711,90,90,120]};
  let fdfBlock='';
  function cellMsg(html){ $('#cellOut',root).innerHTML=html; fdfBlock=''; $('#cellPre',root).textContent=''; }
  function doCell2(){
    const val=validateCellInputs({L:['a','b','c'].map(k=>$('#c_'+k,root).value), ang:['a','b','g'].map(k=>$('#ang_'+k,root).value),
      dk:$('#c_dk',root).value, ec:$('#c_ec',root).value, sh:$('#c_sh',root).value});
    if(!val.ok){ cellMsg(val.editing&&!val.errors.length?'<dt>estado</dt><dd>completa todos los campos para calcular</dd>'
      :`<dt>entrada no válida</dt><dd style="color:var(--bad)">${val.errors.map(esc).join('<br>')}</dd>`); return; }
    const {L,ang,dk,ec,sh}=val.values;
    const C=cellMatrix(L[0],L[1],L[2],ang[0],ang[1],ang[2]); const {V,B}=recip(C);
    const nk=B.map(b=>Math.max(1,Math.ceil(norm(b)/dk)));
    if(nk.some(n=>n>LIMITS.maxK)){ cellMsg(`<dt>entrada no válida</dt><dd style="color:var(--bad)">La malla k superaría ${LIMITS.maxK} puntos por eje: aumenta Δk</dd>`); return; }
    const h=Math.PI/Math.sqrt(ec)*BOHR; const nm=L.map(l=>fftGood(Math.ceil(l/h)));
    const kcut=Math.min(...nk.map((n,i)=>n*L[i]))/2;
    $('#cellOut',root).innerHTML=`<dt>volumen</dt><dd>${fmt(V,3)} Å³</dd><dt>|b₁|, |b₂|, |b₃|</dt><dd>${B.map(b=>fmt(norm(b),3)).join(', ')} Å⁻¹</dd>
      <dt>malla k</dt><dd><b>${nk.join(' × ')}</b> (${nk[0]*nk[1]*nk[2]} puntos sin simetría)</dd><dt>kgrid.Cutoff equivalente</dt><dd>≈ ${fmt(kcut,1)} Å</dd>
      <dt>espaciado de malla real</dt><dd>${fmt(h,4)} Å (${fmt(h/BOHR,4)} Bohr)</dd><dt>puntos de malla real</dt><dd><b>${nm.join(' × ')}</b> = ${(nm[0]*nm[1]*nm[2]).toLocaleString('es')}</dd>`;
    fdfBlock=`# DFT Lab · bloque generado para a,b,c = ${L.join(', ')} Å ; alfa,beta,gamma = ${ang.join(', ')} grados\n# dk = ${dk} 1/Ang (con 2pi) ; malla real esperada ${nm.join('x')}\nMeshCutoff ${ec} Ry\n%block kgrid_Monkhorst_Pack\n ${nk[0]}  0  0  ${sh}\n 0  ${nk[1]}  0  ${sh}\n 0  0  ${nk[2]}  ${sh}\n%endblock kgrid_Monkhorst_Pack\n`;
    $('#cellPre',root).textContent=fdfBlock;
  }
  const setCell2=p=>{ ['a','b','c'].forEach((k,i)=>$('#c_'+k,root).value=p[i]); ['a','b','g'].forEach((k,i)=>$('#ang_'+k,root).value=p[i+3]); doCell2(); };
  $('#cellSi',root).onclick=()=>setCell2(PRE.Si); $('#cellMg',root).onclick=()=>setCell2(PRE.Mg); $('#cellGr',root).onclick=()=>setCell2(PRE.Gr);
  $$('.fields input,.fields select',$('#c_dk',root).closest('.pb')).forEach(i=>i.addEventListener('input',doCell2));
  $('#cellFdf',root).onclick=()=>{ if(fdfBlock) downloadText(fdfBlock,'kgrid_mesh.fdf'); };
  setCell2(PRE.Si);

  // ===== Birch–Murnaghan =====
  const vol=(x,mode)=>mode==='a_fcc'?x**3/4:mode==='a_bcc'?x**3/2:mode==='a_sc'?x**3:x;
  let bmRes=null;
  const loadEos=k=>{ const e=X.eos[k]; $('#bmX',root).value='a_fcc'; $('#bmN',root).value=2; $('#bmData',root).value=`# Si ${k.toUpperCase()} · SIESTA 5.4.2, DZP\n# a (Å)   E (eV)\n`+e.a.map((a,i)=>`${a.toFixed(3)}  ${e.E[i].toFixed(6)}`).join('\n'); doBM(); };
  function doBM(){
    const rows=parseCols($('#bmData',root).value), mode=$('#bmX',root).value, nat=+$('#bmN',root).value||1;
    if(rows.length<5){ $('#bmOut',root).innerHTML='<dt>datos</dt><dd>hacen falta al menos 5 puntos</dd>'; return; }
    const V=rows.map(r=>vol(r[0],mode)), E=rows.map(r=>r[1]);
    const c=polyfit(V.map(v=>v**(-2/3)),E,3); const f=v=>peval(c,v**(-2/3));
    const vmin=Math.min(...V), vmax=Math.max(...V); let v0=NaN, best=Infinity;
    for(let i=0;i<=4000;i++){ const v=vmin*0.8+(vmax*1.2-vmin*0.8)*i/4000, e=f(v); if(e<best){ best=e; v0=v; } }
    for(let it=0;it<60;it++){ const h=v0*1e-4, d1=(f(v0+h)-f(v0-h))/(2*h), d2=(f(v0+h)-2*f(v0)+f(v0-h))/(h*h); v0-=d1/d2; }
    const h=v0*2e-3, d2=(f(v0+h)-2*f(v0)+f(v0-h))/(h*h), d3=(f(v0+2*h)-2*f(v0+h)+2*f(v0-h)-f(v0-2*h))/(2*h**3);
    const B0=v0*d2, Bp=-1-v0*d3/d2; const rms=Math.sqrt(E.reduce((s,e,i)=>s+(e-f(V[i]))**2,0)/E.length);
    const a0=mode==='a_fcc'?(4*v0)**(1/3):mode==='a_bcc'?(2*v0)**(1/3):mode==='a_sc'?v0**(1/3):NaN;
    const out=v0<vmin||v0>vmax;
    bmRes={V0:v0,E0:f(v0),B0:B0*EV_A3_GPA,Bp,a0,rms,nat,rows,mode};
    $('#bmOut',root).innerHTML=`<dt>V₀</dt><dd>${fmt(v0,3)} Å³ (${fmt(v0/nat,3)} Å³/átomo)</dd><dt>a₀</dt><dd>${isFinite(a0)?fmt(a0,4)+' Å':'—'}</dd>
      <dt>B₀</dt><dd><b>${fmt(B0*EV_A3_GPA,1)} GPa</b></dd><dt>B′</dt><dd>${fmt(Bp,2)}</dd><dt>E₀</dt><dd>${fmt(f(v0),5)} eV</dd><dt>rms del ajuste</dt><dd>${(rms*1000).toFixed(3)} meV${out?' · <b style="color:var(--bad)">el mínimo cae fuera de los datos</b>':''}</dd>`;
    const curve=[]; for(let i=0;i<=200;i++){ const v=vmin+(vmax-vmin)*i/200; curve.push([v,f(v)]); }
    const ys=[...E,...curve.map(p=>p[1])], lo=Math.min(...ys), hi=Math.max(...ys), pad=(hi-lo)*0.08;
    chart($('#cvBM',root),{xlim:[vmin-(vmax-vmin)*0.04,vmax+(vmax-vmin)*0.04],ylim:[lo-pad,hi+pad],xlabel:'V (Å³)',ylabel:'E (eV)',legend:true,
      series:[{d:curve,color:css('--accent'),width:2,label:'Birch–Murnaghan 3'},{d:V.map((v,i)=>[v,E[i]]),color:'transparent',label:'datos',nohover:true}],
      points:[...V.map((v,i)=>({x:v,y:E[i],color:css('--ink'),r:3.5})),{x:v0,y:f(v0),color:css('--accent'),r:5,ring:true,label:'V₀'}],vlines:[{x:v0,dash:[3,3]}]});
  }
  $('#bmLda',root).onclick=()=>loadEos('lda'); $('#bmPbe',root).onclick=()=>loadEos('pbe');
  ['#bmData','#bmX','#bmN'].forEach(s=>$(s,root).addEventListener('input',doBM));
  $('#bmRep',root).onclick=()=>{ if(!bmRes) return; const r=bmRes; downloadText(`DFT Lab · ajuste Birch–Murnaghan de tercer orden\nfecha: ${new Date().toISOString()}\n\nV0 = ${r.V0.toFixed(4)} Ang^3  (${(r.V0/r.nat).toFixed(4)} Ang^3/atomo)\na0 = ${isFinite(r.a0)?r.a0.toFixed(5)+' Ang':'-'}\nE0 = ${r.E0.toFixed(6)} eV\nB0 = ${r.B0.toFixed(2)} GPa\nB' = ${r.Bp.toFixed(3)}\nrms = ${(r.rms*1000).toFixed(4)} meV\n\n# datos (${r.mode}, E eV)\n`+r.rows.map(x=>x.join('  ')).join('\n')+'\n','birch_murnaghan.txt'); };
  loadEos('lda');

  // ===== effective mass =====
  const B=SI.bands, nocc=B.nocc, lab=B.labels;
  const MS={mode:'cb',win:0.10};
  function bandPts(){
    if(MS.mode==='own') return {pts:parseCols($('#mData',root).value).map(r=>[r[0],r[1]]),sign:0,title:'mis datos'};
    if(MS.mode==='cb'){ const [xa,xb]=[lab[0][0],lab[1][0]]; const idx=B.x.map((x,i)=>i).filter(i=>B.x[i]>=xa-1e-9&&B.x[i]<=xb+1e-9); const pts=idx.map(i=>[B.x[i],B.E[nocc][i]]); return {pts,sign:1,title:'banda de conducción, Γ→X'}; }
    if(MS.mode==='hh'){ const [xa,xb]=[lab[0][0],lab[1][0]]; const idx=B.x.map((x,i)=>i).filter(i=>B.x[i]>=xa-1e-9&&B.x[i]<=xb+1e-9); return {pts:idx.map(i=>[B.x[i],B.E[nocc-1][i]]),sign:-1,title:'banda de valencia superior, Γ→X'}; }
    const xg=lab[4][0], xl=lab[5][0]; const idx=B.x.map((x,i)=>i).filter(i=>B.x[i]>=xg-1e-9&&B.x[i]<=xl+1e-9); return {pts:idx.map(i=>[B.x[i]-xg,B.E[nocc-1][i]]),sign:-1,title:'banda de valencia superior, Γ→L'};
  }
  function doMass(){
    $('#mWinO',root).textContent=MS.win.toFixed(3); const {pts,sign,title}=bandPts();
    if(pts.length<3){ $('#mOut',root).textContent='Pega al menos 3 puntos k, E.'; return; }
    let ext=0;
    if(sign!==0) pts.forEach((p,i)=>{ if(sign>0? p[1]<pts[ext][1] : p[1]>pts[ext][1]) ext=i; });
    else { const c0=polyfit(pts.map(p=>p[0]),pts.map(p=>p[1]),2), kx=-c0[1]/(2*c0[2]); ext=pts.reduce((b,p,i)=>Math.abs(p[0]-kx)<Math.abs(pts[b][0]-kx)?i:b,0); }
    const k0=pts[ext][0]; const sel=pts.filter(p=>Math.abs(p[0]-k0)<=MS.win+1e-9);
    // symmetric fit around k0; at a zone boundary (Γ) the band is even, so mirror the points
    const fitPts=sel.length>=3?sel:pts; const xs=fitPts.map(p=>p[0]-k0), ys=fitPts.map(p=>p[1]);
    const mir=MS.mode==='own'?[]:fitPts.filter(p=>Math.abs(p[0]-k0)>1e-9&&(k0-(p[0]-k0))<pts[0][0]-1e-9).map(p=>[-(p[0]-k0),p[1]]);
    const c=polyfit([...xs,...mir.map(p=>p[0])],[...ys,...mir.map(p=>p[1])],2);
    const curv=2*c[2], m=HBAR2_ME/curv;
    const lo=Math.min(...pts.map(p=>p[1])), hi=Math.max(...pts.map(p=>p[1])), xr=[pts[0][0],pts[pts.length-1][0]];
    const fitCurve=[]; for(let i=0;i<=120;i++){ const x=k0-MS.win*1.6+i*MS.win*3.2/120; if(x>=xr[0]&&x<=xr[1]) fitCurve.push([x,peval(c,x-k0)]); }
    const yl=MS.mode==='own'?[lo-(hi-lo)*0.1,hi+(hi-lo)*0.1]:sign>0?[pts[ext][1]-0.3,pts[ext][1]+1.8]:[pts[ext][1]-1.8,pts[ext][1]+0.3];
    chart($('#cvM',root),{xlim:xr,ylim:yl,xlabel:'k (Å⁻¹)',ylabel:'E (eV)',legend:true,
      series:[{d:pts,color:css('--ink'),width:1.6,label:title},{d:fitCurve,color:css('--accent'),width:2,dash:[5,3],label:'parábola'}],
      shade:[{x0:k0-MS.win,x1:k0+MS.win,color:alpha(css('--accent'),0.08)}],points:[{x:k0,y:pts[ext][1],color:css('--accent'),r:4}]});
    $('#mOut',root).innerHTML=`<span>extremo en k = <b>${fmt(k0,3)} Å⁻¹</b>${MS.mode==='cb'?` (${fmt(k0/lab[1][0]*100,0)} % de Γ→X)`:''}</span><span>d²E/dk² <b>${fmt(curv,2)} eV·Å²</b></span><span>m*/m<sub>e</sub> <b>${fmt(Math.abs(m),3)}</b>${m<0?' (hueco)':''}</span><span>${sel.length} puntos en la ventana</span>`;
  }
  seg($('#mSel',root),'cb',v=>{ MS.mode=v; $('#mData',root).hidden=v!=='own'; doMass(); });
  $('#mWin',root).oninput=e=>{ MS.win=+e.target.value; doMass(); }; $('#mData',root).oninput=doMass;

  // ===== smearing =====
  const SM={s:0.1,v:'f'};
  const dfun={ 'Fermi–Dirac':t=>1/(4*Math.cosh(t/2)**2),
    'Gauss':t=>Math.exp(-t*t)/Math.sqrt(Math.PI), 'Methfessel–Paxton 1':t=>Math.exp(-t*t)/Math.sqrt(Math.PI)*(1.5-t*t),
    'Marzari–Vanderbilt':t=>{ const u=-t-1/Math.SQRT2; return Math.exp(-u*u)/Math.sqrt(Math.PI)*(2+Math.SQRT2*t); } };
  // all δ̃ written in t = (ε − μ)/σ ; Fermi–Dirac with σ = k_BT has δ = 1/(4 cosh²(t/2))
  function doSmear(){
    $('#smSO',root).textContent=SM.s.toFixed(3); const s=SM.s, cols=[css('--orb-d'),css('--accent'),css('--up'),css('--warn')];
    const series=Object.entries(dfun).map(([n,d],j)=>{ const ts=[], N=1200, T=8; let acc=0, prev=null; const occ=[];
      for(let i=0;i<=N;i++){ const t=T-2*T*i/N; const v=d(t); if(prev!=null) acc+=(v+prev)/2*(2*T/N); prev=v; occ.push([t*s,acc,v/s]); }
      return {d:occ.filter(p=>Math.abs(p[0])<=1).map(p=>[p[0],SM.v==='f'?p[1]:p[2]]).reverse(),color:cols[j],width:j===0?1.6:2,label:n}; });
    const ymax=SM.v==='f'?1.15:Math.max(...series.flatMap(s=>s.d.map(p=>p[1])))*1.1;
    chart($('#cvSm',root),{xlim:[-1,1],ylim:SM.v==='f'?[-0.1,1.15]:[-ymax*0.25,ymax],xlabel:'ε − μ (eV)',ylabel:SM.v==='f'?'ocupación':'δ̃ (1/eV)',series,legend:true,hlines:SM.v==='f'?[{y:1,dash:[3,3]},{y:0}]:[{y:0}],
      read:x=>x==null?'Pasa el cursor para leer cada función.':series.map(se=>{ const p=se.d.reduce((b,q)=>Math.abs(q[0]-x)<Math.abs(b[0]-x)?q:b,se.d[0]); return `<span><span class="sw" style="background:${se.color}"></span>${se.label} <b>${fmt(p[1],3)}</b></span>`; }).join(''),readEl:$('#smOut',root)});
  }
  seg($('#smSel',root),'f',v=>{ SM.v=v; doSmear(); }); $('#smS',root).oninput=e=>{ SM.s=+e.target.value; doSmear(); };

  // ===== units =====
  const U={k:'energy'};
  function fillUnits(){ $('#uFrom',root).innerHTML=Object.keys(UNITS[U.k]).map(u=>`<option>${u}</option>`).join(''); doUnits(); }
  function doUnits(){ const v=+$('#uVal',root).value, from=$('#uFrom',root).value, T=UNITS[U.k]; const base=v*T[from];
    $('#uTab',root).innerHTML=`<tbody>${Object.entries(T).map(([u,f])=>`<tr${u===from?' class="hl"':''}><td>${u}</td><td>${(base/f).toPrecision(8).replace(/\.?0+(e|$)/,'$1')}</td></tr>`).join('')}</tbody>`; }
  seg($('#uSel',root),'energy',v=>{ U.k=v; fillUnits(); }); $('#uVal',root).oninput=doUnits; $('#uFrom',root).onchange=doUnits; fillUnits();

  // ===== electron gas =====
  function doGas(){ const N=+$('#gN',root).value, V=+$('#gV',root).value; const n=N/V; const nb=n*BOHR**3; const rs=(3/(4*Math.PI*nb))**(1/3);
    const kF=(3*Math.PI**2*n)**(1/3), EF=HBAR2_ME/2*kF*kF; const wp=Math.sqrt(4*Math.PI*nb)*HA; const kTF=Math.sqrt(4*(kF*BOHR)/Math.PI)/BOHR;
    const ex=-0.458165/rs*HA, A=0.031091,a1=0.21370,b1=7.5957,b2=3.5876,b3=1.6382,b4=0.49294, s=Math.sqrt(rs); const ec=-2*A*(1+a1*rs)*Math.log(1+1/(2*A*(b1*s+b2*rs+b3*s*rs+b4*rs*rs)))*HA;
    $('#gOut',root).innerHTML=`<dt>densidad n</dt><dd>${fmt(n,4)} Å⁻³</dd><dt>r<sub>s</sub></dt><dd><b>${fmt(rs,3)}</b> Bohr</dd><dt>k<sub>F</sub></dt><dd>${fmt(kF,3)} Å⁻¹</dd><dt>E<sub>F</sub> (gas libre)</dt><dd>${fmt(EF,2)} eV</dd>
      <dt>ħω<sub>p</sub></dt><dd><b>${fmt(wp,2)} eV</b></dd><dt>1/k<sub>TF</sub></dt><dd>${fmt(1/kTF,3)} Å</dd><dt>ε<sub>x</sub> LDA</dt><dd>${fmt(ex,3)} eV/e⁻</dd><dt>ε<sub>c</sub> PW92</dt><dd>${fmt(ec,3)} eV/e⁻</dd>`; }
  ['#gN','#gV'].forEach(s=>$(s,root).oninput=doGas); doGas();

  // ===== formation energy =====
  const F=[{el:'',n:1,mu:''},{el:'',n:1,mu:''}];
  function fRows(){ $('#fTab',root).innerHTML=`<thead><tr><th>Elemento</th><th>n<sub>i</sub> en la celda</th><th>μ<sub>i</sub> (eV/átomo)</th><th></th></tr></thead><tbody>${F.map((r,i)=>`<tr><td><input data-i="${i}" data-k="el" value="${esc(r.el)}" placeholder="ej. Ga" style="width:7ch"></td><td><input data-i="${i}" data-k="n" type="number" min="0" value="${r.n}" style="width:8ch"></td><td><input data-i="${i}" data-k="mu" type="number" step="any" value="${r.mu}" placeholder="E(elemento)/N" style="width:16ch"></td><td>${F.length>1?`<button class="tiny" data-del="${i}">quitar</button>`:''}</td></tr>`).join('')}</tbody>`;
    $$('#fTab input',root).forEach(inp=>inp.oninput=()=>{ F[+inp.dataset.i][inp.dataset.k]=inp.value; doF(); });
    $$('#fTab [data-del]',root).forEach(b=>b.onclick=()=>{ F.splice(+b.dataset.del,1); fRows(); doF(); }); }
  let fRes='';
  function doF(){ const E=parseFloat($('#fE',root).value); const N=F.reduce((s,r)=>s+(+r.n||0),0); const ok=isFinite(E)&&N>0&&F.every(r=>r.mu!==''&&isFinite(+r.mu));
    if(!ok){ $('#fOut',root).innerHTML='Escribe la energía del compuesto y μ de cada elemento.'; fRes=''; return; }
    const sum=F.reduce((s,r)=>s+(+r.n)*(+r.mu),0), dH=(E-sum)/N;
    $('#fOut',root).innerHTML=`<span>Σ n<sub>i</sub>μ<sub>i</sub> <b>${fmt(sum,4)} eV</b></span><span>ΔH<sub>f</sub> <b>${fmt(dH*1000,1)} meV/átomo</b></span><span>${fmt(dH*96.485332,2)} kJ/mol·átomo</span><span>${dH<0?'estable respecto a los elementos':'inestable respecto a los elementos'}</span>`;
    fRes=`DFT Lab · energia de formacion\nE(compuesto) = ${E} eV\n`+F.map(r=>`${r.el||'?'}  n=${r.n}  mu=${r.mu} eV`).join('\n')+`\nN = ${N}\nDeltaH_f = ${(dH*1000).toFixed(2)} meV/atomo\n`; }
  $('#fAdd',root).onclick=()=>{ F.push({el:'',n:1,mu:''}); fRows(); }; $('#fE',root).oninput=doF; $('#fRep',root).onclick=()=>{ if(fRes) downloadText(fRes,'energia_formacion.txt'); };
  fRows(); doF();

  $$('canvas[data-export]',root).forEach(cv=>{ const ph=cv.closest('.panel').querySelector('.ph .btnrow')||cv.closest('.panel').querySelector('.ph'); ph.append(exportBar(cv,cv.dataset.export)); });
  const redraw=()=>{ doBM(); doMass(); doSmear(); };
  onTheme(redraw); doMass(); doSmear();
}
