// 3D viewer for structures, Brillouin zones and isosurfaces (three.js r128).
import * as THREE from '../../vendor/three/three.module.js';
import { OrbitControls } from '../../vendor/three/OrbitControls.js';
import { css, rgb } from './ui.js';

export function createViewer(host, {camera=[12,8,14]}={}){
  const renderer=new THREE.WebGLRenderer({antialias:true, alpha:true, preserveDrawingBuffer:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2)); host.appendChild(renderer.domElement);
  const scene=new THREE.Scene(), cam=new THREE.PerspectiveCamera(35,1,0.01,500);
  const ctl=new OrbitControls(cam, renderer.domElement); ctl.enableDamping=true;
  scene.add(new THREE.AmbientLight(0xffffff,.62)); const dl=new THREE.DirectionalLight(0xffffff,.62); dl.position.set(3,5,4); cam.add(dl); scene.add(cam);
  const root=new THREE.Group(); scene.add(root);
  const labels=[], shared=new WeakSet();
  const inScene=o=>{ while(o){ if(o===scene) return true; o=o.parent; } return false; };
  cam.position.set(...camera); ctl.target.set(0,0,0); ctl.update();
  function resize(){ const r=host.getBoundingClientRect(); if(!r.width) return; renderer.setSize(r.width,r.height,false); renderer.domElement.style.width='100%'; renderer.domElement.style.height='100%'; cam.aspect=r.width/Math.max(1,r.height); cam.updateProjectionMatrix(); }
  const ro=new ResizeObserver(resize); ro.observe(host); resize();
  const tmp=new THREE.Vector3(); let alive=true;
  (function loop(){ if(!alive) return; requestAnimationFrame(loop); ctl.update(); renderer.render(scene,cam);
    const r=host.getBoundingClientRect();
    for (const l of labels){ if(!l.group.visible){ l.el.hidden=true; continue; } l.el.hidden=false; tmp.copy(l.v); l.group.localToWorld(tmp); tmp.project(cam); l.el.style.left=((tmp.x+1)/2*r.width)+'px'; l.el.style.top=((1-tmp.y)/2*r.height)+'px'; } })();
  const api={
    THREE, scene, cam, ctl, root, renderer,
    group(){ const g=new THREE.Group(); root.add(g); return g; },
    // Vacía un grupo y libera lo que el visor posee: geometrías, materiales y texturas de todos los
    // descendientes (una vez cada uno aunque se compartan dentro del grupo). Lo marcado con share() no se libera.
    clear(g){ const own=new Set(); while(g.children.length){ const c=g.children[g.children.length-1]; g.remove(c); collect(c,own); } disposeAll(own,shared);
      for (let i=labels.length-1;i>=0;i--) if(labels[i].group===g || !inScene(labels[i].group)){ labels[i].el.remove(); labels.splice(i,1); } },
    // Recurso (geometría, material, textura) que no pertenece al visor: clear()/destroy() no lo liberan.
    share(r){ if (r) shared.add(r); return r; },
    label(g, text, v){ const d=document.createElement('div'); d.className='lbl3'; d.textContent=text; host.appendChild(d); labels.push({el:d,v:new THREE.Vector3(...v),group:g}); },
    view(pos, target=[0,0,0]){ cam.position.set(...pos); ctl.target.set(...target); ctl.update(); },
    color(name){ return new THREE.Color(css(name)); },
    snapshot(){ renderer.render(scene,cam); return renderer.domElement.toDataURL('image/png'); },
    // Idempotente: para el bucle, desconecta el observador y los controles, libera la escena y el
    // contexto WebGL (si no, cada visor creado deja un contexto vivo hasta agotar el límite del navegador).
    destroy(){ if(!alive) return; alive=false; ro.disconnect(); ctl.dispose(); api.clear(root);
      for (const l of labels) l.el.remove(); labels.length=0;
      renderer.dispose(); renderer.forceContextLoss(); host.innerHTML=''; }
  };
  return api;
}

