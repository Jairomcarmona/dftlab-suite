// Spherical, non-relativistic Kohn–Sham solver for an isolated atom (Hartree atomic units).
// Log grid r = r0·e^x, Numerov on φ(x) = u(r)/√r, eigenvalues by node-counting bisection,
// Hartree potential by radial integration, LDA exchange + VWN5 or PZ81 correlation.
// Validated against NIST's LDA atomic reference data (Kotochigova et al., VWN), see tests.

const ORDER = [[1,0],[2,0],[2,1],[3,0],[3,1],[4,0],[3,2],[4,1],[5,0],[4,2],[5,1],[6,0],[4,3],[5,2],[6,1],[7,0],[5,3],[6,2],[7,1]];
// Ground-state configurations that break the Madelung order (neutral atoms)
const EXC = { 24:{'3d':5,'4s':1}, 29:{'3d':10,'4s':1}, 41:{'4d':4,'5s':1}, 42:{'4d':5,'5s':1}, 44:{'4d':7,'5s':1}, 45:{'4d':8,'5s':1}, 46:{'4d':10,'5s':0}, 47:{'4d':10,'5s':1}, 78:{'5d':9,'6s':1}, 79:{'5d':10,'6s':1} };
export const LL = ['s','p','d','f'];

/** Aufbau configuration for Z electrons (minus `charge`). Returns [{n,l,f}] */
export function configuration(Z, charge = 0) {
  let ne = Z - charge; const conf = [];
  for (const [n,l] of ORDER) { if (ne <= 0) break; const f = Math.min(ne, 2*(2*l+1)); conf.push({n,l,f}); ne -= f; }
  const ex = charge === 0 ? EXC[Z] : null;
  if (ex) for (const [k,v] of Object.entries(ex)) { const n=+k[0], l=LL.indexOf(k[1]); const o=conf.find(c=>c.n===n&&c.l===l); if (o) o.f=v; else conf.push({n,l,f:v}); }
  return conf.filter(c => c.f > 0 || (ex && c.f === 0 && false));
}
export const confString = conf => conf.map(c => `${c.n}${LL[c.l]}${(+c.f.toFixed(3)).toString().replace(/\.0+$/,'')}`).join(' ');
export function parseConfig(s) { const out=[]; const re=/(\d)([spdf])\s*(\d+(?:\.\d+)?)?/g; let m; while((m=re.exec(s))) out.push({n:+m[1],l:LL.indexOf(m[2]),f:m[3]===undefined?1:+m[3]}); return out; }

// ---------------- exchange–correlation (unpolarized) ----------------
function vwn(rs) { // returns [ec, vc]
  const A=0.0310907, x0=-0.10498, b=3.72744, c=12.9352, Q=Math.sqrt(4*c-b*b);
  const X = x => x*x + b*x + c, X0 = X(x0);
  const e = x => A*( Math.log(x*x/X(x)) + 2*b/Q*Math.atan(Q/(2*x+b)) - b*x0/X0*( Math.log((x-x0)**2/X(x)) + 2*(b+2*x0)/Q*Math.atan(Q/(2*x+b)) ) );
  const x = Math.sqrt(rs), ec = e(x);
  const dx = 1e-6*Math.max(x,1e-3), dedx = (e(x+dx)-e(x-dx))/(2*dx);
  return [ec, ec - x/6*dedx];
}
function pz(rs) {
  if (rs < 1) { const A=0.0311,B=-0.048,C=0.0020,D=-0.0116, l=Math.log(rs); const ec=A*l+B+C*rs*l+D*rs; return [ec, ec - rs/3*(A/rs + C*l + C + D)]; }
  const g=-0.1423, b1=1.0529, b2=0.3334, s=Math.sqrt(rs), den=1+b1*s+b2*rs, ec=g/den;
  return [ec, ec - rs/3*(-g*(b1/(2*s)+b2)/(den*den))];
}
export function xc(rho, kind = 'vwn') {
  if (rho < 1e-30) return [0, 0, 0, 0];
  const rs = Math.cbrt(3/(4*Math.PI*rho)), ex = -0.458165293283143/rs, vx = 4/3*ex;
  const [ec, vc] = kind === 'pz' ? pz(rs) : kind === 'x' ? [0,0] : vwn(rs);
  return [ex, vx, ec, vc];
}

// ---------------- grid ----------------
export function makeGrid(Z, { N = 4000, rmin = 1e-6, rmax = 60 } = {}) {
  const x0 = Math.log(rmin/Z), x1 = Math.log(rmax), h = (x1-x0)/(N-1);
  const r = new Float64Array(N); for (let i=0;i<N;i++) r[i] = Math.exp(x0 + i*h);
  return { r, h, N };
}
const trapz = (g, f) => { let s=0; const {r,h,N}=g; for (let i=0;i<N;i++){ const w=(i===0||i===N-1)?0.5:1; s+=w*f[i]*r[i]; } return s*h; }; // ∫ f dr = ∫ f r dx

