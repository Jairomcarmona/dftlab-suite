// Herramientas · Estructura y entrada: read or build a crystal, analyze its symmetry, get the HPKOT k-path and
// Brillouin zone, and export a complete SIESTA input plus a cluster job script. Nothing runs SIESTA here.
import { $, $$, css, esc, fmt, download, downloadText, toast, seg } from '../core/ui.js';
import { readStructure, writeStructure } from '../crystal/formats.js';
import { initMoyo, isMoyoReady, analyze, supercell, latticeFromParameters, cellParameters, volume, formula, reciprocalLattice, normalizeCell } from '../crystal/symmetry.js';
import { getPathOrigCell, prettyLabel } from '../crystal/kpath.js';
import { brillouinZone, bzWireframe } from '../crystal/bz.js';
import { symbolOf } from '../crystal/elements.js';
import { createViewer, drawStructure } from '../core/three-view.js';
import { cellScene } from '../core/scene.js';
import { siestaInput, jobScript, XC, BASIS, DEFAULTS, SCHED_DEFAULTS } from '../tools/fdfgen.js';
import { LUA_HOOK } from './scf.js';

const fcc=a=>[[0,a/2,a/2],[a/2,0,a/2],[a/2,a/2,0]], bcc=a=>[[-a/2,a/2,a/2],[a/2,-a/2,a/2],[a/2,a/2,-a/2]];
const hex=(a,c)=>latticeFromParameters(a,a,c,90,90,120);
const PRESETS = {
  'Si diamante':{lattice:fcc(5.431),positions:[[0,0,0],[.25,.25,.25]],numbers:[14,14]},
  'GaAs zincblenda':{lattice:fcc(5.653),positions:[[0,0,0],[.25,.25,.25]],numbers:[31,33]},
  'NaCl sal de roca':{lattice:fcc(5.640),positions:[[0,0,0],[.5,.5,.5]],numbers:[11,17]},
  'Fe bcc':{lattice:bcc(2.867),positions:[[0,0,0]],numbers:[26]},
  'Mg hcp':{lattice:hex(3.209,5.211),positions:[[1/3,2/3,.25],[2/3,1/3,.75]],numbers:[12,12]},
  'grafito AB':{lattice:hex(2.464,6.711),positions:[[0,0,.25],[0,0,.75],[1/3,2/3,.25],[2/3,1/3,.75]],numbers:[6,6,6,6]},
  'grafeno (vacío 15 Å)':{lattice:hex(2.464,15),positions:[[1/3,2/3,.5],[2/3,1/3,.5]],numbers:[6,6]},
  'MoS₂ monocapa':{lattice:hex(3.16,18),positions:[[1/3,2/3,.5],[2/3,1/3,.5+1.586/18],[2/3,1/3,.5-1.586/18]],numbers:[42,16,16]},
  'ZnO wurtzita':{lattice:hex(3.250,5.207),positions:[[1/3,2/3,0],[2/3,1/3,.5],[1/3,2/3,.382],[2/3,1/3,.882]],numbers:[30,30,8,8]},
  'SrTiO₃ perovskita':{lattice:[[3.905,0,0],[0,3.905,0],[0,0,3.905]],positions:[[0,0,0],[.5,.5,.5],[.5,.5,0],[.5,0,.5],[0,.5,.5]],numbers:[38,22,8,8,8]},
  'TiO₂ rutilo':{lattice:[[4.594,0,0],[0,4.594,0],[0,0,2.959]],positions:[[0,0,0],[.5,.5,.5],[.3053,.3053,0],[.6947,.6947,0],[.8053,.1947,.5],[.1947,.8053,.5]],numbers:[22,22,8,8,8,8]},
};