// Recoge geometrías, materiales y texturas de un objeto y sus descendientes.
export function collect(obj, out=new Set()){
  obj.traverse(o=>{ if(o.geometry) out.add(o.geometry);
    for (const m of [].concat(o.material||[])){ out.add(m); for (const v of Object.values(m)) if(v && v.isTexture) out.add(v); } });
  return out;
}
// Libera cada recurso una vez, salvo los marcados como compartidos.
export function disposeAll(resources, shared){
  for (const r of resources) if(!shared?.has(r)) r.dispose?.();
}

// ---- structure: atoms {el, pos:[x,y,z], color, r}, bonds [[i,j]], cell 3x3 rows ----
export function drawStructure(V, g, {atoms, bonds=[], cell=null, center=null, atomScale=1, bondR=0.11}){
  const T=V.THREE; V.clear(g);
  const c=center || (cell ? [0,1,2].map(k=>(cell[0][k]+cell[1][k]+cell[2][k])/2) : [0,1,2].map(k=>atoms.reduce((a,b)=>a+b.pos[k],0)/atoms.length));
  const sub=p=>new T.Vector3(p[0]-c[0],p[1]-c[1],p[2]-c[2]);
  const geoCache={}, matCache={};
  atoms.forEach(a=>{ const r=(a.r||0.4)*atomScale; const gk=r.toFixed(2); geoCache[gk]=geoCache[gk]||new T.SphereGeometry(r,24,18);
    const mk=a.color; matCache[mk]=matCache[mk]||new T.MeshStandardMaterial({color:new T.Color(a.color),roughness:.45,metalness:.1});
    const m=new T.Mesh(geoCache[gk],matCache[mk]); m.position.copy(sub(a.pos)); m.userData={atom:a}; g.add(m); });
  const bm=new T.MeshStandardMaterial({color:new T.Color(css('--faint')),roughness:.6});
  for (const [i,j] of bonds){ const A=sub(atoms[i].pos), B=sub(atoms[j].pos), len=A.distanceTo(B);
    const m=new T.Mesh(new T.CylinderGeometry(bondR,bondR,len,10),bm); m.position.copy(A.clone().add(B).multiplyScalar(.5));
    m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0), B.clone().sub(A).normalize()); g.add(m); }
  if (cell){ const o=sub([0,0,0]), a=cell.map(v=>new T.Vector3(...v)); const P=[o, o.clone().add(a[0]), o.clone().add(a[1]), o.clone().add(a[2]), o.clone().add(a[0]).add(a[1]), o.clone().add(a[0]).add(a[2]), o.clone().add(a[1]).add(a[2]), o.clone().add(a[0]).add(a[1]).add(a[2])];
    const E=[[0,1],[0,2],[0,3],[1,4],[1,5],[2,4],[2,6],[3,5],[3,6],[4,7],[5,7],[6,7]]; const pts=[]; for (const [i,j] of E){ pts.push(P[i],P[j]); }
    g.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(pts), new T.LineBasicMaterial({color:new T.Color(css('--muted'))}))); }
  return c;
}
// ---- Brillouin zone: faces [[v...]], path segments [[k...]], points {label: k} ----
export function drawBZ(V, g, {faces, segments=[], points={}}){
  const T=V.THREE; V.clear(g);
  const em=new T.LineBasicMaterial({color:new T.Color(css('--muted'))});
  for (const f of faces){ const pts=f.map(p=>new T.Vector3(...p)); pts.push(pts[0].clone()); g.add(new T.Line(new T.BufferGeometry().setFromPoints(pts),em)); }
  const fm=new T.MeshBasicMaterial({color:new T.Color(css('--accent')),transparent:true,opacity:.05,side:T.DoubleSide,depthWrite:false});
  for (const f of faces){ const pos=[]; for (let i=1;i<f.length-1;i++) pos.push(...f[0],...f[i],...f[i+1]); const geo=new T.BufferGeometry(); geo.setAttribute('position',new T.Float32BufferAttribute(pos,3)); g.add(new T.Mesh(geo,fm)); }
  const pm=new T.LineBasicMaterial({color:new T.Color(css('--accent'))});
  for (const s of segments) g.add(new T.Line(new T.BufferGeometry().setFromPoints(s.map(p=>new T.Vector3(...p))),pm));
  const dm=new T.MeshBasicMaterial({color:new T.Color(css('--ink'))}), dg=new T.SphereGeometry(.022,12,10);
  for (const [k,p] of Object.entries(points)){ const s=new T.Mesh(dg,dm); s.position.set(...p); g.add(s); V.label(g,k.replace('GAMMA','Γ').replace(/_(\d)/,'$1'),p); }
}

