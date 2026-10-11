// DFT Lab shell: sidebar navigation + hash router. Each view exports {render(el, view)} and optional {destroy()}.
// `view` es el ámbito de vida del montaje (core/lifecycle.js): lo que registre se libera al navegar.
import { $, $$, toast } from './core/ui.js';
import { createViewScope, mountView } from './core/lifecycle.js';
import { createFrontendStores } from './core/stores.js';
import { releaseCharts } from './core/chart.js';
import { VIEWS, GROUPS } from './views/registry.js';

const side=$('#side'), view=$('#view');
function nav(){
  side.innerHTML=`<div class="brand"><b>DFT Lab</b><span>SIESTA · v1</span></div>`+
    GROUPS.map(g=>`<nav class="navgrp" aria-label="${g.title}"><h4>${g.title}</h4>${VIEWS.filter(v=>v.group===g.id).map(v=>`<a href="#${v.id}" data-id="${v.id}"><span class="num">${v.num||''}</span><span>${v.title}</span></a>`).join('')}</nav>`).join('')+
    `<div class="sidefoot"><div class="btnrow"><button class="tiny" id="themeBtn" type="button">Tema</button></div><span>Cálculos reales con SIESTA 5.4.2. La app no ejecuta SIESTA: lee y exporta archivos.</span></div>`;
  $('#themeBtn').onclick=()=>{ const r=document.documentElement, cur=r.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'); r.dataset.theme = cur==='dark'?'light':'dark'; try{ localStorage.setItem('dftlab-theme', r.dataset.theme); }catch(e){} };
}
try{ const t=localStorage.getItem('dftlab-theme'); if(t) document.documentElement.dataset.theme=t; }catch(e){}
const stores=createFrontendStores();
let scope=null, seq=0;
async function route(){
  const id=(location.hash||'#inicio').slice(1).split('/')[0];
  const v=VIEWS.find(x=>x.id===id)||VIEWS[0];
  const my=++seq;
  scope?.dispose();   // libera la vista anterior (incluido su destroy) una sola vez
  const project=v.group==='tools' || v.group==='post' ? stores.captureProject() : null;
  const sc=scope=createViewScope({area:v.group, store:stores.forArea(v.group), project});
  // Las vistas actuales conservan su estado local. Nuevas vistas consumen context.store.
  // El shell vuelve a montar herramientas al cambiar proyecto, sin tocar Aprender.
  $$('.navgrp a').forEach(a=>a.setAttribute('aria-current', a.dataset.id===v.id?'page':'false'));
  $('#topTitle').textContent=v.title;
  side.classList.remove('open'); $('.scrim')?.remove();
  // Contenedor nuevo por montaje: lo que una vista abandonada escriba tras un await no alcanza a la siguiente.
  const host=document.createElement('div'); host.className='viewhost'; host.dataset.view=v.id;
  view.replaceChildren(host);
  sc.add(()=>releaseCharts(host));   // los gráficos de la vista dejan de observarse al salir
  try{ await mountView(v, host, sc); }catch(e){ if(!sc.alive) return; console.error(e); host.replaceChildren(); const box=document.createElement('div'); box.className='callout warn'; box.textContent='Esta sección no pudo cargarse: '+String(e.message||e); host.appendChild(box); }
  if (my===seq) window.scrollTo(0,0);
}
nav();
stores.subscribe(()=>{ if (scope?.context.project) route(); });
window.addEventListener('hashchange', route);
$('#menuBtn').onclick=()=>{ side.classList.add('open'); const s=document.createElement('div'); s.className='scrim'; s.onclick=()=>{ side.classList.remove('open'); s.remove(); }; document.body.appendChild(s); };
route();
if (typeof __DFTLAB_OPERATIVE__ !== 'undefined' && __DFTLAB_OPERATIVE__) {
  import('./application/operative-shell.js').then(module=>module.attach({stores}));
}
