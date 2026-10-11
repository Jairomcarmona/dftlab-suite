import { $, $$, css, alpha, onTheme, HA } from '../core/ui.js';
import { chart as coreChart, exportBar, interp } from '../core/chart.js';
import X from '../data/pseudo_xc.json';
function setup(cv){ const r=cv.getBoundingClientRect(), dpr=Math.min(window.devicePixelRatio||1,2); cv.width=Math.max(1,Math.round(r.width*dpr)); cv.height=Math.max(1,Math.round(r.height*dpr)); const c=cv.getContext('2d'); c.setTransform(dpr,0,0,dpr,0,0); return {c,W:r.width,H:r.height}; }
function fmtN(v,d){ if(!isFinite(v)) return '—'; return (v<0?'−':'')+Math.abs(v).toFixed(d); }
function fmtT(v){ const a=Math.abs(v); if(a===0) return '0'; const s=a>=10?a.toFixed(0):a>=1?(+a.toFixed(2)).toString():(+a.toPrecision(2)).toString(); return (v<0?'−':'')+s; }
const LCOL = ()=>[css('--orb-s'),css('--orb-p'),css('--orb-d'),css('--e1')];
const LN = ['s','p','d','f'];
// adapter: old cfg (shade:[x0,x1,label]) -> core chart
function chart(cv,cfg){ const c={...cfg}; if (Array.isArray(cfg.shade) && typeof cfg.shade[0]==='number') c.shade=[{x0:cfg.shade[0],x1:cfg.shade[1],label:cfg.shade[2]}]; coreChart(cv,c); }
function addExports(root){ $$('canvas[data-export]',root).forEach(cv=>{ const ph=cv.closest('.panel').querySelector('.ph'); if(!ph.querySelector('.export')) ph.append(exportBar(cv,cv.dataset.export)); }); }

