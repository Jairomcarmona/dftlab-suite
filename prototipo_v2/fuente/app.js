(function(){
const D = JSON.parse(document.getElementById('data').textContent);
const $ = s => document.querySelector(s);
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const fmt = (x,n=2) => (x>=0?'':'−') + Math.abs(x).toFixed(n);
const B = D.bands, nb = B.E.length, nk = B.x.length, nocc = B.nocc;
const xmax = B.x[nk-1], EMIN = -12.5, EMAX = 6.5;
const gap = D.meta.gap;
let cbm = Infinity; for (let b=nocc;b<nb;b++) for (let i=0;i<nk;i++) cbm=Math.min(cbm,B.E[b][i]);
$('#chipGap').textContent = gap.toFixed(2)+' eV ind.';

// shared selection
const S = {ik:null, E:null, w:null, wLock:false, proj:'mix', mode:'post', showSisl:false, wf:null, wfMode:'re', wfIso:0.3};
const listeners = [];
const emit = () => listeners.forEach(f=>f());

// ---------- canvas helpers ----------
function setup(cv){
  const r = cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio||1, 2);
  cv.width = Math.max(1, Math.round(r.width*dpr)); cv.height = Math.max(1, Math.round(r.height*dpr));
  const c = cv.getContext('2d'); c.setTransform(dpr,0,0,dpr,0,0); return {c, W:r.width, H:r.height};
}
function hexA(col, a){ // works for #rrggbb and rgba(...)
  if (col.startsWith('#')){ const n=parseInt(col.slice(1),16); return `rgba(${n>>16&255},${n>>8&255},${n&255},${a})`; }
  return col;
}
function rgb(col){ const n=parseInt(col.slice(1),16); return [n>>16&255,n>>8&255,n&255]; }
function niceTicks(a,b,step){ const t=[]; for(let v=Math.ceil(a/step)*step; v<=b+1e-9; v+=step) t.push(+v.toFixed(6)); return t; }

// ---------- WAVEFUNCTIONS (precomputed with sisl on a 28³ grid of the conventional cell) ----------
const WFD = (()=>{ try{ return JSON.parse(document.getElementById('wfdata').textContent); }catch(e){ return null; } })();
let WF = null; // Int8Array once decoded
async function loadWf(){
  if (!WFD || WF) return;
  try{
    const bin = Uint8Array.from(atob(WFD.data), c=>c.charCodeAt(0));
    const ds = new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'));
    WF = new Int8Array(await new Response(ds).arrayBuffer());
    if (S.wf && three) three.showWf();
  }catch(e){ WF='error'; updVizRead(); }
}
const wfK = WFD ? WFD.kidx : [];
function wfState(ki,n){ return WFD.states[ki*WFD.nb+n]; }
function nearestWfK(ik){ let best=0,d=1e9; wfK.forEach((k,i)=>{ const dd=Math.abs(B.x[k]-B.x[ik]); if(dd<d){d=dd;best=i;} }); return best; }
// marching tetrahedra on an (M)^3 periodic-extended grid
const TETS=[[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]];
const CORN=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
function isoSurface(V, M, h, off, L, colorFn){
  const id=(i,j,k)=>(i*M+j)*M+k;
  const gx=new Float32Array(M*M*M), gy=new Float32Array(M*M*M), gz=new Float32Array(M*M*M);
  for (let i=0;i<M;i++) for (let j=0;j<M;j++) for (let k=0;k<M;k++){
    const p=id(i,j,k);
    gx[p]=V[id(Math.min(i+1,M-1),j,k)]-V[id(Math.max(i-1,0),j,k)];
    gy[p]=V[id(i,Math.min(j+1,M-1),k)]-V[id(i,Math.max(j-1,0),k)];
    gz[p]=V[id(i,j,Math.min(k+1,M-1))]-V[id(i,j,Math.max(k-1,0))];
  }
  const pos=[], nor=[], col=[];
  const P=new Array(8), Vv=new Array(8), I=new Array(8);
  function vert(a,b){
    const t=(L-Vv[a])/(Vv[b]-Vv[a]);
    const pa=P[a], pb=P[b];
    const x=pa[0]+(pb[0]-pa[0])*t, y=pa[1]+(pb[1]-pa[1])*t, z=pa[2]+(pb[2]-pa[2])*t;
    let nx=-(gx[I[a]]+(gx[I[b]]-gx[I[a]])*t), ny=-(gy[I[a]]+(gy[I[b]]-gy[I[a]])*t), nz=-(gz[I[a]]+(gz[I[b]]-gz[I[a]])*t);
    const nn=Math.hypot(nx,ny,nz)||1;
    const c=colorFn(I[a],I[b],t);
    return [x,y,z,nx/nn,ny/nn,nz/nn,c[0],c[1],c[2]];
  }
  function tri(A,Bq,C){
    const ux=Bq[0]-A[0],uy=Bq[1]-A[1],uz=Bq[2]-A[2], vx=C[0]-A[0],vy=C[1]-A[1],vz=C[2]-A[2];
    const fx=uy*vz-uz*vy, fy=uz*vx-ux*vz, fz=ux*vy-uy*vx;
    if (fx*(A[3]+Bq[3]+C[3])+fy*(A[4]+Bq[4]+C[4])+fz*(A[5]+Bq[5]+C[5])<0){ const t=Bq; Bq=C; C=t; }
    for (const q of [A,Bq,C]){ pos.push(q[0],q[1],q[2]); nor.push(q[3],q[4],q[5]); col.push(q[6],q[7],q[8]); }
  }
  for (let i=0;i<M-1;i++) for (let j=0;j<M-1;j++) for (let k=0;k<M-1;k++){
    let any=0, all=1;
    for (let c=0;c<8;c++){ const q=CORN[c]; I[c]=id(i+q[0],j+q[1],k+q[2]); Vv[c]=V[I[c]]; if(Vv[c]>L) any=1; else all=0; }
    if (!any || all) continue;
    for (let c=0;c<8;c++){ const q=CORN[c]; P[c]=[(i+q[0])*h-off,(j+q[1])*h-off,(k+q[2])*h-off]; }
    for (const t of TETS){
      const inn=t.filter(c=>Vv[c]>L), out=t.filter(c=>Vv[c]<=L);
      if (inn.length===0||inn.length===4) continue;
      if (inn.length===1) tri(vert(inn[0],out[0]),vert(inn[0],out[1]),vert(inn[0],out[2]));
      else if (inn.length===3) tri(vert(out[0],inn[0]),vert(out[0],inn[1]),vert(out[0],inn[2]));
      else { const a=vert(inn[0],out[0]), b=vert(inn[0],out[1]), c=vert(inn[1],out[1]), d=vert(inn[1],out[0]); tri(a,b,c); tri(a,c,d); }
    }
  }
  return {pos,nor,col};
}
// complex field on (N+1)^3 with Bloch phase across the cube faces
function wfField(ki,n){
  const N=WFD.N, M=N+1, N3=N*N*N, s=ki*WFD.nb+n, base=s*2*N3;
  const kc=B.kcart[wfK[ki]], a=WFD.a;
  const re=new Float32Array(M*M*M), im=new Float32Array(M*M*M);
  for (let i=0;i<M;i++) for (let j=0;j<M;j++) for (let k=0;k<M;k++){
    const ii=i%N, jj=j%N, kk=k%N, p=(ii*N+jj)*N+kk;
    let r=WF[base+p]/127, m=WF[base+N3+p]/127;
    const sh=(i>=N?kc[0]:0)+(j>=N?kc[1]:0)+(k>=N?kc[2]:0);
    if (sh){ const c=Math.cos(sh*a), sn=Math.sin(sh*a); const r2=r*c-m*sn; m=r*sn+m*c; r=r2; }
    const q=(i*M+j)*M+k; re[q]=r; im[q]=m;
  }
  return {re,im,M};
}
function hsl2rgb(h,s,l){ const f=n=>{ const k=(n+h/30)%12, a=s*Math.min(l,1-l); return l-a*Math.max(-1,Math.min(k-3,9-k,1)); }; return [f(0),f(8),f(4)]; }

// ---------- BANDS ----------
const cB = $('#cBands');
const BP = {l:44, r:10, t:10, b:26};
function bandsMap(W,H){ return { X: x => BP.l + x/xmax*(W-BP.l-BP.r), Y: e => BP.t + (EMAX-e)/(EMAX-EMIN)*(H-BP.t-BP.b),
  iX: px => (px-BP.l)/(W-BP.l-BP.r)*xmax, iY: py => EMAX-(py-BP.t)/(H-BP.t-BP.b)*(EMAX-EMIN) }; }
function drawBands(){
  const {c,W,H} = setup(cB), m = bandsMap(W,H);
  const ink=css('--ink'), muted=css('--muted'), line=css('--line'), faint=css('--faint'), acc=css('--accent');
  const oc=[rgb(css('--orb-s')),rgb(css('--orb-p')),rgb(css('--orb-d'))];
  c.clearRect(0,0,W,H);
  // gap band
  c.fillStyle=css('--gapfill'); c.fillRect(BP.l, m.Y(cbm), W-BP.l-BP.r, m.Y(0)-m.Y(cbm));
  // grid + y ticks
  c.font='11px '+css('--f-data'); c.textAlign='right'; c.textBaseline='middle';
  for (const v of niceTicks(EMIN,EMAX,2)){ const y=m.Y(v); c.strokeStyle=line; c.lineWidth=1; c.beginPath(); c.moveTo(BP.l,y); c.lineTo(W-BP.r,y); c.stroke(); c.fillStyle=muted; c.fillText(v===0?'0':fmt(v,0),BP.l-6,y); }
  c.save(); c.translate(11,(BP.t+H-BP.b)/2); c.rotate(-Math.PI/2); c.textAlign='center'; c.fillStyle=muted; c.font='11px '+css('--f-label'); c.fillText('E − E(VBM)  (eV)',0,0); c.restore();
  // high-symmetry verticals
  c.textAlign='center'; c.textBaseline='top'; c.font='12px '+css('--f-data');
  const seen = {};
  for (const [x,l] of B.labels){ const X=m.X(x); c.strokeStyle=faint; c.beginPath(); c.moveTo(X,BP.t); c.lineTo(X,H-BP.b); c.stroke();
    const key=x.toFixed(4); seen[key]=seen[key]?seen[key]+'|'+l:l; }
  for (const k in seen){ c.fillStyle=ink; c.fillText(seen[k].replace('W_2','W′'), m.X(+k), H-BP.b+6); }
  // bands
  for (let b=0;b<nb;b++){
    for (let i=1;i<nk;i++){
      if (B.x[i]===B.x[i-1]) continue;
      const f=B.fat[b][i], f0=B.fat[b][i-1];
      const x0=m.X(B.x[i-1]), x1=m.X(B.x[i]), y0=m.Y(B.E[b][i-1]), y1=m.Y(B.E[b][i]);
      if ((y0<BP.t&&y1<BP.t)||(y0>H-BP.b&&y1>H-BP.b)) continue;
      if (S.proj==='mix'){
        const s=f[0]+f[1]+f[2]+1e-9; const col=[0,1,2].map(j=>Math.round((oc[0][j]*f[0]+oc[1][j]*f[1]+oc[2][j]*f[2])/s));
        c.strokeStyle=`rgb(${col})`; c.lineWidth=1.8;
      } else {
        const j=+S.proj, w=(f[j]+f0[j])/2;
        c.strokeStyle=hexA(faint,.55); c.lineWidth=1; c.beginPath(); c.moveTo(x0,y0); c.lineTo(x1,y1); c.stroke();
        c.strokeStyle=`rgba(${oc[j]},0.85)`; c.lineWidth=0.4+w*7;
      }
      c.beginPath(); c.moveTo(x0,y0); c.lineTo(x1,y1); c.stroke();
    }
  }
  // states with a precomputed wavefunction
  if (WFD){ for (const k of wfK) for (let b=0;b<WFD.nb;b++){ const X=m.X(B.x[k]), y=m.Y(B.E[b][k]); c.fillStyle=hexA(ink,.35); c.beginPath(); c.arc(X,y,1.7,0,7); c.fill(); } }
  if (S.wf){ const k=wfK[S.wf.ki], X=m.X(B.x[k]), y=m.Y(B.E[S.wf.n][k]); c.strokeStyle=acc; c.lineWidth=2; c.beginPath(); c.arc(X,y,6,0,7); c.stroke(); c.fillStyle=acc; c.beginPath(); c.arc(X,y,2.6,0,7); c.fill(); }
  // VBM / CBM markers
  c.fillStyle=ink; c.font='11px '+css('--f-label'); c.textAlign='left'; c.textBaseline='bottom';
  c.fillText('Eg = '+gap.toFixed(3)+' eV (indirecto)', BP.l+6, m.Y(cbm)-3);
  // transitions for the selected omega
  if (S.w!==null){
    const dec = decAt(S.w);
    if (dec){
      for (const [v,cb,share] of dec.pairs.slice(0,3)){
        if (share<0.05) continue;
        for (let i=0;i<nk;i+=1){
          const dE=B.E[cb][i]-B.E[v][i];
          if (Math.abs(dE-S.w)<0.06){
            const X=m.X(B.x[i]); c.strokeStyle=hexA(acc,Math.min(.9,.25+share)); c.lineWidth=1.5;
            c.beginPath(); c.moveTo(X,m.Y(B.E[v][i])); c.lineTo(X,m.Y(B.E[cb][i])); c.stroke();
            c.fillStyle=hexA(acc,.9); c.beginPath(); c.moveTo(X,m.Y(B.E[cb][i])); c.lineTo(X-3.5,m.Y(B.E[cb][i])+7); c.lineTo(X+3.5,m.Y(B.E[cb][i])+7); c.fill();
          }
        }
      }
    }
  }
  // cursor
  if (S.ik!==null){ const X=m.X(B.x[S.ik]); c.strokeStyle=acc; c.lineWidth=1; c.setLineDash([4,3]); c.beginPath(); c.moveTo(X,BP.t); c.lineTo(X,H-BP.b); c.stroke(); c.setLineDash([]);
    for (let b=0;b<nb;b++){ const y=m.Y(B.E[b][S.ik]); if(y<BP.t||y>H-BP.b) continue; c.fillStyle=acc; c.beginPath(); c.arc(X,y,2.6,0,7); c.fill(); } }
  if (S.E!==null){ const y=m.Y(S.E); c.strokeStyle=hexA(acc,.7); c.setLineDash([2,3]); c.beginPath(); c.moveTo(BP.l,y); c.lineTo(W-BP.r,y); c.stroke(); c.setLineDash([]); }
}
function nearestLabel(x){ let best=null,d=1e9; for (const [xx,l] of B.labels){ if (Math.abs(xx-x)<d){d=Math.abs(xx-x);best=l;} } return d<0.03?best:null; }
cB.addEventListener('pointermove', ev=>{
  const r=cB.getBoundingClientRect(), m=bandsMap(r.width,r.height), x=m.iX(ev.clientX-r.left), E=m.iY(ev.clientY-r.top);
  if (x<0||x>xmax){ return; }
  let ik=0,d=1e9; for (let i=0;i<nk;i++){ const dd=Math.abs(B.x[i]-x); if(dd<d){d=dd;ik=i;} }
  S.ik=ik; S.E=Math.max(EMIN,Math.min(EMAX,E));
  let bb=0,de=1e9; for (let b=0;b<nb;b++){ const dd=Math.abs(B.E[b][ik]-E); if(dd<de){de=dd;bb=b;} }
  const f=B.fat[bb][ik], lab=nearestLabel(B.x[ik]);
  $('#bandRead').innerHTML = `<span>k <b>${lab?lab.replace('W_2','W′'):'#'+ik}</b></span><span>banda <b>${bb+1}</b>${bb<nocc?' (valencia)':' (conducción)'}</span><span>E <b>${fmt(B.E[bb][ik],3)} eV</b></span><span>carácter <b style="color:var(--orb-s)">s ${(f[0]*100).toFixed(0)}%</b> · <b style="color:var(--orb-p)">p ${(f[1]*100).toFixed(0)}%</b> · <b style="color:var(--orb-d)">d ${(f[2]*100).toFixed(0)}%</b></span>`;
  S.band=bb; emit();
});
cB.addEventListener('pointerleave', ()=>{ S.ik=null; S.E=null; emit(); });
cB.addEventListener('click', ev=>{
  if (!WFD) return;
  const r=cB.getBoundingClientRect(), m=bandsMap(r.width,r.height), x=m.iX(ev.clientX-r.left), E=m.iY(ev.clientY-r.top);
  let ik=0,d=1e9; for (let i=0;i<nk;i++){ const dd=Math.abs(B.x[i]-x); if(dd<d){d=dd;ik=i;} }
  const ki=nearestWfK(ik), k=wfK[ki];
  let bb=0,de=1e9; for (let b=0;b<WFD.nb;b++){ const dd=Math.abs(B.E[b][k]-E); if(dd<de){de=dd;bb=b;} }
  S.wf={ki,n:bb}; loadWf(); if (three){ three.setView('wf'); three.showWf(); } emit();
});
document.querySelectorAll('[data-proj]').forEach(bt=>bt.addEventListener('click',()=>{
  S.proj=bt.dataset.proj; document.querySelectorAll('[data-proj]').forEach(o=>o.setAttribute('aria-pressed', o===bt?'true':'false')); emit(); }));

// ---------- DOS ----------
const cD = $('#cDos'), DP={l:8,r:12,t:10,b:26};
const dmax = Math.max(...D.dos.total)*1.05;
function drawDos(){
  const {c,W,H}=setup(cD), Y=e=>DP.t+(EMAX-e)/(EMAX-EMIN)*(H-DP.t-DP.b), X=v=>DP.l+v/dmax*(W-DP.l-DP.r);
  const line=css('--line'), muted=css('--muted'), faint=css('--faint'), acc=css('--accent');
  c.clearRect(0,0,W,H);
  c.fillStyle=css('--gapfill'); c.fillRect(DP.l,Y(cbm),W-DP.l-DP.r,Y(0)-Y(cbm));
  for (const v of niceTicks(EMIN,EMAX,2)){ c.strokeStyle=line; c.beginPath(); c.moveTo(DP.l,Y(v)); c.lineTo(W-DP.r,Y(v)); c.stroke(); }
  const E=D.dos.E;
  c.beginPath(); c.moveTo(X(0),Y(E[0])); for (let i=0;i<E.length;i++){ if(E[i]<EMIN||E[i]>EMAX) continue; c.lineTo(X(D.dos.total[i]),Y(E[i])); } c.lineTo(X(0),Y(Math.min(EMAX,E[E.length-1]))); c.closePath();
  c.fillStyle=hexA(faint,.22); c.fill(); c.strokeStyle=faint; c.lineWidth=1; c.stroke();
  for (const [key,col] of [['s','--orb-s'],['p','--orb-p'],['d','--orb-d']]){
    c.strokeStyle=css(col); c.lineWidth=1.6; c.beginPath(); let st=false;
    for (let i=0;i<E.length;i++){ if(E[i]<EMIN||E[i]>EMAX) continue; const x=X(D.dos[key][i]), y=Y(E[i]); if(!st){c.moveTo(x,y);st=true;} else c.lineTo(x,y); } c.stroke(); }
  c.fillStyle=muted; c.font='11px '+css('--f-label'); c.textAlign='center'; c.textBaseline='top'; c.fillText('estados / eV / celda', (DP.l+W-DP.r)/2, H-DP.b+6);
  if (S.E!==null){ const y=Y(S.E); c.strokeStyle=acc; c.setLineDash([4,3]); c.beginPath(); c.moveTo(DP.l,y); c.lineTo(W-DP.r,y); c.stroke(); c.setLineDash([]);
    const i=Math.round((S.E-E[0])/(E[1]-E[0])); if(i>=0&&i<E.length){ c.fillStyle=acc; c.textAlign='right'; c.textBaseline='bottom'; c.font='11px '+css('--f-data'); c.fillText(D.dos.total[i].toFixed(2), W-DP.r-2, y-3); } }
}
cD.addEventListener('pointermove', ev=>{ const r=cD.getBoundingClientRect(); const e=EMAX-(ev.clientY-r.top-DP.t)/(r.height-DP.t-DP.b)*(EMAX-EMIN); S.E=Math.max(EMIN,Math.min(EMAX,e)); S.ik=null; emit(); });
cD.addEventListener('pointerleave', ()=>{ S.E=null; emit(); });

// ---------- EPS ----------
const cE=$('#cEps'), EP={l:40,r:12,t:10,b:28}, WMAX=10, YMIN=-22, YMAX=62;
const ew=D.eps.w;
function decAt(w){ const L=D.eps.decomp; let best=null,d=1e9; for (const x of L){ const dd=Math.abs(x.w-w); if(dd<d){d=dd;best=x;} } return d<0.06?best:null; }
function drawEps(){
  const {c,W,H}=setup(cE), X=w=>EP.l+w/WMAX*(W-EP.l-EP.r), Y=v=>EP.t+(YMAX-v)/(YMAX-YMIN)*(H-EP.t-EP.b);
  const line=css('--line'), muted=css('--muted'), acc=css('--accent'), e1=css('--e1'), faint=css('--faint');
  c.clearRect(0,0,W,H);
  c.font='11px '+css('--f-data'); c.textAlign='right'; c.textBaseline='middle';
  for (const v of niceTicks(-20,60,20)){ c.strokeStyle=line; c.beginPath(); c.moveTo(EP.l,Y(v)); c.lineTo(W-EP.r,Y(v)); c.stroke(); c.fillStyle=muted; c.fillText(v,EP.l-6,Y(v)); }
  c.textAlign='center'; c.textBaseline='top';
  for (const v of niceTicks(0,WMAX,1)){ c.fillStyle=muted; c.fillText(v,X(v),H-EP.b+5); }
  c.font='11px '+css('--f-label'); c.fillText('ħω (eV)', (EP.l+W-EP.r)/2, H-12);
  // gap marker
  c.strokeStyle=faint; c.setLineDash([2,3]); c.beginPath(); c.moveTo(X(gap),EP.t); c.lineTo(X(gap),H-EP.b); c.stroke(); c.setLineDash([]);
  c.fillStyle=faint; c.textAlign='left'; c.textBaseline='top'; c.fillText('Eg', X(gap)+3, EP.t+2);
  // eps2 area
  c.beginPath(); c.moveTo(X(ew[0]),Y(0)); for (let i=0;i<ew.length&&ew[i]<=WMAX;i++) c.lineTo(X(ew[i]),Y(D.eps.eps2[i])); c.lineTo(X(WMAX),Y(0)); c.closePath();
  c.fillStyle=hexA(acc,.13); c.fill();
  c.strokeStyle=acc; c.lineWidth=1.8; c.beginPath(); for (let i=0;i<ew.length&&ew[i]<=WMAX;i++){ const x=X(ew[i]),y=Y(D.eps.eps2[i]); i?c.lineTo(x,y):c.moveTo(x,y);} c.stroke();
  if (S.showSisl){ c.strokeStyle=hexA(acc,.7); c.setLineDash([5,4]); c.lineWidth=1.3; c.beginPath(); for (let i=0;i<ew.length&&ew[i]<=WMAX;i++){ const x=X(ew[i]),y=Y(D.eps.eps2_sisl[i]); i?c.lineTo(x,y):c.moveTo(x,y);} c.stroke(); c.setLineDash([]); }
  c.strokeStyle=e1; c.lineWidth=1.6; c.beginPath(); for (let i=0;i<ew.length&&ew[i]<=WMAX;i++){ const x=X(ew[i]),y=Y(D.eps.eps1[i]); i?c.lineTo(x,y):c.moveTo(x,y);} c.stroke();
  c.strokeStyle=line; c.beginPath(); c.moveTo(EP.l,Y(0)); c.lineTo(W-EP.r,Y(0)); c.stroke();
  if (S.w!==null){ const x=X(S.w); c.strokeStyle=acc; c.lineWidth=S.wLock?1.6:1; c.setLineDash(S.wLock?[]:[4,3]); c.beginPath(); c.moveTo(x,EP.t); c.lineTo(x,H-EP.b); c.stroke(); c.setLineDash([]); }
}
function epsIdx(w){ return Math.max(0,Math.min(ew.length-1,Math.round((w-ew[0])/(ew[1]-ew[0])))); }
function epsFromEv(ev){ const r=cE.getBoundingClientRect(); return Math.max(0.05,Math.min(WMAX,(ev.clientX-r.left-EP.l)/(r.width-EP.l-EP.r)*WMAX)); }
cE.addEventListener('pointermove', ev=>{ if (S.wLock) return; S.w=epsFromEv(ev); emit(); });
cE.addEventListener('click', ev=>{ const w=epsFromEv(ev); if (S.wLock && Math.abs(w-S.w)<0.15){ S.wLock=false; } else { S.wLock=true; S.w=w; } emit(); });
cE.addEventListener('pointerleave', ()=>{ if(!S.wLock){ S.w=null; emit(); } });
$('#tSisl').addEventListener('click', e=>{ S.showSisl=!S.showSisl; e.currentTarget.setAttribute('aria-pressed', S.showSisl); emit(); });
function updEpsRead(){
  if (S.w===null){ $('#epsRead').innerHTML='Pasa el cursor por el espectro; clic para fijar ω. ε₁(0) = <b>'+D.eps.eps1[0].toFixed(1)+'</b> · pico de ε₂ en <b>'+ew[D.eps.eps2.indexOf(Math.max(...D.eps.eps2))].toFixed(2)+' eV</b>'; return; }
  const i=epsIdx(S.w); $('#epsRead').innerHTML=`<span>ħω <b>${S.w.toFixed(2)} eV</b></span><span>ε₂ <b>${D.eps.eps2[i].toFixed(2)}</b></span><span>ε₁ <b>${fmt(D.eps.eps1[i],2)}</b></span><span>${S.wLock?'fijado · clic de nuevo para soltar':'clic para fijar'}</span>`;
}

// ---------- DECOMPOSITION ----------
function drawDec(){
  const el=$('#decBody');
  const w = S.w===null ? 3.7 : S.w; const dec=decAt(w);
  const head = `<div class="dec-w">${w.toFixed(2)}<small>eV${S.w===null?' · ejemplo: pico E₂':''}</small></div>`;
  if (!dec || !dec.pairs.length){ el.innerHTML = head + `<p class="note">Fuera del rango descompuesto (1–9 eV). ${w<gap?'Por debajo del gap no hay transiciones.':''}</p>`; return; }
  const bars = dec.pairs.filter(p=>p[2]>0.004).map(([v,c,s])=>`<div class="bar"><span>banda ${v+1} → ${c+1}</span><span class="track"><span class="fill" style="display:block;width:${(s*100).toFixed(1)}%"></span></span><span style="text-align:right">${(s*100).toFixed(1)}%</span></div>`).join('');
  const top=dec.k.slice(0,40).reduce((a,r)=>a+r[3],0);
  el.innerHTML = head + bars + `<p class="note">Las flechas sobre las bandas marcan dónde, en el camino de alta simetría, la transición cumple E<sub>c</sub> − E<sub>v</sub> ≈ ħω. En la zona de Brillouin aparecen los puntos k de la malla que más aportan: los 40 principales suman <b>${(top*100).toFixed(0)}%</b> de ε₂ en esta energía.</p>`;
}

// ---------- SIDE: provenance / learn ----------
const M=D.meta;
$('#prov').innerHTML = [
  ['Código', M.code], ['Funcional', M.xc], ['Base', M.basis+' ('+M.norb+' orbitales / celda)'], ['Pseudopotencial', M.pseudo],
  ['MeshCutoff', M.mesh_cutoff], ['Mallas k', M.kgrid], ['Grupo espacial', M.spacegroup+' · red '+M.bravais], ['a', M.a+' Å · Ω = '+M.volume+' Å³'],
  ['Archivos', 'si.fdf · si.TSHS · si.bands · si.EPSIMG · si.out']].map(([k,v])=>`<dt>${k}</dt><dd>${v}</dd>`).join('');
const dosInt = (()=>{ let s=0; const E=D.dos.E; for(let i=1;i<E.length;i++){ if(E[i]>0) break; s+=(D.dos.total[i]+D.dos.total[i-1])/2*(E[i]-E[i-1]); } return s; })();
$('#checks').innerHTML = [
  ['pass', `Electrones bajo el VBM: ${dosInt.toFixed(2)} de 8`],
  ['pass', `Gap LDA ${gap.toFixed(3)} eV, mínimo de conducción al ${(M.kcbm[0]/0.5*100).toFixed(0)}% de Γ→X (LDA de la literatura: ≈0.5 eV, ≈85%)`],
  ['pass', `SCF convergido en ${D.scf.length} ciclos (dDmax < 10⁻⁵)`],
  ['warn', `ε₂ reconstruido con sisl frente a SIESTA: correlación de forma ${M.eps_shape_corr.toFixed(2)}. La descomposición es aproximada; en la app se leería de si.contrib.EPSIMG.`]
].map(([k,t])=>`<div class="check"><i class="${k}">${k==='pass'?'OK':'revisar'}</i><span>${t}</span></div>`).join('');
function drawScf(){
  const cv=$('#cScf'); const {c,W,H}=setup(cv); const p={l:34,r:8,t:8,b:20};
  const n=D.scf.length, ys=D.scf.map(r=>Math.log10(Math.max(r[2],1e-7))), lo=-6, hi=1;
  const X=i=>p.l+(i)/(n-1)*(W-p.l-p.r), Y=v=>p.t+(hi-v)/(hi-lo)*(H-p.t-p.b);
  c.clearRect(0,0,W,H); c.font='10.5px '+css('--f-data'); c.fillStyle=css('--muted'); c.textAlign='right'; c.textBaseline='middle';
  for (const v of [0,-2,-4,-6]){ c.strokeStyle=css('--line'); c.beginPath(); c.moveTo(p.l,Y(v)); c.lineTo(W-p.r,Y(v)); c.stroke(); c.fillText('1e'+v,p.l-4,Y(v)); }
  c.strokeStyle=css('--faint'); c.setLineDash([3,3]); c.beginPath(); c.moveTo(p.l,Y(-5)); c.lineTo(W-p.r,Y(-5)); c.stroke(); c.setLineDash([]);
  c.strokeStyle=css('--accent'); c.lineWidth=1.6; c.beginPath(); ys.forEach((v,i)=>i?c.lineTo(X(i),Y(v)):c.moveTo(X(i),Y(v))); c.stroke();
  c.fillStyle=css('--accent'); ys.forEach((v,i)=>{c.beginPath();c.arc(X(i),Y(v),2.2,0,7);c.fill();});
  c.fillStyle=css('--muted'); c.textAlign='center'; c.textBaseline='top'; c.fillText('ciclo SCF → max |ΔDM|', (p.l+W-p.r)/2, H-14);
}
$('#scfNote').textContent = `E(KS) = ${D.scf[D.scf.length-1][1].toFixed(4)} eV. La línea punteada es la tolerancia DM.Tolerance = 10⁻⁵.`;

function learnHTML(){
  const ik=S.ik, w=S.w===null?3.7:S.w, dec=decAt(w), i=epsIdx(w);
  let kpart;
  if (ik!==null){ const b=S.band??nocc-1, f=B.fat[b][ik], lab=nearestLabel(B.x[ik]);
    kpart = `<div class="eq">H(<b>k</b>) c<sub>n</sub> = ε<sub>n</sub> S(<b>k</b>) c<sub>n</sub> &nbsp;→&nbsp; ε<sub>${b+1}</sub>(<b>k</b><sub>${lab?lab.replace('W_2','W′'):ik}</sub>) = <span class="v">${fmt(B.E[b][ik],3)} eV</span></div>
    <p class="eqcap">SIESTA guarda H y S en una base de ${M.norb} orbitales atómicos numéricos (DZP). Para cada k se resuelve este problema generalizado de ${M.norb}×${M.norb}; las ${nb} raíces son las bandas que ves en ese k.</p>
    <div class="eq">w<sub>nμ</sub> = Re[c*<sub>nμ</sub> (S c<sub>n</sub>)<sub>μ</sub>] &nbsp;→&nbsp; s <span class="v">${(f[0]*100).toFixed(0)}%</span> · p <span class="v">${(f[1]*100).toFixed(0)}%</span> · d <span class="v">${(f[2]*100).toFixed(0)}%</span></div>
    <p class="eqcap">El peso de Mulliken reparte el estado entre orbitales. Como la base no es ortogonal, entra S; por eso la PDOS de la derecha suma exactamente la DOS total.</p>`;
  } else kpart = `<p class="eqcap">Pasa el cursor por las bandas para ver la ecuación de valores propios con los números de ese punto k.</p>`;
  const top = dec&&dec.pairs.length ? dec.pairs[0] : null;
  let wpart='';
  if (S.wf && WFD){ const k=wfK[S.wf.ki], lab=nearestLabel(B.x[k]);
    wpart=`<div><h3>Función de onda en 3D</h3></div><div class="eq">ψ<sub>n<b>k</b></sub>(<b>r</b>) = Σ<sub>μ</sub> c<sub>nμ</sub>(<b>k</b>) Σ<sub><b>R</b></sub> e<sup>i<b>k</b>·<b>R</b></sup> φ<sub>μ</sub>(<b>r</b> − <b>R</b> − τ<sub>μ</sub>)</div>
    <p class="eqcap">El estado ${S.wf.n+1} en ${lab?lab.replace('W_2','W′'):'k #'+k} se construyó sumando los <span class="v">${M.norb}</span> orbitales atómicos de la base con los coeficientes c que salen de diagonalizar H(<b>k</b>), y las réplicas de la red con la fase de Bloch. Al pasar de una celda a la siguiente el estado se multiplica por e<sup>i<b>k</b>·<b>R</b></sup>: en Γ no cambia, en X cambia de signo.</p>`; }
  return `${wpart}<div><h3>Bandas y carácter orbital</h3></div>${kpart}
  <div><h3>Función dieléctrica</h3></div>
  <div class="eq">ε<sub>2</sub>(ω) = <span style="font-size:13px">4π²e²</span>⁄<span style="font-size:13px">(Ω m²ω²)</span> · <span style="font-size:13px">1/N<sub>k</sub></span> Σ<sub>k</sub> Σ<sub>v,c</sub> |⟨c<b>k</b>|p|v<b>k</b>⟩|² δ(E<sub>c</sub> − E<sub>v</sub> − ħω)</div>
  <p class="eqcap">Con Ω = <span class="v">${M.volume} Å³</span>, N<sub>k</sub> = <span class="v">${M.nk_eps}</span>, ensanchamiento η = <span class="v">0.10 eV</span> y ħω = <span class="v">${w.toFixed(2)} eV</span>: ε₂ = <span class="v">${D.eps.eps2[i].toFixed(2)}</span>. ${top?`El término que más pesa es banda ${top[0]+1} → ${top[1]+1}, con el <span class="v">${(top[2]*100).toFixed(0)}%</span>.`:''}</p>
  <div class="eq">ε<sub>1</sub>(ω) = 1 + <span style="font-size:13px">2/π</span> P∫ ω′ε<sub>2</sub>(ω′) ⁄ (ω′² − ω²) dω′ &nbsp;→&nbsp; ε<sub>1</sub>(${w.toFixed(2)}) = <span class="v">${fmt(D.eps.eps1[i],2)}</span></div>
  <p class="eqcap">Kramers–Kronig liga la absorción (ε₂) con la refracción (ε₁). En ω → 0 da ε∞ = <span class="v">${D.eps.eps1[0].toFixed(1)}</span>; el experimento da 11.9. La diferencia viene de la aproximación de partícula independiente (sin campos locales ni excitones) y del gap LDA.</p>`;
}

// ---------- 3D ----------
let three=null, three_view=()=>'bz';
function init3D(){
  if (!window.THREE){ $('#three').innerHTML='<p class="note" style="padding:12px">No se pudo cargar Three.js; las demás vistas siguen enlazadas.</p>'; return; }
  const host=$('#three'), T=THREE;
  const renderer=new T.WebGLRenderer({antialias:true, alpha:true}); renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  host.appendChild(renderer.domElement);
  const scene=new T.Scene(), cam=new T.PerspectiveCamera(35,1,0.01,200);
  const ctl=new T.OrbitControls(cam, renderer.domElement); ctl.enableDamping=true; ctl.enablePan=false;
  scene.add(new T.AmbientLight(0xffffff,.65)); const dl=new T.DirectionalLight(0xffffff,.6); dl.position.set(3,5,4); scene.add(dl);
  const gBZ=new T.Group(), gSt=new T.Group(); scene.add(gBZ); scene.add(gSt);
  const col=n=>new T.Color(css(n));
  // BZ edges
  const edgeMat=new T.LineBasicMaterial({color:col('--muted')});
  for (const f of D.bz.faces){ const pts=f.map(p=>new T.Vector3(...p)); pts.push(pts[0].clone()); gBZ.add(new T.Line(new T.BufferGeometry().setFromPoints(pts), edgeMat)); }
  // path
  const pathMat=new T.LineBasicMaterial({color:col('--accent')});
  let seg=[]; for (let i=0;i<nk;i++){ if(i&&B.x[i]===B.x[i-1]){ gBZ.add(new T.Line(new T.BufferGeometry().setFromPoints(seg),pathMat)); seg=[]; } seg.push(new T.Vector3(...B.kcart[i])); }
  gBZ.add(new T.Line(new T.BufferGeometry().setFromPoints(seg),pathMat));
  // axes hint
  const labs=[];
  for (const [k,p] of Object.entries(D.bz.points)){ const d=document.createElement('div'); d.className='lbl3'; d.textContent=k.replace('W_2','W′'); host.appendChild(d); labs.push({el:d,v:new T.Vector3(...p),g:gBZ});
    const s=new T.Mesh(new T.SphereGeometry(.025,12,12), new T.MeshBasicMaterial({color:col('--ink')})); s.position.set(...p); gBZ.add(s); }
  const kMark=new T.Mesh(new T.SphereGeometry(.045,16,16), new T.MeshBasicMaterial({color:col('--accent')})); kMark.visible=false; gBZ.add(kMark);
  const cloud=new T.Group(); gBZ.add(cloud);
  const cloudGeo=new T.SphereGeometry(1,10,10);
  // structure
  const a=D.structure.a, off=new T.Vector3(a/2,a/2,a/2);
  const atomMat=new T.MeshStandardMaterial({color:new T.Color('#8f9aa8'),roughness:.45,metalness:.15});
  const atomsV=D.structure.atoms.map(p=>new T.Vector3(...p).sub(off));
  for (const v of atomsV){ const m=new T.Mesh(new T.SphereGeometry(.42,24,24),atomMat); m.position.copy(v); gSt.add(m); }
  const bondMat=new T.MeshStandardMaterial({color:new T.Color('#c3c9d1'),roughness:.6});
  for (const [i,j] of D.structure.bonds){ const A=atomsV[i],Bv=atomsV[j], len=A.distanceTo(Bv);
    const m=new T.Mesh(new T.CylinderGeometry(.11,.11,len,12),bondMat); m.position.copy(A.clone().add(Bv).multiplyScalar(.5));
    m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0), Bv.clone().sub(A).normalize()); gSt.add(m); }
  const box=new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(a,a,a)), new T.LineBasicMaterial({color:col('--muted')})); gSt.add(box);
  const stLab=document.createElement('div'); stLab.className='lbl3'; stLab.textContent='a = '+a+' Å'; host.appendChild(stLab); labs.push({el:stLab,v:new T.Vector3(0,-a/2,a/2),g:gSt});
  // wavefunction group: atoms + bonds of the conventional cell and the isosurface
  const gWf=new T.Group(); scene.add(gWf);
  const wAtomMat=new T.MeshStandardMaterial({color:new T.Color('#9aa3ad'),roughness:.5});
  for (const v of atomsV){ const m=new T.Mesh(new T.SphereGeometry(.22,18,18),wAtomMat); m.position.copy(v); gWf.add(m); }
  for (const [i,j] of D.structure.bonds){ const A=atomsV[i],Bv=atomsV[j], len=A.distanceTo(Bv);
    const m=new T.Mesh(new T.CylinderGeometry(.05,.05,len,8),wAtomMat); m.position.copy(A.clone().add(Bv).multiplyScalar(.5));
    m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0), Bv.clone().sub(A).normalize()); gWf.add(m); }
  gWf.add(new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(a,a,a)), new T.LineBasicMaterial({color:col('--muted')})));
  const isoMat=new T.MeshStandardMaterial({vertexColors:true,side:T.DoubleSide,roughness:.42,metalness:.05,transparent:true,opacity:.92});
  let isoMesh=null, field=null, fieldKey=null;
  function showWf(){
    if (!S.wf) return;
    if (!WF || WF==='error'){ updVizRead(); return; }
    const key=S.wf.ki+':'+S.wf.n;
    if (key!==fieldKey){ field=wfField(S.wf.ki,S.wf.n); fieldKey=key; }
    const {re,im,M}=field, n3=M*M*M, h=WFD.a/WFD.N, off=WFD.a/2;
    let mx=0; for (let i=0;i<n3;i++) mx=Math.max(mx,re[i]*re[i]+im[i]*im[i]); mx=Math.sqrt(mx)||1;
    const iso=S.wfIso*mx;
    const parts=[];
    if (S.wfMode==='re'){
      const cp=rgb(css('--psi-pos')).map(v=>v/255), cn=rgb(css('--psi-neg')).map(v=>v/255);
      const neg=new Float32Array(n3); for (let i=0;i<n3;i++) neg[i]=-re[i];
      parts.push(isoSurface(re,M,h,off,iso,()=>cp));
      parts.push(isoSurface(neg,M,h,off,iso,()=>cn));
    } else {
      const A2=new Float32Array(n3); for (let i=0;i<n3;i++) A2[i]=re[i]*re[i]+im[i]*im[i];
      parts.push(isoSurface(A2,M,h,off,iso*iso,(p,q,t)=>{ const r=re[p]+(re[q]-re[p])*t, m=im[p]+(im[q]-im[p])*t; const ph=(Math.atan2(m,r)*180/Math.PI+360)%360; return hsl2rgb(ph,.72,.52); }));
    }
    const pos=[].concat(...parts.map(p=>p.pos)), nor=[].concat(...parts.map(p=>p.nor)), cl=[].concat(...parts.map(p=>p.col));
    const g=new T.BufferGeometry();
    g.setAttribute('position',new T.Float32BufferAttribute(pos,3)); g.setAttribute('normal',new T.Float32BufferAttribute(nor,3)); g.setAttribute('color',new T.Float32BufferAttribute(cl,3));
    if (isoMesh){ gWf.remove(isoMesh); isoMesh.geometry.dispose(); }
    isoMesh=new T.Mesh(g,isoMat); gWf.add(isoMesh);
    updVizRead();
  }
  let view='bz';
  function setView(v){ const prev=view; view=v; gBZ.visible=v==='bz'; gSt.visible=v==='st'; gWf.visible=v==='wf';
    labs.forEach(l=>l.el.hidden=l.g!==(v==='bz'?gBZ:v==='st'?gSt:null));
    if (prev!==v || v==='bz'){ cam.position.set(...(v==='bz'?[2.6,1.6,3.1]:[11,7,13])); ctl.target.set(0,0,0); ctl.update(); }
    $('#vBZ').setAttribute('aria-pressed',v==='bz'); $('#vSt').setAttribute('aria-pressed',v==='st'); $('#vWf').setAttribute('aria-pressed',v==='wf');
    $('#wfCtl').hidden=v!=='wf';
    if (v==='wf'){ if(!S.wf) S.wf={ki:0,n:nocc-1}; loadWf(); showWf(); emit(); }
    updVizRead(); }
  $('#vBZ').onclick=()=>setView('bz'); $('#vSt').onclick=()=>setView('st'); $('#vWf').onclick=()=>setView('wf');
  $('#wRe').onclick=()=>{ S.wfMode='re'; $('#wRe').setAttribute('aria-pressed',true); $('#wAbs').setAttribute('aria-pressed',false); showWf(); };
  $('#wAbs').onclick=()=>{ S.wfMode='abs'; $('#wAbs').setAttribute('aria-pressed',true); $('#wRe').setAttribute('aria-pressed',false); showWf(); };
  let isoT=0; $('#wIso').oninput=e=>{ S.wfIso=+e.target.value; $('#wIsoV').textContent=S.wfIso.toFixed(2); clearTimeout(isoT); isoT=setTimeout(showWf,60); };
  three_view=()=>view;
  function resize(){ const r=host.getBoundingClientRect(); renderer.setSize(r.width,r.height,false); renderer.domElement.style.width='100%'; renderer.domElement.style.height='100%'; cam.aspect=r.width/Math.max(1,r.height); cam.updateProjectionMatrix(); }
  new ResizeObserver(resize).observe(host); resize();
  const tmp=new T.Vector3();
  (function loop(){ requestAnimationFrame(loop); ctl.update(); renderer.render(scene,cam);
    const r=host.getBoundingClientRect();
    for (const l of labs){ if(l.el.hidden) continue; tmp.copy(l.v).project(cam); l.el.style.left=((tmp.x+1)/2*r.width)+'px'; l.el.style.top=((1-tmp.y)/2*r.height)+'px'; } })();
  let lastCloudW=null;
  three={ update(){
      if (S.ik!==null){ kMark.visible=true; kMark.position.set(...B.kcart[S.ik]); } else kMark.visible=false;
      const w=S.w; const dec=w===null?null:decAt(w);
      const key=dec?dec.w:null;
      if (key!==lastCloudW){ lastCloudW=key; while(cloud.children.length) cloud.remove(cloud.children[0]);
        if (dec){ const mx=Math.max(...dec.k.map(r=>r[3])); const mat=new T.MeshBasicMaterial({color:col('--accent'),transparent:true,opacity:.75});
          for (const r of dec.k.slice(0,70)){ const s=new T.Mesh(cloudGeo,mat); const rad=.008+.028*Math.sqrt(r[3]/mx); s.scale.set(rad,rad,rad); s.position.set(r[0],r[1],r[2]); cloud.add(s); } } }
      if (S.ik!==null && view!=='bz') {} },
    setView, showWf };
  setView('bz');
}
function updVizRead(){
  const v=three_view();
  if (v==='wf'){
    if (!S.wf){ $('#vizRead').innerHTML='<span>Clic en una banda para elegir el estado.</span>'; return; }
    if (WF==='error'){ $('#vizRead').innerHTML='<span>Este navegador no pudo descomprimir las funciones de onda.</span>'; return; }
    if (!WF){ $('#vizRead').innerHTML='<span>Descomprimiendo funciones de onda…</span>'; return; }
    const st=wfState(S.wf.ki,S.wf.n), k=wfK[S.wf.ki], lab=nearestLabel(B.x[k]), f=B.fat[S.wf.n][k];
    const deg = st.deg>1 ? `<span>degenerado ×${st.deg}: dentro de ese subespacio la combinación que ves es una de muchas</span>` : '';
    $('#vizRead').innerHTML=`<span>ψ<sub>${S.wf.n+1}</sub>(<b>k</b> = <b>${lab?lab.replace('W_2','W′'):'#'+k}</b>)</span><span>E <b>${fmt(B.E[S.wf.n][k],3)} eV</b> · ${S.wf.n<nocc?'valencia':'conducción'}</span><span>s ${(f[0]*100).toFixed(0)}% · p ${(f[1]*100).toFixed(0)}% · d ${(f[2]*100).toFixed(0)}%</span>${deg}<span>${S.wfMode==='re'?'naranja: Re ψ > 0 · azul: Re ψ < 0':'color = fase arg ψ'}</span>`;
    return;
  }
  const st=v==='st';
  $('#vizRead').innerHTML = st ? '<span>Fd-3m · celda convencional (8 átomos) · enlace Si–Si <b>2.352 Å</b></span><span>arrastra para rotar</span>'
    : `<span>red ${M.bravais} · camino ${D.bz.path.map(p=>p.map(x=>x==='GAMMA'?'Γ':x).join('–')).join(' | ')}</span>${S.w!==null?`<span>puntos azules: k que forman ε₂ a <b>${S.w.toFixed(2)} eV</b></span>`:''}`;
}
// ---------- mode ----------
function setMode(m){ S.mode=m; $('#mPost').setAttribute('aria-pressed',m==='post'); $('#mLearn').setAttribute('aria-pressed',m==='learn');
  $('#sidePost').hidden=m!=='post'; $('#sideLearn').hidden=m!=='learn'; $('#sideTitle').textContent=m==='post'?'Procedencia y controles':'Ecuaciones con tus números'; emit(); }
$('#mPost').onclick=()=>setMode('post'); $('#mLearn').onclick=()=>setMode('learn');

let raf=0;
listeners.push(()=>{ cancelAnimationFrame(raf); raf=requestAnimationFrame(()=>{ drawBands(); drawDos(); drawEps(); drawDec(); updEpsRead(); updVizRead(); if(three) three.update(); if(S.mode==='learn') $('#sideLearn').innerHTML=learnHTML(); }); });
function redrawAll(){ drawScf(); emit(); }
new ResizeObserver(redrawAll).observe(document.querySelector('.grid'));
try{ matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redrawAll); }catch(e){}
new MutationObserver(redrawAll).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
try{ init3D(); }catch(e){ $('#three').innerHTML='<p class="note" style="padding:12px">La vista 3D no está disponible en este navegador.</p>'; }
document.fonts && document.fonts.ready.then(redrawAll);
redrawAll();
})();
