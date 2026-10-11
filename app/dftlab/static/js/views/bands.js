// Section 8: bands, DOS/PDOS, ε(ω) and wavefunctions of Si, all linked by one selection.
import { $, $$, css, alpha, rgb, fmt, seg, onTheme } from '../core/ui.js';
import { chart, exportBar } from '../core/chart.js';
import { createViewer, drawStructure, drawBZ, isoSurface, meshFrom, hsl2rgb, cssRGB } from '../core/three-view.js';
import D from '../data/si_lda.json';
import WFD from '../data/si_wf.json';

const B=D.bands, nb=B.E.length, nk=B.x.length, nocc=B.nocc, xmax=B.x[nk-1], EMIN=-12.5, EMAX=6.5, gap=D.meta.gap;
let cbm=Infinity; for (let b=nocc;b<nb;b++) for (let i=0;i<nk;i++) cbm=Math.min(cbm,B.E[b][i]);
const labX=(()=>{ const m={}; for (const [x,l] of B.labels){ const k=x.toFixed(4); m[k]=m[k]?m[k]+'|'+l:l; } return Object.entries(m).map(([x,l])=>({x:+x,label:l.replace('W_2','W′')})); })();
const nearestLabel=x=>{ let best=null,d=1e9; for (const [xx,l] of B.labels){ if(Math.abs(xx-x)<d){d=Math.abs(xx-x);best=l;} } return d<0.03?best.replace('W_2','W′'):null; };
const wfK=WFD.kidx;
let WF=null;
async function loadWf(){
  if (WF) return WF;
  const bin=Uint8Array.from(atob(WFD.data),c=>c.charCodeAt(0));
  const ds=new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'));
  WF=new Int8Array(await new Response(ds).arrayBuffer()); return WF;
}
function decAt(w){ let best=null,d=1e9; for (const x of D.eps.decomp){ const dd=Math.abs(x.w-w); if(dd<d){d=dd;best=x;} } return d<0.06?best:null; }

