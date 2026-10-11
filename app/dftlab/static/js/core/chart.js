// Generic 2D chart used everywhere in DFT Lab: canvas on screen, SVG/PNG/CSV on export.
import { SvgCtx } from './svgctx.js';
import { css, alpha, download } from './ui.js';

const PAD = {l:50, r:12, t:12, b:36};
function step(span){ const raw=span/5, p=Math.pow(10,Math.floor(Math.log10(raw||1))), m=raw/p; return (m<1.5?1:m<3.5?2:m<7.5?5:10)*p; }
export function ticks(a,b,st){ const s=st||step(b-a), t=[]; for(let v=Math.ceil(a/s-1e-9)*s; v<=b+1e-9*Math.abs(s); v+=s) t.push(Math.abs(v)<Math.abs(s)*1e-6?0:+v.toPrecision(10)); return t; }
export function fmtT(v,st){ const a=Math.abs(v); if(a===0) return '0'; let s; if(st&&a<1e4&&st>=1e-4){ const d=Math.max(0,-Math.floor(Math.log10(st)+1e-9)); return (v<0?'−':'')+a.toFixed(d); } if(a>=1000) s=a.toExponential(1).replace('e+','e'); else if(a>=10) s=(+a.toFixed(1)).toString(); else if(a>=1) s=(+a.toFixed(2)).toString(); else if(a>=0.01) s=(+a.toPrecision(2)).toString(); else s=a.toExponential(0); return (v<0?'−':'')+s; }
const SUP={'-':'⁻','0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹'};
const supr=n=>String(n).split('').map(ch=>SUP[ch]||ch).join('');
export function interp(d,x){ if(!d||!d.length) return NaN; if(x<=d[0][0]) return d[0][1]; for(let i=1;i<d.length;i++){ if(d[i][0]>=x){ const t=(x-d[i-1][0])/((d[i][0]-d[i-1][0])||1); return d[i-1][1]+t*(d[i][1]-d[i-1][1]); } } return d[d.length-1][1]; }

function setupCanvas(cv){
  const r=cv.getBoundingClientRect(), dpr=Math.min(window.devicePixelRatio||1,2);
  cv.width=Math.max(1,Math.round(r.width*dpr)); cv.height=Math.max(1,Math.round(r.height*dpr));
  const c=cv.getContext('2d'); c.setTransform(dpr,0,0,dpr,0,0); return {c,W:r.width,H:r.height};
}

