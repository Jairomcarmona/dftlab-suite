// Small DOM and formatting helpers shared by all views.
export const $ = (s, root=document) => root.querySelector(s);
export const $$ = (s, root=document) => [...root.querySelectorAll(s)];
export const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
export function alpha(col, a){
  if (!col) return col;
  if (col.startsWith('#')){ const n=parseInt(col.slice(1,7),16); return `rgba(${n>>16&255},${n>>8&255},${n&255},${a})`; }
  const m=/rgba?\(([^)]+)\)/.exec(col); if (m){ const p=m[1].split(',').map(s=>s.trim()); return `rgba(${p[0]},${p[1]},${p[2]},${a})`; }
  return col;
}
export function rgb(col){ if(col.startsWith('#')){ const n=parseInt(col.slice(1,7),16); return [n>>16&255,n>>8&255,n&255]; } const m=/rgba?\(([^)]+)\)/.exec(col); return m?m[1].split(',').slice(0,3).map(Number):[0,0,0]; }
export const fmt = (x, n=2) => !isFinite(x) ? '—' : (x<0?'−':'') + Math.abs(x).toFixed(n);
export { esc } from './escape.js';
export function html(strings, ...vals){ return strings.reduce((a,s,i)=>a+s+(i<vals.length?vals[i]:''),''); }
export function el(tag, attrs={}, inner=''){ const e=document.createElement(tag); for (const [k,v] of Object.entries(attrs)){ if(k==='class') e.className=v; else if(k.startsWith('on')) e.addEventListener(k.slice(2),v); else e.setAttribute(k,v); } if(inner) e.innerHTML=inner; return e; }
export function debounce(f, ms=60){ let t=0; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>f(...a),ms); }; }

// Download a Blob. Works in a normal browser tab; some sandboxed embeds block it, so we also report back.
export function download(blob, name){
  try{
    const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 4000);
    toast('Exportado: '+name);
  }catch(e){ toast('El navegador bloqueó la descarga de '+name); }
}
export function downloadText(text, name, type='text/plain'){ download(new Blob([text],{type}), name); }
let toastEl=null, toastT=0;
export function toast(msg){
  if(!toastEl){ toastEl=document.createElement('div'); toastEl.setAttribute('role','status'); toastEl.style.cssText='position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);background:var(--ink);color:var(--panel);font:12.5px var(--f-ui);padding:8px 14px;border-radius:4px;z-index:50;max-width:90vw'; document.body.appendChild(toastEl); }
  toastEl.textContent=msg; toastEl.hidden=false; clearTimeout(toastT); toastT=setTimeout(()=>toastEl.hidden=true,2600);
}
// segmented control helper: buttons with data-v; calls onChange(value)
export function seg(container, value, onChange){
  const btns=$$('button',container);
  const set=v=>btns.forEach(b=>b.setAttribute('aria-pressed', b.dataset.v===String(v)));
  btns.forEach(b=>b.addEventListener('click',()=>{ set(b.dataset.v); onChange(b.dataset.v); }));
  set(value); return set;
}
export function panel({title, sub='', id='', cls='', body='', tools=''}){
  return `<section class="panel ${cls}" ${id?`id="${id}"`:''}><div class="ph"><h2>${title}</h2><div class="btnrow">${tools}${sub?`<span class="sub">${sub}</span>`:''}</div></div><div class="pb">${body}</div></section>`;
}
// theme observer: call f when colors change
export function onTheme(f){
  try{ matchMedia('(prefers-color-scheme: dark)').addEventListener('change', f); }catch(e){}
  new MutationObserver(f).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
}
export const HA=27.211386245988, RY=13.605693122994, BOHR=0.529177210903;
export const LN=['s','p','d','f','g'];
export const lcol = l => css(['--orb-s','--orb-p','--orb-d','--orb-f','--faint'][l]||'--faint');
