// Aprender 1 · Kohn–Sham: the equations solved live for any atom (H–Xe) in the browser.
import { $, $$, css, alpha, esc, fmt, downloadText, seg, HA } from '../core/ui.js';
import { chart, exportBar } from '../core/chart.js';
import { solveAtom, configuration, confString, parseConfig, LL } from '../physics/atom.js';
import { SYMBOLS } from '../crystal/elements.js';
import PX from '../data/pseudo_xc.json';

// First ionization energies, eV (NIST ASD)
const IP = {1:13.598,2:24.587,3:5.392,4:9.323,5:8.298,6:11.260,7:14.534,8:13.618,9:17.423,10:21.565,11:5.139,12:7.646,13:5.986,14:8.152,15:10.487,16:10.360,17:12.968,18:15.760,19:4.341,20:6.113,26:7.902,29:7.726,30:9.394,31:5.999,32:7.900,33:9.789,34:9.752,35:11.814,36:13.999};
const XCN = { vwn:'LDA (VWN5)', pz:'LDA (PZ81)', x:'solo intercambio', none:'Hartree (sin XC)' };

function theory(){ return `
  <h3>Hohenberg y Kohn</h3>
  <p>Para N electrones en un potencial externo v(r), la densidad del estado base ρ(r) determina v(r) salvo una constante, y con él todo el hamiltoniano. Existe un funcional E<sub>v</sub>[ρ] cuyo mínimo es la energía del estado base, y se alcanza en la densidad exacta. Pasamos de una función de 3N variables a una de 3.</p>
  <h3>El truco de Kohn y Sham</h3>
  <p>No conocemos la energía cinética como funcional de ρ. Kohn y Sham la calculan exactamente para un sistema auxiliar de electrones <b>no interactuantes</b> que tiene, por construcción, la misma densidad que el real. Lo que falta se junta en E<sub>xc</sub>.</p>
  <div class="eq">[−½∇² + v(r) + v<sub>H</sub>(r) + v<sub>xc</sub>(r)] φ<sub>i</sub> = ε<sub>i</sub> φ<sub>i</sub>, &nbsp; ρ = Σ<sub>i</sub> f<sub>i</sub> |φ<sub>i</sub>|²</div>
  <div class="eq">v<sub>H</sub>(r) = ∫ ρ(r′)/|r − r′| dr′, &nbsp; v<sub>xc</sub> = δE<sub>xc</sub>/δρ</div>
  <p>El potencial depende de ρ y ρ de los orbitales: se resuelve por iteración, el ciclo SCF de la sección 5.</p>
  <h3>La energía total</h3>
  <div class="eq">E = Σ f<sub>i</sub>ε<sub>i</sub> − E<sub>H</sub> − ∫ v<sub>xc</sub>ρ + E<sub>xc</sub></div>
  <p>La suma de autovalores cuenta dos veces la repulsión electrón–electrón; los otros términos lo corrigen. SIESTA imprime exactamente esta descomposición al final de cada corrida.</p>
  <h3>Qué significan los ε<sub>i</sub></h3>
  <p>Son multiplicadores de Lagrange, no energías de quitar un electrón. Hay una excepción: con el funcional exacto, −ε<sub>HOMO</sub> es la energía de ionización. En LDA el potencial v<sub>xc</sub> decae exponencialmente en vez de como −1/r, el electrón más externo queda poco ligado y −ε<sub>HOMO</sub> sale cerca de la mitad del valor medido. La diferencia de energías totales E(N−1) − E(N) (ΔSCF) sí lo reproduce: lo puedes comprobar en el panel de la derecha.</p>
  <h3>Cómo se resuelve aquí</h3>
  <p>El átomo se trata esférico y sin polarización de espín. La ecuación radial se integra con Numerov en una malla logarítmica de 4000 puntos y cada autovalor se encuentra contando nodos. Esta es la misma ecuación que resuelve ONCVPSP antes de construir un pseudopotencial, y la que resuelve SIESTA para generar sus orbitales base.</p>
  <p class="src">Hohenberg y Kohn, PR 136, B864 (1964) · Kohn y Sham, PR 140, A1133 (1965) · Janak, PRB 18, 7165 (1978) · Perdew et al., PRL 49, 1691 (1982) · Vosko, Wilk y Nusair, CJP 58, 1200 (1980).</p>`; }