// cfg:
//  xlim,ylim: [a,b]; logy/logx; xlabel,ylabel; pad
//  series: [{d:[[x,y]], color, width, dash, label, fill:true|baseline number, fillAlpha, nohover, step}]
//  segments: [{x0,y0,x1,y1,color,width}] (fast many-line drawing, e.g. bands)
//  shade: [{x0,x1,y0,y1,color,label}] ; vlines/hlines: [{x|y,label,color,dash,dy}]
//  points: [{x,y,color,r,ring,label,align}]
//  xticks: [{x,label}] custom ticks (e.g. Γ X L); yticksStep / xticksStep
//  legend: true|false|'left'; overlay(c,map) extra drawing hook; read(x,y)->html with readEl
//  onclick(x,y)
export function draw(c, W, H, cfg, hover){
  const P={...PAD, ...(cfg.pad||{})}, [x0,x1]=cfg.xlim, [y0,y1]=cfg.ylim;
  const lx=cfg.logx, ly=cfg.logy, X0=lx?Math.log10(x0):x0, X1=lx?Math.log10(x1):x1, Y0=ly?Math.log10(y0):y0, Y1=ly?Math.log10(y1):y1;
  const X=x=>P.l+((lx?Math.log10(Math.max(x,1e-300)):x)-X0)/(X1-X0)*(W-P.l-P.r);
  const Y=y=>P.t+(Y1-(ly?Math.log10(Math.max(y,1e-300)):y))/(Y1-Y0)*(H-P.t-P.b);
  const map={X,Y,P,W,H,iX:px=>{ const v=X0+(px-P.l)/(W-P.l-P.r)*(X1-X0); return lx?Math.pow(10,v):v; }, iY:py=>{ const v=Y1-(py-P.t)/(H-P.t-P.b)*(Y1-Y0); return ly?Math.pow(10,v):v; }};
  const ink=css('--ink'), muted=css('--muted'), line=css('--line'), faint=css('--faint'), fdata=css('--f-data'), flabel=css('--f-label');
  if (cfg.bg){ c.fillStyle=cfg.bg; c.fillRect(0,0,W,H); } else c.clearRect(0,0,W,H);
  for (const s of cfg.shade||[]){ c.fillStyle=s.color||css('--gapfill'); const ya=s.y1!==undefined?Y(s.y1):P.t, yb=s.y0!==undefined?Y(s.y0):H-P.b; const xa=s.x0!==undefined?X(s.x0):P.l, xb=s.x1!==undefined?X(s.x1):W-P.r;
    c.fillRect(xa,ya,xb-xa,yb-ya); if(s.label){ c.fillStyle=faint; c.font='11px '+flabel; c.textAlign='left'; c.textBaseline='top'; c.fillText(s.label,xa+4,ya+3); } }
  c.font='11px '+fdata; c.lineWidth=1;
  const yt = ly ? (()=>{ const t=[]; for(let e=Math.ceil(Y0-1e-9);e<=Y1+1e-9;e++) t.push(Math.pow(10,e)); return t; })() : ticks(y0,y1,cfg.yticksStep);
  c.textAlign='right'; c.textBaseline='middle';
  for (const v of yt){ const y=Y(v); c.strokeStyle=line; c.beginPath(); c.moveTo(P.l,y); c.lineTo(W-P.r,y); c.stroke(); c.fillStyle=muted; c.fillText(ly?('10'+supr(Math.round(Math.log10(v)))):(cfg.fy?cfg.fy(v):fmtT(v,yt.length>1?Math.abs(yt[1]-yt[0]):0)),P.l-6,y); }
  c.textAlign='center'; c.textBaseline='top';
  if (cfg.xticks){ c.font='12px '+fdata; for (const t of cfg.xticks){ const x=X(t.x); c.strokeStyle=t.strong===false?line:faint; c.beginPath(); c.moveTo(x,P.t); c.lineTo(x,H-P.b); c.stroke(); c.fillStyle=ink; c.fillText(t.label,x,H-P.b+6); } }
  else { const xt = lx ? (()=>{ const t=[]; for(let e=Math.ceil(X0-1e-9);e<=X1+1e-9;e++) t.push(Math.pow(10,e)); return t; })() : ticks(x0,x1,cfg.xticksStep);
    for (const v of xt){ const x=X(v); c.strokeStyle=line; c.beginPath(); c.moveTo(x,H-P.b); c.lineTo(x,H-P.b+4); c.stroke(); c.fillStyle=muted; c.fillText(lx?('10'+supr(Math.round(Math.log10(v)))):(cfg.fx?cfg.fx(v):fmtT(v,xt.length>1?Math.abs(xt[1]-xt[0]):0)),x,H-P.b+6); } }
  c.strokeStyle=faint; c.beginPath(); c.moveTo(P.l,P.t); c.lineTo(P.l,H-P.b); c.lineTo(W-P.r,H-P.b); c.stroke();
  c.font='11px '+flabel; c.fillStyle=muted; c.textAlign='center'; c.textBaseline='top'; if(cfg.xlabel) c.fillText(cfg.xlabel,(P.l+W-P.r)/2,H-15);
  if (cfg.ylabel){ c.save(); c.translate(11,(P.t+H-P.b)/2); c.rotate(-Math.PI/2); c.textAlign='center'; c.textBaseline='middle'; c.fillText(cfg.ylabel,0,0); c.restore(); }
  c.save(); c.beginPath(); c.rect(P.l,P.t,W-P.l-P.r,H-P.t-P.b); c.clip();
  for (const h of cfg.hlines||[]){ c.strokeStyle=h.color||faint; c.lineWidth=h.width||1; c.setLineDash(h.dash||[3,3]); c.beginPath(); c.moveTo(P.l,Y(h.y)); c.lineTo(W-P.r,Y(h.y)); c.stroke(); c.setLineDash([]);
    if(h.label){ c.fillStyle=h.color||faint; c.font='11px '+flabel; c.textAlign=h.left?'left':'right'; c.textBaseline='bottom'; c.fillText(h.label,h.left?P.l+6:W-P.r-4,Y(h.y)-2); } }
  for (const v of cfg.vlines||[]){ c.strokeStyle=v.color||faint; c.lineWidth=v.width||1; c.setLineDash(v.dash||[3,3]); c.beginPath(); c.moveTo(X(v.x),P.t); c.lineTo(X(v.x),H-P.b); c.stroke(); c.setLineDash([]);
    if(v.label){ c.fillStyle=v.color||faint; c.font='11px '+flabel; c.textAlign='left'; c.textBaseline='top'; c.fillText(v.label,X(v.x)+4,P.t+(v.dy||3)); } }
  for (const s of cfg.series){ if(!s.d||!s.d.length) continue;
    if (s.fill!==undefined && s.fill!==false){ const base=typeof s.fill==='number'?s.fill:(ly?y0:Math.max(y0,Math.min(y1,0)));
      c.beginPath(); c.moveTo(X(s.d[0][0]),Y(base)); for (const [x,y] of s.d) if(isFinite(y)) c.lineTo(X(x),Y(y)); c.lineTo(X(s.d[s.d.length-1][0]),Y(base)); c.closePath(); c.fillStyle=alpha(s.color,s.fillAlpha??.16); c.fill(); }
    if (s.width===0) continue;
    c.strokeStyle=s.color; c.lineWidth=s.width||1.8; c.setLineDash(s.dash||[]);
    c.beginPath(); let st=false, py=null; for (const [x,y] of s.d){ if(!isFinite(y)){ st=false; continue; } const px=X(x), yy=Y(y); if(!st){c.moveTo(px,yy);st=true;} else { if(s.step && py!==null) c.lineTo(px,py); c.lineTo(px,yy);} py=yy; } c.stroke(); c.setLineDash([]); }
  for (const g of cfg.segments||[]){ c.strokeStyle=g.color; c.lineWidth=g.width||1.6; c.beginPath(); c.moveTo(X(g.x0),Y(g.y0)); c.lineTo(X(g.x1),Y(g.y1)); c.stroke(); }
  if (cfg.overlay) cfg.overlay(c,map);
  for (const p of cfg.points||[]){ c.fillStyle=p.color; c.strokeStyle=cfg.bg||css('--panel'); c.lineWidth=1.2; c.beginPath(); c.arc(X(p.x),Y(p.y),p.r||3.2,0,7); c.fill(); if(p.ring) c.stroke(); }
  c.restore();
  for (const p of cfg.points||[]){ if(!p.label) continue; c.fillStyle=p.color; c.font='11px '+flabel; c.textAlign=p.align||'left'; c.textBaseline='bottom'; c.fillText(p.label,X(p.x)+(p.align==='right'?-6:6),Y(p.y)-3); }
  const leg=(cfg.legend===false)?[]:cfg.series.filter(s=>s.label);
  if (leg.length){ c.font='11.5px '+flabel; const wmax=Math.max(...leg.map(s=>c.measureText(s.label).width)); const left=cfg.legend==='left';
    const bx=left?P.l+8:W-P.r-wmax-38, by=P.t+4;
    c.fillStyle=alpha(cfg.bg||css('--panel'),.86); c.fillRect(bx,by,wmax+32,leg.length*16+6);
    let y=by+11; for (const s of leg){ c.strokeStyle=s.color; c.lineWidth=2; c.setLineDash(s.dash||[]); c.beginPath(); c.moveTo(bx+6,y); c.lineTo(bx+20,y); c.stroke(); c.setLineDash([]); c.fillStyle=ink; c.textAlign='left'; c.textBaseline='middle'; c.fillText(s.label,bx+25,y); y+=16; } }
  if (hover && hover.x!=null){ const x=X(hover.x); c.strokeStyle=css('--accent'); c.lineWidth=1; c.setLineDash([4,3]); c.beginPath(); c.moveTo(x,P.t); c.lineTo(x,H-P.b); c.stroke(); c.setLineDash([]);
    for (const s of cfg.series){ if(!s.d||!s.d.length||s.nohover||s.width===0) continue; const v=interp(s.d,hover.x); if(!isFinite(v)) continue; const y=Y(v); if(y<P.t||y>H-P.b) continue; c.fillStyle=s.color; c.beginPath(); c.arc(x,y,3,0,7); c.fill(); } }
  return map;
}

