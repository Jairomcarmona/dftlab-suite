// Postproceso: drop SIESTA output files, get plots, tables and exports. Nothing is executed; files are only read.
import { $, $$, css, alpha, esc, fmt, download, downloadText, seg, toast } from '../core/ui.js';
import { chart, exportBar } from '../core/chart.js';
import { bandEdges, analyzeGap, computeDOS, groupPDOS, sumPDOS, integratePDOS, opticalSpectrum, toPlain, packBands, packDOS, packStructure, packContents, planarAverage, gridIntegral } from '../siesta/index.js';
import { createFileSet } from '../siesta/runset.js';
import { writeStructure } from '../crystal/formats.js';
import { cartToFrac, formula, analyze, isMoyoReady, initMoyo, cellParameters, volume } from '../crystal/symmetry.js';
import { atomicNumber, symbolOf } from '../crystal/elements.js';
import { createViewer, drawStructure } from '../core/three-view.js';
import { cellScene } from '../core/scene.js';
import EX from '../data/examples.json';

const KIND_NAME = { out:'salida principal', fdf:'entrada fdf', bands:'bandas', eig:'autovalores', kp:'puntos k', 'pdos-kp':'puntos k PDOS', pdos:'PDOS', 'pdos-text':'PDOS (texto)', dos:'DOS', epsimg:'ε₂ óptica', 'epsimg-contrib':'ε₂ por transición',
  'ion-xml':'base (.ion.xml)', ion:'base (.ion)', psf:'pseudo psf', psml:'pseudo psml', mde:'MD energías', ani:'trayectoria', fa:'fuerzas', xv:'geometría XV', struct:'geometría STRUCT', 'dftlab-pack':'paquete DFT Lab', grid:'malla 3D (binaria)', fc:'constantes de fuerza', live:'hook Lua (live.jsonl)', unknown:'no reconocido' };

const H = html => ({ html }); // marca HTML de plantilla de confianza; el resto de valores de la tabla se escapa
let V3 = null;
export function destroy(){ if (V3){ V3.destroy(); V3=null; } }

async function gunzipB64(b64){
  const bin=Uint8Array.from(atob(b64), c=>c.charCodeAt(0));
  const ds=new DecompressionStream('gzip'); const txt=await new Response(new Blob([bin]).stream().pipeThrough(ds)).text(); return JSON.parse(txt);
}
async function sha256(content){ try{ const h=await crypto.subtle.digest('SHA-256', typeof content==='string'?new TextEncoder().encode(content):content); return [...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,'0')).join(''); }catch(e){ return ''; } }