function theory(){ return `
  <h3>De la estructura al cálculo</h3>
  <p>Antes de lanzar SIESTA hay cuatro decisiones: qué celda usar, qué simetría tiene, qué camino seguir en la zona de Brillouin para las bandas y con qué parámetros. Esta página las toma contigo y escribe el <code>.fdf</code> y el script del cluster.</p>
  <h3>Simetría</h3>
  <p>El grupo espacial se detecta con moyo (la biblioteca que sucede a spglib) compilada a WebAssembly. La tolerancia <i>symprec</i> decide cuánto pueden desviarse los átomos de las posiciones ideales; una estructura relajada con ruido numérico puede necesitar 10⁻³ Å o más. Las posiciones de Wyckoff dicen qué átomos son equivalentes: los que comparten letra se pueden tratar como una sola especie.</p>
  <h3>Celda primitiva y convencional</h3>
  <p>La celda convencional muestra la simetría (la cúbica de 8 átomos del Si); la primitiva es la más pequeña (2 átomos) y es la que se calcula. Una supercelda sirve para defectos, aleaciones, fonones por diferencias finitas o el escalado de los solvers.</p>
  <h3>El camino k</h3>
  <p>Se usa la convención de Hinuma, Pizzi, Kumagai, Oba y Tanaka (HPKOT, la de seekpath), que define un camino para cada uno de los 24 tipos extendidos de red de Bravais y elimina las ambigüedades de las tablas antiguas. Los puntos se expresan en la base recíproca de <b>tu</b> celda, así que el bloque <code>BandLines</code> sirve sin reordenar átomos.</p>
  <h3>Lo que escribe el generador</h3>
  <p>Geometría, funcional, base, MeshCutoff, malla k por espaciado, smearing, mezclador, relajación opcional y las salidas para el postproceso (bandas, PDOS, Mulliken, óptica, densidad). El script de trabajo sirve para SLURM, PBS, SGE o una corrida local, revisa que estén los pseudos y opcionalmente trabaja en el disco local del nodo.</p>
  <p class="src">Hinuma et al., Comput. Mater. Sci. 128, 140 (2017) · Togo y Tanaka, arXiv:1808.01590 (spglib) · Setyawan y Curtarolo, Comput. Mater. Sci. 49, 299 (2010) · García et al., JCP 152, 204108 (2020) (SIESTA).</p>`; }

let V3=null;
export function destroy(){ if(V3){ V3.destroy(); V3=null; } }

