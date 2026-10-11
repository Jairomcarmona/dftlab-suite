(function(){
// Pseudopotential and XC screens. Data: ONCVPSP outputs, SIESTA runs, sisl density maps (see pxdata).
const X = JSON.parse(document.getElementById('pxdata').textContent);
const $ = s => document.querySelector(s);
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const HA = 27.211386;

// ---------- page navigation ----------
const pages = ['pgBands','pgPseudo','pgXC'];
const hashOf = {pgBands:'bandas', pgPseudo:'pseudos', pgXC:'xc'};
const FOOT = {
  pgBands: document.querySelector('footer').innerHTML,
  pgPseudo: 'Pseudos generados aquí con ONCVPSP 3.3.1 + PSML (gitlab.com/siesta-project/ecosystem/oncvpsp), a partir de las entradas de prueba de Si y N del propio paquete (el de C es una adaptación de la de N con r<sub>c</sub> = 1.35 Bohr). Cada curva es una columna del archivo de salida; nada está dibujado a mano. El pseudo "con fantasma" es la entrada de ejemplo que trae ONCVPSP para enseñar qué es un estado fantasma: no se debe usar.',
  pgXC: 'Si: SIESTA 5.4.2, DZP, MeshCutoff 300 Ry, k 8×8×8, 10 parámetros de red por funcional, pseudo ONCV generado con el mismo funcional del cálculo. Grafito: misma configuración que el test 10.Functionals de SIESTA con base DZP, k 12×12×4 y pseudos ONCV de C. El mapa del plano (110) se calculó con sisl a partir de la densidad de valencia (si.RHO) del cálculo LDA de la pestaña de bandas.'
};
let current = 'pgBands';
function go(id, push){
  current = id;
  for (const p of pages) document.getElementById(p).hidden = p!==id;
  document.querySelectorAll('[data-pg]').forEach(b=>b.setAttribute('aria-pressed', b.dataset.pg===id));
  const onBands = id==='pgBands';
  document.querySelector('header .chips').hidden = !onBands;
  $('#modeSeg').hidden = !onBands;
  document.querySelector('footer').innerHTML = FOOT[id];
  if (push){ try{ history.replaceState(null,'','#'+hashOf[id]); }catch(e){} }
  requestAnimationFrame(()=>{ if (id==='pgPseudo') drawPseudo(); if (id==='pgXC') drawXC(); window.dispatchEvent(new Event('resize')); });
}
document.querySelectorAll('[data-pg]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.pg,true)));

// ---------- generic chart ----------
function setup(cv){
  const r=cv.getBoundingClientRect(), dpr=Math.min(window.devicePixelRatio||1,2);
  cv.width=Math.max(1,Math.round(r.width*dpr)); cv.height=Math.max(1,Math.round(r.height*dpr));
  const c=cv.getContext('2d'); c.setTransform(dpr,0,0,dpr,0,0); return {c,W:r.width,H:r.height};
}
function step(span){ const raw=span/5, p=Math.pow(10,Math.floor(Math.log10(raw))), m=raw/p; return (m<1.5?1:m<3.5?2:m<7.5?5:10)*p; }
function ticks(a,b,logS){ const s=step(b-a), t=[]; for(let v=Math.ceil(a/s)*s; v<=b+1e-9*s; v+=s) t.push(+v.toPrecision(10)); return t; }
function alpha(col,a){ if(col.startsWith('#')){ const n=parseInt(col.slice(1),16); return `rgba(${n>>16&255},${n>>8&255},${n&255},${a})`; } return col; }
function fmtN(v,d){ if(!isFinite(v)) return '—'; return (v<0?'−':'')+Math.abs(v).toFixed(d); }
// cfg: {xlim,ylim,xlabel,ylabel,series:[{d,color,width,dash,label}],shade:[x0,x1],vlines:[{x,label,color}],hlines:[{y,label}],points:[{x,y,color,r,label}],logy,read:(x)=>html}
function chart(cv, cfg){
  cv._cfg = cfg; cv._hx = cv._hx ?? null;
  if (!cv._bound){
    cv._bound = true;
    cv.addEventListener('pointermove', ev=>{ const r=cv.getBoundingClientRect(), P=cv._cfg.pad||PAD; const x=cv._cfg.xlim[0]+(ev.clientX-r.left-P.l)/(r.width-P.l-P.r)*(cv._cfg.xlim[1]-cv._cfg.xlim[0]); cv._hx=Math.max(cv._cfg.xlim[0],Math.min(cv._cfg.xlim[1],x)); render(cv); });
    cv.addEventListener('pointerleave', ()=>{ cv._hx=null; render(cv); });
  }
  render(cv);
}
const PAD={l:46,r:12,t:12,b:34};
function interp(d,x){ if(!d.length) return NaN; if(x<=d[0][0]) return d[0][1]; for(let i=1;i<d.length;i++){ if(d[i][0]>=x){ const t=(x-d[i-1][0])/(d[i][0]-d[i-1][0]); return d[i-1][1]+t*(d[i][1]-d[i-1][1]); } } return d[d.length-1][1]; }
function render(cv){
  const cfg=cv._cfg; if(!cfg || cv.offsetParent===null) return;
  const {c,W,H}=setup(cv), P=cfg.pad||PAD, [x0,x1]=cfg.xlim, [y0,y1]=cfg.ylim;
  const ly=cfg.logy, Y0=ly?Math.log10(y0):y0, Y1=ly?Math.log10(y1):y1;
  const X=x=>P.l+(x-x0)/(x1-x0)*(W-P.l-P.r), Y=y=>{ const v=ly?Math.log10(Math.max(y,1e-30)):y; return P.t+(Y1-v)/(Y1-Y0)*(H-P.t-P.b); };
  const ink=css('--ink'), muted=css('--muted'), line=css('--line'), faint=css('--faint');
  c.clearRect(0,0,W,H);
  if (cfg.shade){ c.fillStyle=css('--gapfill'); c.fillRect(X(cfg.shade[0]),P.t,X(cfg.shade[1])-X(cfg.shade[0]),H-P.t-P.b);
    if (cfg.shade[2]){ c.fillStyle=faint; c.font='11px '+css('--f-label'); c.textAlign='left'; c.textBaseline='top'; c.fillText(cfg.shade[2],X(cfg.shade[0])+4,P.t+3); } }
  c.font='11px '+css('--f-data'); c.lineWidth=1;
  const yt = ly ? (()=>{ const t=[]; for(let e=Math.ceil(Y0);e<=Y1;e++) t.push(Math.pow(10,e)); return t; })() : ticks(y0,y1);
  c.textAlign='right'; c.textBaseline='middle';
  for (const v of yt){ const y=Y(v); c.strokeStyle=line; c.beginPath(); c.moveTo(P.l,y); c.lineTo(W-P.r,y); c.stroke(); c.fillStyle=muted; c.fillText(ly?('10'+supr(Math.round(Math.log10(v)))):(cfg.fy?cfg.fy(v):fmtT(v)),P.l-5,y); }
  c.textAlign='center'; c.textBaseline='top';
  for (const v of ticks(x0,x1)){ const x=X(v); c.strokeStyle=line; c.beginPath(); c.moveTo(x,H-P.b); c.lineTo(x,H-P.b+4); c.stroke(); c.fillStyle=muted; c.fillText(cfg.fx?cfg.fx(v):fmtT(v),x,H-P.b+6); }
  c.strokeStyle=faint; c.beginPath(); c.moveTo(P.l,P.t); c.lineTo(P.l,H-P.b); c.lineTo(W-P.r,H-P.b); c.stroke();
  c.font='11px '+css('--f-label'); c.fillStyle=muted; c.fillText(cfg.xlabel||'',(P.l+W-P.r)/2,H-14);
  c.save(); c.translate(11,(P.t+H-P.b)/2); c.rotate(-Math.PI/2); c.textAlign='center'; c.fillText(cfg.ylabel||'',0,0); c.restore();
  c.save(); c.beginPath(); c.rect(P.l,P.t,W-P.l-P.r,H-P.t-P.b); c.clip();
  for (const h of cfg.hlines||[]){ c.strokeStyle=h.color||faint; c.setLineDash([3,3]); c.beginPath(); c.moveTo(P.l,Y(h.y)); c.lineTo(W-P.r,Y(h.y)); c.stroke(); c.setLineDash([]);
    if(h.label){ c.fillStyle=h.color||faint; c.font='11px '+css('--f-label'); c.textAlign=h.left?'left':'right'; c.textBaseline='bottom'; c.fillText(h.label,h.left?P.l+6:W-P.r-4,Y(h.y)-2); } }
  for (const v of cfg.vlines||[]){ c.strokeStyle=v.color||faint; c.setLineDash(v.dash||[3,3]); c.beginPath(); c.moveTo(X(v.x),P.t); c.lineTo(X(v.x),H-P.b); c.stroke(); c.setLineDash([]);
    if(v.label){ c.fillStyle=v.color||faint; c.font='11px '+css('--f-label'); c.textAlign='left'; c.textBaseline='top'; c.fillText(v.label,X(v.x)+4,P.t+(v.dy||3)); } }
  for (const s of cfg.series){ if(!s.d||!s.d.length) continue; c.strokeStyle=s.color; c.lineWidth=s.width||1.8; c.setLineDash(s.dash||[]);
    c.beginPath(); let st=false; for (const [x,y] of s.d){ if(!isFinite(y)){ st=false; continue; } const px=X(x), py=Y(y); if(!st){c.moveTo(px,py);st=true;} else c.lineTo(px,py); } c.stroke(); c.setLineDash([]); }
  for (const p of cfg.points||[]){ c.fillStyle=p.color; c.strokeStyle=css('--panel'); c.lineWidth=1.2; c.beginPath(); c.arc(X(p.x),Y(p.y),p.r||3.2,0,7); c.fill(); if(p.ring) c.stroke(); }
  c.restore();
  for (const p of cfg.points||[]){ if(!p.label) continue; c.fillStyle=p.color; c.font='11px '+css('--f-label'); c.textAlign=p.align||'left'; c.textBaseline='bottom'; c.fillText(p.label,X(p.x)+(p.align==='right'?-6:6),Y(p.y)-3); }
  // legend
  const leg=cfg.series.filter(s=>s.label); if (leg.length){ c.font='11.5px '+css('--f-label'); let y=P.t+6; const xr=W-P.r-8;
    const wmax=Math.max(...leg.map(s=>c.measureText(s.label).width));
    c.fillStyle=alpha(css('--panel').startsWith('#')?css('--panel'):'#ffffff',.85); c.fillRect(xr-wmax-30,P.t+1,wmax+36,leg.length*16+8);
    for (const s of leg){ c.strokeStyle=s.color; c.lineWidth=2; c.setLineDash(s.dash||[]); c.beginPath(); c.moveTo(xr-wmax-24,y+6); c.lineTo(xr-wmax-8,y+6); c.stroke(); c.setLineDash([]); c.fillStyle=ink; c.textAlign='left'; c.textBaseline='middle'; c.fillText(s.label,xr-wmax-2,y+6); y+=16; } }
  if (cv._hx!==null && cv._hx!==undefined){ const x=X(cv._hx); c.strokeStyle=css('--accent'); c.setLineDash([4,3]); c.beginPath(); c.moveTo(x,P.t); c.lineTo(x,H-P.b); c.stroke(); c.setLineDash([]);
    for (const s of cfg.series){ if(!s.d||!s.d.length||s.nohover) continue; const v=interp(s.d,cv._hx); if(!isFinite(v)) continue; const y=Y(v); if(y<P.t||y>H-P.b) continue; c.fillStyle=s.color; c.beginPath(); c.arc(x,y,3,0,7); c.fill(); } }
  if (cfg.read && cfg.readEl){ cfg.readEl.innerHTML = cfg.read(cv._hx); }
}
function fmtT(v){ const a=Math.abs(v); if(a===0) return '0'; const s=a>=100?a.toFixed(0):a>=10?a.toFixed(0):a>=1?(+a.toFixed(2)).toString():(+a.toPrecision(2)).toString(); return (v<0?'−':'')+s; }
function supr(n){ const m={'-':'⁻','0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹'}; return String(n).split('').map(ch=>m[ch]||ch).join(''); }
const LCOL = ()=>[css('--orb-s'),css('--orb-p'),css('--orb-d'),css('--e1')];
const LN = ['s','p','d','f'];

// ======================= PSEUDOPOTENTIALS =======================
const PS = X.pseudo;
const PSN = {si_lda:'Si · LDA (PW92)', si_pbe:'Si · PBE', c_lda:'C · LDA (PW92)', c_pbe:'C · PBE', si_ghost:'Si con fantasma'};
const SPEC = {si_lda:{Z:14,zv:4,el:'Si',xc:'LDA'}, si_pbe:{Z:14,zv:4,el:'Si',xc:'PBE'}, c_lda:{Z:6,zv:4,el:'C',xc:'LDA'}, c_pbe:{Z:6,zv:4,el:'C',xc:'PBE'}, si_ghost:{Z:14,zv:4,el:'Si',xc:'LDA'}};
const PSS = {ps:'si_lda', l:0, ldl:0};
const shellName = (n,l)=>n+LN[l];
function trap(d,i0,i1,f){ let s=0; for(let i=i0+1;i<=i1;i++) s+=(f(d[i])+f(d[i-1]))/2*(d[i][0]-d[i-1][0]); return s; }

function psTheory(){
  const p=PS[PSS.ps], sp=SPEC[PSS.ps], ae=p.ae, core=ae.slice(0,ae.length-(sp.el==='Si'?2:2)), val=ae.slice(-2);
  const rc=p.rc[0];
  const w=p.wf['0'][0], irc=w.findIndex(r=>r[0]>rc)-1;
  const qa=trap(w,0,irc,r=>r[1]*r[1]), qp=trap(w,0,irc,r=>r[2]*r[2]);
  return `
  <h3>Qué problema resuelven</h3>
  <p>En ${sp.el} hay ${sp.Z-sp.zv} electrones de core (${core.map(s=>shellName(s[0],s[1])).join(', ')}) con energías entre <b>${fmtN(core[0][3],1)}</b> y <b>${fmtN(core[core.length-1][3],2)} Ha</b>, y ${sp.zv} de valencia a <b>${fmtN(val[0][3],3)}</b> y <b>${fmtN(val[1][3],3)} Ha</b> (gráfica 1). El enlace químico ocurre en la escala de la valencia. Pero los orbitales de valencia deben ser ortogonales al core y por eso oscilan con nodos cerca del núcleo (curva continua de la gráfica 2): describirlos exigiría una base o un cutoff enorme.</p>
  <h3>Cómo se construye</h3>
  <p>Se resuelve el átomo completo, se elige un radio de corte r<sub>c</sub> por canal l y, dentro de r<sub>c</sub>, se cambia la función real por una suave y sin nodos. Fuera de r<sub>c</sub> ambas son idénticas. Invirtiendo la ecuación radial se obtiene el potencial que produce esa función suave, y al quitarle el Hartree y el XC de la valencia queda el potencial iónico V<sub>l</sub>(r) de la gráfica 3. Fuera de r<sub>c</sub> todos los canales se juntan en −Z<sub>v</sub>/r.</p>
  <div class="eq">−½ u″ + [ l(l+1)/2r² + V<sub>l</sub><sup>scr</sup>(r) ] u = ε u &nbsp;&nbsp;⇒&nbsp;&nbsp; V<sub>l</sub><sup>scr</sup> = ε − l(l+1)/2r² + u″/2u</div>
  <h3>Conservación de la norma</h3>
  <p>La condición clave (Hamann, Schlüter y Chiang, 1979) es que la carga dentro de r<sub>c</sub> sea la misma. Con este pseudo, para el canal s: <b>${qa.toFixed(4)}</b> (real) y <b>${qp.toFixed(4)}</b> (pseudo). Esa igualdad garantiza que la derivada logarítmica coincide también al variar la energía, y eso es lo que hace al pseudo <b>transferible</b>: funciona en el sólido, no solo en el átomo.</p>
  <div class="eq">∫<sub>0</sub><sup>r<sub>c</sub></sup> |u<sup>PS</sup>|² dr = ∫<sub>0</sub><sup>r<sub>c</sub></sup> |u<sup>AE</sup>|² dr &nbsp;⇒&nbsp; ∂/∂ε (d ln u/dr)|<sub>r<sub>c</sub></sub> idéntica</div>
  <h3>Forma separable y proyectores</h3>
  <p>SIESTA y los códigos de ondas planas usan la forma de Kleinman–Bylander: un potencial local más proyectores no locales. ONCVPSP usa dos proyectores por canal, lo que mejora la transferibilidad sin endurecer el pseudo.</p>
  <div class="eq">V̂<sub>PS</sub> = V<sub>loc</sub>(r) + Σ<sub>l,i,j</sub> |β<sub>li</sub>⟩ D<sub>ij</sub> ⟨β<sub>lj</sub>|</div>
  <p>Si el potencial local está mal elegido aparecen <b>estados fantasma</b>: soluciones espurias por debajo de la valencia que no existen en el átomo real. Elige "Si con fantasma" para verlos en la derivada logarítmica y en el diagnóstico.</p>
  <h3>Corrección no lineal de core</h3>
  <p>El intercambio-correlación no es lineal en la densidad, así que E<sub>xc</sub>[ρ<sub>v</sub> + ρ<sub>c</sub>] ≠ E<sub>xc</sub>[ρ<sub>v</sub>] + E<sub>xc</sub>[ρ<sub>c</sub>]. Se guarda una carga de core parcial suave (curva punteada de la gráfica 4) que entra en V<sub>xc</sub>. Importa en magnetismo y cuando core y valencia se traslapan.</p>
  <h3>Dureza y cutoff</h3>
  <p>Un r<sub>c</sub> pequeño es más fiel pero exige más componentes de Fourier. El C (r<sub>c</sub> = 1.35 Bohr) es mucho más duro que el Si (r<sub>c</sub> = 2.70 Bohr): compáralos en la gráfica 6. En SIESTA esto se traduce en el MeshCutoff necesario; la base de orbitales es otra convergencia, independiente.</p>
  <h3>El funcional va dentro del pseudo</h3>
  <p>El pseudo se genera con un funcional y debe usarse con el mismo. Compara Si · LDA con Si · PBE: el nivel 3p cambia de ${fmtN(PS.si_lda.ae.slice(-1)[0][3],4)} a ${fmtN(PS.si_pbe.ae.slice(-1)[0][3],4)} Ha y el potencial iónico también cambia. SIESTA avisa cuando el funcional del cálculo no coincide con el del pseudo.</p>
  <h3>Formatos y bibliotecas</h3>
  <p><b>.psf</b>: potenciales semilocales (Troullier–Martins, programa ATOM), el formato clásico de SIESTA. <b>.psml</b>: XML con proyectores, potenciales semilocales y funciones de onda; lo leen SIESTA (libpsml) y otros códigos. <b>.upf/.psp8</b>: ondas planas. Bibliotecas curadas como PseudoDojo publican pseudos ONCV ya probados.</p>
  <p class="src">Hamann, Schlüter y Chiang, PRL 43, 1494 (1979) · Troullier y Martins, PRB 43, 1993 (1991) · Kleinman y Bylander, PRL 48, 1425 (1982) · Louie, Froyen y Cohen, PRB 26, 1738 (1982) · Hamann, PRB 88, 085117 (2013).</p>`;
}
function psControls(){
  const p=PS[PSS.ps], nl=Object.keys(p.wf).length;
  const mk=(id,key,n,lab)=>{ $(id).innerHTML=Array.from({length:n},(_,l)=>`<button class="tiny" data-l="${l}" aria-pressed="${PSS[key]===l}">${lab(l)}</button>`).join('');
    $(id).querySelectorAll('button').forEach(b=>b.onclick=()=>{ PSS[key]=+b.dataset.l; drawPseudo(); }); };
  if (PSS.l>=nl) PSS.l=0;
  mk('#psL','l',nl,l=>LN[l]);
  mk('#psLdL','ldl',Object.keys(p.ld).length,l=>LN[l]);
  const sp=SPEC[PSS.ps];
  $('#psChips').innerHTML=[['Z',sp.Z],['Z<sub>val</sub>',sp.zv],['XC',sp.xc],['r<sub>c</sub>',p.rc.map((r,l)=>LN[l]+' '+r.toFixed(2)).join(' · ')+' Bohr'],['proyectores','2 por canal']].map(([k,v])=>`<span class="chip">${k} <em>${v}</em></span>`).join('');
}
function drawPseudo(){
  if (current!=='pgPseudo') return;
  const p=PS[PSS.ps], sp=SPEC[PSS.ps], cols=LCOL(), acc=css('--accent'), ink=css('--ink'), muted=css('--muted'), faint=css('--faint');
  psControls();
  $('#psTheory').innerHTML=psTheory();
  // 1 levels
  levels($('#psLev'), p, sp);
  // 2 wavefunction
  const l=PSS.l, w=p.wf[String(l)][0], rc=p.rc[l]??p.rc[0];
  const irc=w.findIndex(r=>r[0]>rc)-1;
  const qa=trap(w,0,irc,r=>r[1]*r[1]), qp=trap(w,0,irc,r=>r[2]*r[2]);
  const bound = l < 2 || (sp.el==='C' && l<2);
  const ymax=Math.max(...w.map(r=>Math.max(Math.abs(r[1]),Math.abs(r[2]))))*1.12;
  chart($('#psWf'),{xlim:[0,Math.min(8,w[w.length-1][0])],ylim:[-ymax*.75,ymax],xlabel:'r (Bohr)',ylabel:'u(r) = r R(r)',shade:[0,rc,'r < r_c'],
    vlines:[{x:rc,label:'r_c = '+rc.toFixed(2),color:muted,dy:18}],hlines:[{y:0}],
    series:[{d:w.map(r=>[r[0],r[1]]),color:cols[l],width:2,label:'all-electron'},{d:w.map(r=>[r[0],r[2]]),color:acc,width:2,dash:[6,4],label:'pseudo'}],
    readEl:$('#psWfRead'), read:x=>`<span>carga dentro de r<sub>c</sub>: real <b>${qa.toFixed(4)}</b> · pseudo <b>${qp.toFixed(4)}</b></span>`+(x===null?`<span>${l<=1?'estado ligado '+shellName(sp.el==='Si'?3:2,l):'canal '+LN[l]+': estado de dispersión a ε = 0.10 Ha (no ligado en el átomo)'}</span>`:`<span>r <b>${x.toFixed(2)}</b> · AE <b>${fmtN(interp(w.map(r=>[r[0],r[1]]),x),3)}</b> · PS <b>${fmtN(interp(w.map(r=>[r[0],r[2]]),x),3)}</b></span>`)});
  // 3 potentials
  const V=p.V, nl=Object.keys(p.wf).length, zv=sp.zv;
  const vmin=Math.min(-zv/0.9, ...V.map(r=>Math.min(...r.slice(1,1+nl))))*1.05;
  const vser=[]; for(let j=0;j<nl;j++) vser.push({d:V.map(r=>[r[0],r[1+j]]),color:cols[j],width:2,label:'V_'+LN[j]});
  vser.push({d:p.Vloc.map(r=>[r[0],r[1]]),color:faint,width:1.6,dash:[2,3],label:'V_loc'});
  vser.push({d:V.filter(r=>r[0]>0.3).map(r=>[r[0],-zv/r[0]]),color:ink,width:1,dash:[5,4],label:'−Z_v/r',nohover:true});
  chart($('#psV'),{xlim:[0,5],ylim:[vmin,2],xlabel:'r (Bohr)',ylabel:'Ha',shade:[0,rc],vlines:[{x:rc,label:'r_c',color:muted}],series:vser,
    readEl:$('#psVRead'), read:x=>x===null?`<span>Dentro de r<sub>c</sub> cada canal siente un potencial distinto: eso es la no localidad. El núcleo desnudo daría −${sp.Z}/r.</span>`:`<span>r <b>${x.toFixed(2)}</b></span>`+vser.slice(0,nl).map((s,j)=>`<span>V<sub>${LN[j]}</sub> <b>${fmtN(interp(s.d,x),2)}</b></span>`).join('')+`<span>−Z<sub>v</sub>/r <b>${fmtN(-zv/x,2)}</b></span>`});
  // 4 charges
  const R=p.rho, r2=(r,j)=>[r[0],r[0]*r[0]*r[j]];
  const rmaxRho=Math.max(...R.map(r=>r[0]*r[0]*r[1]));
  const rv=R.map(r=>r2(r,1)), rcore=R.map(r=>r2(r,2)), rm=R.map(r=>r2(r,3));
  const qv=trap(R,0,R.length-1,r=>r[0]*r[0]*r[1]);
  chart($('#psRho'),{xlim:[0,5],ylim:[0,rmaxRho*1.9],xlabel:'r (Bohr)',ylabel:'4πr²ρ (e/Bohr)',vlines:[{x:rc,label:'r_c',color:muted}],
    series:[{d:rv,color:acc,width:2,label:'valencia (pseudo)'},{d:rcore,color:cols[0],width:1.6,label:'core real'},{d:rm,color:cols[2],width:2,dash:[5,4],label:'core modelo (NLCC)'}],
    readEl:$('#psRhoRead'), read:x=>`<span>∫ valencia = <b>${qv.toFixed(2)}</b> e (de ${sp.zv}; la cola más allá de 6 Bohr no está graficada)</span>`+(x===null?'':`<span>r <b>${x.toFixed(2)}</b></span>`)});
  // 5 log derivatives
  const ll=PSS.ldl, LD=p.ld[String(ll)];
  const eps=(p.ae.find(s=>s[1]===ll && s===p.ae.filter(q=>q[1]===ll).slice(-1)[0])||[])[3];
  const ldv=[]; if (eps!==undefined && ll<=1) ldv.push({x:eps,label:'ε_'+LN[ll]+' = '+eps.toFixed(3),color:muted});
  const ldy=LD.flatMap(r=>[r[1],r[2]]); chart($('#psLd'),{xlim:[LD[LD.length-1][0],LD[0][0]].sort((a,b)=>a-b),ylim:[Math.min(...ldy)-0.3,Math.max(...ldy)+0.3],xlabel:'E (Ha)',ylabel:'arctan[d ln u/dr] en r = r_c',vlines:ldv,
    series:[{d:LD.map(r=>[r[0],r[1]]).reverse(),color:cols[ll],width:2,label:'all-electron'},{d:LD.map(r=>[r[0],r[2]]).reverse(),color:acc,width:2,dash:[6,4],label:'pseudo'}],
    readEl:$('#psLdRead'), read:x=>{ if(x===null) return `<span>Si las curvas coinciden en todo el rango, el pseudo dispersa igual que el átomo real a cualquier energía: es transferible. Un salto extra en la curva del pseudo delata un estado fantasma.</span>`;
      const a=interp(LD.map(r=>[r[0],r[1]]).reverse(),x), b=interp(LD.map(r=>[r[0],r[2]]).reverse(),x); return `<span>E <b>${x.toFixed(2)} Ha</b></span><span>AE <b>${fmtN(a,3)}</b> · PS <b>${fmtN(b,3)}</b> · diferencia <b>${fmtN(b-a,3)}</b></span>`; }});
  // 6 convergence
  const cser=[], allC=[]; for (const [k,v] of Object.entries(p.conv)){ cser.push({d:v.map(r=>[r[0],r[1]*1000]),color:cols[+k],width:2,label:LN[+k]}); allC.push(...v.map(r=>r[0])); }
  const other=PS[PSS.ps.startsWith('si')?'c_lda':'si_lda'];
  for (const [k,v] of Object.entries(other.conv)) cser.push({d:v.map(r=>[r[0],r[1]*1000]),color:alpha(cols[+k],.35),width:1.2,dash:[3,3],nohover:true});
  chart($('#psConv'),{xlim:[0,Math.max(...allC,...Object.values(other.conv).flat().map(r=>r[0]))*1.05],ylim:[0.01,20],logy:true,xlabel:'cutoff de energía cinética (Ha)',ylabel:'error (mHa/e)',
    hlines:[{y:1,label:'1 mHa/e'}],series:cser,
    readEl:$('#psConvRead'), read:x=>{ const c1=Object.entries(p.conv).map(([k,v])=>{ const r=v.find(q=>q[1]<=0.001); return `<span>${LN[+k]}: 1 mHa/e a <b>${r?r[0].toFixed(1):'—'} Ha</b> (${r?(r[0]*2).toFixed(0):'—'} Ry)</span>`; }).join('');
      return c1+`<span>líneas tenues: ${PSS.ps.startsWith('si')?'C':'Si'} para comparar</span>`; }});
  // 7 tests + ghost
  const tests=p.tests;
  const desc=t=>t.rows.filter(r=>r.length>4).map(r=>shellName(r[0],r[1])+'<sup>'+(+r[2]).toString()+'</sup>').join(' ');
  let rows='';
  tests.forEach((t,i)=>{ t.rows.filter(r=>r.length>4).forEach((r,j)=>{ rows+=`<tr${i===0?' class="hl"':''}><td>${j===0?(i===0?'referencia ':'prueba '+i+' ')+'('+desc(t)+')':''}</td><td>${shellName(r[0],r[1])}</td><td>${r[3].toFixed(5)}</td><td>${r[4].toFixed(5)}</td><td class="${Math.abs(r[5])<1e-3?'good':'bad'}">${(r[5]*1000).toFixed(3)}</td><td>${j===0?(t.exc*1000).toFixed(3):''}</td></tr>`; }); });
  let ghost='';
  const gb=p.ghost.filter(s=>/GHOST/.test(s)), gp=p.ghostp.filter(s=>/GHOST/.test(s));
  if (gb.length||gp.length) ghost=`<div class="ghost"><b>Diagnóstico de ONCVPSP: ${gb.length} estados fantasma ligados y ${gp.length} localizados de energía positiva.</b> Por ejemplo, en el canal ${LN[+gb[0].split(/\s+/)[0]]} aparece un estado a ${(+gb[0].split(/\s+/)[1]).toFixed(2)} Ha que el átomo real no tiene. Un sólido calculado con este pseudo tendría bandas falsas.</div>`;
  else ghost=`<p class="note">Diagnóstico de ONCVPSP: <b>ningún estado fantasma</b> ligado ni localizado.</p>`;
  $('#psTests').innerHTML=`<div class="tblwrap"><table class="tbl"><thead><tr><th>configuración</th><th>nivel</th><th>ε real</th><th>ε pseudo</th><th>diferencia (mHa)</th><th>error de excitación (mHa)</th></tr></thead><tbody>${rows}</tbody></table></div>
   <p class="note">El pseudo se construyó en la configuración de referencia. En las de prueba se quitan electrones (iones) y el pseudo debe seguir dando los mismos niveles y las mismas diferencias de energía total que el átomo real. Errores de décimas de mHa son excelentes.</p>${ghost}`;
}
function levels(cv,p,sp){
  const {c,W,H}=setup(cv), P={l:56,r:16,t:14,b:14};
  const ae=p.ae, ncore=ae.length-2, emin=ae[0][3], ymin=Math.log10(-emin*1.4), ymax=Math.log10(0.08);
  const Y=e=>P.t+(Math.log10(-e)-ymax)/(ymin-ymax)*(H-P.t-P.b);
  const cols=LCOL(), muted=css('--muted'), line=css('--line'), ink=css('--ink'), acc=css('--accent');
  c.clearRect(0,0,W,H); c.font='11px '+css('--f-data'); c.textAlign='right'; c.textBaseline='middle';
  for (const v of [-0.1,-1,-10,-100]){ if(Math.log10(-v)>ymin) continue; const y=Y(v); c.strokeStyle=line; c.beginPath(); c.moveTo(P.l,y); c.lineTo(W-P.r,y); c.stroke(); c.fillStyle=muted; c.fillText(fmtT(v),P.l-6,y); }
  c.save(); c.translate(12,H/2); c.rotate(-Math.PI/2); c.textAlign='center'; c.font='11px '+css('--f-label'); c.fillText('ε (Ha, escala log)',0,0); c.restore();
  const colW=(W-P.l-P.r)/3, x0=P.l+colW*0.15;
  // core/valence division
  const yDiv=(Y(ae[ncore-1][3])+Y(ae[ncore][3]))/2;
  c.fillStyle=css('--gapfill'); c.fillRect(P.l,P.t,W-P.l-P.r,yDiv-P.t);
  c.fillStyle=muted; c.font='600 11px '+css('--f-label'); c.textAlign='left'; c.textBaseline='top'; c.fillText('VALENCIA (la conserva el pseudo)',P.l+6,P.t+4); c.textBaseline='bottom'; c.fillText('CORE (se elimina)',P.l+6,H-P.b-2);
  ae.forEach((s,i)=>{ const y=Y(s[3]), x=x0+colW*(s[1]===0?0.5:1.1), w=colW*0.55; c.strokeStyle=cols[s[1]]; c.lineWidth=2.5; c.beginPath(); c.moveTo(x,y); c.lineTo(x+w,y); c.stroke();
    c.fillStyle=ink; c.font='12px '+css('--f-data'); c.textAlign='left'; c.textBaseline='middle'; c.fillText(shellName(s[0],s[1])+(s[2]?'':'')+' '+fmtN(s[3],s[3]<-1?2:4),x+w+6,y); });
  // pseudo levels
  const t0=p.tests[0].rows.filter(r=>r.length>4);
  t0.forEach(r=>{ const y=Y(r[4]), x=x0+colW*(r[1]===0?0.5:1.1); c.strokeStyle=acc; c.setLineDash([3,2]); c.lineWidth=1.5; c.beginPath(); c.moveTo(x-6,y+4); c.lineTo(x+colW*0.55+2,y+4); c.stroke(); c.setLineDash([]); });
  $('#psLevNote').innerHTML=`Línea continua: niveles del átomo completo. Línea punteada azul: niveles del pseudoátomo, que solo tiene la valencia y la reproduce a menos de 10<sup>−5</sup> Ha. El core está ${Math.round(ae[0][3]/ae[ae.length-1][3])} veces más abajo que el último nivel de valencia.`;
}
document.querySelectorAll('[data-ps]').forEach(b=>b.addEventListener('click',()=>{ PSS.ps=b.dataset.ps; document.querySelectorAll('[data-ps]').forEach(o=>o.setAttribute('aria-pressed',o===b)); drawPseudo(); }));

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
  if (current!=='pgXC') return;
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

// ---------- init ----------
const redraw=()=>{ if(current==='pgPseudo') drawPseudo(); if(current==='pgXC') drawXC(); };
new ResizeObserver(()=>redraw()).observe(document.querySelector('.wrap'));
try{ matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw); }catch(e){}
new MutationObserver(redraw).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
document.fonts && document.fonts.ready.then(redraw);
const h=(location.hash||'').slice(1); const back={bandas:'pgBands',pseudos:'pgPseudo',xc:'pgXC'};
if (back[h]) go(back[h]); else go('pgBands');
})();
