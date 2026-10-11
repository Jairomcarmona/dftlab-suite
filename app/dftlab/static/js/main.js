// DFT Lab shell: sidebar navigation + hash router. Each view exports {render(el)} and optional {destroy()}.
import { $, $$, toast } from './core/ui.js';
import { VIEWS, GROUPS } from './views/registry.js';

const side=$('#side'), view=$('#view');
function nav(){
  side.innerHTML=`<div class="brand"><b>DFT Lab</b><span>SIESTA · v1</span></div>`+
    GROUPS.map(g=>`<nav class="navgrp" aria-label="${g.title}"><h4>${g.title}</h4>${VIEWS.filter(v=>v.group===g.id).map(v=>`<a href="#${v.id}" data-id="${v.id}"><span class="num">${v.num||''}</span><span>${v.title}</span></a>`).join('')}</nav>`).join('')+
    `<div class="sidefoot"><div class="btnrow"><button class="tiny" id="themeBtn" type="button">Tema</button></div><span>Cálculos reales con SIESTA 5.4.2. La app no ejecuta SIESTA: lee y exporta archivos.</span></div>`;
  $('#themeBtn').onclick=()=>{ const r=document.documentElement, cur=r.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'); r.dataset.theme = cur==='dark'?'light':'dark'; try{ localStorage.setItem('dftlab-theme', r.dataset.theme); }catch(e){} };
}
try{ const t=localStorage.getItem('dftlab-theme'); if(t) document.documentElement.dataset.theme=t; }catch(e){}
let current=null;
async function route(){
  const id=(location.hash||'#inicio').slice(1).split('/')[0];
  const v=VIEWS.find(x=>x.id===id)||VIEWS[0];
  if (current && current.destroy) try{ current.destroy(); }catch(e){}
  $$('.navgrp a').forEach(a=>a.setAttribute('aria-current', a.dataset.id===v.id?'page':'false'));
  $('#topTitle').textContent=v.title;
  side.classList.remove('open'); $('.scrim')?.remove();
  view.innerHTML='';
  current=v;
  try{ await v.render(view); }catch(e){ console.error(e); view.innerHTML=`<div class="callout warn">Esta sección no pudo cargarse: ${String(e.message||e)}</div>`; }
  window.scrollTo(0,0);
}
nav();
window.addEventListener('hashchange', route);
$('#menuBtn').onclick=()=>{ side.classList.add('open'); const s=document.createElement('div'); s.className='scrim'; s.onclick=()=>{ side.classList.remove('open'); s.remove(); }; document.body.appendChild(s); };
route();
