// Aprender 11 · Espín y magnetismo: Fe bcc ferromagnético frente a no magnético, y NiO ferromagnético frente a antiferromagnético (SIESTA 5.4.2, PBE).
import { $, $$, css, alpha, onTheme, fmt, downloadText, seg } from '../core/ui.js';
import { chart, exportBar } from '../core/chart.js';
import D from '../data/espin.json';

const KB_T = (eV) => eV * 11604.518;   // eV → K

function theory(){ return `
  <h3>DFT con espín: dos densidades</h3>
  <p>En el caso colineal el electrón tiene un eje de espín fijo y la densidad se separa en ρ<sub>↑</sub> y ρ<sub>↓</sub>. La energía de intercambio y correlación depende de ambas, y la magnetización es m(r) = ρ<sub>↑</sub>(r) − ρ<sub>↓</sub>(r), cuya integral es el momento total en μ<sub>B</sub>. Con <code>Spin polarized</code> SIESTA resuelve dos hamiltonianos acoplados por el potencial de xc; <code>DM.InitSpin</code> da la polarización inicial de cada especie o átomo y decide a qué solución del SCF se llega, ferromagnética (FM) o antiferromagnética (AFM).</p>
  <h3>Por qué un metal se magnetiza: el criterio de Stoner</h3>
  <p>Si se polariza el sistema, el intercambio baja la energía de los electrones ↑ y sube la de los ↓: aparece un desdoblamiento de intercambio Δ<sub>ex</sub> = I·m, con I el parámetro de Stoner, una propiedad atómica que cambia poco de un entorno a otro. Hacerlo cuesta energía cinética, que es menor cuanto mayor sea la densidad de estados en el nivel de Fermi. El estado no magnético es inestable si</p>
  <div class="eq">I · N<sub>σ</sub>(E<sub>F</sub>) &gt; 1</div>
  <p>con N<sub>σ</sub> la densidad de estados por espín y átomo del cálculo no magnético. En Fe, Co y Ni los picos de los estados 3d caen cerca de E<sub>F</sub> y se cumple; en los metales alcalinos y en Al, no. Esta pantalla mide I a partir de las dos corridas de Fe (I = Δ<sub>ex</sub>/m) y lo compara con el N(E<sub>F</sub>) de la corrida no magnética.</p>
  <h3>Magnetovolumen</h3>
  <p>El momento crece con la distancia entre átomos porque la banda d se estrecha y N(E<sub>F</sub>) aumenta. Por eso el parámetro de red de equilibrio del estado FM es mayor que el del no magnético; un cálculo de Fe sin espín da una celda demasiado pequeña. Esa diferencia se ve abajo en E(a).</p>
  <h3>Antiferromagnetismo y superintercambio</h3>
  <p>En NiO los Ni<sup>2+</sup> (3d⁸, S = 1) no se tocan: el acoplamiento pasa por el orbital 2p del O (superintercambio, Kramers 1934; Anderson 1950), que favorece espines antiparalelos en el camino Ni–O–Ni a 180°. En la estructura AFM-II los planos (111) de Ni alternan ↑ y ↓, lo que exige una celda romboédrica de dos Ni. Para comparar FM y AFM se usa la misma celda, el mismo U y los mismos proyectores, de modo que solo cambia la asignación inicial de espines (<code>DM.InitSpin</code>): ΔE = E<sub>FM</sub> − E<sub>AFM</sub> &gt; 0 significa que el AFM es el estado fundamental.</p>
  <h3>Qué no incluye este cálculo</h3>
  <p>Es colineal y sin acoplamiento espín–órbita: el momento que sale es el de espín, no hay anisotropía magnética ni momento orbital, y las diferencias de energía FM–AFM son del orden de decenas de meV, comparables con la precisión de la base DZP y de la malla k. El valor de ΔE depende del funcional y de U; la tendencia con U es más confiable que el número absoluto. Convertir ΔE en una temperatura de Néel o de Curie requiere un modelo de Heisenberg (que no se ajusta aquí), por lo que no se muestra ninguna.</p>
  <p class="src">Stoner, Proc. R. Soc. A 165, 372 (1938) · Janak, PRB 16, 255 (1977) · Kramers, Physica 1, 182 (1934) · Anderson, PRB 79, 350 (1950) · Moruzzi, Janak y Williams, <i>Calculated Electronic Properties of Metals</i> (1978) · Cococcioni y de Gironcoli, PRB 71, 035105 (2005).</p>`; }

