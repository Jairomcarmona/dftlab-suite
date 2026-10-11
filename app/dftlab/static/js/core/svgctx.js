// Minimal CanvasRenderingContext2D look-alike that records drawing into SVG.
// Supports the subset used by DFT Lab charts: paths (moveTo/lineTo/arc/rect/closePath),
// stroke/fill, fillRect/clearRect, fillText with align/baseline, setLineDash, save/restore,
// translate/rotate, clip to rect, drawImage (canvas -> embedded PNG).
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const num = v => (Math.round(v*100)/100).toString();

export class SvgCtx {
  constructor(W, H){
    this.W=W; this.H=H; this.out=[]; this.stack=[]; this.clipId=0; this.groupDepth=0;
    this.st={fillStyle:'#000', strokeStyle:'#000', lineWidth:1, font:'10px sans-serif', textAlign:'start', textBaseline:'alphabetic', dash:[], globalAlpha:1, tx:[1,0,0,1,0,0]};
    this.path='';
  }
  // state properties
  set fillStyle(v){ this.st.fillStyle=v; } get fillStyle(){ return this.st.fillStyle; }
  set strokeStyle(v){ this.st.strokeStyle=v; } get strokeStyle(){ return this.st.strokeStyle; }
  set lineWidth(v){ this.st.lineWidth=v; } get lineWidth(){ return this.st.lineWidth; }
  set font(v){ this.st.font=v; } get font(){ return this.st.font; }
  set textAlign(v){ this.st.textAlign=v; } get textAlign(){ return this.st.textAlign; }
  set textBaseline(v){ this.st.textBaseline=v; } get textBaseline(){ return this.st.textBaseline; }
  set globalAlpha(v){ this.st.globalAlpha=v; } get globalAlpha(){ return this.st.globalAlpha; }
  set lineCap(v){} set lineJoin(v){} set imageSmoothingEnabled(v){}
  setLineDash(d){ this.st.dash=d||[]; }
  setTransform(a,b,c,d,e,f){ this.st.tx=[a,b,c,d,e,f]; }
  measureText(t){ const m=/(\d+(?:\.\d+)?)px/.exec(this.st.font); const px=m?+m[1]:10; return {width:String(t).length*px*0.56}; }
  _pt(x,y){ const t=this.st.tx; return [t[0]*x+t[2]*y+t[4], t[1]*x+t[3]*y+t[5]]; }
  save(){ this.stack.push({...this.st, dash:[...this.st.dash], tx:[...this.st.tx], depth:this.groupDepth}); }
  restore(){ const s=this.stack.pop(); if(!s) return; while(this.groupDepth>s.depth){ this.out.push('</g>'); this.groupDepth--; } const {depth,...rest}=s; this.st=rest; }
  translate(x,y){ const t=this.st.tx; t[4]+=t[0]*x+t[2]*y; t[5]+=t[1]*x+t[3]*y; }
  rotate(a){ const t=this.st.tx, c=Math.cos(a), s=Math.sin(a); const [a0,b0,c0,d0]=t; t[0]=a0*c+c0*s; t[1]=b0*c+d0*s; t[2]=-a0*s+c0*c; t[3]=-b0*s+d0*c; }
  scale(sx,sy){ const t=this.st.tx; t[0]*=sx; t[1]*=sx; t[2]*=sy; t[3]*=sy; }
  beginPath(){ this.path=''; }
  moveTo(x,y){ const p=this._pt(x,y); this.path+=`M${num(p[0])} ${num(p[1])}`; }
  lineTo(x,y){ const p=this._pt(x,y); this.path+=`L${num(p[0])} ${num(p[1])}`; }
  closePath(){ this.path+='Z'; }
  rect(x,y,w,h){ this.moveTo(x,y); this.lineTo(x+w,y); this.lineTo(x+w,y+h); this.lineTo(x,y+h); this.closePath(); }
  arc(x,y,r,a0,a1){
    if (Math.abs(a1-a0)>=2*Math.PI-1e-6 || a1>=7){ const p=this._pt(x,y), s=Math.hypot(this.st.tx[0],this.st.tx[1]); const R=r*s;
      this.path+=`M${num(p[0]+R)} ${num(p[1])}A${num(R)} ${num(R)} 0 1 0 ${num(p[0]-R)} ${num(p[1])}A${num(R)} ${num(R)} 0 1 0 ${num(p[0]+R)} ${num(p[1])}`; return; }
    const n=24; for(let i=0;i<=n;i++){ const a=a0+(a1-a0)*i/n; const px=x+r*Math.cos(a), py=y+r*Math.sin(a); if(i===0 && !this.path) this.moveTo(px,py); else this.lineTo(px,py); }
  }
  _paint(kind){
    const st=this.st, col=kind==='fill'?st.fillStyle:st.strokeStyle;
    const op = st.globalAlpha<1 ? ` opacity="${st.globalAlpha}"` : '';
    if (kind==='fill') this.out.push(`<path d="${this.path}" fill="${esc(col)}" stroke="none"${op}/>`);
    else { const sw=st.lineWidth*Math.hypot(st.tx[0],st.tx[1]); this.out.push(`<path d="${this.path}" fill="none" stroke="${esc(col)}" stroke-width="${num(sw)}"${st.dash.length?` stroke-dasharray="${st.dash.join(' ')}"`:''} stroke-linejoin="round" stroke-linecap="round"${op}/>`); }
  }
  stroke(){ this._paint('stroke'); }
  fill(){ this._paint('fill'); }
  fillRect(x,y,w,h){ const keep=this.path; this.beginPath(); this.rect(x,y,w,h); this._paint('fill'); this.path=keep; }
  strokeRect(x,y,w,h){ const keep=this.path; this.beginPath(); this.rect(x,y,w,h); this._paint('stroke'); this.path=keep; }
  clearRect(){ }
  clip(){ const id='c'+(++this.clipId); this.out.push(`<clipPath id="${id}"><path d="${this.path}"/></clipPath><g clip-path="url(#${id})">`); this.groupDepth++; }
  fillText(t,x,y){
    const st=this.st, p=this._pt(x,y);
    const anchor={left:'start',start:'start',center:'middle',right:'end',end:'end'}[st.textAlign]||'start';
    const base={top:'hanging',middle:'central',bottom:'text-after-edge',alphabetic:'alphabetic',hanging:'hanging'}[st.textBaseline]||'alphabetic';
    const m=/(?:(\d{3})\s+)?(\d+(?:\.\d+)?)px\s+(.*)/.exec(st.font)||[]; const weight=m[1]||'400', size=m[2]||'10', fam=(m[3]||'sans-serif').replace(/"/g,"'");
    const ang=Math.atan2(st.tx[1],st.tx[0])*180/Math.PI;
    const rot=Math.abs(ang)>0.01?` transform="rotate(${num(ang)} ${num(p[0])} ${num(p[1])})"`:'';
    this.out.push(`<text x="${num(p[0])}" y="${num(p[1])}" font-family="${esc(fam)}" font-size="${size}" font-weight="${weight}" fill="${esc(st.fillStyle)}" text-anchor="${anchor}" dominant-baseline="${base}"${rot}>${esc(t)}</text>`);
  }
  drawImage(img,x,y,w,h){ try{ const p=this._pt(x,y), s=Math.hypot(this.st.tx[0],this.st.tx[1]); const url=img.toDataURL('image/png'); this.out.push(`<image href="${url}" x="${num(p[0])}" y="${num(p[1])}" width="${num(w*s)}" height="${num(h*s)}" preserveAspectRatio="none"/>`); }catch(e){} }
  createImageData(w,h){ return {width:w,height:h,data:new Uint8ClampedArray(w*h*4)}; }
  toString(bg){
    while(this.groupDepth>0){ this.out.push('</g>'); this.groupDepth--; }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.W}" height="${this.H}" viewBox="0 0 ${this.W} ${this.H}">${bg?`<rect width="100%" height="100%" fill="${bg}"/>`:''}${this.out.join('')}</svg>`;
  }
}
