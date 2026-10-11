// Landing page: the chain of a DFT calculation as cards linking to each section.
import { VIEWS } from './registry.js';
export function mount(root){
  const learn=VIEWS.filter(v=>v.group==='learn'), tools=VIEWS.filter(v=>v.group!=='learn'&&v.group!=='start');
  const DESC={pseudos:'Qué se quita del átomo y por qué funciona: funciones reales vs pseudo, norma, fantasmas.',xc:'LDA, GGA, híbridos y vdW; dónde se nota en un cristal y en el grafito.',bandas:'Bandas gordas, PDOS, ε(ω) y la función de onda en 3D del Si.'};
  root.innerHTML=`<div class="pghead"><div><h1>DFT Lab</h1><p class="lede">Un curso de teoría del funcional de la densidad construido sobre cálculos reales de SIESTA, y una mesa de trabajo para postprocesar los tuyos. Nada aquí es una animación: cada curva sale de un cálculo, y cada cálculo dice cómo se hizo.</p></div></div>
  <h3>Aprender</h3><div class="cards">${learn.map(v=>`<a class="card" href="#${v.id}"><span class="num">${v.num}</span><b>${v.title}</b><span>${v.desc||DESC[v.id]||''}</span></a>`).join('')}</div>
  ${tools.length?`<h3>Herramientas y postproceso</h3><div class="cards">${tools.map(v=>`<a class="card" href="#${v.id}"><b>${v.title}</b><span>${v.desc||''}</span></a>`).join('')}</div>`:''}`;
}
