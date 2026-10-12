import { kramersKronig } from '../../../app/dftlab/static/js/siesta/epsimg.js';
const w0 = 4, g = 0.5, wp = Math.sqrt(10.7) * w0;
const eps = (w) => { const dr = w0*w0 - w*w, di = g*w, d = dr*dr + di*di; return [1 + wp*wp*dr/d, wp*wp*di/d]; };
for (const Emax of [8, 12, 20, 40, 100]) {
  const n = Math.round(Emax / 0.01) + 1, E = new Float64Array(n), e2 = new Float64Array(n);
  for (let i = 0; i < n; i++) { E[i] = i * 0.01; e2[i] = eps(E[i])[1]; }
  const e1 = kramersKronig(E, e2);
  const k = 50; // w = 0.5 eV (0 evita la division)
  const w = E[k];
  console.log(`Emax=${Emax} eV  eps1(0.5 eV) KK=${e1[k].toFixed(3)} exacto=${eps(w)[0].toFixed(3)}  error=${(100*(e1[k]-eps(w)[0])/eps(w)[0]).toFixed(2)} %`);
}
