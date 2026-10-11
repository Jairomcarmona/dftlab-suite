import { $, $$, css, alpha, HA, fmt, download, toast } from '../core/ui.js';
import { chart as coreChart, exportBar, interp } from '../core/chart.js';
import X from '../data/pseudo_xc.json';
import L from '../data/pseudo_lib.json';
function setup(cv){ const r=cv.getBoundingClientRect(), dpr=Math.min(window.devicePixelRatio||1,2); cv.width=Math.max(1,Math.round(r.width*dpr)); cv.height=Math.max(1,Math.round(r.height*dpr)); const c=cv.getContext('2d'); c.setTransform(dpr,0,0,dpr,0,0); return {c,W:r.width,H:r.height}; }
function fmtN(v,d){ if(!isFinite(v)) return '—'; return (v<0?'−':'')+Math.abs(v).toFixed(d); }
function fmtT(v){ const a=Math.abs(v); if(a===0) return '0'; const s=a>=10?a.toFixed(0):a>=1?(+a.toFixed(2)).toString():(+a.toPrecision(2)).toString(); return (v<0?'−':'')+s; }
const LCOL = ()=>[css('--orb-s'),css('--orb-p'),css('--orb-d'),css('--e1')];
const LN = ['s','p','d','f'];
// adapter: old cfg (shade:[x0,x1,label]) -> core chart
function chart(cv,cfg){ const c={...cfg}; if (Array.isArray(cfg.shade) && typeof cfg.shade[0]==='number') c.shade=[{x0:cfg.shade[0],x1:cfg.shade[1],label:cfg.shade[2]}]; coreChart(cv,c); }
function addExports(root){ $$('canvas[data-export]',root).forEach(cv=>{ const ph=cv.closest('.panel').querySelector('.ph'); if(!ph.querySelector('.export')) ph.append(exportBar(cv,cv.dataset.export)); }); }
// ======================= PSEUDOPOTENTIALS =======================
const PS = {...X.pseudo, ...L.ps};
const PSN = {si_lda:'Si · LDA (PW92)', si_pbe:'Si · PBE', c_lda:'C · LDA (PW92)', c_pbe:'C · PBE', si_ghost:'Si con fantasma'};
const SPEC = {si_lda:{Z:14,el:'Si',xc:'LDA',val:[[3,0,2],[3,1,2]]}, si_pbe:{Z:14,el:'Si',xc:'PBE',val:[[3,0,2],[3,1,2]]}, c_lda:{Z:6,el:'C',xc:'LDA',val:[[2,0,2],[2,1,2]]}, c_pbe:{Z:6,el:'C',xc:'PBE',val:[[2,0,2],[2,1,2]]}, si_ghost:{Z:14,el:'Si',xc:'LDA',val:[[3,0,2],[3,1,2]]}};
const ZOF={H:1,Li:3,B:5,C:6,N:7,O:8,F:9,Na:11,Mg:12,Al:13,Si:14,P:15,S:16,Cl:17,K:19,Ca:20,Ti:22,Fe:26,Ni:28,Cu:29,Zn:30,Ga:31,Ge:32,As:33,Se:34,Sr:38,Zr:40,Mo:42,Ag:47,Au:79};
const parseVal=v=>v.split(/\s+/).map(t=>{ const m=t.match(/^(\d)([spdf])([\d.]+)$/); return [+m[1],'spdf'.indexOf(m[2]),+m[3]]; });
for (const [el,info] of Object.entries(L.elements)) for (const xc of ['lda','pbe']) SPEC[el+'_'+xc]={Z:ZOF[el],el,xc:xc==='lda'?'LDA (PZ)':'PBE',val:parseVal(info.valence),info,lib:true};
for (const k in SPEC) SPEC[k].zv=Math.round(SPEC[k].val.reduce((a,v)=>a+v[2],0)*100)/100;
const PSS = {ps:'si_lda', st:0, ldl:0, xc:'pbe'};
const shellName = (n,l)=>n+LN[l];
const isVal=(sp,st)=>sp.val.some(v=>v[0]===st[0]&&v[1]===st[1]);
// wavefunction sets of ONCVPSP, labelled with the valence shell they belong to (semicore first, then valence; unbound = scattering)
function states(k){ const p=PS[k], sp=SPEC[k], out=[];
  for (const l of Object.keys(p.wf).map(Number).sort((a,b)=>a-b)){ const vl=sp.val.filter(v=>v[1]===l).sort((a,b)=>a[0]-b[0]);
    p.wf[String(l)].forEach((w,i)=>out.push({l,i,w,label:vl[i]?shellName(vl[i][0],l):LN[l]+' (dispersión)',bound:!!vl[i]})); }
  return out; }