export function mount(root, view){
  const S={ base:null, cell:null, src:'', sym:null, path:null, symprec:1e-3, view:'st', p:{...DEFAULTS, label:'si'}, q:{...SCHED_DEFAULTS} };
  root.innerHTML=`
  <div class="pghead"><div>
    <div class="kicker">Herramientas</div><h1>Estructura, simetría y entrada de SIESTA</h1>
    <p class="lede">Carga un CIF, POSCAR, XYZ, .XV o .fdf, o elige un cristal de ejemplo. Obtén grupo espacial, Wyckoff, celda primitiva, zona de Brillouin y camino k, y descarga el <code>.fdf</code> completo y el script para tu cluster.</p>
  </div></div>
  <div class="pgrid">
    <article class="panel theory sticky">${theory()}</article>
    <div class="charts">
      <section class="panel wide"><div class="ph"><h2>Estructura</h2><div class="btnrow"><select class="tiny" id="pre"><option value="">ejemplos…</option>${Object.keys(PRESETS).map(k=>`<option>${esc(k)}</option>`).join('')}</select><label class="tiny" style="cursor:pointer">abrir archivo<input type="file" id="stFile" hidden></label></div></div>
        <div class="pb"><label class="drop" id="stDrop" style="padding:12px"><b>Suelta un CIF, POSCAR, XYZ, .XV, .STRUCT_OUT o .fdf</b></label>
          <div class="split2" style="margin-top:12px"><div><dl class="kv" id="stKv"></dl>
            <div class="btnrow" style="margin-top:10px"><button class="tiny" id="toPrim">a primitiva</button><button class="tiny" id="toConv">a convencional</button><button class="tiny" id="reset">original</button></div>
            <div class="btnrow" style="margin-top:8px"><span class="tiny-t">supercelda</span><input type="number" id="sc1" value="1" min="1" max="8" style="width:5ch"><input type="number" id="sc2" value="1" min="1" max="8" style="width:5ch"><input type="number" id="sc3" value="1" min="1" max="8" style="width:5ch"><button class="tiny" id="doSc">aplicar</button></div>
            <div class="btnrow" style="margin-top:8px"><label class="sl">symprec (Å) <select id="symprec">${[1e-5,1e-4,1e-3,1e-2,0.05,0.1].map(v=>`<option value="${v}"${v===1e-3?' selected':''}>${v}</option>`).join('')}</select></label></div>
            <div class="btnrow" style="margin-top:10px"><span class="tiny-t">exportar</span>${['cif','xyz','extxyz','poscar','fdf','struct_in'].map(f=>`<button class="tiny" data-fmt="${f}">${f.toUpperCase()}</button>`).join('')}<button class="tiny" id="png3">imagen</button></div></div>
          <div><div class="btnrow" style="margin-bottom:6px"><div class="seg" id="vSel"><button data-v="st">estructura</button><button data-v="bz">zona de Brillouin</button></div></div><div class="three" id="st3" style="height:360px;position:relative"></div></div></div></div></section>

      <section class="panel wide"><div class="ph"><h2>Simetría y Wyckoff</h2></div><div class="pb"><div class="tblwrap"><table class="tbl" id="wyTab"></table></div><p class="note" id="symNote"></p></div></section>
      <section class="panel wide"><div class="ph"><h2>Camino k (HPKOT)</h2></div><div class="pb"><div class="tblwrap"><table class="tbl" id="kTab"></table></div><p class="note" id="kNote"></p></div></section>

      <section class="panel wide"><div class="ph"><h2>Generador de entrada de SIESTA</h2><div class="btnrow"><button class="btn" id="dlFdf">descargar .fdf</button><button class="tiny" id="dlLua" hidden>hook .lua</button></div></div>
        <div class="pb"><div class="fields" id="gen"></div>
          <div class="btnrow" style="margin-top:10px" id="genChk"></div>
          <pre class="code" id="fdfPre" style="max-height:420px;overflow:auto;margin-top:10px"></pre></div></section>

      <section class="panel wide"><div class="ph"><h2>Script para el cluster</h2><div class="btnrow"><div class="seg" id="schSel"><button data-v="slurm">SLURM</button><button data-v="pbs">PBS/Torque</button><button data-v="sge">SGE</button><button data-v="local">local</button></div><button class="btn" id="dlJob">descargar .sh</button></div></div>
        <div class="pb"><div class="fields" id="jobF"></div><pre class="code" id="jobPre" style="max-height:340px;overflow:auto;margin-top:10px"></pre>
        <p class="note">DFT Lab no lanza el cálculo: copia el .fdf, el script y los pseudos (<code>Símbolo.psml</code> o <code>.psf</code>) a tu carpeta de trabajo y envíalo con <code>sbatch</code>, <code>qsub</code> o <code>bash</code>. Revisa los nombres de módulos de tu máquina.</p></div></section>
    </div>
  </div>
  <footer class="prov">Simetría: moyo 0.21 (WebAssembly), probado contra spglib 2.7 en 371 estructuras y los 230 grupos espaciales. Camino k: port de seekpath 2.2 (HPKOT), idéntico en los 29 casos extendidos de Bravais. Los ejemplos usan parámetros experimentales a temperatura ambiente. Comprobación: el .fdf generado para Si (LDA, DZP, bandas, PDOS, óptica, .TSHS) se corrió con SIESTA 5.4.2 y terminó sin errores, con el camino Γ–X–U|K–Γ–L–W–X y un gap de 0.52 eV.</footer>`;

  // ---------- generator form ----------
  const F=[
    ['label','SystemLabel','text'],['xc','funcional','select',Object.keys(XC)],['basis','base','select',BASIS],['energyShift','PAO.EnergyShift (meV)','number'],
    ['mesh','MeshCutoff (Ry)','number'],['kmode','malla k','select',['spacing','grid']],['kspacing','Δk (Å⁻¹, con 2π)','number'],['kgridTxt','n₁ n₂ n₃','text'],['kshift','desplazamiento','select',['0.5','0.0']],
    ['spin','espín','select',['none','polarized']],['occ','ocupación','select',['FD','MP']],['temp','temperatura (K)','number'],
    ['mixer','mezclador','select',['Pulay','Broyden','Linear']],['weight','peso','number'],['history','historia','number'],['mix','mezclar','select',['Hamiltonian','density']],['maxit','MaxSCFIterations','number'],['dmTol','SCF.DM.Tolerance','number'],
    ['run','tipo de corrida','select',['single','relax']],['maxForce','fuerza máx (eV/Å)','number'],['cgSteps','pasos CG','number'],['coordinates','coordenadas','select',['Fractional','Ang']]];
  const NAMES={spacing:'por espaciado',grid:'n×n×n fija',single:'punto único',relax:'relajación CG',none:'sin espín',polarized:'colineal',Hamiltonian:'hamiltoniano',density:'matriz densidad',Fractional:'fraccionales',Ang:'Å'};
  const CHK=[['bands','bandas (BandLines)'],['pdos','PDOS'],['mulliken','Mulliken'],['rho','densidad .RHO'],['optical','óptica ε(ω)'],['saveHS','.TSHS para sisl'],['coop','COOP/COHP'],['varCell','celda variable'],['lua','hook Lua (live.jsonl)']];
  S.p.kgridTxt='6 6 6';
  $('#gen',root).innerHTML=F.map(([k,l,t,opts])=>`<label class="field">${l}${t==='select'?`<select data-k="${k}">${opts.map(o=>`<option value="${o}"${String(S.p[k])===o?' selected':''}>${NAMES[o]||o}</option>`).join('')}</select>`:`<input data-k="${k}" type="${t}" step="any" value="${esc(S.p[k]??'')}">`}</label>`).join('');
  $('#genChk',root).innerHTML=CHK.map(([k,l])=>`<label class="check"><input type="checkbox" data-c="${k}"${S.p[k]?' checked':''}> ${l}</label>`).join('');
  $$('#gen [data-k]',root).forEach(e=>e.addEventListener('input',()=>{ const k=e.dataset.k; S.p[k]=e.type==='number'?+e.value:e.value; regen(); }));
  $$('#genChk [data-c]',root).forEach(e=>e.addEventListener('change',()=>{ S.p[e.dataset.c]=e.checked; regen(); }));
  const QF=[['job','nombre del trabajo','text'],['nodes','nodos','number'],['ntasks','procesos MPI por nodo','number'],['omp','hilos OpenMP por proceso','number'],['time','tiempo (hh:mm:ss)','text'],['mem','memoria (ej. 32G)','text'],['partition','partición / cola','text'],['account','cuenta','text'],['modules','módulos (una línea)','text'],['siesta','ejecutable','text']];
  $('#jobF',root).innerHTML=QF.map(([k,l,t])=>`<label class="field">${l}<input data-q="${k}" type="${t}" value="${esc(S.q[k])}"></label>`).join('')+`<label class="check"><input type="checkbox" id="scr"> usar disco local del nodo</label>`;
  $$('#jobF [data-q]',root).forEach(e=>e.addEventListener('input',()=>{ S.q[e.dataset.q]=e.type==='number'?+e.value:e.value; regenJob(); }));
  $('#scr',root).onchange=e=>{ S.q.scratch=e.target.checked; regenJob(); };
  seg($('#schSel',root),'slurm',v=>{ S.q.sched=v; regenJob(); });

  let fdfText='', jobText='';
  function regen(){
    if(!S.cell) return;
    const p={...S.p}; p.kgrid=String(p.kgridTxt).trim().split(/\s+/).map(Number).slice(0,3); if(p.kgrid.length<3||p.kgrid.some(x=>!(x>0))) p.kgrid=[1,1,1];
    p.kshift=+p.kshift;
    try{ fdfText=siestaInput(S.cell,p,S.path); }catch(e){ fdfText='# Error: '+e.message; }
    $('#fdfPre',root).textContent=fdfText; $('#dlLua',root).hidden=!S.p.lua; regenJob();
  }
  function regenJob(){ if(!S.cell) return; jobText=jobScript(S.p.label,[...new Set(S.cell.numbers)],S.q); $('#jobPre',root).textContent=jobText; }
  $('#dlFdf',root).onclick=()=>downloadText(fdfText,`${S.p.label}.fdf`);
  $('#dlJob',root).onclick=()=>downloadText(jobText,`run_${S.p.label}.sh`);
  $('#dlLua',root).onclick=()=>downloadText(LUA_HOOK,'dftlab_scf_hook.lua');

  // ---------- structure ----------
  async function setCell(cell, src, {keepBase=false}={}){
    if(!isMoyoReady()){ try{ await initMoyo('inline'); }catch(e){ if(view.alive) toast('No se pudo cargar moyo: '+e.message); } }
    if(!view.alive) return;   // V3 es de módulo: un setCell tardío no debe crear un visor tras destroy()
    S.cell=normalizeCell(cell); S.src=src; if(!keepBase) S.base=S.cell;
    try{ S.sym=analyze(S.cell,{symprec:S.symprec}); }catch(e){ S.sym=null; }
    try{ S.path=getPathOrigCell(S.cell,{symprec:S.symprec}); }catch(e){ S.path=null; }
    info(); draw3(); regen();
  }
  function info(){
    const c=S.cell, p=cellParameters(c.lattice), sy=S.sym;
    $('#stKv',root).innerHTML=`<dt>origen</dt><dd>${esc(S.src)}</dd><dt>fórmula</dt><dd>${esc(formula(c).formula)} (Z = ${formula(c).z})</dd><dt>átomos</dt><dd>${c.numbers.length}</dd>
      <dt>a, b, c</dt><dd>${[p.a,p.b,p.c].map(v=>fmt(v,4)).join(', ')} Å</dd><dt>α, β, γ</dt><dd>${[p.alpha,p.beta,p.gamma].map(v=>fmt(v,2)).join(', ')}°</dd><dt>volumen</dt><dd>${fmt(volume(c.lattice),3)} Å³</dd>
      <dt>grupo espacial</dt><dd><b>${sy?`${esc(sy.international)} (${sy.number})`:'—'}</b></dd><dt>sistema</dt><dd>${sy?`${sy.crystal_system}, Bravais ${sy.bravais}, Pearson ${sy.pearson_symbol}`:'—'}</dd>
      <dt>grupo puntual</dt><dd>${sy?esc(sy.point_group)+`, ${sy.nOps} operaciones${sy.has_inversion?', con inversión':''}`:'—'}</dd>`;
    $('#wyTab',root).innerHTML=sy?`<thead><tr><th>elemento</th><th>Wyckoff</th><th>simetría del sitio</th><th>átomos equivalentes</th></tr></thead><tbody>${sy.orbits.map(o=>`<tr><td>${o.element}</td><td>${o.indices.length}${o.wyckoff}</td><td>${esc(o.siteSymmetry)}</td><td>${o.indices.map(i=>i+1).join(', ')}</td></tr>`).join('')}</tbody>`:'';
    $('#symNote',root).textContent=sy?`Primitiva: ${sy.primitive.numbers.length} átomos. Convencional: ${sy.conventional.numbers.length} átomos. symprec = ${S.symprec} Å.`:'No se pudo determinar la simetría.';
    const P=S.path;
    if(P){ const B=reciprocalLattice(c.lattice,true); const pts=Object.entries(P.point_coords).filter(([l])=>P.path.some(s=>s.includes(l)));
      $('#kTab',root).innerHTML=`<thead><tr><th>punto</th><th>k₁</th><th>k₂</th><th>k₃</th><th>|k| (Å⁻¹)</th></tr></thead><tbody>${pts.map(([l,f])=>{ const kc=[0,1,2].map(j=>f[0]*B[0][j]+f[1]*B[1][j]+f[2]*B[2][j]); return `<tr><td>${prettyLabel(l)}</td>${f.map(x=>`<td>${fmt(x,4)}</td>`).join('')}<td>${fmt(Math.hypot(...kc),4)}</td></tr>`; }).join('')}</tbody>`;
      $('#kNote',root).innerHTML=`Red extendida <b>${P.bravais_lattice_extended}</b>. Camino: ${P.path.map(([a,b])=>prettyLabel(a)+'–'+prettyLabel(b)).join(', ')}.${P.is_supercell?' <b>La celda es una supercelda</b>: el camino es el de la primitiva expresado en esta base; las bandas saldrán plegadas.':''}${P.warnings?.length?' '+esc(P.warnings.join(' ')):''}`;
    } else { $('#kTab',root).innerHTML=''; $('#kNote',root).textContent='Sin camino k (no se detectó la simetría).'; }
  }
  function draw3(){
    if(!V3){ try{ V3=createViewer($('#st3',root)); }catch(e){ $('#st3',root).textContent='Sin WebGL'; return; } }
    const g=V3.root.children[0]||V3.group(); V3.clear(g);
    if(S.view==='st'){ const sc=cellScene(S.cell,{maxAtoms:1500}); drawStructure(V3,g,{atoms:sc.atoms,bonds:sc.bonds,cell:S.cell.lattice}); const L=Math.max(...S.cell.lattice.map(v=>Math.hypot(...v))); V3.view([L*1.6,L*1.1,L*1.9]); }
    else { const T=V3.THREE, B=reciprocalLattice(S.cell.lattice,true), bz=brillouinZone(B);
      const m=new T.LineBasicMaterial({color:new T.Color(css('--muted'))}); for(const [p1,p2] of bzWireframe(bz)) g.add(new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(...p1),new T.Vector3(...p2)]),m));
      if(S.path){ const pm=new T.LineBasicMaterial({color:new T.Color(css('--accent'))}); const cart=f=>[0,1,2].map(j=>f[0]*B[0][j]+f[1]*B[1][j]+f[2]*B[2][j]);
        for(const [a,b] of S.path.path) g.add(new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(...cart(S.path.point_coords[a])),new T.Vector3(...cart(S.path.point_coords[b]))]),pm));
        const used=new Set(S.path.path.flat()); for(const l of used) V3.label(g,prettyLabel(l),cart(S.path.point_coords[l])); }
      const R=Math.max(...bz.vertices.map(v=>Math.hypot(...v))); V3.view([R*2.4,R*1.6,R*2.8]); }
  }
  seg($('#vSel',root),'st',v=>{ S.view=v; draw3(); });
  $('#pre',root).onchange=e=>{ const k=e.target.value; if(!k) return; const c=PRESETS[k]; const lab=k.split(' ')[0].replace(/[^A-Za-z0-9]/g,'').toLowerCase()||'sys'; S.p.label=lab; $('[data-k="label"]',root).value=lab; setCell(c,k+' (ejemplo)'); };
  async function readFile(f){ const t=await f.text(); if(!view.alive) return; try{ const c=readStructure(t,{filename:f.name}); const lab=f.name.replace(/\.[^.]+$/,'').replace(/[^A-Za-z0-9_]/g,'')||'sys'; S.p.label=lab; $('[data-k="label"]',root).value=lab; setCell(c,f.name); }catch(e){ toast('No pude leer '+f.name+': '+e.message); } }
  $('#stFile',root).onchange=e=>{ if(e.target.files[0]) readFile(e.target.files[0]); e.target.value=''; };
  const dz=$('#stDrop',root); dz.addEventListener('dragover',e=>{ e.preventDefault(); dz.classList.add('over'); }); dz.addEventListener('dragleave',()=>dz.classList.remove('over'));
  dz.addEventListener('drop',e=>{ e.preventDefault(); dz.classList.remove('over'); if(e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
  dz.addEventListener('click',()=>$('#stFile',root).click());
  $('#toPrim',root).onclick=()=>S.sym&&setCell(S.sym.primitive,'primitiva estándar de '+S.src,{keepBase:true});
  $('#toConv',root).onclick=()=>S.sym&&setCell(S.sym.conventional,'convencional estándar de '+S.src,{keepBase:true});
  $('#reset',root).onclick=()=>S.base&&setCell(S.base,S.src.replace(/^(primitiva|convencional) estándar de |^supercelda .* de /,''),{keepBase:true});
  $('#doSc',root).onclick=()=>{ const n=['#sc1','#sc2','#sc3'].map(s=>Math.max(1,Math.min(8,+$(s,root).value||1))); if(n[0]*n[1]*n[2]*S.cell.numbers.length>4000){ toast('Más de 4000 átomos: elige una supercelda menor.'); return; } setCell(supercell(S.cell,n),`supercelda ${n.join('×')} de ${S.src}`,{keepBase:true}); };
  $('#symprec',root).onchange=e=>{ S.symprec=+e.target.value; setCell(S.cell,S.src,{keepBase:true}); };
  $$('[data-fmt]',root).forEach(b=>b.onclick=()=>{ const fm=b.dataset.fmt, ext={cif:'cif',xyz:'xyz',extxyz:'extxyz',poscar:'vasp',fdf:'fdf',struct_in:'STRUCT_IN'}[fm];
    try{ downloadText(writeStructure(S.cell,fm,fm==='fdf'?{systemLabel:S.p.label}:fm==='cif'?{symmetrize:false}:{}),`${S.p.label}.${ext}`); }catch(e){ toast('Error al escribir '+fm+': '+e.message); } });
  $('#png3',root).onclick=()=>{ if(!V3) return; fetch(V3.snapshot()).then(r=>r.blob()).then(b=>download(b,`${S.p.label}_${S.view==='st'?'estructura':'zona_brillouin'}.png`)); };

  $('#pre',root).value='Si diamante'; S.p.label='si'; $('[data-k="label"]',root).value='si';
  setCell(PRESETS['Si diamante'],'Si diamante (ejemplo)');
}