export function mount(root, view){
  const S={Z:14, charge:0, xc:'vwn', conf:null, res:null, ion:null, show:new Set(), rscale:'log', pot:'rV'};
  root.innerHTML=`
  <div class="pghead"><div>
    <div class="kicker">Aprender · 1</div><h1>Las ecuaciones de Kohn–Sham</h1>
    <p class="lede">Un átomo resuelto de forma autoconsistente aquí mismo, en tu navegador: cualquier elemento del H al Xe, con o sin intercambio y correlación. Los autovalores coinciden con PySCF en el límite de base completa con diferencias de 0.1 mHa.</p>
  </div></div>
  <div class="pgrid">
    <article class="panel theory sticky">${theory()}</article>
    <div class="charts">
      <section class="panel wide"><div class="ph"><h2>Átomo de Kohn–Sham</h2><div class="btnrow"><button class="tiny" id="ksRep">exportar informe</button></div></div>
        <div class="pb"><div class="fields">
          <label class="field">elemento<select id="ksZ">${SYMBOLS.slice(1,55).map((s,i)=>`<option value="${i+1}"${i+1===14?' selected':''}>${i+1} · ${s}</option>`).join('')}</select></label>
          <label class="field">carga<select id="ksQ">${[-1,0,1,2,3].map(q=>`<option value="${q}"${q===0?' selected':''}>${q>0?'+':''}${q}</option>`).join('')}</select></label>
          <label class="field">funcional<select id="ksXC">${Object.entries(XCN).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label>
          <label class="field" style="grid-column:span 2">configuración<input id="ksConf" spellcheck="false"></label>
        </div>
        <div class="btnrow" style="margin-top:10px"><button class="btn" id="ksRun">Resolver</button><span class="note" id="ksStat" style="margin:0"></span></div>
        <div class="tblwrap" style="margin-top:10px"><table class="tbl" id="ksTab"></table></div></div></section>

      <section class="panel"><div class="ph"><h2>Orbitales radiales u(r) = r R(r)</h2><div class="seg" id="rSel"><button data-v="log">r log</button><button data-v="lin">r lineal</button></div></div>
        <div class="pb"><div class="chips" id="orbChips"></div><canvas data-export="ks_orbitales" id="cvOrb" style="height:270px"></canvas><div class="readout" id="orbRead"></div></div></section>

      <section class="panel"><div class="ph"><h2>Potenciales</h2><div class="seg" id="pSel"><button data-v="rV">r·V(r)</button><button data-v="V">V(r)</button></div></div>
        <div class="pb"><canvas data-export="ks_potenciales" id="cvPot" style="height:270px"></canvas><div class="readout" id="potRead"></div>
        <p class="note">r·V muestra la carga que ve un electrón: −Z junto al núcleo; lejos, −(Z−N+1) para el potencial exacto. En LDA v<sub>xc</sub> decae demasiado rápido y r·V<sub>eff</sub> tiende a −(Z−N) = 0 en el átomo neutro.</p></div></section>

      <section class="panel"><div class="ph"><h2>Densidad radial 4πr²ρ(r)</h2></div>
        <div class="pb"><canvas data-export="ks_densidad" id="cvRho" style="height:250px"></canvas><div class="readout" id="rhoRead"></div>
        <p class="note">Las capas electrónicas aparecen como máximos. Las líneas finas son la contribución de cada orbital.</p></div></section>

      <section class="panel"><div class="ph"><h2>Ciclo SCF del átomo</h2></div>
        <div class="pb"><canvas data-export="ks_scf" id="cvHist" style="height:250px"></canvas><div class="readout" id="histRead"></div>
        <p class="note">Mezcla lineal de la densidad con peso 0.4. Arranca desde el potencial de Thomas–Fermi.</p></div></section>

      <section class="panel wide"><div class="ph"><h2>Energía de ionización: −ε<sub>HOMO</sub> frente a ΔSCF</h2></div>
        <div class="pb"><div id="ipBox"></div></div></section>
    </div>
  </div>
  <footer class="prov">Solver propio de DFT Lab (física/atom.js): Kohn–Sham radial no relativista, esférico y sin espín. Validado contra PySCF 2.x con LDA VWN5 y bases sin contraer aug-cc-pV5Z: Ne, Mg y Ar coinciden en energía total y autovalores dentro de 2.5×10⁻⁴ Ha. ONCVPSP, que se usó para los pseudos del curso, resuelve la versión escalar relativista. Energías de ionización experimentales: NIST ASD.</footer>`;

  const pal=()=>[css('--orb-s'),css('--orb-p'),css('--orb-d'),css('--orb-f')];
  const orbColor=(o,i)=>{ const c=pal()[o.l]; return c; };
  const B=x=>x; // radii in Bohr

  function setDefaults(){ S.conf=configuration(S.Z,S.charge); $('#ksConf',root).value=confString(S.conf); }
  function run(){
    const conf=parseConfig($('#ksConf',root).value); if(!conf.length){ $('#ksStat',root).textContent='Configuración no válida.'; return; }
    const ne=conf.reduce((s,c)=>s+c.f,0);
    $('#ksStat',root).textContent='Calculando…'; $('#ksRun',root).disabled=true;
    view.timeout(()=>{
      const t=performance.now();
      try{
        S.res=solveAtom(S.Z,{conf,xc:S.xc});
        // ΔSCF: remove one electron from the highest occupied level
        const hi=S.res.orbitals.filter(o=>o.f>0).reduce((a,o)=>o.E>a.E?o:a);
        const conf2=conf.map(c=>({...c})); const h2=conf2.find(c=>c.n===hi.n&&c.l===hi.l); h2.f=Math.max(0,h2.f-1);
        S.ion = ne>1||S.Z>1 ? solveAtom(S.Z,{conf:conf2.filter(c=>c.f>0||true),xc:S.xc}) : null;
        if (S.ion && conf2.reduce((s,c)=>s+c.f,0)===0) S.ion=null;
        S.homo=hi; S.show=new Set(S.res.orbitals.map((o,i)=>i).filter(i=>i>=S.res.orbitals.length-3));
        const dt=performance.now()-t;
        $('#ksStat',root).innerHTML=`${S.res.converged?'Convergió':'<b style="color:var(--bad)">No convergió</b>'} en ${S.res.history.length} iteraciones · ${Math.round(dt)} ms · ${fmt(S.res.charge,4)} electrones`;
      }catch(e){ $('#ksStat',root).textContent='Error: '+e.message; }
      $('#ksRun',root).disabled=false; drawAll();
    }, 20);
  }
  function table(){
    const r=S.res, E=r.energies, oncv = S.Z===14 && S.charge===0 && (S.xc==='pz'||S.xc==='vwn') ? PX.pseudo.si_lda.ae : null;
    $('#ksTab',root).innerHTML=`<thead><tr><th>Orbital</th><th>ocupación</th><th>ε (Ha)</th><th>ε (eV)</th><th>⟨r⟩ (Bohr)</th>${oncv?'<th>ONCVPSP (Ha, rel. escalar)</th>':''}</tr></thead><tbody>${r.orbitals.map(o=>{ const rr=r.grid.r, h=r.grid.h; let m=0; for(let i=0;i<rr.length;i++) m+=o.u[i]*o.u[i]*rr[i]*rr[i]*h; const ref=oncv&&oncv.find(a=>a[0]===o.n&&a[1]===o.l);
      return `<tr${o===S.homo?' class="hl"':''}><td>${o.n}${LL[o.l]}</td><td>${(+o.f.toFixed(3))}</td><td>${fmt(o.E,6)}</td><td>${fmt(o.E*HA,3)}</td><td>${fmt(m,3)}</td>${oncv?`<td>${ref?fmt(ref[3],6):'—'}</td>`:''}</tr>`; }).join('')}
      <tr><td colspan="${oncv?6:5}" style="border:0"></td></tr>
      ${[['Energía total',E.Etot],['Cinética T<sub>s</sub>',E.Ekin],['Electrón–núcleo',E.Een],['Hartree E<sub>H</sub>',E.EH],['Intercambio E<sub>x</sub>',E.Ex],['Correlación E<sub>c</sub>',E.Ec],['Σ f ε',E.ebs]].map(([n,v])=>`<tr><td>${n}</td><td></td><td>${fmt(v,6)}</td><td>${fmt(v*HA,2)}</td><td></td>${oncv?'<td></td>':''}</tr>`).join('')}
      <tr><td>Virial −V/T</td><td></td><td>${fmt(-(E.Etot-E.Ekin)/E.Ekin,6)}</td><td></td><td></td>${oncv?'<td></td>':''}</tr></tbody>`;
  }
  function chips(){
    $('#orbChips',root).innerHTML=S.res.orbitals.map((o,i)=>`<button class="tiny" data-i="${i}" aria-pressed="${S.show.has(i)}"><span class="sw" style="background:${orbColor(o,i)}"></span>${o.n}${LL[o.l]}</button>`).join('');
    $$('#orbChips button',root).forEach(b=>b.onclick=()=>{ const i=+b.dataset.i; S.show.has(i)?S.show.delete(i):S.show.add(i); b.setAttribute('aria-pressed',S.show.has(i)); drawOrb(); });
  }
  const sample=(arr, f, every=8)=>{ const r=S.res.grid.r, out=[]; for(let i=0;i<r.length;i+=every) out.push([r[i], f(arr,i)]); return out; };
  function xr(){ const r=S.res.grid.r; const far=S.res.orbitals.reduce((m,o)=>{ let i=r.length-1; while(i>0&&Math.abs(o.u[i])<1e-3) i--; return Math.max(m,r[i]); },1); return S.rscale==='log'?[Math.max(1e-3,0.02/S.Z),far*1.2]:[0,far*1.1]; }
  function drawOrb(){
    const lim=xr(), dash=[[],[6,3],[2,2],[8,3,2,3]];
    const series=S.res.orbitals.map((o,i)=>({o,i})).filter(x=>S.show.has(x.i)).map(({o,i})=>({d:sample(o.u,(u,j)=>u[j],3).filter(p=>p[0]>=lim[0]&&p[0]<=lim[1]),color:orbColor(o,i),width:2,dash:dash[(o.n-o.l-1)%4],label:`${o.n}${LL[o.l]}  ε = ${fmt(o.E,4)} Ha`}));
    chart($('#cvOrb',root),{xlim:lim,ylim:[-1.6,2.2],logx:S.rscale==='log',xlabel:'r (Bohr)',ylabel:'u(r)',series,legend:true,hlines:[{y:0}],
      read:x=>x==null?'Los nodos radiales son n − l − 1.':series.map(s=>{ const p=s.d.reduce((b,q)=>Math.abs(q[0]-x)<Math.abs(b[0]-x)?q:b,s.d[0]); return `<span><span class="sw" style="background:${s.color}"></span>${s.label.split(' ')[0]} <b>${fmt(p[1],3)}</b></span>`; }).join('')+`<span>r <b>${fmt(x,3)}</b></span>`,readEl:$('#orbRead',root)});
  }
  function drawPot(){
    const r=S.res.grid.r, Z=S.Z, lim=xr(); const rv=S.pot==='rV';
    const f=(arr)=>sample(arr,(a,i)=>rv?a[i]*r[i]:a[i],4).filter(p=>p[0]>=lim[0]&&p[0]<=lim[1]);
    const nuc=Float64Array.from(r,x=>-Z/x);
    const series=[{d:f(nuc),color:css('--faint'),width:1.4,dash:[4,3],label:'núcleo −Z/r'},{d:f(S.res.VH),color:css('--orb-p'),width:1.8,label:'Hartree v_H'},
      {d:f(S.res.Vxc),color:css('--orb-d'),width:1.8,label:'v_xc'},{d:f(S.res.V),color:css('--accent'),width:2.4,label:'v_eff total'}];
    const ne=S.res.charge;
    chart($('#cvPot',root),{xlim:lim,ylim:rv?[-Z*1.05,ne*1.05]:[-Math.min(4*Z,60),Math.min(3*Z,30)],logx:S.rscale==='log',xlabel:'r (Bohr)',ylabel:rv?'r·V(r)  (Ha·Bohr)':'V(r) (Ha)',series,legend:true,hlines:rv?[{y:-(Z-ne+1),dash:[2,3],label:'−(Z−N+1)'}]:[{y:0}],
      read:x=>{ if(x==null) return 'Pasa el cursor.'; return series.map(s=>{ const p=s.d.reduce((b,q)=>Math.abs(q[0]-x)<Math.abs(b[0]-x)?q:b,s.d[0]); return `<span><span class="sw" style="background:${s.color}"></span>${s.label} <b>${fmt(p[1],3)}</b></span>`; }).join(''); },readEl:$('#potRead',root)});
  }
  function drawRho(){
    const r=S.res.grid.r, lim=xr(); const tot=sample(S.res.rho,(a,i)=>4*Math.PI*r[i]*r[i]*a[i],3).filter(p=>p[0]>=lim[0]&&p[0]<=lim[1]);
    const parts=S.res.orbitals.map((o,i)=>({d:sample(o.u,(u,j)=>o.f*u[j]*u[j],3).filter(p=>p[0]>=lim[0]&&p[0]<=lim[1]),color:alpha(orbColor(o,i),0.8),width:1,label:`${o.n}${LL[o.l]}`}));
    const ymax=Math.max(...tot.map(p=>p[1]))*1.08;
    chart($('#cvRho',root),{xlim:lim,ylim:[0,ymax],logx:S.rscale==='log',xlabel:'r (Bohr)',ylabel:'4πr²ρ (e/Bohr)',legend:false,
      series:[{d:tot,color:css('--ink'),width:2.2,label:'total',fill:0,fillAlpha:0.08},...parts],
      read:x=>{ if(x==null) return `∫4πr²ρ dr = <b>${fmt(S.res.charge,5)}</b> electrones`; const p=tot.reduce((b,q)=>Math.abs(q[0]-x)<Math.abs(b[0]-x)?q:b,tot[0]); let q=0; const g=S.res.grid; for(let i=0;i<g.N&&g.r[i]<=x;i++) q+=4*Math.PI*g.r[i]**3*S.res.rho[i]*g.h; return `<span>r <b>${fmt(x,3)}</b></span><span>4πr²ρ <b>${fmt(p[1],3)}</b></span><span>carga dentro de r <b>${fmt(q,3)}</b></span>`; },readEl:$('#rhoRead',root)});
  }
  function drawHist(){
    const h=S.res.history, Ef=h[h.length-1].Etot;
    const d1=h.slice(0,-1).map(x=>[x.it,Math.max(Math.abs(x.Etot-Ef),1e-12)]), d2=h.filter(x=>x.dEig).map(x=>[x.it,Math.max(x.dEig,1e-12)]);
    chart($('#cvHist',root),{xlim:[1,Math.max(h.length,3)],ylim:[1e-10,1e3],logy:true,xlabel:'iteración',ylabel:'Ha',legend:true,
      series:[{d:d1,color:css('--accent'),width:2,label:'|E − E_final|'},{d:d2,color:css('--orb-d'),width:1.6,dash:[5,3],label:'máx |Δε|'}],
      read:x=>{ if(x==null) return 'Converge cuando energía y autovalores cambian menos de 10⁻⁷ Ha.'; const r=h[Math.round(x)-1]; return r?`<span>it <b>${r.it}</b></span><span>E <b>${fmt(r.Etot,6)} Ha</b></span>`:''; },readEl:$('#histRead',root)});
  }
  function ipBox(){
    const box=$('#ipBox',root);
    if(!S.ion){ box.innerHTML='<p class="note">Hace falta al menos un electrón para quitarlo.</p>'; return; }
    const koop=-S.homo.E*HA, dscf=(S.ion.energies.Etot-S.res.energies.Etot)*HA, exp=S.charge===0?IP[S.Z]:null;
    const max=Math.max(koop,dscf,exp||0)*1.15, bar=(v,c,l)=>`<div style="display:grid;grid-template-columns:150px minmax(0,1fr) 70px;gap:10px;align-items:center;font-size:12.5px"><span>${l}</span><span style="height:14px;background:var(--panel-2);border-radius:3px;overflow:hidden"><span style="display:block;height:100%;width:${(v/max*100).toFixed(1)}%;background:${c}"></span></span><span style="font-family:var(--f-data);text-align:right">${fmt(v,2)} eV</span></div>`;
    box.innerHTML=`<div style="display:flex;flex-direction:column;gap:6px;max-width:680px">${bar(koop,css('--orb-d'),'−ε<sub>HOMO</sub> ('+S.homo.n+LL[S.homo.l]+')')}${bar(dscf,css('--accent'),'ΔSCF: E(N−1) − E(N)')}${exp?bar(exp,css('--ink'),'Experimento (NIST)'):''}</div>
      <p class="note">${XCN[S.xc]}. ${exp?`−ε<sub>HOMO</sub> se queda en el ${Math.round(koop/exp*100)} % del valor medido; ΔSCF en el ${Math.round(dscf/exp*100)} %.`:''} ${S.xc==='none'?'Sin XC, cada electrón se repele a sí mismo en v<sub>H</sub> y todo queda menos ligado.':''} El cálculo es esférico y sin espín; en átomos de capa abierta (C, N, O) el ΔSCF con polarización de espín se acerca más.</p>`;
  }
  function drawAll(){ if(!S.res) return; table(); chips(); drawOrb(); drawPot(); drawRho(); drawHist(); ipBox(); }

  $('#ksZ',root).onchange=e=>{ S.Z=+e.target.value; setDefaults(); run(); };
  $('#ksQ',root).onchange=e=>{ S.charge=+e.target.value; if(S.Z-S.charge<=0){ S.charge=0; e.target.value=0; } setDefaults(); run(); };
  $('#ksXC',root).onchange=e=>{ S.xc=e.target.value; run(); };
  $('#ksRun',root).onclick=run;
  $('#ksConf',root).addEventListener('keydown',e=>{ if(e.key==='Enter') run(); });
  seg($('#rSel',root),'log',v=>{ S.rscale=v; drawAll(); });
  seg($('#pSel',root),'rV',v=>{ S.pot=v; drawPot(); });
  $('#ksRep',root).onclick=()=>{ if(!S.res) return; const r=S.res, E=r.energies;
    let t=`DFT Lab · átomo de Kohn-Sham\nZ = ${S.Z} (${SYMBOLS[S.Z]}), carga ${S.charge}, ${XCN[S.xc]}\nconfiguración: ${confString(r.conf)}\nconvergió: ${r.converged} en ${r.history.length} iteraciones\n\n# orbital  f  eps(Ha)  eps(eV)\n`+r.orbitals.map(o=>`${o.n}${LL[o.l]}  ${o.f}  ${o.E.toFixed(8)}  ${(o.E*HA).toFixed(5)}`).join('\n');
    t+=`\n\n# energías (Ha)\nEtot ${E.Etot.toFixed(8)}\nEkin ${E.Ekin.toFixed(8)}\nEen ${E.Een.toFixed(8)}\nEH ${E.EH.toFixed(8)}\nEx ${E.Ex.toFixed(8)}\nEc ${E.Ec.toFixed(8)}\n`;
    if(S.ion) t+=`\nDeltaSCF IP = ${((S.ion.energies.Etot-E.Etot)*HA).toFixed(4)} eV ; -eps_HOMO = ${(-S.homo.E*HA).toFixed(4)} eV\n`;
    t+=`\n# r(Bohr)  rho(e/Bohr^3)  V_eff(Ha)  V_H  V_xc  `+r.orbitals.map(o=>'u_'+o.n+LL[o.l]).join('  ')+'\n';
    for(let i=0;i<r.grid.N;i+=4) t+=[r.grid.r[i],r.rho[i],r.V[i],r.VH[i],r.Vxc[i],...r.orbitals.map(o=>o.u[i])].map(x=>x.toExponential(8)).join(' ')+'\n';
    downloadText(t,`ks_atomo_${SYMBOLS[S.Z]}.txt`); };

  $$('canvas[data-export]',root).forEach(cv=>{ const ph=cv.closest('.panel').querySelector('.ph .btnrow')||cv.closest('.panel').querySelector('.ph'); ph.append(exportBar(cv,cv.dataset.export)); });
  view.onTheme(drawAll); setDefaults(); run();
}