export function mount(root){
  const F=D.fe, N=D.nio, eos=F.eos, eA=eos.find(e=>e.a===F.aExp)||eos[0];
  const dEFe=(eA.Efm-eA.Enm)*1000;                                   // meV, a = a_exp
  const mMin=(k,fit)=>{ const lo=eos.reduce((b,e)=>Math.abs(e.a-fit.a0)<Math.abs(b.a-fit.a0)?e:b); return lo; };
  const fmMin=F.fitFm, nmMin=F.fitNm;
  const eFmMin=fmMin.E0, eNmMin=nmMin.E0;
  const dEmin=(eNmMin-eFmMin)*1000;
  const mom0=(()=>{ const m=eos.map(e=>[e.a,e.mom]); for(let i=0;i<m.length-1;i++) if(m[i][0]<=fmMin.a0&&fmMin.a0<=m[i+1][0]){ const t=(fmMin.a0-m[i][0])/(m[i+1][0]-m[i][0]); return m[i][1]*(1-t)+m[i+1][1]*t; } return eA.mom; })();
  const Ufull=N.scan.find(s=>s.U===8)||N.scan[N.scan.length-1];
  const sc=N.scan, Umax=Math.max(...sc.map(s=>s.U));
  const dr=F.derived, Ieff=dr.exchSplit/eA.mom, stoner=Ieff*dr.NEFperSpin;
  const S={U:8, nio:'AFM', fe:'FM', feDos:'FM'};

  root.innerHTML=`
  <div class="pghead"><div>
    <div class="kicker">Aprender · 11</div><h1>Espín y magnetismo</h1>
    <p class="lede">Hierro bcc con y sin espín, y NiO ferromagnético frente a antiferromagnético, calculados con SIESTA y PBE. El Fe ferromagnético tiene μ = ${fmt(eA.mom,2)} μ<sub>B</sub> en a = ${fmt(F.aExp,3)} Å y es ${fmt(dEmin,0)} meV por átomo más estable que el no magnético (cada uno en su mínimo); en NiO con U = ${Ufull.U} eV el AFM gana al FM por ${fmt(Ufull.dE*1000,0)} meV por celda de dos fórmulas.</p>
  </div></div>
  <div class="pgrid">
    <article class="panel theory sticky">${theory()}</article>
    <div class="charts">

      <section class="panel wide"><div class="ph"><h2>Fe bcc · bandas</h2><div class="seg" id="feSel"><button data-v="FM">FM ↑↓</button><button data-v="NM">no magnético</button><button data-v="both">FM sobre NM</button></div></div>
        <div class="pb"><canvas data-export="Fe_bandas_espin" id="cvFeB" style="height:380px"></canvas><div class="readout" id="feBRead"></div>
        <p class="note">Energías relativas a E<sub>F</sub> en a = ${fmt(F.aExp,3)} Å. En el ferromagnético las bandas ↑ (<span class="sw" style="background:var(--up)"></span>) bajan y las ↓ (<span class="sw" style="background:var(--dn)"></span>) suben respecto a las del no magnético (gris): el desdoblamiento de intercambio separa los centroides de la DOS 3d (de −9 a 6 eV) en ${fmt(dr.cUp,2)} eV (↑) y ${fmt(dr.cDn,2)} eV (↓), es decir ${fmt(dr.exchSplit,2)} eV. Los 3d ↑ alojan ${fmt(dr.dOccUp,2)} electrones por debajo de E<sub>F</sub> y los ↓ ${fmt(dr.dOccDn,2)}.</p></div></section>

      <section class="panel wide"><div class="ph"><h2>Fe bcc · densidad de estados</h2><div class="seg" id="feDosSel"><button data-v="FM">FM</button><button data-v="NM">no magnético</button></div></div>
        <div class="pb"><canvas data-export="Fe_DOS_espin" id="cvFeD" style="height:340px"></canvas><div class="readout" id="feDRead"></div>
        <p class="note" id="feDNote"></p></div></section>

      <section class="panel"><div class="ph"><h2>Energía frente a parámetro de red</h2></div>
        <div class="pb"><canvas data-export="Fe_Ea_FM_NM" id="cvFeE" style="height:280px"></canvas><div class="readout" id="feERead"></div>
        <p class="note">Energía por átomo, con cero en el mínimo del ferromagnético. Cada punto es un SCF completo (bcc, 1 átomo/celda, k 16×16×16). Las líneas verticales marcan el mínimo ajustado (cúbica en V<sup>−2/3</sup>) de cada estado.</p></div></section>
      <section class="panel"><div class="ph"><h2>Momento frente a parámetro de red</h2></div>
        <div class="pb"><canvas data-export="Fe_momento_a" id="cvFeM" style="height:280px"></canvas><div class="readout" id="feMRead"></div>
        <p class="note">Momento total de espín por átomo de la corrida ferromagnética. Crece con la expansión de la red porque la banda 3d se estrecha; entre 2.85 y 2.90 Å el momento da un salto de 0.26 μ<sub>B</sub> en lugar de crecer suavemente (no se investigó su causa); el valor experimental es el momento total (espín y órbita) a temperatura ambiente.</p></div></section>

      <section class="panel wide"><div class="ph"><h2>NiO · FM frente a AFM</h2><div class="seg" id="nioSel"><button data-v="AFM">AFM-II</button><button data-v="FM">FM</button></div><div class="seg" id="uSel">${sc.map(s=>`<button data-v="${s.U}">U = ${s.U} eV</button>`).join('')}</div></div>
        <div class="pb"><canvas data-export="NiO_PDOS_FM_AFM" id="cvPd" style="height:340px"></canvas><div class="readout" id="pdRead"></div>
        <p class="note" id="pdNote"></p></div></section>

      <section class="panel"><div class="ph"><h2>ΔE = E<sub>FM</sub> − E<sub>AFM</sub> frente a U</h2></div>
        <div class="pb"><canvas data-export="NiO_dE_U" id="cvDe" style="height:260px"></canvas><div class="readout" id="deRead"></div>
        <p class="note">Energía por celda (dos Ni y dos O). Positivo: el AFM-II es el estado fundamental. Misma celda, mismos pseudos y misma base en ambos casos.</p></div></section>
      <section class="panel"><div class="ph"><h2>Momento del Ni y gap</h2></div>
        <div class="pb"><canvas data-export="NiO_momento_FM_AFM" id="cvMm" style="height:260px"></canvas><div class="readout" id="mmRead"></div>
        <p class="note" id="mmNote"></p></div></section>

      <section class="panel wide"><div class="ph"><h2>Resumen frente al experimento</h2></div>
        <div class="pb"><div id="tbl" style="overflow-x:auto"></div></div></section>

      <section class="panel"><div class="ph"><h2>Calculadora · criterio de Stoner</h2></div>
        <div class="pb"><label class="sl">I (eV) <input type="range" id="iIn" min="0.3" max="1.4" step="0.01" value="${Ieff.toFixed(2)}"><output id="iOut"></output></label>
          <label class="sl">N<sub>σ</sub>(E<sub>F</sub>) (estados/eV/átomo/espín) <input type="range" id="nIn" min="0.2" max="3" step="0.01" value="${dr.NEFperSpin.toFixed(2)}"><output id="nOut"></output></label>
          <div class="readout" id="stRead"></div>
          <p class="note" id="stNote"></p></div></section>

      <section class="panel"><div class="ph"><h2>Entradas de SIESTA</h2><div class="btnrow"><button class="tiny" id="dlFe">Fe FM .fdf</button><button class="tiny" id="dlNio">NiO FM U = 8 .fdf</button></div></div>
        <div class="pb"><pre class="code" style="max-height:300px;overflow:auto" id="fdfPre"></pre>
        <p class="note">Para el estado no magnético se quitan <code>Spin polarized</code> y <code>DM.InitSpin</code>; para el AFM de NiO el segundo Ni lleva <code>2 −</code> en <code>DM.InitSpin</code>.</p></div></section>
    </div>
  </div>
  <footer class="prov">SIESTA 5.4.2, PBE, pseudos ONCV de la biblioteca de DFT Lab (Fe con semicore 3s3p, 16 e⁻; Ni con 3s3p, 18 e⁻; O, 6 e⁻), base DZP, EnergyShift 50 meV, MeshCutoff 300 Ry. Fe: bcc de un átomo, k 16×16×16 (PDOS 24×24×24), Methfessel–Paxton de orden 1 con 0.1 eV, tolerancia de DM 10⁻⁵. NiO: celda romboédrica AFM-II de 4 átomos con a = 4.17 Å, k 6×6×6 (PDOS 12×12×12), 100 K, U de Dudarev sobre los 3d (corridas AFM de la sección 8, reutilizadas); FM con los dos Ni inicializados ↑. Momentos: espín total de la celda (Fe) y población de Mulliken (Ni). Experimento: Fe a = 2.866 Å, μ ≈ 2.22 μ<sub>B</sub>, B<sub>0</sub> ≈ 168 GPa (valores de libro, p. ej. Kittel); NiO μ 1.64–1.90 μ<sub>B</sub> (Cheetham y Hope 1983; Fender et al. 1968), gap 3.8–4.3 eV (Sawatzky y Allen 1984).</footer>`;

  // ---- Fe: bandas ----
  const bandSeries=(B,spin,color,w,lab,dash)=>B[spin].map((y,i)=>({d:B.x.map((x,k)=>[x,y[k]]),color,width:w,dash,label:i===0?lab:undefined}));
  function drawFeB(){
    const fm=F.bands.fm, nm=F.bands.nm, mode=S.fe;
    let series=[];
    if(mode==='FM'){ series=[...bandSeries(fm,'up',css('--up'),1.5,'espín ↑'),...bandSeries(fm,'dn',css('--dn'),1.5,'espín ↓')]; }
    else if(mode==='NM'){ series=bandSeries(nm,'up',css('--ink'),1.5,'no magnético'); }
    else { series=[...bandSeries(nm,'up',css('--faint'),1.4,'no magnético',[4,3]),...bandSeries(fm,'up',css('--up'),1.4,'FM ↑'),...bandSeries(fm,'dn',css('--dn'),1.4,'FM ↓')]; }
    const B=fm;
    chart($('#cvFeB',root),{xlim:[0,B.x[B.x.length-1]],ylim:[-9,6],xlabel:'',ylabel:'E − E_F (eV)',xticks:B.labels.map(l=>({x:l.x,label:l.label})),series,legend:true,hlines:[{y:0,dash:[4,3]}],nohover:true});
    const wd=(b)=>{ let lo=1e9,hi=-1e9; b.up.forEach(y=>{ if(y.some(e=>e>-9&&e<6)) { /* banda d */ } }); return null; };
    $('#feBRead',root).innerHTML=`<span>${fm.up.length} bandas ↑, ${fm.dn.length} ↓ en la ventana</span><span>E<sub>F</sub> FM <b>${fmt(fm.fermi,3)} eV</b></span><span>E<sub>F</sub> NM <b>${fmt(nm.fermi,3)} eV</b></span><span>camino Γ–H–N–Γ–P–H, ${fm.nk} puntos k</span>`;
  }
  // ---- Fe: DOS ----
  function drawFeD(){
    const P=F.pdos[S.feDos.toLowerCase()], E=P.E;
    const cols={d:css('--orb-d'),p:css('--orb-p'),s:css('--orb-s')};
    const series=[]; ['d','p','s'].forEach(l=>{ series.push({d:E.map((e,i)=>[e,P.up[l][i]]),color:cols[l],width:1.8,label:'Fe '+({d:'3d',p:'4p',s:'4s'})[l],fill:0,fillAlpha:l==='d'?0.15:0.05}); series.push({d:E.map((e,i)=>[e,-P.dn[l][i]]),color:cols[l],width:1.8,fill:0,fillAlpha:l==='d'?0.15:0.05}); });
    const iF=E.findIndex(e=>e>=0);
    chart($('#cvFeD',root),{xlim:[-9,6],ylim:[-4.5,4.5],xlabel:'E − E_F (eV)',ylabel:'estados/eV/átomo (↓ negativo)',series,legend:true,hlines:[{y:0}],vlines:[{x:0,dash:[4,3]}],
      read:x=>{ if(x==null) return `Fe a = ${fmt(F.aExp,3)} Å · ${S.feDos==='FM'?'ferromagnético':'no magnético'}`; const i=E.reduce((b,e,j)=>Math.abs(e-x)<Math.abs(E[b]-x)?j:b,0); return `<span>E <b>${fmt(E[i],2)} eV</b></span>`+['d','p','s'].map(l=>`<span><span class="sw" style="background:${cols[l]}"></span>${({d:'3d',p:'4p',s:'4s'})[l]} ↑ <b>${fmt(P.up[l][i],2)}</b> ↓ <b>${fmt(P.dn[l][i],2)}</b></span>`).join(''); },readEl:$('#feDRead',root)});
    const nEF=(spin)=>['s','p','d'].reduce((t,l)=>t+P[spin][l][iF],0);
    $('#feDNote',root).innerHTML = S.feDos==='FM'
      ? `En el ferromagnético la DOS ↑ queda desplazada hacia abajo ${fmt(dr.exchSplit,2)} eV respecto a la ↓ (centroides de los 3d: ${fmt(dr.cUp,2)} y ${fmt(dr.cDn,2)} eV). En E<sub>F</sub>, N<sub>↑</sub> = ${fmt(nEF('up'),2)} y N<sub>↓</sub> = ${fmt(nEF('dn'),2)} estados/eV; los 3d ocupados son ${fmt(dr.dOccUp,2)} (↑) y ${fmt(dr.dOccDn,2)} (↓) por átomo entre −9 y 0 eV, una diferencia de ${fmt(dr.dOccUp-dr.dOccDn,2)} electrones frente a μ = ${fmt(eA.mom,2)} μ<sub>B</sub>; no coinciden exactamente porque la PDOS excluye la contribución s y p (con polarización opuesta) y el traslape entre orbitales.`
      : `Sin espín cada banda es la mitad del total. N<sub>σ</sub>(E<sub>F</sub>) = ${fmt(nEF('up'),2)} estados/eV/átomo/espín (promedio en ±0.1 eV: ${fmt(dr.NEFperSpin,2)}). Con el I medido del ferromagnético (${fmt(Ieff,2)} eV), I·N<sub>σ</sub> = ${fmt(stoner,2)} &gt; 1, de modo que el criterio de Stoner predice la inestabilidad, como encuentra la comparación de energías.`;
  }
  // ---- Fe: E(a) y momento ----
  function drawFeE(){
    const E0=Math.min(...eos.map(e=>e.Efm)), E1=Math.min(...eos.map(e=>e.Enm));
    const Ef=eos.map(e=>[e.a,(e.Efm-E0)*1000]), En=eos.map(e=>[e.a,(e.Enm-E0)*1000]);
    chart($('#cvFeE',root),{xlim:[2.67,3.03],ylim:[-10,Math.max(...En.map(p=>p[1]))*1.05],xlabel:'a (Å)',ylabel:'E − E_min(FM) (meV/átomo)',legend:true,
      series:[{d:Ef,color:css('--up'),width:2,label:'ferromagnético'},{d:En,color:css('--ink'),width:2,label:'no magnético'}],
      points:[...Ef.map(p=>({x:p[0],y:p[1],color:css('--up'),r:3.5})),...En.map(p=>({x:p[0],y:p[1],color:css('--ink'),r:3.5}))],
      vlines:[{x:fmMin.a0,color:css('--up'),dash:[4,3],label:'FM'},{x:nmMin.a0,color:css('--ink'),dash:[4,3],label:'NM'},{x:F.aExp,color:css('--ok'),dash:[2,3],label:'exp.'}],
      read:x=>x==null?`FM: a₀ ${fmt(fmMin.a0,3)} Å, B₀ ${fmt(fmMin.B0,0)} GPa · NM: a₀ ${fmt(nmMin.a0,3)} Å, B₀ ${fmt(nmMin.B0,0)} GPa · experimento a = ${fmt(F.aExp,3)} Å`:'',readEl:$('#feERead',root)});
  }
  function drawFeM(){
    chart($('#cvFeM',root),{xlim:[2.67,3.03],ylim:[1.5,3.1],xlabel:'a (Å)',ylabel:'μ (μB/átomo)',series:[{d:eos.map(e=>[e.a,e.mom]),color:css('--up'),width:2,label:'SIESTA'}],points:eos.map(e=>({x:e.a,y:e.mom,color:css('--up'),r:3.5})),
      shade:[],hlines:[{y:2.22,color:css('--ok'),dash:[4,3],label:'exp. 2.22'}],vlines:[{x:fmMin.a0,color:css('--up'),dash:[4,3]}],legend:false,
      read:x=>{ if(x==null) return `μ(a₀ FM) ≈ ${fmt(mom0,2)} μB · μ(${fmt(F.aExp,3)} Å) = ${fmt(eA.mom,2)} μB · Mulliken ${fmt(eA.momMull,2)}`; const i=eos.reduce((b,e,j)=>Math.abs(e.a-x)<Math.abs(eos[b].a-x)?j:b,0); return `<span>a <b>${fmt(eos[i].a,3)} Å</b></span><span>μ <b>${fmt(eos[i].mom,3)} μB</b></span>`; },readEl:$('#feMRead',root)});
  }
  // ---- NiO ----
  const cur=()=>sc.find(s=>s.U===S.U);
  function drawPd(){
    const s=cur(), side=S.nio==='AFM'?s.afm:s.fm, P=side.pdos, E=N.E;
    if(!P){ chart($('#cvPd',root),{xlim:[-9,6],ylim:[-1,1],series:[],nohover:true}); $('#pdNote',root).textContent='Sin PDOS para este caso.'; return; }
    const K=[['Ni1-d',css('--orb-d'),'Ni 3d (Ni1)'],['O-p',css('--orb-p'),'O 2p']];
    const series=[];
    K.forEach(([k,c,l])=>{ series.push({d:E.map((e,i)=>[e,P[k].up[i]]),color:c,width:1.8,label:l,fill:0,fillAlpha:0.15}); series.push({d:E.map((e,i)=>[e,-P[k].dn[i]]),color:c,width:1.8,fill:0,fillAlpha:0.15}); });
    chart($('#cvPd',root),{xlim:[-9,6],ylim:[-6,6],xlabel:side.metallic?'E − E_F (eV)':'E − borde de valencia (eV)',ylabel:'estados/eV (↓ negativo)',series,legend:true,hlines:[{y:0}],vlines:[{x:0,dash:[4,3]}],
      shade:side.metallic?[]:[{x0:0,x1:side.gap,color:alpha(css('--accent'),0.08),label:'gap '+fmt(side.gap,2)+' eV'}],
      read:x=>{ if(x==null) return `${S.nio} · U = ${s.U} eV · ${side.metallic?'metálico':'gap '+fmt(side.gap,2)+' eV'} · μ(Ni1) ${fmt(side.mom,2)} μB · E = ${fmt(side.etot,3)} eV`; const i=E.reduce((b,e,j)=>Math.abs(e-x)<Math.abs(E[b]-x)?j:b,0); return K.map(([k,c,l])=>`<span><span class="sw" style="background:${c}"></span>${l} ↑ <b>${fmt(P[k].up[i],2)}</b> ↓ <b>${fmt(P[k].dn[i],2)}</b></span>`).join('')+`<span>E <b>${fmt(x,2)} eV</b></span>`; },readEl:$('#pdRead',root)});
    $('#pdNote',root).innerHTML = S.nio==='AFM'
      ? `AFM-II: la PDOS del Ni2 es la imagen especular de la del Ni1 (espines invertidos), así que basta mostrar un Ni. Gap ${fmt(s.afm.gap,2)} eV y momento ${fmt(s.afm.mom,2)} μ<sub>B</sub>.`
      : `FM: los dos Ni apuntan ↑ y el momento total de la celda es ${fmt(s.fm.S,2)} μ<sub>B</sub> (Ni1 ${fmt(s.fm.mom,2)}, Ni2 ${fmt(s.fm.momNi2,2)} por Mulliken). ${s.fm.metallic?'El estado FM resulta metálico en este cálculo: hay estados de un espín cruzando E<sub>F</sub> y la referencia de energía es E<sub>F</sub>.':'El FM mantiene un gap de '+fmt(s.fm.gap,2)+' eV ('+(s.fm.type==='direct'?'directo':'indirecto')+', mínimo entre ambos espines).'} ΔE = E<sub>FM</sub> − E<sub>AFM</sub> = ${fmt(s.dE*1000,0)} meV por celda.`;
  }
  function drawDe(){
    const d=sc.map(s=>[s.U,s.dE*1000]);
    const ymax=Math.max(...d.map(p=>p[1]), 10)*1.15, ymin=Math.min(...d.map(p=>p[1]),0)*1.15-5;
    chart($('#cvDe',root),{xlim:[-0.3,Umax+0.5],ylim:[ymin,ymax],xlabel:'U (eV)',ylabel:'E_FM − E_AFM (meV/celda)',series:[{d,color:css('--accent'),width:2,label:'SIESTA PBE+U'}],points:d.map(p=>({x:p[0],y:p[1],color:p[0]===S.U?css('--bad'):css('--accent'),r:p[0]===S.U?5:3.5})),hlines:[{y:0}],legend:false,nohover:true});
    $('#deRead',root).innerHTML=sc.map(s=>`<span>U ${s.U}: <b>${fmt(s.dE*1000,0)}</b> meV</span>`).join('');
  }
  function drawMm(){
    const A=sc.map(s=>[s.U,s.afm.mom]), Fm=sc.map(s=>[s.U,s.fm.mom]);
    chart($('#cvMm',root),{xlim:[-0.3,Umax+0.5],ylim:[1.0,2.2],xlabel:'U (eV)',ylabel:'μ(Ni) Mulliken (μB)',legend:true,
      series:[{d:A,color:css('--orb-d'),width:2,label:'AFM-II'},{d:Fm,color:css('--accent'),width:2,dash:[5,3],label:'FM'}],points:[...A.map(p=>({x:p[0],y:p[1],color:css('--orb-d'),r:3.5})),...Fm.map(p=>({x:p[0],y:p[1],color:css('--accent'),r:3.5}))],
      shade:[{y0:1.64,y1:1.90,color:alpha(css('--ok'),0.15),label:'experimento'}],nohover:true});
    $('#mmRead',root).innerHTML=sc.map(s=>`<span>U ${s.U}: gap AFM <b>${fmt(s.afm.gap,2)}</b> · FM <b>${s.fm.metallic?'metal':fmt(s.fm.gap,2)}</b></span>`).join('');
    $('#mmNote',root).innerHTML='Momento de espín de Mulliken del Ni1 y gap (eV) de los autovalores de la malla k. Para el FM el gap se toma entre ambos espines.';
  }
  // ---- tabla de resumen ----
  function drawTbl(){
    const row=(a,b,c,d)=>`<tr><td>${a}</td><td>${b}</td><td style="text-align:left">${c}</td><td style="text-align:left">${d}</td></tr>`;
    $('#tbl',root).innerHTML=`<table class="tbl"><thead><tr><th>Cantidad</th><th>SIESTA (PBE, DZP)</th><th>Experimento</th><th>Comentario</th></tr></thead><tbody>
      ${row('Fe · a₀ ferromagnético',fmt(fmMin.a0,3)+' Å','2.866 Å','ajuste cúbico en V<sup>−2/3</sup> sobre '+eos.length+' puntos')}
      ${row('Fe · a₀ no magnético',fmt(nmMin.a0,3)+' Å','—','más pequeña: no hay expansión magnetovolumétrica')}
      ${row('Fe · B₀ ferromagnético',fmt(fmMin.B0,0)+' GPa','≈ 168 GPa','sensible a la forma del ajuste')}
      ${row('Fe · μ en a<sub>exp</sub>',fmt(eA.mom,2)+' μ<sub>B</sub>','≈ 2.22 μ<sub>B</sub>','espín solamente; sin contribución orbital')}
      ${row('Fe · E<sub>NM</sub> − E<sub>FM</sub> en a<sub>exp</sub>',fmt(-dEFe,0)+' meV/átomo','—','energía de magnetización a red fija')}
      ${row('Fe · E<sub>NM</sub> − E<sub>FM</sub> en mínimos',fmt(dEmin,0)+' meV/átomo','—','cada estado en su propio a₀')}
      ${row('Fe · desdoblamiento Δ<sub>ex</sub>',fmt(dr.exchSplit,2)+' eV','—','centroides 3d de −9 a 6 eV')}
      ${row('Fe · I = Δ<sub>ex</sub>/μ',fmt(Ieff,2)+' eV','≈ 0.9 eV','Janak 1977 (cálculo, no experimento)')}
      ${row('Fe · I·N<sub>σ</sub>(E<sub>F</sub>)',fmt(stoner,2),'&gt; 1 (ferromagnético)','criterio de Stoner')}
      ${sc.map(s=>row('NiO · U = '+s.U+' eV · E<sub>FM</sub> − E<sub>AFM</sub>',fmt(s.dE*1000,0)+' meV/celda · gap AFM '+fmt(s.afm.gap,2)+' · FM '+(s.fm.metallic?'metal':fmt(s.fm.gap,2))+' eV','gap 3.8–4.3 eV; μ 1.64–1.90 μ<sub>B</sub>','μ(Ni) AFM '+fmt(s.afm.mom,2)+' · FM '+fmt(s.fm.mom,2)+' μ<sub>B</sub>')).join('')}
      </tbody></table>`;
  }
  // ---- Stoner ----
  function drawSt(){
    const I=+$('#iIn',root).value, n=+$('#nIn',root).value; $('#iOut',root).textContent=I.toFixed(2); $('#nOut',root).textContent=n.toFixed(2);
    const p=I*n;
    $('#stRead',root).innerHTML=`<span>I·N<sub>σ</sub> = <b>${fmt(p,2)}</b></span><span class="${p>1?'':''}">${p>1?'inestable: el metal se magnetiza':'estable: el no magnético se mantiene'}</span>`;
    $('#stNote',root).innerHTML=`Con los valores medidos en esta pantalla (I = ${fmt(Ieff,2)} eV, N<sub>σ</sub> = ${fmt(dr.NEFperSpin,2)}) el producto es ${fmt(stoner,2)}. Para que se cumpla el criterio con I = ${fmt(Ieff,2)} eV hace falta N<sub>σ</sub> &gt; ${fmt(1/Ieff,2)}. Es una estimación de campo medio con el I que sale del ferromagnético, no una predicción independiente.`;
  }

  $('#fdfPre',root).textContent=F.fdf;
  $('#dlFe',root).onclick=()=>downloadText(F.fdf,'Fe_FM.fdf');
  $('#dlNio',root).onclick=()=>downloadText(N.fdfFm||'','NiO_FM_U8.fdf');
  seg($('#feSel',root),S.fe,v=>{ S.fe=v; drawFeB(); });
  seg($('#feDosSel',root),S.feDos,v=>{ S.feDos=v; drawFeD(); });
  seg($('#nioSel',root),S.nio,v=>{ S.nio=v; drawPd(); });
  seg($('#uSel',root),String(S.U),v=>{ S.U=+v; drawPd(); drawDe(); });
  $('#iIn',root).oninput=drawSt; $('#nIn',root).oninput=drawSt;
  $$('canvas[data-export]',root).forEach(cv=>{ const ph=cv.closest('.panel').querySelector('.ph .btnrow')||cv.closest('.panel').querySelector('.ph'); ph.append(exportBar(cv,cv.dataset.export)); });
  const all=()=>{ drawFeB(); drawFeD(); drawFeE(); drawFeM(); drawPd(); drawDe(); drawMm(); drawTbl(); drawSt(); };
  onTheme(all); all();
}
