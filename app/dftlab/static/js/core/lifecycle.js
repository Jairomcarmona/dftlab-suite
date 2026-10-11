// Ciclo de vida de una vista. El router crea un ámbito por montaje y lo libera al abandonarla.
// Todo lo que la vista registre (suscripciones, listeners, observadores, timers, frames, recursos)
// se libera una sola vez y en orden inverso; los callbacks envueltos con guard() no actúan sobre una
// vista abandonada. `alive` es la prueba de vigencia: no usar root.isConnected, porque el contenedor
// de vistas es el mismo elemento conectado de una navegación a otra.
import { onTheme } from './ui.js';

export function createViewScope(){
  let alive = true;
  const cleanups = [];
  const ac = typeof AbortController === 'function' ? new AbortController() : null;
  const run = f => { try{ f(); }catch(e){ console.error(e); } };
  const scope = {
    get alive(){ return alive; },
    // AbortSignal para fetch/addEventListener({signal}); se aborta al salir.
    signal: ac ? ac.signal : undefined,
    // Registra una limpieza. Si la vista ya se abandonó (p. ej. tras un await), se ejecuta ya.
    add(f){ if (typeof f !== 'function') return f; if (alive) cleanups.push(f); else run(f); return f; },
    // Envuelve un callback para que no haga nada cuando la vista ya no está vigente.
    guard(f){ return (...a) => alive ? f(...a) : undefined; },
    onTheme(f){ return scope.add(onTheme(scope.guard(f))); },
    timeout(f, ms){ const t = setTimeout(scope.guard(f), ms); scope.add(() => clearTimeout(t)); return t; },
    interval(f, ms){ const t = setInterval(scope.guard(f), ms); scope.add(() => clearInterval(t)); return t; },
    // Observador (ResizeObserver, MutationObserver…) desconectado al salir.
    observer(o){ scope.add(() => o.disconnect()); return o; },
    // Objeto con destroy()/dispose() propiedad de la vista.
    own(r){ if (r) scope.add(() => (r.destroy || r.dispose).call(r)); return r; },
    dispose(){
      if (!alive) return;
      alive = false;
      if (ac) ac.abort();
      while (cleanups.length) run(cleanups.pop());
    },
  };
  return scope;
}