export function mount(root){
  root.innerHTML=`
  <div class="pghead">
    <div>
      <div class="kicker">Aprender · 3</div><h1>Intercambio y correlación</h1>
      <p class="lede">Kohn–Sham es exacto salvo por un término: E<sub>xc</sub>[ρ]. Toda la diferencia entre funcionales está ahí. Esta pantalla muestra qué aproxima cada uno, dónde se nota en un cristal real y qué cambia en los resultados, con cálculos de SIESTA hechos con pseudos consistentes para cada funcional.</p>
    </div>
  </div>
  <div class="pgrid">
    <article class="panel theory" id="xcTheory"></article>
    <div class="charts">
      <section class="panel wide"><div class="ph"><h2>La escalera de Jacob</h2><span class="sub">Perdew, 2001</span></div><div class="pb" id="xcLadder"></div></section>
      <section class="panel"><div class="ph"><h2>Calculadora · gas homogéneo (LDA)</h2><span class="sub">PW92</span></div>
        <div class="pb"><div class="calc"><label class="sl">r<sub>s</sub> <input type="range" id="rsIn" min="0.5" max="8" step="0.01" value="2.0"><output id="rsOut">2.00</output></label>
          <div class="btnrow" id="rsPre"></div></div>
          <canvas data-export="xc_gas_homogeneo" id="xcEps" style="height:250px"></canvas><dl class="kv calcout" id="rsTab"></dl></div></section>
      <section class="panel"><div class="ph"><h2>Calculadora · factor de realce F<sub>x</sub>(s)</h2><span class="sub">GGA</span></div>
        <div class="pb"><div class="calc"><label class="sl">s <input type="range" id="sIn" min="0" max="3" step="0.01" value="0.6"><output id="sOut">0.60</output></label></div>
          <canvas data-export="xc_Fx" id="xcFx" style="height:250px"></canvas><dl class="kv calcout" id="sTab"></dl></div></section>
      <section class="panel wide"><div class="ph"><h2>Dónde se separa la GGA de la LDA en el Si real</h2>
        <div class="seg" role="group" aria-label="Mapa" id="mapSel"><button data-m="rho" aria-pressed="false">ρ</button><button data-m="rs" aria-pressed="false">r<sub>s</sub></button><button data-m="s" aria-pressed="true">s</button><button data-m="fx" aria-pressed="false">F<sub>x</sub><sup>PBE</sup> − 1</button></div></div>
        <div class="pb mapwrap"><div class="mapbox"><canvas id="xcMap" style="height:330px"></canvas><canvas id="xcBar" style="height:22px"></canvas></div>
          <div class="mapside"><div class="readout" id="mapRead">Pasa el cursor por el plano (110).</div><p class="note" id="mapNote"></p></div></div></section>
      <section class="panel"><div class="ph"><h2>Experimento · Si con LDA y PBE</h2><span class="sub">SIESTA, E(a) y Birch–Murnaghan</span></div><div class="pb"><canvas data-export="Si_EOS_LDA_PBE" id="xcEos" style="height:280px"></canvas><div id="eosTab"></div></div></section>
      <section class="panel"><div class="ph"><h2>Experimento · capas de grafito</h2><div class="btnrow"><button class="tiny" id="grRaw" aria-pressed="false">mostrar sin counterpoise</button></div></div><div class="pb"><canvas data-export="grafito_enlace" id="xcGr" style="height:280px"></canvas><div class="readout" id="grRead"></div><p class="note" id="grNote"></p></div></section>
      <section class="panel wide"><div class="ph"><h2>Más allá: el gap con distintos funcionales</h2><span class="sub">valores típicos de la literatura, eV</span></div><div class="pb" id="gapTab"></div></section>
    </div>
  </div><footer class="prov">Si: SIESTA 5.4.2, DZP, MeshCutoff 300 Ry, k 8×8×8, 10 parámetros de red por funcional, pseudo ONCV generado con el mismo funcional. Grafito: configuración del test 10.Functionals de SIESTA con base DZP, k 12×12×4, pseudos ONCV de C y corrección de counterpoise. El mapa del plano (110) se calculó con sisl a partir de si.RHO.</footer>`;
  // ======================= XC =======================
  // PW92 correlation (unpolarized) in Ha
  function pw92(rs){ const A=0.031091,a1=0.21370,b1=7.5957,b2=3.5876,b3=1.6382,b4=0.49294, s=Math.sqrt(rs);
    return -2*A*(1+a1*rs)*Math.log(1+1/(2*A*(b1*s+b2*rs+b3*s*rs+b4*rs*rs))); }
  const ex = rs => -0.458165/rs;
  const FX = { PBE:(s)=>1+0.804-0.804/(1+0.21951*s*s/0.804), PBEsol:(s)=>1+0.804-0.804/(1+(10/81)*s*s/0.804), revPBE:(s)=>1+1.245-1.245/(1+0.21951*s*s/1.245) };
  const XS = {rs:2.0, s:0.6, map:'s'};
  const PRE = [['Al',2.07],['Cu',2.67],['Na',3.93],['Si val.',2.01],['Cs',5.62]];
  function xcTheory(){
    return `
    <h3>Qué es E<sub>xc</sub></h3>
    <p>Kohn y Sham escriben la energía con lo que saben calcular exactamente para electrones independientes y meten todo lo demás en un término:</p>
    <div class="eq">E[ρ] = T<sub>s</sub>[ρ] + ∫V<sub>ext</sub>ρ + E<sub>H</sub>[ρ] + E<sub>xc</sub>[ρ], &nbsp; V<sub>xc</sub>(r) = δE<sub>xc</sub>/δρ(r)</div>
    <p>E<sub>xc</sub> contiene el intercambio (Pauli), la correlación (los electrones se evitan por la repulsión) y la parte de la energía cinética que el sistema no interactuante no captura. Se puede ver como la interacción de cada electrón con su <b>hueco de intercambio-correlación</b>, una zona alrededor de él con un electrón de menos.</p>
    <div class="eq">E<sub>xc</sub> = ½ ∫∫ ρ(r) n<sub>xc</sub>(r,r′) / |r − r′| dr dr′, &nbsp; ∫ n<sub>xc</sub>(r,r′) dr′ = −1</div>
    <h3>LDA: cada punto como un gas homogéneo</h3>
    <p>Toma la energía por electrón de un gas de electrones uniforme con la densidad local. El intercambio es exacto y analítico; la correlación viene de Monte Carlo cuántico (Ceperley y Alder, 1980), parametrizada por PZ81 o PW92. Usa la calculadora para ver ε<sub>x</sub> y ε<sub>c</sub> en función de r<sub>s</sub>.</p>
    <div class="eq">E<sub>xc</sub><sup>LDA</sup> = ∫ ρ ε<sub>xc</sub><sup>hom</sup>(ρ) dr, &nbsp; ε<sub>x</sub> = −0.4582 / r<sub>s</sub> Ha, &nbsp; r<sub>s</sub> = (3/4πρ)<sup>1/3</sup></div>
    <p><b>Funciona mejor de lo esperado</b> porque su hueco cumple la regla de suma, y los errores de intercambio y correlación se cancelan en parte. <b>Aproxima bien</b> estructuras y fonones de sólidos compactos, metales sp y semiconductores. <b>Falla</b> en que sobreenlaza: constantes de red ~1 % cortas, módulo de compresibilidad alto y energías de cohesión sobreestimadas. Da el estado base equivocado del Fe (no lo predice bcc ferromagnético).</p>
    <h3>GGA: añadir el gradiente</h3>
    <p>PBE (Perdew, Burke y Ernzerhof, 1996) multiplica el intercambio LDA por un factor que depende del gradiente reducido s, y corrige la correlación. No tiene parámetros ajustados a datos: todos salen de restricciones exactas, como el límite de Lieb–Oxford (F<sub>x</sub> ≤ 1.804).</p>
    <div class="eq">E<sub>x</sub><sup>GGA</sup> = ∫ ρ ε<sub>x</sub><sup>LDA</sup> F<sub>x</sub>(s) dr, &nbsp; s = |∇ρ| / (2 k<sub>F</sub> ρ)</div>
    <p><b>Aproxima bien</b> energías de atomización de moléculas, barreras, superficies y el Fe bcc ferromagnético. <b>Falla</b> en que subenlaza los sólidos (constantes ~1 % largas) y no tiene dispersión: el grafito casi no se mantiene unido. <b>PBEsol</b> recupera la expansión de gradiente para sólidos y corrige las constantes de red.</p>
    <h3>Lo que ni LDA ni GGA arreglan</h3>
    <p><b>El gap.</b> El gap de Kohn–Sham no es el gap fundamental: le falta la discontinuidad de la derivada de E<sub>xc</sub>, y sale subestimado 30–100 %. <b>La autointeracción.</b> Cada electrón se repele un poco a sí mismo, lo que deslocaliza los estados d y f; de ahí vienen DFT+U y la U lineal de Cococcioni. <b>La dispersión.</b> Las fuerzas de van der Waals son correlación no local y no las ve ningún funcional local o semilocal.</p>
    <h3>Más allá</h3>
    <p><b>meta-GGA</b> (SCAN, r²SCAN) usa también la densidad de energía cinética τ y distingue enlaces covalentes, metálicos y débiles. <b>Híbridos</b> mezclan una fracción de intercambio exacto de Hartree–Fock: PBE0 (25 %), HSE06 (25 % solo de corto alcance, el estándar para gaps de sólidos) y B3LYP (química molecular). Corrigen buena parte del gap pero cuestan 10–100 veces más. <b>vdW-DF</b> (Dion et al. 2004, en SIESTA con el algoritmo de Román-Pérez y Soler) y <b>VV10</b> añaden correlación no local; <b>D3</b> de Grimme es una corrección empírica por pares.</p>
    <p class="src">Kohn y Sham, PR 140, A1133 (1965) · Ceperley y Alder, PRL 45, 566 (1980) · Perdew y Wang, PRB 45, 13244 (1992) · Perdew, Burke y Ernzerhof, PRL 77, 3865 (1996) · Perdew et al., PRL 100, 136406 (2008) · Dion et al., PRL 92, 246401 (2004) · Heyd, Scuseria y Ernzerhof, JCP 118, 8207 (2003).</p>`;
  }
  function ladder(){
    const R=[
      [1,'LDA','ρ','PW92, PZ81','Sólidos compactos; sobreenlaza'],
      [2,'GGA','ρ, ∇ρ','PBE, PBEsol, revPBE','Moléculas y superficies; subenlaza'],
      [3,'meta-GGA','ρ, ∇ρ, τ','SCAN, r²SCAN','Enlaces de distinto tipo con un solo funcional'],
      [4,'Híbridos','+ orbitales ocupados (intercambio exacto)','PBE0, HSE06, B3LYP','Gaps y estados localizados; 10–100× más caro'],
      [5,'RPA y doble híbridos','+ orbitales vacíos','RPA, B2PLYP','Dispersión y energías de reacción; muy caro']];
    $('#xcLadder').innerHTML=`<div class="heaven">precisión química</div><div class="ladder">${R.map(r=>`<div class="rung${r[0]<=2?' here':''}"><span class="n">${r[0]}</span><span class="nm">${r[1]}</span><span class="ing">usa: ${r[2]}</span><span class="ex"><b>${r[3]}</b> · ${r[4]}</span></div>`).join('')}</div><div class="heaven">Hartree (sin XC)</div>
     <p class="note">Cada peldaño añade un ingrediente y cumple más condiciones exactas. Los peldaños 1 y 2 (resaltados) son los que SIESTA usa en producción, más vdW-DF y DFT+U.</p>`;
  }
  function rsReadout(){
    const rs=XS.rs, n=3/(4*Math.PI*rs**3), kF=Math.cbrt(3*Math.PI**2*n), EF=kF*kF/2*HA, wp=Math.sqrt(4*Math.PI*n)*HA, kTF=Math.sqrt(4*kF/Math.PI);
    const B=0.529177;
    $('#rsTab').innerHTML=[
      ['n', (n/B**3).toFixed(4)+' e/Å³'], ['k<sub>F</sub>', (kF/B).toFixed(3)+' Å⁻¹'],
      ['E<sub>F</sub>', EF.toFixed(2)+' eV'], ['ħω<sub>p</sub>', wp.toFixed(2)+' eV'],
      ['ε<sub>x</sub>', fmtN(ex(rs)*HA,3)+' eV'], ['ε<sub>c</sub>', fmtN(pw92(rs)*HA,3)+' eV'],
      ['ε<sub>c</sub>/ε<sub>x</sub>', (pw92(rs)/ex(rs)*100).toFixed(1)+' %'], ['λ<sub>TF</sub>', (B/kTF).toFixed(3)+' Å']
    ].map(([k,v])=>`<dt>${k}</dt><dd>${v}</dd>`).join('');
  }
  function drawXC(){
    const cols=LCOL(), acc=css('--accent'), ink=css('--ink'), muted=css('--muted'), faint=css('--faint'), e1=css('--e1');
    if (!$('#xcTheory').innerHTML) { $('#xcTheory').innerHTML=xcTheory(); ladder();
      $('#rsPre').innerHTML=PRE.map(([n,v])=>`<button class="tiny" data-rs="${v}">${n} ${v}</button>`).join('');
      $('#rsPre').querySelectorAll('button').forEach(b=>b.onclick=()=>{ XS.rs=+b.dataset.rs; $('#rsIn').value=XS.rs; drawXC(); }); }
    // electron gas
    $('#rsOut').textContent=XS.rs.toFixed(2); rsReadout();
    const rsd=[]; for(let r=0.5;r<=8.001;r+=0.05) rsd.push(r);
    chart($('#xcEps'),{xlim:[0.5,8],ylim:[-28,0],xlabel:'r_s (Bohr)',ylabel:'eV / electrón',
      series:[{d:rsd.map(r=>[r,ex(r)*HA]),color:acc,label:'ε_x'},{d:rsd.map(r=>[r,pw92(r)*HA]),color:e1,label:'ε_c (PW92)'},{d:rsd.map(r=>[r,(ex(r)+pw92(r))*HA]),color:ink,width:1.4,dash:[5,4],label:'ε_xc'}],
      vlines:[{x:XS.rs,color:acc,dash:[]}], points:[{x:XS.rs,y:ex(XS.rs)*HA,color:acc},{x:XS.rs,y:pw92(XS.rs)*HA,color:e1}]});
    // Fx
    $('#sOut').textContent=XS.s.toFixed(2);
    const sd=[]; for(let s=0;s<=3.001;s+=0.02) sd.push(s);
    const hist=X.map.shist;
    const hmax=Math.max(...hist.w);
    const hser={d:hist.s.map((s,i)=>[s,1+0.75*hist.w[i]/hmax]),color:alpha(faint,.9),width:1,label:'s en el Si (peso ρ)',nohover:true};
    chart($('#xcFx'),{xlim:[0,3],ylim:[0.95,1.95],xlabel:'s = |∇ρ| / (2 k_F ρ)',ylabel:'F_x(s)',
      hlines:[{y:1.804,label:'cota de Lieb–Oxford 1.804',left:true}],
      series:[hser,{d:sd.map(s=>[s,1]),color:muted,width:1.4,label:'LDA'},{d:sd.map(s=>[s,FX.PBE(s)]),color:acc,label:'PBE'},{d:sd.map(s=>[s,FX.PBEsol(s)]),color:cols[1],label:'PBEsol'},{d:sd.map(s=>[s,FX.revPBE(s)]),color:e1,dash:[5,4],label:'revPBE'}],
      vlines:[{x:XS.s,color:acc,dash:[]}]});
    $('#sTab').innerHTML=Object.entries(FX).map(([k,f])=>`<dt>F<sub>x</sub><sup>${k}</sup></dt><dd>${f(XS.s).toFixed(4)}</dd>`).join('')+`<dt>% de s del Si &lt; ${XS.s.toFixed(2)}</dt><dd>${(cumS(XS.s)*100).toFixed(0)} %</dd>`;
    drawMap(); drawEos(); drawGr(); gapTable();
  }
  function cumS(s0){ const h=X.map.shist; let a=0,b=0; h.s.forEach((s,i)=>{ b+=h.w[i]; if(s<=s0) a+=h.w[i]; }); return a/b; }
  $('#rsIn').addEventListener('input',e=>{ XS.rs=+e.target.value; drawXC(); });
  $('#sIn').addEventListener('input',e=>{ XS.s=+e.target.value; drawXC(); });
  
  // ---- density map of Si (110) plane
  const MAPC=[[13,8,135],[84,2,163],[139,10,165],[185,50,137],[219,92,104],[244,136,73],[254,188,43],[240,249,33]]; // plasma
  function cmap(t){ t=Math.max(0,Math.min(1,t)); const x=t*(MAPC.length-1), i=Math.min(MAPC.length-2,Math.floor(x)), f=x-i; return MAPC[i].map((v,j)=>Math.round(v+(MAPC[i+1][j]-v)*f)); }
  function mapField(m){ const M=X.map; if(m==='rho') return {F:M.rho,lab:'ρ (e/Bohr³)',lo:0,hi:0.09}; if(m==='rs') return {F:M.rs,lab:'r_s (Bohr)',lo:1.3,hi:4.2}; if(m==='s') return {F:M.s,lab:'s',lo:0,hi:1.5};
    return {F:M.s.map(r=>r.map(s=>FX.PBE(s)-1)),lab:'F_x^PBE − 1',lo:0,hi:0.32}; }
  let mapHover=null;
  function drawMap(){
    const M=X.map, cv=$('#xcMap'), {c,W,H}=setup(cv);
    const {F,lab,lo,hi}=mapField(XS.map);
    const sc=Math.min(W/M.W,H/M.Hh), w=M.W*sc, h=M.Hh*sc, ox=(W-w)/2, oy=(H-h)/2;
    const img=c.createImageData(M.nu,M.nv);
    for(let j=0;j<M.nv;j++) for(let i=0;i<M.nu;i++){ const col=cmap((F[j][i]-lo)/(hi-lo)); const p=((M.nv-1-j)*M.nu+i)*4; img.data[p]=col[0]; img.data[p+1]=col[1]; img.data[p+2]=col[2]; img.data[p+3]=255; }
    const off=document.createElement('canvas'); off.width=M.nu; off.height=M.nv; off.getContext('2d').putImageData(img,0,0);
    c.clearRect(0,0,W,H); c.imageSmoothingEnabled=true; c.drawImage(off,ox,oy,w,h);
    // bonds and atoms
    const P=(u,v)=>[ox+u*sc, oy+h-v*sc];
    const at=M.atoms;
    c.strokeStyle='rgba(255,255,255,.55)'; c.lineWidth=1.5;
    for(let a=0;a<at.length;a++) for(let b=a+1;b<at.length;b++){ const d=Math.hypot(at[a][0]-at[b][0],at[a][1]-at[b][1]); if(Math.abs(d-2.35)<0.05){ const A=P(...at[a]),B=P(...at[b]); c.beginPath(); c.moveTo(...A); c.lineTo(...B); c.stroke(); } }
    for (const a of at){ const [x,y]=P(...a); c.fillStyle='#f4f6f8'; c.strokeStyle='#1b1f24'; c.lineWidth=1; c.beginPath(); c.arc(x,y,5,0,7); c.fill(); c.stroke(); }
    c.fillStyle='#ffffff'; c.font='11px '+css('--f-label'); c.textAlign='left'; c.textBaseline='top'; c.fillText('[110] →',ox+6,oy+h-16); c.save(); c.translate(ox+6,oy+h-22); c.rotate(-Math.PI/2); c.fillText('[001] →',0,0); c.restore();
    if (mapHover){ const [x,y]=P(mapHover.u,mapHover.v); c.strokeStyle='#ffffff'; c.lineWidth=1.5; c.beginPath(); c.arc(x,y,7,0,7); c.stroke(); }
    cv._geo={ox,oy,w,h,sc};
    // colorbar
    const cb=$('#xcBar'), g=setup(cb); g.c.clearRect(0,0,g.W,g.H); const bw=Math.min(w,g.W), bx=(g.W-bw)/2;
    for(let i=0;i<bw;i++){ const col=cmap(i/bw); g.c.fillStyle=`rgb(${col})`; g.c.fillRect(bx+i,0,1.5,8); }
    g.c.fillStyle=css('--muted'); g.c.font='11px '+css('--f-data'); g.c.textBaseline='top'; g.c.textAlign='left'; g.c.fillText(fmtT(lo),bx,10); g.c.textAlign='right'; g.c.fillText(fmtT(hi),bx+bw,10); g.c.textAlign='center'; g.c.fillText(lab,bx+bw/2,10);
    const notes={rho:'Densidad de valencia: se acumula en los enlaces Si–Si (zigzag del plano 110) y casi desaparece en los huecos de la estructura diamante.',
      rs:'r_s es el radio de la esfera que contiene un electrón. En los enlaces vale ~1.4 Bohr (gas denso); en los huecos supera 4. La LDA trata cada punto como un gas homogéneo con ese r_s.',
      s:'s mide qué tan rápido cambia la densidad en la escala local de longitud. Es pequeño en los enlaces (allí la LDA es razonable) y grande cerca de los núcleos y en las colas: ahí PBE corrige.',
      fx:'Cuánto aumenta PBE el intercambio respecto a la LDA en cada punto. La corrección vive en los huecos y cerca del core, no en el enlace; por eso PBE alarga la red al favorecer las regiones de baja densidad.'};
    $('#mapNote').textContent=notes[XS.map];
  }
  document.querySelectorAll('[data-m]').forEach(b=>b.addEventListener('click',()=>{ XS.map=b.dataset.m; document.querySelectorAll('[data-m]').forEach(o=>o.setAttribute('aria-pressed',o===b)); drawMap(); }));
  $('#xcMap').addEventListener('pointermove',ev=>{ const cv=$('#xcMap'), g=cv._geo, r=cv.getBoundingClientRect(), M=X.map; if(!g) return;
    const u=(ev.clientX-r.left-g.ox)/g.sc, v=(g.oy+g.h-(ev.clientY-r.top))/g.sc; if(u<0||v<0||u>M.W||v>M.Hh){ mapHover=null; drawMap(); return; }
    const i=Math.round(u/M.W*(M.nu-1)), j=Math.round(v/M.Hh*(M.nv-1)); mapHover={u,v};
    const s=M.s[j][i], rs=M.rs[j][i], rho=M.rho[j][i];
    $('#mapRead').innerHTML=`<span>ρ <b>${rho.toFixed(4)}</b> e/Bohr³</span><span>r<sub>s</sub> <b>${rs.toFixed(2)}</b></span><span>s <b>${s.toFixed(2)}</b></span><span>F<sub>x</sub><sup>PBE</sup> <b>${FX.PBE(s).toFixed(3)}</b></span><span>ε<sub>x</sub><sup>LDA</sup> <b>${fmtN(ex(rs)*HA,2)}</b> eV</span>`;
    drawMap(); });
  $('#xcMap').addEventListener('pointerleave',()=>{ mapHover=null; drawMap(); });
  
  // ---- Si EOS
  function bm(V,f){ const eta=Math.pow(f.V0/V,2/3); return f.E0+9*f.V0*f.B0/16*(Math.pow(eta-1,3)*f.Bp+Math.pow(eta-1,2)*(6-4*eta)); }
  function drawEos(){
    const E=X.eos, cols={lda:css('--accent'),pbe:css('--e1')};
    const ser=[], pts=[]; let emin=Infinity;
    for (const k of ['lda','pbe']) emin=Math.min(emin,E[k].fit.E0);
    for (const k of ['lda','pbe']){ const f=E[k].fit; const d=[]; for(let a=5.22;a<=5.73;a+=0.005) d.push([a,(bm(a**3/4,f)-f.E0)*1000/2]);
      ser.push({d,color:cols[k],label:k.toUpperCase()}); E[k].a.forEach((a,i)=>pts.push({x:a,y:(E[k].E[i]-f.E0)*1000/2,color:cols[k],r:3.4,ring:true})); }
    chart($('#xcEos'),{xlim:[5.22,5.73],ylim:[-5,140],xlabel:'a (Å)',ylabel:'E − E_min (meV/átomo)',series:ser,points:pts,
      vlines:[{x:5.431,label:'exp. 5.431',color:css('--ok'),dash:[2,3]},{x:E.lda.a0,color:cols.lda,dash:[1,3]},{x:E.pbe.a0,color:cols.pbe,dash:[1,3]}]});
    const r=(k)=>E[k];
    const row=(lab,l,p,ex,u,d)=>`<tr><td>${lab}</td><td>${l}</td><td>${p}</td><td>${ex}</td></tr>`;
    $('#eosTab').innerHTML=`<div class="tblwrap"><table class="tbl"><thead><tr><th></th><th>LDA</th><th>PBE</th><th>exp.</th></tr></thead><tbody>
     ${row('a₀ (Å)',r('lda').a0.toFixed(3)+' <small>('+fmtN((r('lda').a0/5.431-1)*100,1)+'%)</small>',r('pbe').a0.toFixed(3)+' <small>(+'+((r('pbe').a0/5.431-1)*100).toFixed(1)+'%)</small>','5.431')}
     ${row('B₀ (GPa)',r('lda').B0GPa.toFixed(0),r('pbe').B0GPa.toFixed(0),'98')}
     ${row('gap indirecto (eV)',r('lda').gap0.toFixed(2),r('pbe').gap0.toFixed(2),'1.17')}
     ${row('gap directo en Γ (eV)',r('lda').gapG0.toFixed(2),r('pbe').gapG0.toFixed(2),'3.4')}
     </tbody></table></div><p class="note">Los puntos son cálculos de SIESTA; la curva es el ajuste de Birch–Murnaghan hecho aquí. LDA queda corta y PBE larga, como predice la teoría, y ambos dan casi la mitad del gap experimental: eso no se arregla con un mejor funcional local, se necesita un híbrido o GW.</p>`;
  }
  // ---- graphite
  const GS={raw:false};
  function drawGr(){
    const G=X.graphite;
    if (!Object.keys(G.curves).length){ const cv=$('#xcGr'); const {c,W,H}=setup(cv); c.clearRect(0,0,W,H); c.fillStyle=css('--muted'); c.font='13px '+css('--f-ui'); c.textAlign='center'; c.fillText('Cálculos de SIESTA en curso (40 + 36 corridas).',W/2,H/2); $('#grNote').textContent='Este panel se llena cuando terminen las curvas de LDA, PBE, vdW-DF y VV10, con y sin corrección de counterpoise.'; return; } const cols={lda:css('--accent'),pbe:css('--e1'),drsll:css('--orb-p'),vv:css('--orb-s')}, names={lda:'LDA',pbe:'PBE',drsll:'vdW-DF (DRSLL)',vv:'VV10'};
    const ser=[], pts=[];
    for (const k of Object.keys(G.curves)){ const c=G.curves[k]; ser.push({d:c.d.map((d,i)=>[d,c.Eb[i]]),color:cols[k],label:names[k]}); }
    if (GS.raw) for (const k of Object.keys(G.curves)){ const c=G.curves[k]; ser.push({d:c.d.map((d,i)=>[d,c.raw[i]]),color:alpha(cols[k],.45),width:1.3,dash:[4,3],nohover:true}); }
    chart($('#xcGr'),{xlim:[2.85,6.05],ylim:[-110,60],xlabel:'distancia entre capas d (Å)',ylabel:'E_enlace (meV/átomo)',series:ser,hlines:[{y:0}],
      vlines:[{x:3.35,label:'exp. 3.35 Å',color:css('--ok'),dash:[2,3]}],
      readEl:$('#grRead'), read:x=>{ if(x===null) return Object.entries(G.curves).map(([k,c])=>`<span>${names[k]}: mínimo <b>${c.dmin.toFixed(2)} Å</b>, <b>${c.Emin.toFixed(0)} meV/át.</b></span>`).join('');
        return `<span>d <b>${x.toFixed(2)} Å</b></span>`+Object.entries(G.curves).map(([k,c])=>`<span>${names[k]} <b>${fmtN(interp(c.d.map((d,i)=>[d,c.Eb[i]]),x),1)}</b></span>`).join(''); }});
    $('#grNote').innerHTML='Curvas continuas: energía de enlace por átomo con corrección de counterpoise (cada capa calculada sola, con los orbitales fantasma de la otra). Punteadas, si activas el botón: sin corregir, respecto a capas separadas 10 Å; la diferencia es el error de superposición de base (BSSE) de los orbitales localizados. El experimento da d = 3.35 Å y una energía de exfoliación de unos 40–55 meV/átomo. PBE casi no enlaza las capas porque no tiene dispersión; la LDA da una distancia razonable por cancelación de errores, no por buena física; vdW-DF y VV10 añaden la correlación no local que falta: vdW-DF cae dentro del rango experimental y VV10 lo rebasa un poco. La curva de VV10 corregida llega solo a 5 Å: a 6 Å el cálculo con orbitales fantasma divergió (energía saltando de −310.7 a −297.5 eV), un caso real de inestabilidad del SCF que se guardó para la sección de oscilaciones.';
  }
  $('#grRaw').addEventListener('click',e=>{ GS.raw=!GS.raw; e.currentTarget.setAttribute('aria-pressed',GS.raw); drawGr(); });
  function gapTable(){
    const E=X.eos;
    const rows=[
      ['Si', E.lda.gap0.toFixed(2)+'*', E.pbe.gap0.toFixed(2)+'*', '—', '1.1–1.2', '1.17'],
      ['C (diamante)', '4.1', '4.1–4.2', '—', '5.3', '5.48'],
      ['GaAs', '0.3–0.5', '0.5', '—', '1.2–1.4', '1.52'],
      ['ZnO', '0.7', '0.7–0.8', '1.5–2 (U en Zn d)', '2.1–2.5', '3.44'],
      ['NiO (AFM)', '0.4', '0.6–1.0', '3.0–3.4 (U ≈ 5–6 eV)', '4.1–4.3', '4.0–4.3']];
    $('#gapTab').innerHTML=`<div class="tblwrap"><table class="tbl"><thead><tr><th>material</th><th>LDA</th><th>PBE</th><th>PBE+U</th><th>HSE06</th><th>exp.</th></tr></thead><tbody>${rows.map(r=>`<tr>${r.map((v,i)=>`<td${i===5?' class="good"':''}>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <p class="note">* calculado aquí con SIESTA. El resto son rangos típicos publicados (dependen de geometría, pseudos y acoplamiento espín-órbita); sirven para ver la tendencia, no como referencia exacta. La LDA y PBE subestiman todos los gaps. DFT+U ayuda donde el problema es la localización d (NiO) y casi nada en sp (Si, GaAs); el híbrido HSE06 mejora todos a un costo mucho mayor.</p>`;
  }
  
  
  addExports(root); onTheme(()=>drawXC()); drawXC();
}