// Attach a chart to a canvas (re-callable: replaces cfg and re-renders)
export function chart(cv, cfg){
  cv._cfg=cfg;
  if (!cv._bound){
    cv._bound=true; cv._hover=null;
    const toData=ev=>{ const r=cv.getBoundingClientRect(); const m=cv._map; if(!m) return null; const x=m.iX(ev.clientX-r.left), y=m.iY(ev.clientY-r.top); const [a,b]=cv._cfg.xlim; return {x:Math.max(Math.min(a,b),Math.min(Math.max(a,b),x)), y, px:ev.clientX-r.left, py:ev.clientY-r.top}; };
    cv.addEventListener('pointermove', ev=>{ if(cv._cfg.nohover) return; cv._hover=toData(ev); render(cv); });
    cv.addEventListener('pointerleave', ()=>{ cv._hover=null; render(cv); });
    cv.addEventListener('click', ev=>{ if(cv._cfg.onclick){ const d=toData(ev); if(d) cv._cfg.onclick(d.x,d.y,d); } });
  }
  if (!observed.has(cv)){ observed.add(cv); sizes().observe(cv); }
  render(cv);
}
// Un solo ResizeObserver para todos los gráficos. Un lienzo que sale del documento deja de observarse
// (ResizeObserver notifica al quitarlo); releaseCharts() lo hace de forma explícita al abandonar una vista.
const observed=new Set(); let ro=null;
const sizes=()=>ro||(ro=new ResizeObserver(es=>{ for (const e of es){ const cv=e.target; if (!cv.isConnected) releaseChart(cv); else render(cv); } }));
export function releaseChart(cv){ if (observed.delete(cv)) ro.unobserve(cv); }
export function releaseCharts(root){ for (const cv of [...observed]) if (root.contains(cv)) releaseChart(cv); }
export function render(cv){
  const cfg=cv._cfg; if(!cfg || !cv.isConnected || cv.offsetParent===null) return;
  const {c,W,H}=setupCanvas(cv);
  cv._map=draw(c,W,H,cfg,cv._hover);
  if (cfg.readEl && cfg.read) cfg.readEl.innerHTML=cfg.read(cv._hover?cv._hover.x:null, cv._hover?cv._hover.y:null);
}