// ---- isosurface (marching tetrahedra) ----
const TETS=[[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]];
const CORN=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
// V: Float32Array of size M0*M1*M2 (index (i*M1+j)*M2+k); toCart(i,j,k)->[x,y,z] (grid coordinates may be non-orthogonal)
export function isoSurface(Vf, dims, toCart, L, colorFn){
  const [M0,M1,M2]=dims, id=(i,j,k)=>(i*M1+j)*M2+k, n=M0*M1*M2;
  const gx=new Float32Array(n), gy=new Float32Array(n), gz=new Float32Array(n);
  for (let i=0;i<M0;i++) for (let j=0;j<M1;j++) for (let k=0;k<M2;k++){ const p=id(i,j,k);
    gx[p]=Vf[id(Math.min(i+1,M0-1),j,k)]-Vf[id(Math.max(i-1,0),j,k)]; gy[p]=Vf[id(i,Math.min(j+1,M1-1),k)]-Vf[id(i,Math.max(j-1,0),k)]; gz[p]=Vf[id(i,j,Math.min(k+1,M2-1))]-Vf[id(i,j,Math.max(k-1,0))]; }
  // gradient in grid index space -> approximate cartesian normal via toCart differences
  const e0=sub3(toCart(1,0,0),toCart(0,0,0)), e1=sub3(toCart(0,1,0),toCart(0,0,0)), e2=sub3(toCart(0,0,1),toCart(0,0,0));
  const Minv=inv3([e0,e1,e2]); // rows e_i; grad_cart = Minv * grad_index
  const pos=[], nor=[], col=[]; const P=new Array(8), Vv=new Array(8), I=new Array(8);
  function vert(a,b){ const t=(L-Vv[a])/(Vv[b]-Vv[a]); const pa=P[a], pb=P[b];
    const gi=[-(gx[I[a]]+(gx[I[b]]-gx[I[a]])*t), -(gy[I[a]]+(gy[I[b]]-gy[I[a]])*t), -(gz[I[a]]+(gz[I[b]]-gz[I[a]])*t)];
    const gc=[Minv[0][0]*gi[0]+Minv[0][1]*gi[1]+Minv[0][2]*gi[2], Minv[1][0]*gi[0]+Minv[1][1]*gi[1]+Minv[1][2]*gi[2], Minv[2][0]*gi[0]+Minv[2][1]*gi[1]+Minv[2][2]*gi[2]];
    const nn=Math.hypot(...gc)||1; const c=colorFn(I[a],I[b],t);
    return [pa[0]+(pb[0]-pa[0])*t, pa[1]+(pb[1]-pa[1])*t, pa[2]+(pb[2]-pa[2])*t, gc[0]/nn, gc[1]/nn, gc[2]/nn, c[0],c[1],c[2]]; }
  function tri(A,B,C){ const ux=B[0]-A[0],uy=B[1]-A[1],uz=B[2]-A[2], vx=C[0]-A[0],vy=C[1]-A[1],vz=C[2]-A[2]; const fx=uy*vz-uz*vy, fy=uz*vx-ux*vz, fz=ux*vy-uy*vx;
    if (fx*(A[3]+B[3]+C[3])+fy*(A[4]+B[4]+C[4])+fz*(A[5]+B[5]+C[5])<0){ const t=B; B=C; C=t; }
    for (const q of [A,B,C]){ pos.push(q[0],q[1],q[2]); nor.push(q[3],q[4],q[5]); col.push(q[6],q[7],q[8]); } }
  for (let i=0;i<M0-1;i++) for (let j=0;j<M1-1;j++) for (let k=0;k<M2-1;k++){
    let any=0, all=1; for (let c=0;c<8;c++){ const q=CORN[c]; I[c]=id(i+q[0],j+q[1],k+q[2]); Vv[c]=Vf[I[c]]; if(Vv[c]>L) any=1; else all=0; }
    if (!any||all) continue;
    for (let c=0;c<8;c++){ const q=CORN[c]; P[c]=toCart(i+q[0],j+q[1],k+q[2]); }
    for (const t of TETS){ const inn=t.filter(c=>Vv[c]>L), out=t.filter(c=>Vv[c]<=L);
      if (inn.length===0||inn.length===4) continue;
      if (inn.length===1) tri(vert(inn[0],out[0]),vert(inn[0],out[1]),vert(inn[0],out[2]));
      else if (inn.length===3) tri(vert(out[0],inn[0]),vert(out[0],inn[1]),vert(out[0],inn[2]));
      else { const a=vert(inn[0],out[0]), b=vert(inn[0],out[1]), c=vert(inn[1],out[1]), d=vert(inn[1],out[0]); tri(a,b,c); tri(a,c,d); } }
  }
  return {pos,nor,col};
}
function sub3(a,b){ return [a[0]-b[0],a[1]-b[1],a[2]-b[2]]; }
export function inv3(m){ const [a,b,c]=m; const det=a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]);
  // inverse of matrix whose ROWS are a,b,c ; returns matrix X with X*[a;b;c]^T... we need grad_cart such that grad_index_i = e_i·grad_cart => E grad_cart = grad_index => grad_cart = E^{-1} grad_index
  const E=[[a[0],a[1],a[2]],[b[0],b[1],b[2]],[c[0],c[1],c[2]]];
  const inv=[[ (E[1][1]*E[2][2]-E[1][2]*E[2][1])/det, (E[0][2]*E[2][1]-E[0][1]*E[2][2])/det, (E[0][1]*E[1][2]-E[0][2]*E[1][1])/det ],
             [ (E[1][2]*E[2][0]-E[1][0]*E[2][2])/det, (E[0][0]*E[2][2]-E[0][2]*E[2][0])/det, (E[0][2]*E[1][0]-E[0][0]*E[1][2])/det ],
             [ (E[1][0]*E[2][1]-E[1][1]*E[2][0])/det, (E[0][1]*E[2][0]-E[0][0]*E[2][1])/det, (E[0][0]*E[1][1]-E[0][1]*E[1][0])/det ]];
  return inv; }
export function meshFrom(V, {pos,nor,col}, {opacity=.92}={}){
  const T=V.THREE, g=new T.BufferGeometry();
  g.setAttribute('position',new T.Float32BufferAttribute(pos,3)); g.setAttribute('normal',new T.Float32BufferAttribute(nor,3)); g.setAttribute('color',new T.Float32BufferAttribute(col,3));
  return new T.Mesh(g,new T.MeshStandardMaterial({vertexColors:true,side:T.DoubleSide,roughness:.42,metalness:.05,transparent:opacity<1,opacity}));
}
export function hsl2rgb(h,s,l){ const f=n=>{ const k=(n+h/30)%12, a=s*Math.min(l,1-l); return l-a*Math.max(-1,Math.min(k-3,9-k,1)); }; return [f(0),f(8),f(4)]; }
export const cssRGB = n => rgb(css(n)).map(v=>v/255);