export function mount(root, view){
  const FS = createFileSet(), F = FS.files; // {name, size, content (texto o bytes de malla), kind, data, error, link, hash}
  root.innerHTML=`
  <div class="pghead"><div>
    <div class="kicker">Postproceso</div><h1>Tus cálculos de SIESTA</h1>
    <p class="lede">Arrastra aquí los archivos de una corrida hecha en tu laptop o en el cluster: el <code>.out</code>, <code>.bands</code>, <code>.PDOS</code>, <code>.EIG</code>/<code>.KP</code>, <code>.EPSIMG</code>, <code>.XV</code>, <code>.MDE</code>, <code>.ion.xml</code>, pseudos, mallas <code>.RHO</code>/<code>.VH</code>, paquetes <code>.dftlab.json</code> o el <code>live.jsonl</code> del hook Lua. Todo se lee en tu navegador; nada se sube a ningún servidor. Cada gráfica se exporta a SVG, PNG o CSV y la geometría a CIF, XYZ, POSCAR o fdf.</p>
  </div></div>
  <section class="panel"><div class="pb">
    <label class="drop" id="drop"><input type="file" id="fileIn" multiple hidden>
      <b>Suelta archivos aquí</b> o haz clic para elegirlos<br><span class="tiny-t">Puedes mezclar archivos de varias corridas; se agrupan por SystemLabel.</span></label>
    <div class="btnrow" style="margin-top:10px"><span class="note" style="margin:0">Sin archivos a mano:</span><button class="tiny" id="exFe">ejemplo: Fe bcc con espín</button><button class="tiny" id="exRelax">ejemplo: relajación de Si₈</button><button class="tiny" id="clearAll" hidden>quitar todo</button><button class="tiny" id="repMd" hidden>exportar informe</button><button class="tiny" id="repJson" hidden>exportar datos (JSON)</button></div>
    <div class="tblwrap" style="margin-top:10px"><table class="tbl" id="fileTab"></table></div>
  </div></section>
  <div class="charts" id="ppOut" style="margin-top:12px"></div>
  <footer class="prov">Lectores de DFT Lab para SIESTA 4.1–5.x (carpeta siesta/), probados con 341 comprobaciones contra sisl y numpy sobre corridas reales de Si, Fe con espín, Fe con espín-órbita, relajación y dinámica molecular. Las mallas binarias (.RHO, .DRHO, .VH, .VT…) se leen directamente; .TSHS, .HSX y .WFSX se convierten antes con <code>scripts/dftlab_pack.py</code>.</footer>`;

  const drop=$('#drop',root), inp=$('#fileIn',root);
  drop.addEventListener('dragover',e=>{ e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave',()=>drop.classList.remove('over'));
  drop.addEventListener('drop',e=>{ e.preventDefault(); drop.classList.remove('over'); addFiles([...e.dataTransfer.files]); });
  inp.addEventListener('change',()=>{ addFiles([...inp.files]); inp.value=''; });
  $('#exFe',root).onclick=async()=>loadExample('fe'); $('#exRelax',root).onclick=async()=>loadExample('relax');
  $('#clearAll',root).onclick=()=>{ FS.clear(); refresh(); };

  async function loadExample(k){ const d=await gunzipB64(EX[k]); await addItems(Object.entries(d).map(([name,text])=>({name, content:text}))); }
  async function addFiles(files){
    const big=files.filter(f=>f.size>80e6); if(big.length) toast('Se omitieron archivos de más de 80 MB: '+big.map(f=>f.name).join(', '));
    // bytes originales: el conjunto de archivos decide texto (lectores textuales) o bytes (mallas binarias)
    const items=await Promise.all(files.filter(f=>f.size<=80e6).map(async f=>({name:f.name, content:await f.arrayBuffer()})));
    await addItems(items);
  }
  async function addItems(items){
    for (const it of items){ it.size=typeof it.content==='string'?new TextEncoder().encode(it.content).length:it.content.byteLength; it.hash=await sha256(it.content); }
    await FS.add(items);   // relee y vuelve a enlazar .EIG/.KP sea cual sea el orden de carga
    if (!view.alive) return;   // la lectura terminó después de abandonar la vista: no crear visores ni paneles
    refresh();
  }
  function label(f){ return f.name.replace(/\.(out|fdf|bands|EIG|KP|PDOS\.xml|PDOS|DOS|EPSIMG|XV|STRUCT_OUT|MDE|ANI|FA|ion\.xml|ion|jsonl|log|dftlab\.json|RHO|DRHO|RHOXC|BADER|TOTAL_CHARGE|VH|VT|VNA|VXC|LDOS|IORHO)$/i,''); }
  // Qué se ve de cada archivo en esta pantalla: distingue «leído» de «visualizado».
  function shown(f, geoSrc){
    const pd=get('pdos').length>0;
    switch(f.kind){
      case 'out': return f.name===geoSrc?'resumen, gráficas y geometría':'resumen y gráficas';
      case 'bands': case 'pdos': case 'epsimg': case 'mde': case 'live': case 'ion-xml': case 'ion': case 'psf': case 'psml': case 'grid': return 'visualizado';
      case 'eig': return (pd?'leído; la DOS se muestra desde la PDOS':'DOS visualizada')+' · pesos y k: '+(f.link?.kp?f.link.kp:'uniformes (sin .KP)');
      case 'kp': return f.link?.usedBy?.length?'pesos y k para '+f.link.usedBy.join(', '):'sin .EIG con la misma etiqueta';
      case 'fdf': return get('out').some(g=>label(g)===label(f))?'usado en el resumen':'leído; sin gráfica en esta pantalla';
      case 'xv': case 'struct': return f.name===geoSrc?'geometría visualizada':'leído; se muestra la geometría de '+geoSrc;
      case 'dftlab-pack': { const c=packContents(f.data), on=[c.bands&&'bandas',c.dos&&'DOS',c.structure&&(f.name===geoSrc?'estructura':null),c.gap&&'gap'].filter(Boolean);
        return (on.length?'visualizado: '+on.join(', '):'nada visualizable')+(c.extras.length?' · no se visualiza en esta pantalla: '+c.extras.map(x=>x.label).join('; '):''); }
      default: return 'leído; sin gráfica en esta pantalla';
    }
  }
  function fileTable(geoSrc){
    const st=f=>f.error?{c:'--bad',t:f.error}:!f.data?{c:'--bad',t:'sin lector'}:{c:f.link?.note?'--warn':'--ok',t:shown(f,geoSrc)+(f.link?.note?' · '+f.link.note:'')};
    $('#fileTab',root).innerHTML=F.length?`<thead><tr><th>Archivo</th><th>tipo</th><th>tamaño</th><th>estado</th><th></th></tr></thead><tbody>${F.map((f,i)=>{ const s2=st(f); return `<tr><td>${esc(f.name)}</td><td>${esc(KIND_NAME[f.kind]||f.kind)}</td><td>${(f.size/1024).toFixed(1)} KB</td><td style="color:${css(s2.c)};white-space:normal;min-width:24ch" data-status="${esc(f.name)}">${esc(s2.t)}</td><td><button class="tiny" data-rm="${i}">quitar</button></td></tr>`; }).join('')}</tbody>`:'';
    $$('[data-rm]',root).forEach(b=>b.onclick=()=>{ FS.removeAt(+b.dataset.rm); refresh(); });
    ['#clearAll','#repMd','#repJson'].forEach(s=>$(s,root).hidden=!F.length);
  }
  const get=FS.get;
  const panel=(id,title,tools='',wide=true)=>`<section class="panel${wide?' wide':''}" id="${id}"><div class="ph"><h2>${title}</h2><div class="btnrow">${tools}</div></div><div class="pb"></div></section>`;
  const body=id=>$('#'+id+' .pb',root);
  const addExp=()=>$$('#ppOut canvas[data-export]',root).forEach(cv=>{ const ph=cv.closest('.panel').querySelector('.ph .btnrow'); if(!ph.querySelector('.export')) ph.append(exportBar(cv,cv.dataset.export)); });

  // ---------- panels ----------
  function summary(f){
    const o=f.data, fe=o.finalEnergy||{}, fin=o.final||{};
    const fdfF=F.find(g=>g.kind==='fdf'&&g.data&&label(g)===label(f)); const fk=k=>{ const key=String(k).toLowerCase().replace(/[._-]/g,''); return (o.fdf?.keys?.[key]||fdfF?.data?.keys?.[key])?.value; };
    const xcS=[o.input?.xcFunctional||fk('XC.functional'),o.input?.xcAuthors||fk('XC.authors')].filter(Boolean).join(' ')||o.species?.[0]?.xc||'—';
    const basS=o.input?.basisSize||fk('PAO.BasisSize')||(o.species||[]).map(s=>s.label+': '+(s.basis||[]).map(b=>b.state+'×'+(b.zetas?.length||1)).join(' ')).join('; ')||'—';
    const kv=[['Programa',o.program?.version||'—'],['SystemLabel',o.systemLabel||label(f)],['Terminó',o.run?.completed?'sí (Job completed)':H('<b style="color:var(--bad)">no</b>')],
      ['XC',xcS],['Base',basS],['Espín',o.spin?.config||'—'],
      ['Átomos / orbitales',`${o.nAtoms??'—'} / ${o.nOrbitals??'—'}`],['Electrones',o.nElectrons??'—'],['MeshCutoff usado',o.mesh?.cutoffUsed?`${fmt(o.mesh.cutoffUsed,1)} Ry, malla ${o.mesh.mesh?.join('×')}`:'—'],
      ['Malla k',o.kgrid?.supercell?o.kgrid.supercell.map((r,i)=>r[i]).join('×')+` (${o.kgrid.nk??'?'} puntos)`:'—'],['Temperatura electrónica',o.electronicTemperature?`${o.electronicTemperature.value} ${o.electronicTemperature.unit}`:'—'],
      ['Pasos de geometría',o.nSteps??1],['SCF',fin.scfConverged===false?H('<b style="color:var(--bad)">no convergió</b>'):`${o.scf?.length??0} iteraciones en total`],
      ['E total',fin.etot!=null?H(`<b>${fmt(fin.etot,6)} eV</b>`):'—'],['Energía libre',fin.freeEnergy!=null?`${fmt(fin.freeEnergy,6)} eV`:'—'],['Nivel de Fermi',o.fermi!=null?`${fmt(o.fermi,4)} eV`:'—'],
      ['Fuerza máxima',fin.maxForce!=null?`${fmt(fin.maxForce,4)} eV/Å`:'—'],['Presión',fin.pressureKbar!=null?`${fmt(fin.pressureKbar,3)} kbar`:'—'],
      ['Momento de espín',o.spinMoment?H(`${fmt(o.spinMoment.abs,3)} μ<sub>B</sub>`):'—'],['Tiempo total',o.timers?.wallTime?`${fmt(o.timers.wallTime,1)} s`:'—']];
    const dec=Object.entries(fe).filter(([k,v])=>isFinite(v)&&Math.abs(v)>1e-9&&k!=='Fermi');
    const warn=(o.warnings||[]).slice(0,6);
    return `<dl class="kv two">${kv.map(([k,v])=>`<dt>${k}</dt><dd>${v&&v.html!=null?v.html:esc(v)}</dd>`).join('')}</dl>
      ${dec.length?`<h3 style="margin-top:12px">Energía final por términos</h3><div class="tblwrap"><table class="tbl"><tbody>${dec.map(([k,v])=>`<tr${k==='Total'?' class="hl"':''}><td>${esc(k)}</td><td>${fmt(v,6)} eV</td></tr>`).join('')}</tbody></table></div>`:''}
      ${warn.length?`<div class="callout warn" style="margin-top:10px">${warn.map(w=>esc(w.text)).join('<br>')}</div>`:''}`;
  }
  function drawScf(id,o){
    const rows=o.scf||[]; if(!rows.length) return;
    const pick=k=>rows.map((r,i)=>[i+1,Math.max(Math.abs(r[k]),1e-9)]).filter(p=>isFinite(p[1]));
    const bounds=[]; rows.forEach((r,i)=>{ if(i&&r.step!==rows[i-1].step) bounds.push({x:i+0.5,dash:[2,3]}); });
    const series=[{d:pick('dHmax'),color:css('--accent'),width:1.8,label:'dH máx (eV)'},{d:pick('dDmax'),color:css('--orb-d'),width:1.6,label:'dDM máx'}].filter(s=>s.d.length);
    const ys=series.flatMap(s=>s.d.map(p=>p[1]));
    chart($('#cv_'+id,root),{xlim:[1,Math.max(rows.length,2)],ylim:[Math.max(1e-8,Math.min(...ys)/3),Math.max(...ys)*3],logy:true,xlabel:'iteración SCF (acumulada)',ylabel:'cambio máximo',series,legend:true,vlines:bounds,
      read:x=>{ if(x==null) return bounds.length?'Las líneas verticales separan pasos de geometría.':'Pasa el cursor sobre las curvas.'; const r=rows[Math.round(x)-1]; return r?`<span>paso <b>${r.step??1}</b> it <b>${r.iscf}</b></span><span>E_KS <b>${fmt(r.E_KS,5)}</b></span><span>dH <b>${(r.dHmax??NaN).toExponential(2)}</b></span><span>dDM <b>${(r.dDmax??NaN).toExponential(2)}</b></span>`:''; },readEl:$('#rd_'+id,root)});
  }
  function drawTraj(id,o){
    const t=o.trajectory||[]; if(t.length<2) return;
    const e0=t[t.length-1].eKS;
    chart($('#cv_'+id,root),{xlim:[1,t.length],ylim:(()=>{ const v=t.map(s=>(s.eKS-e0)*1000); const lo=Math.min(...v), hi=Math.max(...v); return [lo-(hi-lo)*0.08-0.1,hi+(hi-lo)*0.08+0.1]; })(),xlabel:'paso de geometría',ylabel:'E_KS − E_final (meV)',legend:true,
      series:[{d:t.map((s,i)=>[i+1,(s.eKS-e0)*1000]),color:css('--accent'),width:2,label:'energía'}],points:t.map((s,i)=>({x:i+1,y:(s.eKS-e0)*1000,color:css('--accent'),r:3})),
      read:x=>{ if(x==null) return 'Energía y fuerza máxima en cada paso.'; const s=t[Math.round(x)-1]; return s?`<span>paso <b>${Math.round(x)}</b></span><span>E_KS <b>${fmt(s.eKS,5)} eV</b></span><span>F máx <b>${fmt(s.maxForce,4)} eV/Å</b></span><span>SCF <b>${s.scfIterations}</b> it</span>`:''; },readEl:$('#rd_'+id,root)});
    const c2=$('#cv2_'+id,root); if(c2){ const fm=t.map((s,i)=>[i+1,Math.max(s.maxForce,1e-5)]);
      chart(c2,{xlim:[1,t.length],ylim:[Math.min(...fm.map(p=>p[1]))/3,Math.max(...fm.map(p=>p[1]))*3],logy:true,xlabel:'paso de geometría',ylabel:'fuerza máxima (eV/Å)',series:[{d:fm,color:css('--orb-d'),width:2,label:'F máx'}],points:fm.map(p=>({x:p[0],y:p[1],color:css('--orb-d'),r:3})),hlines:[{y:0.04,dash:[3,3],label:'MD.MaxForceTol por defecto'}],legend:false,nohover:true}); }
  }
  function drawBands(id,b,ef){
    const E0=ef??b.fermi, st=S.bands; const x=Array.from(b.x);
    const cols=[css('--up'),css('--dn')];
    const series=[]; b.bands.forEach((sp,s)=>sp.forEach(band=>series.push({d:x.map((xx,i)=>[xx,band[i]-E0]),color:b.nSpin>1?cols[s]:css('--accent'),width:1.4,nohover:true})));
    const ed=bandEdges(b);
    const ticks=b.labels.map(l=>({x:l.x,label:l.label}));
    chart($('#cv_'+id,root),{xlim:[x[0],x[x.length-1]],ylim:[st.emin,st.emax],xlabel:'',ylabel:'E − E_F (eV)',series,xticks:ticks,vlines:ticks.map(t=>({x:t.x,color:css('--line')})),hlines:[{y:0,dash:[4,3],label:'E_F'}],legend:false,
      csv:()=>{ let s='# '+b.bands.length+' spin channel(s); x (1/Ang), E-EF (eV) per band\nx,'+b.bands.flatMap((sp,si)=>sp.map((_,j)=>`s${si+1}b${j+1}`)).join(',')+'\n'; for(let i=0;i<x.length;i++) s+=x[i]+','+b.bands.flatMap(sp=>sp.map(bd=>(bd[i]-E0).toFixed(5))).join(',')+'\n'; return s; },
      read:(xx,yy)=>{ if(xx==null) return ed.metallic?'Metal: bandas cruzan E_F.':`gap ${fmt(ed.gap,3)} eV, ${ed.direct?'directo':'indirecto'}`; return `<span>k <b>${fmt(xx,3)} Å⁻¹</b></span><span>E − E_F <b>${fmt(yy,3)} eV</b></span>`; },readEl:$('#rd_'+id,root)});
  }
  function drawPdos(id,p){
    const mode=S.pdosMode, groups=groupPDOS(p, mode==='total'?[]:mode.split('+'), 'total'), E=Array.from(p.energy), ef=p.fermi;
    const spin=p.components.length===2 && S.pdosSpin;
    const pal=[css('--accent'),css('--orb-s'),css('--orb-p'),css('--orb-d'),css('--orb-f'),css('--up'),css('--dn'),css('--warn')];
    let series=[];
    if (spin){ const gu=groupPDOS(p, mode==='total'?[]:mode.split('+'), 'up'), gd=groupPDOS(p, mode==='total'?[]:mode.split('+'), 'down');
      gu.forEach((g,i)=>series.push({d:E.map((e,j)=>[e-ef,g.data[j]]),color:pal[i%8],width:1.6,label:g.label+' ↑',fill:0,fillAlpha:0.06}));
      gd.forEach((g,i)=>series.push({d:E.map((e,j)=>[e-ef,-gd[i].data[j]]),color:pal[i%8],width:1.6,dash:[4,2],label:g.label+' ↓'}));
    } else groups.forEach((g,i)=>series.push({d:E.map((e,j)=>[e-ef,g.data[j]]),color:pal[i%8],width:1.7,label:g.label||'total',fill:0,fillAlpha:0.06}));
    const ymax=Math.max(...series.flatMap(s=>s.d.map(q=>Math.abs(q[1]))))*1.08;
    const ints=groups.map(g=>({label:g.label||'total', q:integratePDOS(p,g.data,ef)}));
    chart($('#cv_'+id,root),{xlim:[S.bands.emin,S.bands.emax],ylim:spin?[-ymax,ymax]:[0,ymax],xlabel:'E − E_F (eV)',ylabel:'estados/eV',series,legend:true,vlines:[{x:0,dash:[4,3],label:'E_F'}],hlines:spin?[{y:0}]:[],
      read:x=>{ if(x==null) return 'Electrones hasta E_F: '+ints.map(i=>`<span>${esc(i.label)} <b>${fmt(i.q,3)}</b></span>`).join(''); return series.slice(0,8).map(s=>{ const pt=s.d.reduce((b,q)=>Math.abs(q[0]-x)<Math.abs(b[0]-x)?q:b,s.d[0]); return `<span><span class="sw" style="background:${s.color}"></span>${esc(s.label)} <b>${fmt(pt[1],2)}</b></span>`; }).join(''); },readEl:$('#rd_'+id,root)});
  }
  function drawEigDos(id,e,link){
    const d=computeDOS(e,{sigma:0.1,de:0.01}); const ef=e.fermi; const E=Array.from(d.energy);
    chart($('#cv_'+id,root),{xlim:[S.bands.emin,S.bands.emax],ylim:[0,Math.max(...d.total)*1.05],xlabel:'E − E_F (eV)',ylabel:'estados/eV/celda',legend:true,vlines:[{x:0,dash:[4,3],label:'E_F'}],
      series:d.dos.length>1?d.dos.map((c,s)=>({d:E.map((x,i)=>[x-ef,c[i]]),color:[css('--up'),css('--dn')][s],width:1.7,label:['espín ↑','espín ↓'][s]})):[{d:E.map((x,i)=>[x-ef,d.total[i]]),color:css('--accent'),width:1.8,label:'DOS (σ = 0.1 eV)',fill:0,fillAlpha:0.08}],nohover:true});
    const g=analyzeGap(e); $('#rd_'+id,root).innerHTML=`<span>${g.type==='metal'?'metal':`gap <b>${fmt(g.gap,3)} eV</b> ${g.type==='direct'?'directo':'indirecto'}`}</span><span>${e.nk} puntos k, ${e.nBands} bandas</span><span>electrones bajo E_F <b>${fmt(d.electronsBelowFermi,3)}</b></span><span>pesos <b>${esc(link?.weights||'uniformes (1/nk)')}</b></span>`;
  }
  function drawOpt(id,eps){
    const sp=opticalSpectrum(eps), q=S.opt, E=Array.from(sp.energy);
    const Q={eps:[['eps2','ε₂',css('--accent')],['eps1','ε₁ (Kramers–Kronig)',css('--orb-d')]],nk:[['n','n',css('--accent')],['k','κ',css('--orb-d')]],abs:[['absorption','α (1/cm)',css('--accent')]],refl:[['reflectivity','R',css('--accent')]],eels:[['eels','−Im 1/ε',css('--accent')]]}[q];
    const series=Q.map(([k,l,c])=>({d:E.map((x,i)=>[x,sp[k][i]]).filter(p=>isFinite(p[1])),color:c,width:1.8,label:l}));
    const ys=series.flatMap(s=>s.d.filter(p=>p[0]>0.3).map(p=>p[1])); const lo=Math.min(0,...ys), hi=Math.max(...ys)*1.05;
    chart($('#cv_'+id,root),{xlim:[0,Math.min(E[E.length-1],25)],ylim:[lo,hi],xlabel:'ħω (eV)',ylabel:Q[0][1],series,legend:true,hlines:[{y:0}],nohover:false,
      read:x=>x==null?`f-sum: ${eps.fsumRule?.map(v=>fmt(v,3)).join(', ')||'—'}`:series.map(s=>{ const p=s.d.reduce((b,q)=>Math.abs(q[0]-x)<Math.abs(b[0]-x)?q:b,s.d[0]); return `<span>${s.label} <b>${fmt(p[1],3)}</b></span>`; }).join('')+`<span>ħω <b>${fmt(x,2)} eV</b></span>`,readEl:$('#rd_'+id,root)});
  }
  function drawPackDos(id,D){
    const E=Array.from(D.energy,e=>e-D.fermi), pal=[css('--orb-s'),css('--orb-p'),css('--orb-d'),css('--orb-f')];
    let series;
    if(D.nChannels===2) series=D.total.map((c,s)=>({d:E.map((x,i)=>[x,s?-c[i]:c[i]]),color:[css('--up'),css('--dn')][s],width:1.7,label:['espín ↑','espín ↓ (negativo)'][s]}));
    else series=[{d:E.map((x,i)=>[x,D.total[0][i]]),color:css('--accent'),width:1.8,label:'total',fill:0,fillAlpha:0.08},...(D.byL?D.byL.names.map((n,g)=>({d:E.map((x,i)=>[x,D.byL.data[0][g][i]]),color:pal[g%4],width:1.4,label:n})):[])];
    const ys=series.flatMap(s=>s.d.map(p=>p[1])), hi=Math.max(...ys)*1.05, lo=Math.min(0,...ys)*1.05;
    chart($('#cv_'+id,root),{xlim:[S.bands.emin,S.bands.emax],ylim:[lo,hi||1],xlabel:'E − E_F (eV)',ylabel:'estados/eV/celda',series,legend:true,vlines:[{x:0,dash:[4,3],label:'E_F'}],hlines:D.nChannels===2?[{y:0}]:[],nohover:true});
    $('#rd_'+id,root).textContent=`DOS del paquete: σ = ${D.sigma} eV, malla MP ${(D.mp||[]).join('×')} (${D.nk} puntos k); electrones bajo E_F ${D.electronsBelowFermi}.`;
  }
  function drawGrid(id,g,axis){
    const avg=planarAverage(g,axis,0,1), ys=avg.map(p=>p[1]), lo=Math.min(...ys), hi=Math.max(...ys), pad=(hi-lo)*0.08||Math.abs(hi)*0.1||1;
    chart($('#cv_'+id,root),{xlim:[0,Math.hypot(...g.cell[axis])],ylim:[lo-pad,hi+pad],xlabel:`posición a lo largo de ${'abc'[axis]} (Å)`,ylabel:`promedio planar (${g.units})`,series:[{d:avg,color:css('--accent'),width:2,label:'promedio planar'}],legend:false,nohover:true});
  }
  function drawMde(id,m){
    const c=m.columns, n=c.step.length; const keys=[['temperature','T (K)',css('--warn')],['eKS','E_KS (eV)',css('--accent')],['eTot','E_tot (eV)',css('--orb-d')]].filter(k=>c[k[0]]);
    let k=keys.find(x=>x[0]===S.mde)||keys[0]; if(k[0]==='temperature'&&Array.from(c.temperature).every(v=>v===0)&&keys.length>1) k=keys[1]; const d=Array.from(c.step).map((s,i)=>[s,c[k[0]][i]]); const ys=d.map(p=>p[1]); const lo=Math.min(...ys), hi=Math.max(...ys), pd=(hi-lo)*0.1||1;
    chart($('#cv_'+id,root),{xlim:[d[0][0],d[n-1][0]||1],ylim:[lo-pd,hi+pd],xlabel:'paso',ylabel:k[1],series:[{d,color:k[2],width:2,label:k[1]}],legend:false,nohover:true});
  }
  function drawLive(id,L){
    const last=L[L.length-1]; const K=[['Etot','E_KS'],['Eharris','Harris'],['Ekin','T_s'],['Exc','E_xc'],['Ebs','E banda']].filter(k=>last[k[0]]!=null);
    const pal=[css('--accent'),css('--orb-d'),css('--up'),css('--orb-p'),css('--orb-s')];
    const series=K.map(([k,n],i)=>({d:L.map(r=>[r.it,r[k]-last[k]]),color:pal[i],width:i?1.6:2.2,label:n}));
    const ys=series.flatMap(s=>s.d.map(p=>p[1])); const A=Math.max(...ys.map(Math.abs))*1.05||1;
    chart($('#cv_'+id,root),{xlim:[L[0].it,Math.max(last.it,L[0].it+1)],ylim:[-A,A],xlabel:'iteración SCF',ylabel:'E − E_final (eV)',series,legend:true,
      read:x=>{ if(x==null) return `${L.length} iteraciones registradas`; const r=L.find(q=>q.it===Math.round(x)); return r?K.map(([k,n])=>`<span>${n} <b>${fmt(r[k],5)}</b></span>`).join('')+`<span>w <b>${r.w}</b></span>`:''; },readEl:$('#rd_'+id,root)});
  }
  function drawIon(id,ion){
    const pal=[css('--orb-s'),css('--orb-p'),css('--orb-d'),css('--orb-f')];
    const series=ion.orbitals.map(o=>({d:Array.from(o.r).map((r,i)=>[r,o.R[i]]).filter((p,i)=>i%3===0),color:pal[o.l],width:2,dash:[[],[6,3],[2,2]][(o.z||1)-1]||[],label:`${o.n}${'spdf'[o.l]} ζ${o.z}${o.polarized?' pol':''} · r_c ${fmt(o.cutoff,2)}`}));
    chart($('#cv_'+id,root),{xlim:[0,Math.max(...ion.orbitals.map(o=>o.cutoff))*1.05],ylim:[Math.min(-0.2,...series.flatMap(s=>s.d.map(p=>p[1])))*1.1,Math.max(...series.flatMap(s=>s.d.map(p=>p[1])))*1.1],xlabel:'r (Bohr)',ylabel:'R(r)',series,legend:true,hlines:[{y:0}],nohover:true});
  }
  function drawPseudo(id,ps){
    const pal=[css('--orb-s'),css('--orb-p'),css('--orb-d'),css('--orb-f')];
    let pots=[]; if(ps.format==='psf') pots=ps.semilocal.down.map(p=>({l:p.l,r:ps.grid.r,V:p.V})); else pots=(ps.semilocal[0]?.potentials||[]).map(p=>({l:p.l,r:p.r||ps.grid.r,V:p.V}));
    const series=pots.map(p=>({d:Array.from(p.r).map((r,i)=>[r,p.V[i]]).filter((q,i)=>i%2===0&&q[0]<=6&&q[0]>0.01),color:pal[p.l],width:2,label:'V_'+'spdf'[p.l]+' (Ry)'}));
    chart($('#cv_'+id,root),{xlim:[0,6],ylim:[Math.max(-30,Math.min(...series.flatMap(s=>s.d.map(p=>p[1])))),Math.min(10,Math.max(2,...series.flatMap(s=>s.d.map(p=>p[1]))))],xlabel:'r (Bohr)',ylabel:'V_l(r) (Ry)',series,legend:true,hlines:[{y:0}],nohover:true});
  }

  // geometry from the best available source
  function geometry(){
    const xv=get('xv')[0], st=get('struct')[0], out=get('out')[0];
    let cell=null, src='', file='';
    if (xv){ const d=xv.data; cell={lattice:d.cell, positions:cartToFrac(d.cell,d.positions), numbers:Array.from(d.Z)}; src=file=xv.name; }
    else if (st){ const d=st.data; cell={lattice:d.cell, positions:d.fractional, numbers:Array.from(d.Z)}; src=file=st.name; }
    else if (out && out.data.cell && (out.data.finalCoordinates||out.data.initialGeometry)){ const o=out.data, g=o.finalCoordinates||o.initialGeometry;
      const pos=g.positions||g.coords; const sp=(o.species||[]); const Z=(g.species||[]).map(s=>{ const S2=sp.find(q=>q.index===s||q.label===s); return S2?S2.Z:atomicNumber(String(s)); });
      if(pos&&Z.length===pos.length&&Z.every(z=>z>0)){ cell={lattice:o.cell, positions:cartToFrac(o.cell,pos), numbers:Z}; src=out.name+' (coordenadas finales)'; file=out.name; } }
    if (!cell){ const pk=get('dftlab-pack').find(f=>packStructure(f.data)); if(pk){ cell=packStructure(pk.data); src=file=pk.name; } }
    return cell?{cell,src,file}:null;
  }

  const S={bands:{emin:-8,emax:6}, pdosMode:'species+l', pdosSpin:true, opt:'eps', mde:'temperature'};
  function refresh(){
    destroy();
    const geo=geometry(); fileTable(geo?.file);
    const out=$('#ppOut',root); let h='';
    const outs=get('out'), bands=get('bands'), pd=get('pdos'), eig=get('eig'), eps=get('epsimg'), mde=get('mde'), live=get('live'), ions=[...get('ion-xml'),...get('ion')], pss=[...get('psf'),...get('psml')], grids=get('grid');
    const packs=get('dftlab-pack').map(f=>({f, B:packBands(f.data), D:packDOS(f.data), C:packContents(f.data)}));
    outs.forEach((f,i)=>{ h+=panel('sum'+i,`Resumen · ${esc(f.data.systemLabel||label(f))}`);
      if(f.data.scf?.length) h+=panel('scf'+i,'Convergencia SCF','',false).replace('<div class="pb"></div>',`<div class="pb"><canvas data-export="${esc(label(f))}_scf" id="cv_scf${i}" style="height:250px"></canvas><div class="readout" id="rd_scf${i}"></div></div>`);
      if((f.data.trajectory||[]).length>1) h+=panel('tr'+i,'Trayectoria de la geometría','',false).replace('<div class="pb"></div>',`<div class="pb"><canvas data-export="${esc(label(f))}_trayectoria" id="cv_tr${i}" style="height:220px"></canvas><canvas data-export="${esc(label(f))}_fuerza" id="cv2_tr${i}" style="height:180px;margin-top:8px"></canvas><div class="readout" id="rd_tr${i}"></div></div>`);
      const mul=f.data.populations?.mulliken; if(mul?.atoms?.length) h+=panel('mul'+i,'Poblaciones de Mulliken','',false).replace('<div class="pb"></div>',`<div class="pb"><div class="tblwrap" style="max-height:300px;overflow:auto"><table class="tbl"><thead><tr><th>átomo</th><th>especie</th>${mul.columns.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${mul.atoms.map(a=>`<tr><td>${a.atom}</td><td>${esc(a.species??'')}</td>${mul.columns.map(c=>`<td>${fmt(a[c],3)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`);
    });
    const energyTools=`<label class="sl">E mín <input type="number" id="eMin" value="${S.bands.emin}" step="1" style="width:7ch"></label><label class="sl">E máx <input type="number" id="eMax" value="${S.bands.emax}" step="1" style="width:7ch"></label>`;
    bands.forEach((f,i)=>{ h+=panel('bd'+i,`Bandas · ${esc(f.name)}`,i===0?energyTools:'').replace('<div class="pb"></div>',`<div class="pb"><canvas data-export="${esc(label(f))}_bandas" id="cv_bd${i}" style="height:340px"></canvas><div class="readout" id="rd_bd${i}"></div></div>`); });
    pd.forEach((f,i)=>{ const two=f.data.components.length===2; h+=panel('pd'+i,`PDOS · ${esc(f.name)}`,`<div class="seg" id="pdMode${i}"><button data-v="species+l">especie y l</button><button data-v="species">especie</button><button data-v="l">l</button><button data-v="atom">átomo</button><button data-v="total">total</button></div>${two?'<button class="tiny" id="pdSpin'+i+'">↑↓ separados</button>':''}`).replace('<div class="pb"></div>',`<div class="pb"><canvas data-export="${esc(label(f))}_pdos" id="cv_pd${i}" style="height:320px"></canvas><div class="readout" id="rd_pd${i}"></div></div>`); });
    if(!pd.length) eig.forEach((f,i)=>{ h+=panel('eg'+i,`DOS a partir de ${esc(f.name)}`,'',false).replace('<div class="pb"></div>',`<div class="pb"><canvas data-export="${esc(label(f))}_dos" id="cv_eg${i}" style="height:260px"></canvas><div class="readout" id="rd_eg${i}"></div></div>`); });
    eps.forEach((f,i)=>{ h+=panel('op'+i,`Óptica · ${esc(f.name)}`,`<div class="seg" id="opSel${i}"><button data-v="eps">ε₁, ε₂</button><button data-v="nk">n, κ</button><button data-v="abs">absorción</button><button data-v="refl">reflectividad</button><button data-v="eels">pérdida</button></div>`).replace('<div class="pb"></div>',`<div class="pb"><canvas data-export="${esc(label(f))}_optica" id="cv_op${i}" style="height:280px"></canvas><div class="readout" id="rd_op${i}"></div><p class="note">ε₁ se obtiene de ε₂ por Kramers–Kronig hasta la energía máxima del archivo; en metales falta la parte de Drude, que SIESTA no incluye en ε₂.</p></div>`); });
    mde.forEach((f,i)=>{ h+=panel('md'+i,`Dinámica · ${esc(f.name)}`,`<div class="seg" id="mdSel${i}"><button data-v="temperature">T</button><button data-v="eKS">E_KS</button><button data-v="eTot">E total</button></div>`,false).replace('<div class="pb"></div>',`<div class="pb"><canvas data-export="${esc(label(f))}_md" id="cv_md${i}" style="height:240px"></canvas></div>`); });
    live.forEach((f,i)=>{ h+=panel('lv'+i,`Hook Lua · ${esc(f.name)}`,'',true).replace('<div class="pb"></div>',`<div class="pb"><canvas data-export="${esc(label(f))}_lua" id="cv_lv${i}" style="height:260px"></canvas><div class="readout" id="rd_lv${i}"></div></div>`); });
    ions.forEach((f,i)=>{ h+=panel('io'+i,`Base · ${esc(f.name)}`,'',false).replace('<div class="pb"></div>',`<div class="pb"><canvas data-export="${esc(label(f))}_orbitales" id="cv_io${i}" style="height:250px"></canvas></div>`); });
    pss.forEach((f,i)=>{ h+=panel('ps'+i,`Pseudopotencial · ${esc(f.name)}`,'',false).replace('<div class="pb"></div>',`<div class="pb"><canvas data-export="${esc(label(f))}_pseudo" id="cv_ps${i}" style="height:250px"></canvas></div>`); });
    packs.forEach(({f,B,D,C},i)=>{
      if(B) h+=panel('pb'+i,`Bandas · ${esc(f.name)}`,!bands.length&&i===0?energyTools:'').replace('<div class="pb"></div>',`<div class="pb"><canvas data-export="${esc(label(f))}_bandas" id="cv_pb${i}" style="height:340px"></canvas><div class="readout" id="rd_pb${i}"></div></div>`);
      if(D) h+=panel('pk'+i,`DOS · ${esc(f.name)}`,'',false).replace('<div class="pb"></div>',`<div class="pb"><canvas data-export="${esc(label(f))}_dos" id="cv_pk${i}" style="height:260px"></canvas><div class="readout" id="rd_pk${i}"></div></div>`);
      const gp=f.data.gap, src=f.data.source||{};
      h+=panel('pi'+i,`Paquete · ${esc(f.name)}`,'',false).replace('<div class="pb"></div>',`<div class="pb"><dl class="kv"><dt>origen</dt><dd>${esc([src.systemLabel,src.hamiltonian].filter(Boolean).join(' · ')||'—')}</dd><dt>generador</dt><dd>${esc(f.data.generator||'—')}</dd><dt>espín</dt><dd>${esc(f.data.spin?.kind||'—')}</dd><dt>E_F</dt><dd>${fmt(f.data.fermi,4)} eV</dd><dt>gap</dt><dd>${gp?(gp.metallic?'metal':`${fmt(gp.gap,3)} eV, ${gp.type==='direct'?'directo':'indirecto'}`)+(gp.source?' ('+esc(gp.source)+')':''):'—'}</dd></dl>${C.extras.length?`<p class="note" data-pack-missing>Esta pantalla todavía no visualiza: ${esc(C.extras.map(x=>x.label).join('; '))}. Los datos están en el archivo y en «exportar datos».</p>`:''}${!B||!D?`<p class="note">El paquete no trae ${[!B&&'bandas',!D&&'DOS'].filter(Boolean).join(' ni ')} utilizables.</p>`:''}</div>`);
    });
    grids.forEach((f,i)=>{ const g=f.data; h+=panel('gr'+i,`Malla · ${esc(f.name)}`,`<div class="seg" id="grAx${i}"><button data-v="0">a</button><button data-v="1">b</button><button data-v="2">c</button></div>`,false).replace('<div class="pb"></div>',`<div class="pb"><dl class="kv"><dt>malla</dt><dd>${g.mesh.join(' × ')}${g.nspin>1?` · ${g.nspin} espines (se muestra el primero)`:''}</dd><dt>celda a, b, c</dt><dd>${g.cell.map(v=>fmt(Math.hypot(...v),3)).join(', ')} Å</dd><dt>volumen</dt><dd>${fmt(g.volume,2)} Å³</dd><dt>unidades</dt><dd>${esc(g.units)}</dd>${g.units==='e/Bohr³'?`<dt>∫ sobre la celda</dt><dd>${fmt(gridIntegral(g),4)} e</dd>`:''}</dl><canvas data-export="${esc(label(f))}_planar" id="cv_gr${i}" style="height:220px"></canvas><p class="note">Promedio planar en las unidades del archivo. Para cortes 2D y perfiles usa <a href="#${g.units==='Ry'?'potencial':'densidad'}">${g.units==='Ry'?'Potencial y función trabajo':'Densidad y cargas'}</a>.</p></div>`); });
    if (geo) h+=panel('geo','Geometría',`<button class="tiny" data-fmt="cif">CIF</button><button class="tiny" data-fmt="xyz">XYZ</button><button class="tiny" data-fmt="extxyz">extXYZ</button><button class="tiny" data-fmt="poscar">POSCAR</button><button class="tiny" data-fmt="fdf">fdf</button><button class="tiny" id="geoPng">imagen</button>`).replace('<div class="pb"></div>',`<div class="pb"><div class="split2"><dl class="kv" id="geoKv"></dl><div class="three" id="geo3" style="height:340px;position:relative"></div></div></div>`);
    out.innerHTML=h||(F.length?'<p class="note">Ninguno de los archivos tiene un lector gráfico todavía.</p>':'');

    outs.forEach((f,i)=>{ body('sum'+i).innerHTML=summary(f); if(f.data.scf?.length) drawScf('scf'+i,f.data); if((f.data.trajectory||[]).length>1) drawTraj('tr'+i,f.data); });
    const ef=outs[0]?.data?.fermi;
    bands.forEach((f,i)=>drawBands('bd'+i,f.data,f.data.fermi??ef));
    pd.forEach((f,i)=>{ seg($('#pdMode'+i,root),S.pdosMode,v=>{ S.pdosMode=v; drawPdos('pd'+i,f.data); }); const sb=$('#pdSpin'+i,root); if(sb){ sb.setAttribute('aria-pressed',S.pdosSpin); sb.onclick=()=>{ S.pdosSpin=!S.pdosSpin; sb.setAttribute('aria-pressed',S.pdosSpin); drawPdos('pd'+i,f.data); }; } drawPdos('pd'+i,f.data); });
    if(!pd.length) eig.forEach((f,i)=>drawEigDos('eg'+i,f.data,f.link));
    eps.forEach((f,i)=>{ seg($('#opSel'+i,root),S.opt,v=>{ S.opt=v; drawOpt('op'+i,f.data); }); drawOpt('op'+i,f.data); });
    mde.forEach((f,i)=>{ seg($('#mdSel'+i,root),S.mde,v=>{ S.mde=v; drawMde('md'+i,f.data); }); drawMde('md'+i,f.data); });
    live.forEach((f,i)=>drawLive('lv'+i,f.data)); ions.forEach((f,i)=>drawIon('io'+i,f.data)); pss.forEach((f,i)=>drawPseudo('ps'+i,f.data));
    packs.forEach(({B,D},i)=>{ if(B) drawBands('pb'+i,B,B.fermi); if(D) drawPackDos('pk'+i,D); });
    grids.forEach((f,i)=>{ seg($('#grAx'+i,root),'2',v=>drawGrid('gr'+i,f.data,+v)); drawGrid('gr'+i,f.data,2); });
    const eMin=$('#eMin',root), eMax=$('#eMax',root);
    if(eMin){ const upd=()=>{ S.bands.emin=+eMin.value; S.bands.emax=+eMax.value; bands.forEach((f,i)=>drawBands('bd'+i,f.data,f.data.fermi??ef)); pd.forEach((f,i)=>drawPdos('pd'+i,f.data)); packs.forEach(({B,D},i)=>{ if(B) drawBands('pb'+i,B,B.fermi); if(D) drawPackDos('pk'+i,D); }); }; eMin.onchange=upd; eMax.onchange=upd; }
    if (geo) showGeo(geo);
    addExp();
  }
  async function showGeo({cell,src}){
    const p=cellParameters(cell.lattice);
    let sg='calculando…';
    const kv=()=>{ $('#geoKv',root).innerHTML=`<dt>origen</dt><dd>${esc(src)}</dd><dt>fórmula</dt><dd>${esc(formula(cell).formula)}</dd><dt>átomos</dt><dd>${cell.numbers.length}</dd><dt>a, b, c</dt><dd>${[p.a,p.b,p.c].map(v=>fmt(v,4)).join(', ')} Å</dd><dt>α, β, γ</dt><dd>${[p.alpha,p.beta,p.gamma].map(v=>fmt(v,2)).join(', ')}°</dd><dt>volumen</dt><dd>${fmt(volume(cell.lattice),3)} Å³</dd><dt>grupo espacial</dt><dd>${sg}</dd>`; };
    kv();
    $$('[data-fmt]',root).forEach(b=>b.onclick=()=>{ const fm=b.dataset.fmt; const ext={cif:'cif',xyz:'xyz',extxyz:'extxyz',poscar:'vasp',fdf:'fdf'}[fm];
      try{ downloadText(writeStructure(cell,fm,fm==='fdf'?{systemLabel:'dftlab'}:{}), `${(src.split(' ')[0]||'estructura').replace(/\.[^.]+$/,'')}.${ext}`); }catch(e){ toast('No se pudo escribir '+fm+': '+e.message); } });
    try{ V3=createViewer($('#geo3',root)); const g=V3.group(); const sc=cellScene(cell); drawStructure(V3,g,{atoms:sc.atoms,bonds:sc.bonds,cell:cell.lattice});
      const L=Math.max(...cell.lattice.map(v=>Math.hypot(...v))); V3.view([L*1.6,L*1.1,L*1.9]);
      $('#geoPng',root).onclick=()=>{ const url=V3.snapshot(); fetch(url).then(r=>r.blob()).then(b=>download(b,'estructura.png')); };
    }catch(e){ $('#geo3',root).textContent='Sin WebGL: '+e.message; }
    try{ if(!isMoyoReady()) await initMoyo('inline'); const a=analyze(cell,{symprec:1e-3}); sg=`${esc(a.international)} (${a.number}), ${a.crystal_system}`; }catch(e){ sg='—'; }
    if(view.alive) kv();
  }

  // ---------- report ----------
  $('#repMd',root).onclick=()=>{
    const outs=get('out'); let t=`# Informe de postproceso · DFT Lab\n\nGenerado: ${new Date().toISOString()}\n\n## Archivos leídos\n\n| archivo | tipo | bytes | SHA-256 |\n|---|---|---|---|\n`+F.map(f=>`| ${f.name} | ${KIND_NAME[f.kind]||f.kind} | ${f.size} | ${f.hash.slice(0,16)}… |`).join('\n')+'\n';
    for (const f of outs){ const o=f.data, fin=o.final||{};
      t+=`\n## ${o.systemLabel||label(f)}\n\n- SIESTA ${o.program?.version||'?'}; terminó: ${o.run?.completed?'sí':'no'}\n- XC: ${o.input?.xcFunctional||'?'} ${o.input?.xcAuthors||''}; base ${o.input?.basisSize||'?'}; MeshCutoff ${o.mesh?.cutoffUsed??'?'} Ry\n- Átomos ${o.nAtoms}; orbitales ${o.nOrbitals}; electrones ${o.nElectrons}\n- E total ${fin.etot} eV; energía libre ${fin.freeEnergy} eV; E_F ${o.fermi} eV\n- Fuerza máxima ${fin.maxForce} eV/Ang; presión ${fin.pressureKbar} kbar\n- SCF: ${o.scf?.length} iteraciones; convergió: ${fin.scfConverged}\n`;
      if(o.spinMoment) t+=`- Momento de espín ${o.spinMoment.abs} muB\n`;
      if(o.finalEnergy) t+='\n| término | eV |\n|---|---|\n'+Object.entries(o.finalEnergy).filter(([k,v])=>isFinite(v)).map(([k,v])=>`| ${k} | ${v} |`).join('\n')+'\n';
      if(o.warnings?.length) t+='\nAvisos de SIESTA:\n\n'+o.warnings.slice(0,20).map(w=>'- '+w.text).join('\n')+'\n'; }
    for (const f of get('bands')){ const e=bandEdges(f.data); t+=`\n## Bandas (${f.name})\n\n- ${f.data.nBands} bandas, ${f.data.nSpin} canal(es), ${f.data.nk} puntos k\n- ${e.metallic?'metal':`gap ${e.gap?.toFixed(4)} eV, ${e.direct?'directo':'indirecto'}`}\n`; }
    for (const f of get('eig')){ t+=`\n## Autovalores (${f.name})\n\n- ${f.data.nk} puntos k, ${f.data.nBands} bandas; pesos: ${f.link?.weights||'uniformes (1/nk)'}; coordenadas k: ${f.link?.kpoints||'no disponibles'}\n`+(f.link?.note?`- Aviso: ${f.link.note}\n`:''); }
    for (const f of get('dftlab-pack')){ const c=packContents(f.data); t+=`\n## Paquete (${f.name})\n\n- ${f.data.generator||'?'}; E_F ${f.data.fermi} eV; gap ${f.data.gap?.gap ?? '?'} eV (${f.data.gap?.type ?? '?'})\n`+(c.extras.length?`- No visualizado en Postproceso: ${c.extras.map(x=>x.label).join('; ')}\n`:''); }
    for (const f of get('grid')){ t+=`\n## Malla (${f.name})\n\n- ${f.data.mesh.join(' x ')}, ${f.data.nspin} espín(es), unidades ${f.data.units}\n`; }
    for (const f of get('pdos')){ t+=`\n## PDOS (${f.name})\n\n`+groupPDOS(f.data,['species','l'],'total').map(g=>`- ${g.label}: ${integratePDOS(f.data,g.data,f.data.fermi).toFixed(3)} electrones hasta E_F`).join('\n')+'\n'; }
    t+='\nLos números de este informe se leyeron de los archivos listados; DFT Lab no ejecutó SIESTA.\n';
    downloadText(t,'informe_dftlab.md','text/markdown');
  };
  // mallas y paquetes: metadatos y procedencia (sus arreglos completos están en el archivo original, identificado por SHA-256)
  const exportData=f=>f.kind==='grid'?{mesh:f.data.mesh, nspin:f.data.nspin, cell:f.data.cell, units:f.data.units, volume:f.data.volume}
    :f.kind==='dftlab-pack'?{source:f.data.source, generator:f.data.generator, spin:f.data.spin, fermi:f.data.fermi, gap:f.data.gap, contents:packContents(f.data)}:toPlain(f.data);
  $('#repJson',root).onclick=()=>{ const o=F.filter(f=>f.data&&f.kind!=='live').map(f=>({name:f.name, kind:f.kind, sha256:f.hash, ...(f.link?{link:f.link}:{}), data:exportData(f)})); downloadText(JSON.stringify({dftlab:'postproceso', created:new Date().toISOString(), files:o}),'dftlab_postproceso.json','application/json'); };
  view.onTheme(()=>refresh());
  fileTable();
}