export function mount(root){
  const S={ik:null, E:null, band:null, w:null, wLock:false, proj:'mix', mode:'post', wf:null, wfMode:'re', wfIso:0.3, view:'bz'};
  root.innerHTML=`
  <div class="pghead"><div><div class="kicker">Aprender · 7</div><h1>Bandas, densidad de estados y óptica del Si</h1>
    <p class="lede">Un solo cálculo de SIESTA, cinco vistas enlazadas. Pasa el cursor por las bandas, la DOS o el espectro y todo se mueve junto. Da clic en una banda para ver su función de onda en 3D.</p></div>
    <div class="pgctl"><div class="chips">${[['SIESTA','5.4.2'],['XC','LDA-CA'],['base','DZP'],['MeshCutoff','200 Ry'],['k SCF','8×8×8'],['Fd-3m','(227)'],['E<sub>g</sub>',gap.toFixed(2)+' eV ind.']].map(([k,v])=>`<span class="chip">${k} <em>${v}</em></span>`).join('')}</div>
    <div class="seg" id="bMode"><button data-v="post">Postproceso</button><button data-v="learn">Aprender</button></div></div></div>
  <div class="bgrid">
    <section class="panel" id="bViz"><div class="ph"><h2>Espacio real y recíproco</h2><div class="seg" id="vSel"><button data-v="bz">Zona de Brillouin</button><button data-v="st">Estructura</button><button data-v="wf">ψ<sub>n<b>k</b></sub></button></div></div>
      <div class="pb"><div class="three" id="b3"></div>
        <div class="btnrow" id="wfCtl" hidden style="padding-top:8px"><div class="seg" id="wMode"><button data-v="re">Re ψ (±)</button><button data-v="abs">|ψ|² con fase</button></div>
          <label class="sl">isovalor <input type="range" id="wIso" min="0.08" max="0.8" step="0.01" value="0.3"><output id="wIsoV">0.30</output></label></div>
        <div class="readout" id="vizRead"></div></div></section>
    <section class="panel" id="bBands"><div class="ph"><h2>Bandas · camino seekpath</h2><div class="btnrow" id="projSel"><button class="tiny" data-v="mix">s/p/d</button><button class="tiny" data-v="0">s</button><button class="tiny" data-v="1">p</button><button class="tiny" data-v="2">d</button></div></div>
      <div class="pb"><canvas id="cB" style="height:430px" aria-label="Estructura de bandas"></canvas><div class="readout" id="bandRead"></div></div></section>
    <section class="panel" id="bDos"><div class="ph"><h2>DOS · PDOS</h2><span class="sub">20³ k · σ 0.12 eV</span></div>
      <div class="pb"><canvas id="cD" style="height:430px" aria-label="Densidad de estados"></canvas></div></section>
    <section class="panel" id="bEps"><div class="ph"><h2>Función dieléctrica ε(ω)</h2><div class="btnrow"><button class="tiny" id="tSisl" aria-pressed="false">ε₂ reconstruido (sisl)</button></div></div>
      <div class="pb"><canvas id="cE" style="height:260px" aria-label="Función dieléctrica"></canvas><div class="readout" id="epsRead"></div></div></section>
    <section class="panel" id="bDec"><div class="ph"><h2>¿Qué forma este pico?</h2><span class="sub">transiciones v → c en 14³ k</span></div><div class="pb" id="decBody"></div></section>
    <aside class="panel" id="bSide"><div class="ph"><h2 id="sideTitle">Procedencia y controles</h2></div><div class="pb" id="sideBody"></div></aside>
  </div>
  <footer class="prov">SIESTA 5.4.2 corrió el SCF, las bandas, la PDOS y ε₂ (malla 16³, policristal) en 36 s en 4 núcleos. Las bandas gordas, la descomposición de ε₂ y las 176 funciones de onda (8 bandas × 22 puntos k, malla 28³ de la celda convencional) se calcularon con sisl a partir de H(k) y S(k) del archivo si.TSHS. El camino k es el estándar de seekpath.</footer>`;
  if (!document.getElementById('bgrid-css')){ const st=document.createElement('style'); st.id='bgrid-css'; st.textContent=`
    .bgrid{display:grid;gap:12px;align-items:start;grid-template-columns:minmax(0,3fr) minmax(0,4.6fr) minmax(0,2.2fr);grid-template-areas:"viz bands dos" "eps eps side" "dec dec side"}
    @media (min-width:1500px){.bgrid{grid-template-areas:"viz bands dos" "eps dec side"}}
    @media (max-width:1000px){.bgrid{grid-template-columns:minmax(0,1fr);grid-template-areas:"bands" "dos" "viz" "eps" "dec" "side"}}
    #bViz{grid-area:viz}#bBands{grid-area:bands}#bDos{grid-area:dos}#bEps{grid-area:eps}#bDec{grid-area:dec}#bSide{grid-area:side}
    .dec-w{font:600 26px var(--f-data)} .dec-w small{font-size:13px;color:var(--muted);font-weight:400;margin-left:6px}
    .bar{display:grid;grid-template-columns:7.5em minmax(0,1fr) 3.4em;gap:8px;align-items:center;font:12.5px var(--f-data)}
    .bar .track{height:10px;background:var(--panel-2);border-radius:2px;overflow:hidden}.bar .fill{height:100%;background:var(--accent)}`; document.head.appendChild(st); }

  const cB=$('#cB'), cD=$('#cD'), cE=$('#cE');
  $('#bBands .ph .btnrow').append(exportBar(cB,'Si_bandas'));
  $('#bDos .ph').append(exportBar(cD,'Si_PDOS'));
  $('#bEps .ph .btnrow').append(exportBar(cE,'Si_epsilon'));

  // ---- bands
  function bandsCfg(){
    const oc=[rgb(css('--orb-s')),rgb(css('--orb-p')),rgb(css('--orb-d'))], faint=css('--faint'), acc=css('--accent'), ink=css('--ink');
    const segs=[];
    for (let b=0;b<nb;b++) for (let i=1;i<nk;i++){ if (B.x[i]===B.x[i-1]) continue; const f=B.fat[b][i], f0=B.fat[b][i-1];
      if (S.proj==='mix'){ const s=f[0]+f[1]+f[2]+1e-9; segs.push({x0:B.x[i-1],y0:B.E[b][i-1],x1:B.x[i],y1:B.E[b][i],color:`rgb(${[0,1,2].map(j=>Math.round((oc[0][j]*f[0]+oc[1][j]*f[1]+oc[2][j]*f[2])/s))})`,width:1.8}); }
      else { const j=+S.proj, w=(f[j]+f0[j])/2; segs.push({x0:B.x[i-1],y0:B.E[b][i-1],x1:B.x[i],y1:B.E[b][i],color:alpha(faint,.55),width:1}); segs.push({x0:B.x[i-1],y0:B.E[b][i-1],x1:B.x[i],y1:B.E[b][i],color:`rgba(${oc[j]},.85)`,width:.4+w*7}); } }
    return {xlim:[0,xmax], ylim:[EMIN,EMAX], ylabel:'E − E(VBM)  (eV)', xticks:labX, yticksStep:2, segments:segs, series:[], legend:false, nohover:true,
      shade:[{x0:0,x1:xmax,y0:0,y1:cbm}], pad:{l:46,b:28},
      csv:()=>{ let o='# Si LDA bands (eV, relative to VBM); columns: k-distance (1/Å), band1..band'+nb+'\n'; for (let i=0;i<nk;i++) o+=B.x[i]+','+B.E.map(e=>e[i]).join(',')+'\n'; return o; },
      overlay:(c,m)=>{
        c.fillStyle=ink; c.font='11px '+css('--f-label'); c.textAlign='left'; c.textBaseline='bottom'; c.fillText('Eg = '+gap.toFixed(3)+' eV (indirecto)', m.P.l+6, m.Y(cbm)-3);
        for (const k of wfK) for (let b=0;b<WFD.nb;b++){ c.fillStyle=alpha(ink,.35); c.beginPath(); c.arc(m.X(B.x[k]),m.Y(B.E[b][k]),1.7,0,7); c.fill(); }
        if (S.wf){ const k=wfK[S.wf.ki], X=m.X(B.x[k]), y=m.Y(B.E[S.wf.n][k]); c.strokeStyle=acc; c.lineWidth=2; c.beginPath(); c.arc(X,y,6,0,7); c.stroke(); }
        if (S.w!==null){ const dec=decAt(S.w); if (dec) for (const [v,cb,share] of dec.pairs.slice(0,3)){ if(share<0.05) continue; for (let i=0;i<nk;i++){ if (Math.abs(B.E[cb][i]-B.E[v][i]-S.w)<0.06){ const X=m.X(B.x[i]); c.strokeStyle=alpha(acc,Math.min(.9,.25+share)); c.lineWidth=1.5; c.beginPath(); c.moveTo(X,m.Y(B.E[v][i])); c.lineTo(X,m.Y(B.E[cb][i])); c.stroke(); } } } }
        if (S.ik!==null){ const X=m.X(B.x[S.ik]); c.strokeStyle=acc; c.lineWidth=1; c.setLineDash([4,3]); c.beginPath(); c.moveTo(X,m.P.t); c.lineTo(X,m.H-m.P.b); c.stroke(); c.setLineDash([]); for (let b=0;b<nb;b++){ const y=m.Y(B.E[b][S.ik]); c.fillStyle=acc; c.beginPath(); c.arc(X,y,2.6,0,7); c.fill(); } }
        if (S.E!==null){ const y=m.Y(S.E); c.strokeStyle=alpha(acc,.7); c.setLineDash([2,3]); c.beginPath(); c.moveTo(m.P.l,y); c.lineTo(m.W-m.P.r,y); c.stroke(); c.setLineDash([]); }
      },
      onclick:(x,E)=>{ const ik=nearestK(x); let ki=0,d=1e9; wfK.forEach((k,i)=>{ const dd=Math.abs(B.x[k]-B.x[ik]); if(dd<d){d=dd;ki=i;} }); const k=wfK[ki]; let bb=0,de=1e9; for (let b=0;b<WFD.nb;b++){ const dd=Math.abs(B.E[b][k]-E); if(dd<de){de=dd;bb=b;} } S.wf={ki,n:bb}; setView('wf'); }
    };
  }
  const nearestK=x=>{ let ik=0,d=1e9; for (let i=0;i<nk;i++){ const dd=Math.abs(B.x[i]-x); if(dd<d){d=dd;ik=i;} } return ik; };
  cB.addEventListener('pointermove',ev=>{ const m=cB._map; if(!m) return; const r=cB.getBoundingClientRect(); const x=m.iX(ev.clientX-r.left), E=m.iY(ev.clientY-r.top); if(x<0||x>xmax) return;
    S.ik=nearestK(x); S.E=Math.max(EMIN,Math.min(EMAX,E)); let bb=0,de=1e9; for (let b=0;b<nb;b++){ const dd=Math.abs(B.E[b][S.ik]-E); if(dd<de){de=dd;bb=b;} } S.band=bb;
    const f=B.fat[bb][S.ik], lab=nearestLabel(B.x[S.ik]);
    $('#bandRead').innerHTML=`<span>k <b>${lab||'#'+S.ik}</b></span><span>banda <b>${bb+1}</b> ${bb<nocc?'(valencia)':'(conducción)'}</span><span>E <b>${fmt(B.E[bb][S.ik],3)} eV</b></span><span>s <b style="color:var(--orb-s)">${(f[0]*100).toFixed(0)}%</b> · p <b style="color:var(--orb-p)">${(f[1]*100).toFixed(0)}%</b> · d <b style="color:var(--orb-d)">${(f[2]*100).toFixed(0)}%</b></span>`;
    emit(); });
  cB.addEventListener('pointerleave',()=>{ S.ik=null; S.E=null; emit(); });
  seg($('#projSel'),'mix',v=>{ S.proj=v; emit(); });

  // ---- DOS (x = states, y = E)
  const dmax=Math.max(...D.dos.total)*1.05, E=D.dos.E;
  function dosCfg(){ const ser=[{d:E.map((e,i)=>[D.dos.total[i],e]),color:css('--faint'),width:1,label:'total'}]; for (const [k,c,l] of [['s','--orb-s','s'],['p','--orb-p','p'],['d','--orb-d','d']]) ser.push({d:E.map((e,i)=>[D.dos[k][i],e]),color:css(c),width:1.6,label:l});
    return {xlim:[0,dmax],ylim:[EMIN,EMAX],xlabel:'estados / eV / celda',series:ser,nohover:true,pad:{l:30,b:28},yticksStep:2,shade:[{y0:0,y1:cbm}],
      overlay:(c,m)=>{ c.beginPath(); c.moveTo(m.X(0),m.Y(E[0])); E.forEach((e,i)=>c.lineTo(m.X(D.dos.total[i]),m.Y(e))); c.lineTo(m.X(0),m.Y(E[E.length-1])); c.closePath(); c.fillStyle=alpha(css('--faint'),.2); c.fill();
        if (S.E!==null){ const y=m.Y(S.E); c.strokeStyle=css('--accent'); c.setLineDash([4,3]); c.beginPath(); c.moveTo(m.P.l,y); c.lineTo(m.W-m.P.r,y); c.stroke(); c.setLineDash([]); } },
      csv:()=>'# Si LDA DOS/PDOS (states/eV/cell); E(eV vs VBM),total,s,p,d\n'+E.map((e,i)=>[e,D.dos.total[i],D.dos.s[i],D.dos.p[i],D.dos.d[i]].join(',')).join('\n') }; }
  cD.addEventListener('pointermove',ev=>{ const m=cD._map; if(!m) return; const r=cD.getBoundingClientRect(); S.E=Math.max(EMIN,Math.min(EMAX,m.iY(ev.clientY-r.top))); S.ik=null; emit(); });
  cD.addEventListener('pointerleave',()=>{ S.E=null; emit(); });

  // ---- eps
  const ew=D.eps.w;
  function epsCfg(){ const acc=css('--accent'); const lim=i=>ew[i]<=10;
    const ser=[{d:ew.map((w,i)=>[w,D.eps.eps2[i]]).filter((_,i)=>lim(i)),color:acc,label:'ε₂ SIESTA',fill:0,fillAlpha:.13},{d:ew.map((w,i)=>[w,D.eps.eps1[i]]).filter((_,i)=>lim(i)),color:css('--e1'),width:1.6,label:'ε₁ (Kramers–Kronig)'}];
    if (S.showSisl) ser.push({d:ew.map((w,i)=>[w,D.eps.eps2_sisl[i]]).filter((_,i)=>lim(i)),color:alpha(acc,.7),dash:[5,4],width:1.3,label:'ε₂ sisl'});
    return {xlim:[0,10],ylim:[-22,62],xlabel:'ħω (eV)',series:ser,hlines:[{y:0,dash:[]}],vlines:[{x:gap,label:'Eg'}].concat(S.w!==null?[{x:S.w,color:acc,dash:S.wLock?[]:[4,3],width:S.wLock?1.6:1}]:[]),nohover:true,
      onclick:(w)=>{ if (S.wLock && Math.abs(w-S.w)<0.15) S.wLock=false; else { S.wLock=true; S.w=w; } emit(); }}; }
  cE.addEventListener('pointermove',ev=>{ if(S.wLock) return; const m=cE._map; if(!m) return; const r=cE.getBoundingClientRect(); S.w=Math.max(0.05,Math.min(10,m.iX(ev.clientX-r.left))); emit(); });
  cE.addEventListener('pointerleave',()=>{ if(!S.wLock){ S.w=null; emit(); } });
  $('#tSisl').onclick=e=>{ S.showSisl=!S.showSisl; e.currentTarget.setAttribute('aria-pressed',S.showSisl); emit(); };
  const epsIdx=w=>Math.max(0,Math.min(ew.length-1,Math.round((w-ew[0])/(ew[1]-ew[0]))));
  function epsRead(){ if (S.w===null){ $('#epsRead').innerHTML='Pasa el cursor por el espectro; clic para fijar ω. ε₁(0) = <b>'+D.eps.eps1[0].toFixed(1)+'</b>'; return; }
    const i=epsIdx(S.w); $('#epsRead').innerHTML=`<span>ħω <b>${S.w.toFixed(2)} eV</b></span><span>ε₂ <b>${D.eps.eps2[i].toFixed(2)}</b></span><span>ε₁ <b>${fmt(D.eps.eps1[i],2)}</b></span><span>${S.wLock?'fijado · clic de nuevo para soltar':'clic para fijar'}</span>`; }
  function drawDec(){ const w=S.w===null?3.7:S.w, dec=decAt(w), el=$('#decBody');
    const head=`<div class="dec-w">${w.toFixed(2)}<small>eV${S.w===null?' · ejemplo: pico E₂':''}</small></div>`;
    if (!dec||!dec.pairs.length){ el.innerHTML=head+`<p class="note">Fuera del rango descompuesto (1–9 eV).${w<gap?' Por debajo del gap no hay transiciones.':''}</p>`; return; }
    el.innerHTML=head+dec.pairs.filter(p=>p[2]>0.004).map(([v,c,s])=>`<div class="bar"><span>banda ${v+1} → ${c+1}</span><span class="track"><span class="fill" style="display:block;width:${(s*100).toFixed(1)}%"></span></span><span style="text-align:right">${(s*100).toFixed(1)}%</span></div>`).join('')+
      `<p class="note">Las flechas sobre las bandas marcan dónde, en el camino de alta simetría, se cumple E<sub>c</sub> − E<sub>v</sub> ≈ ħω. En la zona de Brillouin aparecen los puntos k de la malla que más aportan.</p>`; }

  // ---- side
  const M=D.meta;
  function sideHTML(){
    if (S.mode==='post'){ const dosInt=(()=>{ let s=0; for(let i=1;i<E.length;i++){ if(E[i]>0) break; s+=(D.dos.total[i]+D.dos.total[i-1])/2*(E[i]-E[i-1]); } return s; })();
      return `<dl class="kv">${[['Código',M.code],['Funcional',M.xc],['Base',M.basis+' ('+M.norb+' orbitales)'],['Pseudo',M.pseudo],['MeshCutoff',M.mesh_cutoff],['Mallas k',M.kgrid],['Grupo',M.spacegroup+' · '+M.bravais],['a',M.a+' Å']].map(([k,v])=>`<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
      <h3 style="margin-top:12px">Controles de calidad</h3>
      ${[['good','OK',`Electrones bajo el VBM: ${dosInt.toFixed(2)} de 8`],['good','OK',`Gap LDA ${gap.toFixed(3)} eV, CBM al ${(M.kcbm[0]/0.5*100).toFixed(0)}% de Γ→X`],['good','OK',`SCF convergido en ${D.scf.length} ciclos`],['warnc','revisar',`ε₂ reconstruido con sisl vs SIESTA: correlación ${M.eps_shape_corr.toFixed(2)}`]].map(([c,t,s])=>`<div class="check"><i class="${c}">${t}</i><span>${s}</span></div>`).join('')}`; }
    const w=S.w===null?3.7:S.w, i=epsIdx(w);
    let s='';
    if (S.wf){ const k=wfK[S.wf.ki]; s+=`<h3>Función de onda</h3><div class="eq">ψ<sub>n<b>k</b></sub>(<b>r</b>) = Σ<sub>μ</sub> c<sub>nμ</sub>(<b>k</b>) Σ<sub><b>R</b></sub> e<sup>i<b>k</b>·<b>R</b></sup> φ<sub>μ</sub>(<b>r</b> − <b>R</b> − τ<sub>μ</sub>)</div><p class="note">El estado ${S.wf.n+1} en ${nearestLabel(B.x[k])||'k #'+k} es una suma de los ${M.norb} orbitales de la base con los coeficientes que salen de diagonalizar H(<b>k</b>). Al pasar a la celda vecina se multiplica por e<sup>i<b>k</b>·<b>R</b></sup>.</p>`; }
    if (S.ik!==null){ const b=S.band??nocc-1, f=B.fat[b][S.ik]; s+=`<h3>Bandas</h3><div class="eq">H(<b>k</b>) c<sub>n</sub> = ε<sub>n</sub> S(<b>k</b>) c<sub>n</sub> → ε<sub>${b+1}</sub> = <span class="v">${fmt(B.E[b][S.ik],3)} eV</span></div><div class="eq">w<sub>nμ</sub> = Re[c*<sub>nμ</sub>(S c<sub>n</sub>)<sub>μ</sub>] → s <span class="v">${(f[0]*100).toFixed(0)}%</span> p <span class="v">${(f[1]*100).toFixed(0)}%</span> d <span class="v">${(f[2]*100).toFixed(0)}%</span></div><p class="note">Como la base no es ortogonal entra S; por eso la PDOS suma exactamente la DOS total.</p>`; }
    else s+=`<p class="note">Pasa el cursor por las bandas para ver la ecuación de valores propios con los números de ese punto k.</p>`;
    s+=`<h3>Función dieléctrica</h3><div class="eq">ε<sub>2</sub>(ω) ∝ (1/ω²) Σ<sub><b>k</b>,v,c</sub> |⟨c<b>k</b>|p|v<b>k</b>⟩|² δ(E<sub>c</sub> − E<sub>v</sub> − ħω)</div><p class="note">A ħω = <span class="v">${w.toFixed(2)} eV</span>: ε₂ = <span class="v">${D.eps.eps2[i].toFixed(2)}</span>. Kramers–Kronig da ε₁(0) = ε∞ = <span class="v">${D.eps.eps1[0].toFixed(1)}</span> (exp. 11.9); la diferencia viene de la aproximación de partícula independiente y del gap LDA.</p>`;
    return s; }
  seg($('#bMode'),'post',v=>{ S.mode=v; $('#sideTitle').textContent=v==='post'?'Procedencia y controles':'Ecuaciones con tus números'; emit(); });

  // ---- 3D
  let V=null, gBZ, gSt, gWf, isoMesh=null;
  try{
    V=createViewer($('#b3'));
    gBZ=V.group(); gSt=V.group(); gWf=V.group();
    const segs=[]; let cur=[]; for (let i=0;i<nk;i++){ if(i&&B.x[i]===B.x[i-1]){ segs.push(cur); cur=[]; } cur.push(B.kcart[i]); } segs.push(cur);
    drawBZ(V,gBZ,{faces:D.bz.faces,segments:segs,points:D.bz.points});
    const a=D.structure.a, atoms=D.structure.atoms.map(p=>({pos:p,color:'#8f9aa8',r:.42}));
    drawStructure(V,gSt,{atoms,bonds:D.structure.bonds,cell:[[a,0,0],[0,a,0],[0,0,a]]});
    drawStructure(V,gWf,{atoms:atoms.map(x=>({...x,r:.22})),bonds:D.structure.bonds,cell:[[a,0,0],[0,a,0],[0,0,a]],bondR:.05});
    const kMark=new V.THREE.Mesh(new V.THREE.SphereGeometry(.045,16,16),new V.THREE.MeshBasicMaterial({color:V.color('--accent')})); kMark.visible=false; gBZ.add(kMark);
    const cloud=new V.THREE.Group(); gBZ.add(cloud); let lastW=null;
    V.update=()=>{ if (S.ik!==null){ kMark.visible=true; kMark.position.set(...B.kcart[S.ik]); } else kMark.visible=false;
      const dec=S.w===null?null:decAt(S.w), key=dec?dec.w:null;
      if (key!==lastW){ lastW=key; while(cloud.children.length) cloud.remove(cloud.children[0]);
        if (dec){ const mx=Math.max(...dec.k.map(r=>r[3])); const mat=new V.THREE.MeshBasicMaterial({color:V.color('--accent'),transparent:true,opacity:.75}), geo=new V.THREE.SphereGeometry(1,10,10);
          for (const r of dec.k.slice(0,70)){ const s=new V.THREE.Mesh(geo,mat); const rad=.008+.028*Math.sqrt(r[3]/mx); s.scale.set(rad,rad,rad); s.position.set(r[0],r[1],r[2]); cloud.add(s); } } } };
  }catch(e){ $('#b3').innerHTML='<p class="note" style="padding:12px">La vista 3D no está disponible en este navegador (WebGL).</p>'; }

  async function showWf(){
    if (!V || !S.wf) return; $('#vizRead').innerHTML='<span>Descomprimiendo funciones de onda…</span>';
    let wf; try{ wf=await loadWf(); }catch(e){ $('#vizRead').innerHTML='<span>Este navegador no pudo descomprimir las funciones de onda.</span>'; return; }
    const N=WFD.N, M=N+1, N3=N*N*N, base=(S.wf.ki*WFD.nb+S.wf.n)*2*N3, kc=B.kcart[wfK[S.wf.ki]], a=WFD.a;
    const re=new Float32Array(M*M*M), im=new Float32Array(M*M*M);
    for (let i=0;i<M;i++) for (let j=0;j<M;j++) for (let k=0;k<M;k++){ const p=((i%N)*N+(j%N))*N+(k%N); let r=wf[base+p]/127, m=wf[base+N3+p]/127;
      const sh=(i>=N?kc[0]:0)+(j>=N?kc[1]:0)+(k>=N?kc[2]:0); if (sh){ const c=Math.cos(sh*a), sn=Math.sin(sh*a); const r2=r*c-m*sn; m=r*sn+m*c; r=r2; } const q=(i*M+j)*M+k; re[q]=r; im[q]=m; }
    let mx=0; for (let i=0;i<re.length;i++) mx=Math.max(mx,re[i]*re[i]+im[i]*im[i]); mx=Math.sqrt(mx)||1;
    const h=a/N, off=a/2, toCart=(i,j,k)=>[i*h-off,j*h-off,k*h-off], dims=[M,M,M], iso=S.wfIso*mx; const parts=[];
    if (S.wfMode==='re'){ const cp=cssRGB('--psi-pos'), cn=cssRGB('--psi-neg'); const neg=re.map(v=>-v); parts.push(isoSurface(re,dims,toCart,iso,()=>cp)); parts.push(isoSurface(neg,dims,toCart,iso,()=>cn)); }
    else { const A2=new Float32Array(re.length); for (let i=0;i<re.length;i++) A2[i]=re[i]*re[i]+im[i]*im[i];
      parts.push(isoSurface(A2,dims,toCart,iso*iso,(p,q,t)=>{ const r=re[p]+(re[q]-re[p])*t, m=im[p]+(im[q]-im[p])*t; return hsl2rgb((Math.atan2(m,r)*180/Math.PI+360)%360,.72,.52); })); }
    const merged={pos:parts.flatMap(p=>p.pos),nor:parts.flatMap(p=>p.nor),col:parts.flatMap(p=>p.col)};
    if (isoMesh){ gWf.remove(isoMesh); isoMesh.geometry.dispose(); } isoMesh=meshFrom(V,merged); gWf.add(isoMesh);
    vizRead();
  }
  function setView(v){ S.view=v; setSel(v); if(!V) return; gBZ.visible=v==='bz'; gSt.visible=v==='st'; gWf.visible=v==='wf'; $('#wfCtl').hidden=v!=='wf';
    V.view(v==='bz'?[2.6,1.6,3.1]:[11,7,13]); if (v==='wf'){ if(!S.wf) S.wf={ki:0,n:nocc-1}; showWf(); } vizRead(); emit(); }
  const setSel=seg($('#vSel'),'bz',v=>setView(v));
  seg($('#wMode'),'re',v=>{ S.wfMode=v; showWf(); });
  let isoT=0; $('#wIso').oninput=e=>{ S.wfIso=+e.target.value; $('#wIsoV').textContent=S.wfIso.toFixed(2); clearTimeout(isoT); isoT=setTimeout(showWf,60); };
  function vizRead(){ const el=$('#vizRead'); if(!el) return;
    if (S.view==='wf' && S.wf){ const st=WFD.states[S.wf.ki*WFD.nb+S.wf.n], k=wfK[S.wf.ki], f=B.fat[S.wf.n][k];
      el.innerHTML=`<span>ψ<sub>${S.wf.n+1}</sub>(<b>${nearestLabel(B.x[k])||'k #'+k}</b>)</span><span>E <b>${fmt(B.E[S.wf.n][k],3)} eV</b></span><span>s ${(f[0]*100).toFixed(0)}% · p ${(f[1]*100).toFixed(0)}% · d ${(f[2]*100).toFixed(0)}%</span>${st.deg>1?`<span>degenerado ×${st.deg}: la combinación dentro del subespacio es arbitraria</span>`:''}<span>${S.wfMode==='re'?'naranja Re ψ > 0 · azul Re ψ < 0':'color = fase arg ψ'}</span>`; return; }
    el.innerHTML = S.view==='st' ? '<span>Fd-3m · celda convencional (8 átomos) · enlace Si–Si <b>2.352 Å</b></span>' : `<span>red ${M.bravais} · camino ${D.bz.path.map(p=>p.map(x=>x==='GAMMA'?'Γ':x).join('–')).join(' | ')}</span>${S.w!==null?`<span>puntos: k que forman ε₂ a <b>${S.w.toFixed(2)} eV</b></span>`:''}`; }

  let raf=0;
  function emit(){ cancelAnimationFrame(raf); raf=requestAnimationFrame(()=>{ chart(cB,bandsCfg()); chart(cD,dosCfg()); chart(cE,epsCfg()); epsRead(); drawDec(); $('#sideBody').innerHTML=sideHTML(); vizRead(); V?.update?.(); }); }
  onTheme(()=>emit());
  $('#bandRead').innerHTML='Pasa el cursor por las bandas. <b>Clic</b> en una banda para ver su función de onda.';
  setView('bz'); emit();
  mount.destroy=()=>V?.destroy();
}
export function destroy(){ mount.destroy?.(); }