// ---------------- radial Schrödinger ----------------
// Outward Numerov for φ'' = k(x) φ with k = (l+½)² + 2r²(V−E). Returns node count and filled φ.
function outward(g, V, l, E, phi, Z = 0) {
  const {r,h,N} = g, h12 = h*h/12; let nodes = 0;
  const k = i => (l+0.5)**2 + 2*r[i]*r[i]*(V[i]-E);
  phi[0] = Math.pow(r[0], l+0.5)*(1 - Z*r[0]/(l+1)); phi[1] = Math.pow(r[1], l+0.5)*(1 - Z*r[1]/(l+1));
  let f0 = 1 - h12*k(0), f1 = 1 - h12*k(1), last = N-1;
  for (let i=1;i<N-1;i++) {
    const f2 = 1 - h12*k(i+1);
    phi[i+1] = ((12-10*f1)*phi[i] - f0*phi[i-1]) / f2;
    if (phi[i+1]*phi[i] < 0) nodes++;
    if (Math.abs(phi[i+1]) > 1e100) { for (let j=0;j<=i+1;j++) phi[j]*=1e-100; }
    // deep in the classically forbidden region the solution only grows (and Numerov turns unstable)
    if (V[i+1] > E && h12*k(i+1) > 0.3) { last = i+1; break; }
    f0 = f1; f1 = f2;
  }
  return { nodes, last };
}
// Bound state with n_r = n−l−1 radial nodes; returns {E, u (normalized, u = r R)}
export function solveState(g, V, n, l, Eguess = null) {
  const Z = -V[0]*g.r[0];
  const target = n - l - 1, phi = new Float64Array(g.N);
  let lo = Infinity, hi = -1e-12;
  for (let i=0;i<g.N;i++) lo = Math.min(lo, V[i] + l*(l+1)/(2*g.r[i]*g.r[i]));
  if (outward(g,V,l,hi,phi,Z).nodes <= target) return null; // unbound in this grid
  for (let it=0; it<200 && hi-lo > 1e-12*Math.max(1,Math.abs(lo)); it++) {
    const E = 0.5*(lo+hi), { nodes } = outward(g, V, l, E, phi, Z);
    if (nodes > target) hi = E; else lo = E;
  }
  const E = 0.5*(lo+hi); const { last } = outward(g, V, l, lo, phi, Z);
  // build u = √r φ, cut the diverging tail at the last minimum of |u| beyond the outer turning point
  const u = new Float64Array(g.N); let cut = last;
  for (let i=0;i<=Math.min(last,g.N-1);i++) u[i] = Math.sqrt(g.r[i])*phi[i];
  let iT = 0; for (let i=g.N-1;i>0;i--) if (V[i] + l*(l+1)/(2*g.r[i]**2) < E) { iT = i; break; }
  let best = Math.min(last, g.N-1), bv = Infinity;
  for (let i=iT;i<=Math.min(last,g.N-1);i++){ const a=Math.abs(u[i]); if (a<bv){ bv=a; best=i; } }
  cut = best; for (let i=cut+1;i<g.N;i++) u[i]=0;
  const nrm = Math.sqrt(trapz(g, u.map(x=>x*x))); for (let i=0;i<g.N;i++) u[i]/=nrm;
  // sign convention: positive near the nucleus
  const first = u.findIndex(x=>Math.abs(x)>1e-6); if (first>=0 && u[first]<0) for (let i=0;i<g.N;i++) u[i]=-u[i];
  return { E, u };
}

// ---------------- Hartree ----------------
function hartree(g, rho) {
  const {r,h,N} = g, VH = new Float64Array(N); let q = 0; const Q = new Float64Array(N), P = new Float64Array(N);
  for (let i=1;i<N;i++) { const a=4*Math.PI*rho[i-1]*r[i-1]**3, b=4*Math.PI*rho[i]*r[i]**3; Q[i]=Q[i-1]+0.5*(a+b)*h; }
  for (let i=N-2;i>=0;i--) { const a=4*Math.PI*rho[i+1]*r[i+1]**2, b=4*Math.PI*rho[i]*r[i]**2; P[i]=P[i+1]+0.5*(a+b)*h; }
  for (let i=0;i<N;i++) VH[i] = Q[i]/r[i] + P[i];
  return VH;
}

/**
 * Self-consistent Kohn–Sham atom.
 * opts: {conf, xc:'vwn'|'pz'|'x'|'none', mix, tol, maxit, onIter(info)}
 * Returns {grid, orbitals:[{n,l,f,E,u}], rho, V, VH, Vxc, energies:{...}, history:[...], converged}
 */