// ---------- export ----------
export function exportPNG(cv, name, scale=3){
  const cfg=cv._cfg; if(!cfg) return; const r=cv.getBoundingClientRect();
  const off=document.createElement('canvas'); off.width=Math.round(r.width*scale); off.height=Math.round(r.height*scale);
  const c=off.getContext('2d'); c.setTransform(scale,0,0,scale,0,0);
  draw(c,r.width,r.height,{...cfg,bg:css('--panel')},null);
  off.toBlob(b=>download(b,name+'.png'),'image/png');
}
export function exportSVG(cv, name){
  const cfg=cv._cfg; if(!cfg) return; const r=cv.getBoundingClientRect();
  const s=new SvgCtx(r.width,r.height); draw(s,r.width,r.height,{...cfg,bg:css('--panel')},null);
  download(new Blob([s.toString()],{type:'image/svg+xml'}),name+'.svg');
}
export function exportCSV(cv, name){
  const cfg=cv._cfg; if(!cfg) return;
  if (cfg.csv){ download(new Blob([cfg.csv()],{type:'text/csv'}),name+'.csv'); return; }
  const cols=cfg.series.filter(s=>s.d&&s.d.length&&s.label);
  let out='# DFT Lab export: '+name+'\n# '+(cfg.xlabel||'x')+' | '+(cfg.ylabel||'y')+'\n';
  for (const s of cols){ out+='\n# '+s.label+'\n'; for (const [x,y] of s.d) out+=x+','+y+'\n'; }
  download(new Blob([out],{type:'text/csv'}),name+'.csv');
}
// small export toolbar for a panel header
export function exportBar(cv, name){
  const el=document.createElement('span'); el.className='export';
  el.innerHTML='<button type="button" title="Figura vectorial">SVG</button><button type="button" title="Imagen a 3× resolución">PNG</button><button type="button" title="Datos de las curvas">CSV</button>';
  const [b1,b2,b3]=el.querySelectorAll('button');
  b1.onclick=()=>exportSVG(cv,typeof name==='function'?name():name); b2.onclick=()=>exportPNG(cv,typeof name==='function'?name():name); b3.onclick=()=>exportCSV(cv,typeof name==='function'?name():name);
  return el;
}