function trap(d,i0,i1,f){ let s=0; for(let i=i0+1;i<=i1;i++) s+=(f(d[i])+f(d[i-1]))/2*(d[i][0]-d[i-1][0]); return s; }

function psTheory(){
  const p=PS[PSS.ps], sp=SPEC[PSS.ps], ae=p.ae, core=ae.filter(s=>!isVal(sp,s)), val=ae.filter(s=>isVal(sp,s));
  const rc=p.rc[0];
  const w=p.wf['0'].slice(-1)[0], irc=w.findIndex(r=>r[0]>rc)-1;
  const qa=trap(w,0,irc,r=>r[1]*r[1]), qp=trap(w,0,irc,r=>r[2]*r[2]);
  return `
  <h3>Qué problema resuelven</h3>
  <p>${core.length?`En ${sp.el} hay ${Math.round(sp.Z-sp.zv)} electrones de core (${core.map(s=>shellName(s[0],s[1])).join(', ')}) con energías entre <b>${fmtN(core[0][3],1)}</b> y <b>${fmtN(core[core.length-1][3],2)} Ha</b>, y ${sp.zv} en la valencia del pseudo (${val.map(s=>shellName(s[0],s[1])+' a <b>'+fmtN(s[3],3)+'</b>').join(', ')} Ha) (gráfica 1).`:`El H no tiene core: su pseudo solo suaviza el −1/r del núcleo, y el ahorro está en el cutoff.`}${sp.info&&sp.info.semicore.length?` Los niveles ${sp.info.semicore.join(' y ')} son <b>semicore</b>: están hondos pero se traslapan con la valencia, así que se dejan en el pseudo para que sea transferible.`:''} El enlace químico ocurre en la escala de la valencia. Pero los orbitales de valencia deben ser ortogonales al core y por eso oscilan con nodos cerca del núcleo (curva continua de la gráfica 2): describirlos exigiría una base o un cutoff enorme.</p>
  <h3>Cómo se construye</h3>
  <p>Se resuelve el átomo completo, se elige un radio de corte r<sub>c</sub> por canal l y, dentro de r<sub>c</sub>, se cambia la función real por una suave y sin nodos. Fuera de r<sub>c</sub> ambas son idénticas. Invirtiendo la ecuación radial se obtiene el potencial que produce esa función suave, y al quitarle el Hartree y el XC de la valencia queda el potencial iónico V<sub>l</sub>(r) de la gráfica 3. Fuera de r<sub>c</sub> todos los canales se juntan en −Z<sub>v</sub>/r.</p>
  <div class="eq">−½ u″ + [ l(l+1)/2r² + V<sub>l</sub><sup>scr</sup>(r) ] u = ε u &nbsp;&nbsp;⇒&nbsp;&nbsp; V<sub>l</sub><sup>scr</sup> = ε − l(l+1)/2r² + u″/2u</div>
  <h3>Conservación de la norma</h3>
  <p>La condición clave (Hamann, Schlüter y Chiang, 1979) es que la carga dentro de r<sub>c</sub> sea la misma. Con este pseudo, para el canal s: <b>${qa.toFixed(4)}</b> (real) y <b>${qp.toFixed(4)}</b> (pseudo). (Para el último nivel s de valencia.) Esa igualdad garantiza que la derivada logarítmica coincide también al variar la energía, y eso es lo que hace al pseudo <b>transferible</b>: funciona en el sólido, no solo en el átomo.</p>
  <div class="eq">∫<sub>0</sub><sup>r<sub>c</sub></sup> |u<sup>PS</sup>|² dr = ∫<sub>0</sub><sup>r<sub>c</sub></sup> |u<sup>AE</sup>|² dr &nbsp;⇒&nbsp; ∂/∂ε (d ln u/dr)|<sub>r<sub>c</sub></sub> idéntica</div>
  <h3>Forma separable y proyectores</h3>
  <p>SIESTA y los códigos de ondas planas usan la forma de Kleinman–Bylander: un potencial local más proyectores no locales. ONCVPSP usa dos proyectores por canal, lo que mejora la transferibilidad sin endurecer el pseudo.</p>
  <div class="eq">V̂<sub>PS</sub> = V<sub>loc</sub>(r) + Σ<sub>l,i,j</sub> |β<sub>li</sub>⟩ D<sub>ij</sub> ⟨β<sub>lj</sub>|</div>
  <p>Si el potencial local está mal elegido aparecen <b>estados fantasma</b>: soluciones espurias por debajo de la valencia que no existen en el átomo real. Elige "Si con fantasma" para verlos en la derivada logarítmica y en el diagnóstico.</p>
  <h3>Corrección no lineal de core</h3>
  <p>El intercambio-correlación no es lineal en la densidad, así que E<sub>xc</sub>[ρ<sub>v</sub> + ρ<sub>c</sub>] ≠ E<sub>xc</sub>[ρ<sub>v</sub>] + E<sub>xc</sub>[ρ<sub>c</sub>]. Se guarda una carga de core parcial suave (curva punteada de la gráfica 4) que entra en V<sub>xc</sub>. Importa en magnetismo y cuando core y valencia se traslapan.</p>
  <h3>Dureza y cutoff</h3>
  <p>Un r<sub>c</sub> pequeño es más fiel pero exige más componentes de Fourier. El C (r<sub>c</sub> ≈ 1.3 Bohr) es mucho más duro que el Si (r<sub>c</sub> = 2.70 Bohr): compáralos en la gráfica 6. En la biblioteca los más duros son Zn, F y Ni (≈ 46 Ha, 400 Ry de MeshCutoff) y los más blandos Se, Al, Si y As (≤ 12 Ha). En SIESTA esto se traduce en el MeshCutoff necesario; la base de orbitales es otra convergencia, independiente.</p>
  <h3>El funcional va dentro del pseudo</h3>
  <p>El pseudo se genera con un funcional y debe usarse con el mismo. Compara Si · LDA con Si · PBE: el nivel 3p cambia de ${fmtN(PS.si_lda.ae.slice(-1)[0][3],4)} a ${fmtN(PS.si_pbe.ae.slice(-1)[0][3],4)} Ha y el potencial iónico también cambia. SIESTA avisa cuando el funcional del cálculo no coincide con el del pseudo.</p>
  <h3>Formatos y bibliotecas</h3>
  <p><b>.psf</b>: potenciales semilocales (Troullier–Martins, programa ATOM), el formato clásico de SIESTA. <b>.psml</b>: XML con proyectores, potenciales semilocales y funciones de onda; lo leen SIESTA (libpsml) y otros códigos. <b>.upf/.psp8</b>: ondas planas. Bibliotecas curadas como PseudoDojo publican pseudos ONCV ya probados.</p>
  <p class="src">Hamann, Schlüter y Chiang, PRL 43, 1494 (1979) · Troullier y Martins, PRB 43, 1993 (1991) · Kleinman y Bylander, PRL 48, 1425 (1982) · Louie, Froyen y Cohen, PRB 26, 1738 (1982) · Hamann, PRB 88, 085117 (2013).</p>`;
}
function psControls(){
  const p=PS[PSS.ps], ST=states(PSS.ps);
  if (PSS.st>=ST.length) PSS.st=0;
  $('#psL').innerHTML=ST.map((t,i)=>`<button class="tiny" data-i="${i}" aria-pressed="${PSS.st===i}">${t.label}</button>`).join('');
  $('#psL').querySelectorAll('button').forEach(b=>b.onclick=()=>{ PSS.st=+b.dataset.i; drawPseudo(); });
  const nld=Object.keys(p.ld).length; if (PSS.ldl>=nld) PSS.ldl=0;
  $('#psLdL').innerHTML=Array.from({length:nld},(_,l)=>`<button class="tiny" data-l="${l}" aria-pressed="${PSS.ldl===l}">${LN[l]}</button>`).join('');
  $('#psLdL').querySelectorAll('button').forEach(b=>b.onclick=()=>{ PSS.ldl=+b.dataset.l; drawPseudo(); });
  const sp=SPEC[PSS.ps], I=sp.info;
  const chips=[['',sp.el+' · '+(PSN[PSS.ps]?PSN[PSS.ps].split(' · ')[1]:sp.xc)],['Z',sp.Z],['Z<sub>val</sub>',sp.zv],['r<sub>c</sub>',p.rc.map((r,l)=>LN[l]+' '+r.toFixed(2)).join(' · ')+' Bohr'],['proyectores','2 por canal']];
  if (I) chips.push(['semicore',I.semicore.length?I.semicore.join(' '):'no'],['NLCC',I.nlcc?'sí':'no'],['MeshCutoff sugerido',I.mesh_cutoff_Ry+' Ry']);
  $('#psChips').innerHTML=chips.map(([k,v])=>`<span class="chip">${k} <em>${v}</em></span>`).join('');
  $$('[data-ps]').forEach(o=>o.setAttribute('aria-pressed',o.dataset.ps===PSS.ps));
  $$('#ptab [data-el]').forEach(o=>o.setAttribute('aria-pressed',PSS.ps===o.dataset.el+'_'+PSS.xc));
}
function drawPseudo(){
  const p=PS[PSS.ps], sp=SPEC[PSS.ps], cols=LCOL(), acc=css('--accent'), ink=css('--ink'), muted=css('--muted'), faint=css('--faint');
  psControls();
  $('#psTheory').innerHTML=psTheory();
  libInfo();
  // 1 levels
  levels($('#psLev'), p, sp);
  // 2 wavefunction
  const ST=states(PSS.ps), cur=ST[PSS.st], l=cur.l, w=cur.w, rc=p.rc[l]??p.rc[0];
  const irc=Math.max(1,w.findIndex(r=>r[0]>rc)-1);
  const qa=trap(w,0,irc,r=>r[1]*r[1]), qp=trap(w,0,irc,r=>r[2]*r[2]);
  const ymax=Math.max(...w.map(r=>Math.max(Math.abs(r[1]),Math.abs(r[2]))))*1.12;
  chart($('#psWf'),{xlim:[0,Math.min(8,w[w.length-1][0])],ylim:[-ymax*.75,ymax],xlabel:'r (Bohr)',ylabel:'u(r) = r R(r)',shade:[0,rc,'r < r_c'],
    vlines:[{x:rc,label:'r_c = '+rc.toFixed(2),color:muted,dy:18}],hlines:[{y:0}],
    series:[{d:w.map(r=>[r[0],r[1]]),color:cols[l],width:2,label:'all-electron'},{d:w.map(r=>[r[0],r[2]]),color:acc,width:2,dash:[6,4],label:'pseudo'}],
    readEl:$('#psWfRead'), read:x=>`<span>carga dentro de r<sub>c</sub>: real <b>${qa.toFixed(4)}</b> · pseudo <b>${qp.toFixed(4)}</b></span>`+(x===null?`<span>${cur.bound?'estado ligado '+cur.label+(sp.info&&sp.info.semicore.includes(cur.label)?' (semicore)':''):'canal '+LN[l]+': estado de dispersión (no ligado en el átomo)'}</span>`:`<span>r <b>${x.toFixed(2)}</b> · AE <b>${fmtN(interp(w.map(r=>[r[0],r[1]]),x),3)}</b> · PS <b>${fmtN(interp(w.map(r=>[r[0],r[2]]),x),3)}</b></span>`)});
  // 3 potentials
  const V=p.V, nl=Math.min(p.rc.length,V[0].length-1), zv=sp.zv;
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
  const ldv=[]; if (eps!==undefined && sp.val.some(v=>v[1]===ll)) ldv.push({x:eps,label:'ε_'+LN[ll]+' = '+eps.toFixed(3),color:muted});
  const ldy=LD.flatMap(r=>[r[1],r[2]]); chart($('#psLd'),{xlim:[LD[LD.length-1][0],LD[0][0]].sort((a,b)=>a-b),ylim:[Math.min(...ldy)-0.3,Math.max(...ldy)+0.3],xlabel:'E (Ha)',ylabel:'arctan[d ln u/dr] en r = r_c',vlines:ldv,
    series:[{d:LD.map(r=>[r[0],r[1]]).reverse(),color:cols[ll],width:2,label:'all-electron'},{d:LD.map(r=>[r[0],r[2]]).reverse(),color:acc,width:2,dash:[6,4],label:'pseudo'}],
    readEl:$('#psLdRead'), read:x=>{ if(x===null) return `<span>Si las curvas coinciden en todo el rango, el pseudo dispersa igual que el átomo real a cualquier energía: es transferible. Un salto extra en la curva del pseudo delata un estado fantasma.</span>`;
      const a=interp(LD.map(r=>[r[0],r[1]]).reverse(),x), b=interp(LD.map(r=>[r[0],r[2]]).reverse(),x); return `<span>E <b>${x.toFixed(2)} Ha</b></span><span>AE <b>${fmtN(a,3)}</b> · PS <b>${fmtN(b,3)}</b> · diferencia <b>${fmtN(b-a,3)}</b></span>`; }});
  // 6 convergence
  const cser=[], allC=[]; for (const [k,v] of Object.entries(p.conv)){ cser.push({d:v.map(r=>[r[0],r[1]*1000]),color:cols[+k],width:2,label:LN[+k]}); allC.push(...v.map(r=>r[0])); }
  const other=PS[sp.el==='Si'?'c_lda':'si_lda'];
  for (const [k,v] of Object.entries(other.conv)) cser.push({d:v.map(r=>[r[0],r[1]*1000]),color:alpha(cols[+k],.35),width:1.2,dash:[3,3],nohover:true});
  chart($('#psConv'),{xlim:[0,Math.max(...allC,...Object.values(other.conv).flat().map(r=>r[0]))*1.05],ylim:[0.01,20],logy:true,xlabel:'cutoff de energía cinética (Ha)',ylabel:'error (mHa/e)',
    hlines:[{y:1,label:'1 mHa/e'}],series:cser,
    readEl:$('#psConvRead'), read:x=>{ const c1=Object.entries(p.conv).map(([k,v])=>{ const r=v.find(q=>q[1]<=0.001); return `<span>${LN[+k]}: 1 mHa/e a <b>${r?r[0].toFixed(1):'—'} Ha</b> (${r?(r[0]*2).toFixed(0):'—'} Ry)</span>`; }).join('');
      return c1+`<span>líneas tenues: ${sp.el==='Si'?'C':'Si'} para comparar</span>`; }});
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
async function gunzip64(b64){ const bin=Uint8Array.from(atob(b64),c=>c.charCodeAt(0)); const ds=new DecompressionStream('gzip'); return await new Response(new Blob([bin]).stream().pipeThrough(ds)).text(); }
function libInfo(){
  const sp=SPEC[PSS.ps], el=$('#libInfo');
  if(!sp.lib){ el.innerHTML=`<p class="note">Elige un elemento para ver su pseudo de la biblioteca. Los cinco botones de arriba son los pseudos de Si y C con los que se explican los conceptos (incluido uno con fantasma).</p>`; return; }
  const I=sp.info, x=PSS.xc;
  el.innerHTML=`<dl class="kv"><dt>Valencia del pseudo</dt><dd>${I.valence}${I.semicore.length?' (semicore '+I.semicore.join(', ')+')':''}</dd>
    <dt>r<sub>c</sub> por canal</dt><dd>${I.rc.map((r,l)=>LN[l]+' '+r.toFixed(2)).join(' · ')} Bohr</dd>
    <dt>Potencial local</dt><dd>polinomio, r<sub>c</sub>(5) = ${I.loc[2]} Bohr${I.loc[3]?', dvloc0 = '+I.loc[3]+' Ha':''}</dd>
    <dt>Corrección de core</dt><dd>${I.nlcc?'sí (icmod '+I.core[0]+')':'no'}</dd>
    <dt>Error máximo en las pruebas</dt><dd>${I.maxerr_mHa[x].toFixed(2)} mHa (valencia ${I.maxerr_valence_mHa[x].toFixed(2)} mHa)</dd>
    <dt>Fantasmas</dt><dd>ninguno (ligados ni de energía positiva)</dd>
    <dt>MeshCutoff sugerido</dt><dd>${I.mesh_cutoff_Ry} Ry (1 mHa/e a ${I.ecut_1mHa_Ha} Ha)</dd></dl>
    <div class="btnrow"><button class="tiny" id="dlPsml">descargar ${sp.el}.psml (${x.toUpperCase()})</button></div>
    <p class="note">En SIESTA: guarda el archivo como <code>${sp.el}.psml</code> junto al .fdf, usa <code>${sp.el}</code> como etiqueta de especie y ${x==='lda'?'<code>XC.functional LDA</code> + <code>XC.authors CA</code>':'<code>XC.functional GGA</code> + <code>XC.authors PBE</code>'}. Para metales 3d usa <code>PAO.EnergyShift</code> de 20–50 meV: con 100 meV los orbitales quedan demasiado confinados (ver gráfica 8).</p>`;
  $('#dlPsml').onclick=async()=>{ try{ const t=await gunzip64(PS[PSS.ps].psml); download(new Blob([t],{type:'application/xml'}),sp.el+'.psml'); }catch(e){ toast('No se pudo descomprimir: '+e.message); } };
}
function drawVal(){
  const V=L.validation; if(!V||!V.length){ $('#valPanel').hidden=true; return; }
  const mats=V.map(v=>v.material), cols=[css('--orb-s'),css('--orb-d')];
  const pts=[]; V.forEach((v,i)=>['lda','pbe'].forEach((x,j)=>{ const r=v[x]; if(r&&isFinite(r.err)) pts.push({x:i+(j?0.12:-0.12),y:r.err,color:cols[j],r:4}); }));
  const ys=pts.map(p=>p.y);
  coreChart($('#psVal'),{xlim:[-0.6,mats.length-0.4],ylim:[Math.min(-5,...ys)-0.5,Math.max(3,...ys)+0.5],xticks:mats.map((m,i)=>({x:i,label:m})),ylabel:'a₀ − a_exp (%)',hlines:[{y:0}],
    shade:[{y0:-2,y1:0,color:alpha(cols[0],0.08)},{y0:0,y1:1.5,color:alpha(cols[1],0.08)}],points:pts,
    series:[{d:[[-9,-9]],color:cols[0],label:'LDA'},{d:[[-9,-9]],color:cols[1],label:'PBE'}],legend:true,nohover:true});
  $('#psValRead').innerHTML='<span>Bandas tenues: lo típico en la literatura de ondas planas (LDA de −1 a −2 %, PBE de 0 a +1.5 %).</span>';
  const f=(r,k,d)=>r&&r[k]!=null&&isFinite(r[k])?fmt(r[k],d):'—';
  $('#psValTbl').innerHTML=`<table class="tbl"><thead style="text-transform:none"><tr><th>material</th><th>a exp (Å)</th><th>a₀ LDA (Å)</th><th>a₀ PBE (Å)</th><th>B₀ LDA (GPa)</th><th>B₀ PBE (GPa)</th><th>B exp (GPa)</th></tr></thead><tbody>${V.map(v=>`<tr><td>${v.material}</td><td>${v.aexp}</td><td>${f(v.lda,'a0',3)} <span class="${Math.abs(v.lda?.err)>3?'bad':''}">(${f(v.lda,'err',1)}%)</span></td><td>${f(v.pbe,'a0',3)} <span class="${Math.abs(v.pbe?.err)>3?'bad':''}">(${f(v.pbe,'err',1)}%)</span></td><td>${f(v.lda,'B0',0)}</td><td>${f(v.pbe,'B0',0)}</td><td>${v.Bexp}</td></tr>`).join('')}</tbody></table>`;
  $('#psValNote').innerHTML=L.validationNote||'';
}
function levels(cv,p,sp){ // columns by l; shaded = what the pseudo keeps
  const {c,W,H}=setup(cv), P={l:56,r:16,t:14,b:14};
  const ae=p.ae, valS=ae.filter(s=>isVal(sp,s)), coreS=ae.filter(s=>!isVal(sp,s)), emin=Math.min(...ae.map(s=>s[3])), ymin=Math.log10(-emin*1.4), ymax=Math.log10(0.08);
  const Y=e=>P.t+(Math.log10(-e)-ymax)/(ymin-ymax)*(H-P.t-P.b);
  const cols=LCOL(), muted=css('--muted'), line=css('--line'), ink=css('--ink'), acc=css('--accent');
  c.clearRect(0,0,W,H); c.font='11px '+css('--f-data'); c.textAlign='right'; c.textBaseline='middle';
  for (const v of [-0.1,-1,-10,-100]){ if(Math.log10(-v)>ymin) continue; const y=Y(v); c.strokeStyle=line; c.beginPath(); c.moveTo(P.l,y); c.lineTo(W-P.r,y); c.stroke(); c.fillStyle=muted; c.fillText(fmtT(v),P.l-6,y); }
  c.save(); c.translate(12,H/2); c.rotate(-Math.PI/2); c.textAlign='center'; c.font='11px '+css('--f-label'); c.fillText('ε (Ha, escala log)',0,0); c.restore();
  const nlc=Math.max(...ae.map(s=>s[1]))+1, colW=(W-P.l-P.r)/Math.max(2,nlc), x0=P.l+colW*0.08;
  // core/valence division
  const yDiv=coreS.length?(Y(Math.max(...coreS.map(s=>s[3])))+Y(Math.min(...valS.map(s=>s[3]))))/2:H-P.b;
  c.fillStyle=css('--gapfill'); c.fillRect(P.l,P.t,W-P.l-P.r,yDiv-P.t);
  c.fillStyle=muted; c.font='600 11px '+css('--f-label'); c.textAlign='left'; c.textBaseline='top'; c.fillText('VALENCIA (la conserva el pseudo)',P.l+6,P.t+4); c.textBaseline='bottom'; c.textAlign='right'; c.fillText('CORE (se elimina)',W-P.r-6,H-P.b-2); c.textAlign='left';
  ae.forEach((s,i)=>{ const y=Y(s[3]), x=x0+colW*s[1], w=colW*0.3; c.strokeStyle=cols[s[1]]; c.lineWidth=2.5; c.beginPath(); c.moveTo(x,y); c.lineTo(x+w,y); c.stroke();
    c.fillStyle=ink; c.font='12px '+css('--f-data'); c.textAlign='left'; c.textBaseline='middle'; c.fillText(shellName(s[0],s[1])+' '+fmtN(s[3],s[3]<-10?1:s[3]<-1?2:3),x+w+4,y); });
  // pseudo levels
  const t0=p.tests[0].rows.filter(r=>r.length>4);
  t0.forEach(r=>{ const y=Y(r[4]), x=x0+colW*r[1]; c.strokeStyle=acc; c.setLineDash([3,2]); c.lineWidth=1.5; c.beginPath(); c.moveTo(x-4,y+4); c.lineTo(x+colW*0.3+2,y+4); c.stroke(); c.setLineDash([]); });
  $('#psLevNote').innerHTML=`Línea continua: niveles del átomo completo. Línea punteada azul: niveles del pseudoátomo, que solo tiene la valencia y la reproduce a menos de 10<sup>−5</sup> Ha. ${coreS.length?`El nivel más hondo está ${Math.round(emin/Math.max(...valS.map(s=>s[3])))} veces más abajo que el último nivel de valencia.`:''}`;
}

export function mount(root, view){
  root.innerHTML=`
  <div class="pghead">
    <div>
      <div class="kicker">Aprender · 2</div><h1>Pseudopotenciales</h1>
      <p class="lede">Los electrones del core casi no participan en el enlace, pero obligan a usar funciones con muchos nodos cerca del núcleo. El pseudopotencial los quita y deja un problema suave que reproduce exactamente al átomo real fuera de un radio de corte r<sub>c</sub>. Todo lo que ves aquí sale de pseudos generados con ONCVPSP (versión con salida PSML del proyecto SIESTA) y se puede usar tal cual en SIESTA.</p>
    </div>
    <div class="pgctl">
      <span class="ctl-lbl">Pseudopotencial</span>
      <div class="seg" role="group" aria-label="Pseudopotencial" id="psSel">
        <button data-ps="si_lda" aria-pressed="true">Si · LDA</button><button data-ps="si_pbe" aria-pressed="false">Si · PBE</button><button data-ps="c_lda" aria-pressed="false">C · LDA</button><button data-ps="c_pbe" aria-pressed="false">C · PBE</button><button data-ps="si_ghost" aria-pressed="false" class="warnbtn">Si con fantasma</button>
      </div>
      <div class="chips" id="psChips"></div>
    </div>
  </div>
  <div class="pgrid">
    <article class="panel theory" id="psTheory"></article>
    <div class="charts">
      <section class="panel wide" id="libPanel"><div class="ph"><h2>Biblioteca de DFT Lab · 30 elementos</h2><div class="seg" id="xcLib"><button data-v="lda">LDA</button><button data-v="pbe">PBE</button></div></div>
        <div class="pb"><div class="ptab" id="ptab"></div><div id="libInfo"></div></div></section>
      <section class="panel"><div class="ph"><h2>1 · Niveles del átomo real</h2><span class="sub">all-electron, Ha</span></div><div class="pb"><canvas id="psLev" style="height:290px"></canvas><p class="note" id="psLevNote"></p></div></section>
      <section class="panel"><div class="ph"><h2>2 · Función de onda real vs pseudo</h2><div class="btnrow" id="psL"></div></div><div class="pb"><canvas data-export="pseudo_funcion_onda" id="psWf" style="height:290px"></canvas><div class="readout" id="psWfRead"></div></div></section>
      <section class="panel"><div class="ph"><h2>3 · Potencial iónico por canal</h2><span class="sub">V<sub>l</sub>(r), Ha</span></div><div class="pb"><canvas data-export="pseudo_potenciales" id="psV" style="height:290px"></canvas><div class="readout" id="psVRead"></div></div></section>
      <section class="panel"><div class="ph"><h2>4 · Cargas y corrección de core</h2><span class="sub">4πr²ρ(r)</span></div><div class="pb"><canvas data-export="pseudo_cargas" id="psRho" style="height:290px"></canvas><div class="readout" id="psRhoRead"></div></div></section>
      <section class="panel"><div class="ph"><h2>5 · Transferibilidad: derivada logarítmica</h2><div class="btnrow" id="psLdL"></div></div><div class="pb"><canvas data-export="pseudo_derivada_log" id="psLd" style="height:290px"></canvas><div class="readout" id="psLdRead"></div></div></section>
      <section class="panel"><div class="ph"><h2>6 · Dureza: error contra el cutoff</h2><span class="sub">mHa / electrón</span></div><div class="pb"><canvas data-export="pseudo_cutoff" id="psConv" style="height:290px"></canvas><div class="readout" id="psConvRead"></div></div></section>
      <section class="panel wide"><div class="ph"><h2>7 · Prueba de transferibilidad: otras configuraciones</h2><span class="sub">ε all-electron vs pseudo, Ha</span></div><div class="pb" id="psTests"></div></section>
      <section class="panel wide" id="valPanel"><div class="ph"><h2>8 · Validación en sólidos con SIESTA</h2></div>
        <div class="pb"><canvas data-export="pseudos_validacion_a0" id="psVal" style="height:300px"></canvas><div class="readout" id="psValRead"></div><div class="tblwrap" id="psValTbl"></div>
        <p class="note" id="psValNote"></p></div></section>
    </div>
  </div><footer class="prov">Pseudos generados con ONCVPSP 3.3.1 + PSML (gitlab.com/siesta-project/ecosystem/oncvpsp), escalares-relativistas, dos proyectores por canal. Cada curva es una columna del archivo de salida. Los 60 archivos .psml, las entradas .dat y las salidas completas están en <code>app/dftlab/data/pseudos/</code>; el LDA es Ceperley–Alder con la parametrización de Perdew–Zunger (<code>XC.authors CA</code>). El pseudo \"con fantasma\" es la entrada de ejemplo de ONCVPSP para enseñar qué es un estado fantasma: no se debe usar.</footer>`;
  document.querySelectorAll('[data-ps]').forEach(b=>b.addEventListener('click',()=>{ PSS.ps=b.dataset.ps; PSS.st=0; drawPseudo(); }));
  const POS={H:[1,1],Li:[2,1],B:[2,13],C:[2,14],N:[2,15],O:[2,16],F:[2,17],Na:[3,1],Mg:[3,2],Al:[3,13],Si:[3,14],P:[3,15],S:[3,16],Cl:[3,17],K:[4,1],Ca:[4,2],Ti:[4,4],Fe:[4,8],Ni:[4,10],Cu:[4,11],Zn:[4,12],Ga:[4,13],Ge:[4,14],As:[4,15],Se:[4,16],Sr:[5,2],Zr:[5,4],Mo:[5,6],Ag:[5,11],Au:[6,11]};
  $('#ptab').innerHTML=Object.keys(L.elements).map(el=>`<button data-el="${el}" style="grid-row:${POS[el][0]};grid-column:${POS[el][1]}" title="${el}: ${L.elements[el].valence}">${el}</button>`).join('');
  $$('#ptab [data-el]').forEach(b=>b.onclick=()=>{ PSS.ps=b.dataset.el+'_'+PSS.xc; PSS.st=0; drawPseudo(); });
  $$('#xcLib button').forEach(b=>b.onclick=()=>{ PSS.xc=b.dataset.v; $$('#xcLib button').forEach(o=>o.setAttribute('aria-pressed',o===b)); if(SPEC[PSS.ps].lib){ PSS.ps=SPEC[PSS.ps].el+'_'+PSS.xc; } drawPseudo(); });
  $$('#xcLib button').forEach(o=>o.setAttribute('aria-pressed',o.dataset.v===PSS.xc));
  drawVal();


  addExports(root); view.onTheme(()=>drawPseudo()); drawPseudo();
}