export function solveAtom(Z, opts = {}) {
  const conf = (opts.conf || configuration(Z)).map(c => ({...c}));
  const kind = opts.xc || 'vwn', mix = opts.mix ?? 0.4, tol = opts.tol ?? 1e-7, maxit = opts.maxit ?? 200;
  const g = makeGrid(Z, opts.grid), {r,N} = g;
  // start: Thomas–Fermi-like screened Coulomb potential
  let V = new Float64Array(N);
  const Ne = conf.reduce((s,c)=>s+c.f,0);
  for (let i=0;i<N;i++){ const x=r[i]*Math.cbrt(Z)/0.8853; const phiTF=1/(1+0.02747*Math.sqrt(x)+1.243*x-0.1486*x**1.5+0.2302*x*x+0.007298*x**2.5+0.006944*x**3); V[i] = -Math.max(Z*phiTF, Z-Ne+1)/r[i]; }
  const hist = []; let orbs = [], rho = new Float64Array(N), VH, Vxc = new Float64Array(N), conv = false, Eprev = 0;
  const snap = [];
  for (let it=1; it<=maxit; it++) {
    orbs = conf.map(c => { const s = solveState(g, V, c.n, c.l); return { ...c, E: s ? s.E : NaN, u: s ? s.u : new Float64Array(N) }; });
    const rhoOut = new Float64Array(N);
    for (const o of orbs) for (let i=0;i<N;i++) rhoOut[i] += o.f*o.u[i]*o.u[i]/(4*Math.PI*r[i]*r[i]);
    if (it === 1) rho = rhoOut; else for (let i=0;i<N;i++) rho[i] = (1-mix)*rho[i] + mix*rhoOut[i];
    VH = hartree(g, rho);
    const exc = new Float64Array(N);
    for (let i=0;i<N;i++){ const [ex,vx,ec,vc] = kind==='none' ? [0,0,0,0] : xc(rho[i], kind); Vxc[i]=vx+vc; exc[i]=ex+ec; }
    const Vnew = new Float64Array(N); let dV = 0;
    for (let i=0;i<N;i++){ Vnew[i] = -Z/r[i] + VH[i] + Vxc[i]; dV = Math.max(dV, Math.abs(Vnew[i]-V[i])*r[i]); }
    // energies with the output orbitals and the mixed density
    const ebs = orbs.reduce((s,o)=>s+o.f*o.E,0);
    const f4 = a => a.map((v,i)=>4*Math.PI*r[i]*r[i]*v);
    const EH = 0.5*trapz(g, f4(rho.map((p,i)=>p*VH[i])));
    const Exc = trapz(g, f4(rho.map((p,i)=>p*exc[i])));
    const Vxcint = trapz(g, f4(rho.map((p,i)=>p*Vxc[i])));
    const Een = -Z*trapz(g, f4(rho.map((p,i)=>p/r[i])));
    const Etot = ebs - EH - Vxcint + Exc;
    const Ekin = Etot - EH - Exc - Een;
    hist.push({ it, Etot, dV, eig: orbs.map(o=>o.E) });
    if (opts.onIter) opts.onIter({ it, Etot, dV });
    if (opts.keepSnapshots) snap.push({ rho: Float64Array.from(rho), V: Float64Array.from(Vnew) });
    V = Vnew;
    const dEig = it>1 ? Math.max(...orbs.map((o,j)=>Math.abs(o.E-hist[it-2].eig[j]))) : 1;
    hist[it-1].dEig = dEig;
    if (it > 2 && dEig < tol && Math.abs(Etot-Eprev) < tol) { conv = true; Eprev = Etot; break; }
    Eprev = Etot;
  }
  // final energies
  const f4 = a => a.map((v,i)=>4*Math.PI*r[i]*r[i]*v);
  const exc = new Float64Array(N); for (let i=0;i<N;i++){ const [ex,vx,ec,vc]=kind==='none'?[0,0,0,0]:xc(rho[i],kind); exc[i]=ex+ec; }
  const ebs = orbs.reduce((s,o)=>s+o.f*o.E,0), EH = 0.5*trapz(g,f4(rho.map((p,i)=>p*VH[i]))), Exc = trapz(g,f4(rho.map((p,i)=>p*exc[i])));
  const Exc_x = trapz(g,f4(rho.map((p,i)=>p*(kind==='none'?0:xc(p,kind)[0]))));
  const Vxcint = trapz(g,f4(rho.map((p,i)=>p*Vxc[i]))), Een = -Z*trapz(g,f4(rho.map((p,i)=>p/r[i])));
  const Etot = ebs - EH - Vxcint + Exc, Ekin = Etot - EH - Exc - Een;
  return { Z, grid: g, orbitals: orbs, rho, V, VH, Vxc, conf, xc: kind, converged: conv, history: hist, snapshots: snap,
    energies: { Etot, Ekin, Een, EH, Exc, Ex: Exc_x, Ec: Exc - Exc_x, ebs }, charge: trapz(g, f4(rho)) };
}
