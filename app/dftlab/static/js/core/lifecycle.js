// Ciclo de vida de una vista. El router crea un ámbito por montaje y lo libera al abandonarla.
// Todo lo que la vista registre (suscripciones, listeners, observadores, timers, frames, recursos)
// se libera una sola vez y en orden inverso; los callbacks envueltos con guard() no actúan sobre una
// vista abandonada. `alive` es la prueba de vigencia: no usar root.isConnected, porque el contenedor
// de vistas es el mismo elemento conectado de una navegación a otra.
import { onTheme } from './ui.js';

export function createViewScope(context = {}){
  let alive = true;
  const cleanups = [];
  const frames = new Set();
  const owned = new WeakSet();
  const ac = typeof AbortController === 'function' ? new AbortController() : null;
  const run = f => { try{ f(); }catch(e){ console.error(e); } };
  const scope = {
    // Contexto UI por montaje; no contiene credenciales ni autoridad de ejecución.
    context: Object.freeze({...context}),
    get alive(){ return alive; },
    // AbortSignal para fetch/addEventListener({signal}); se aborta al salir.
    signal: ac ? ac.signal : undefined,
    // Registra una limpieza. Si la vista ya se abandonó (p. ej. tras un await), se ejecuta ya.
    add(f){ if (typeof f !== 'function') return f; if (alive) cleanups.push(f); else run(f); return f; },
    // Envuelve un callback para que no haga nada cuando la vista ya no está vigente.
    guard(f){ return function(...a){ return alive ? f.apply(this, a) : undefined; }; },
    listen(target, type, f, options){
      const callback = scope.guard(f);
      target.addEventListener(type, callback, options);
      return scope.add(() => target.removeEventListener(type, callback, options));
    },
    // subscribe(callback) debe devolver la desuscripción; store y SDK usan el mismo patrón.
    subscribe(source, f){ return scope.add(source.subscribe(scope.guard(f))); },
    // Worker propiedad del montaje. Mensajes pendientes también necesitan guard/listen.
    worker(w){
      if (w && !owned.has(w)) {
        if (typeof w.terminate !== 'function') throw new TypeError('Worker sin terminate()');
        owned.add(w); scope.add(() => w.terminate());
      }
      return w;
    },
    frame(f){
      if (!alive) return undefined;
      const t = requestAnimationFrame(time => { frames.delete(t); if (alive) f(time); });
      frames.add(t); return t;
    },
    onTheme(f){ return scope.add(onTheme(scope.guard(f))); },
    timeout(f, ms){ const t = setTimeout(scope.guard(f), ms); scope.add(() => clearTimeout(t)); return t; },
    interval(f, ms){ const t = setInterval(scope.guard(f), ms); scope.add(() => clearInterval(t)); return t; },
    // Observador (ResizeObserver, MutationObserver…) desconectado al salir.
    observer(o){
      if (!owned.has(o)) {
        if (typeof o.disconnect !== 'function') throw new TypeError('Observer sin disconnect()');
        owned.add(o); scope.add(() => o.disconnect());
      }
      return o;
    },
    // Objeto con destroy()/dispose() propiedad de la vista.
    own(r){
      if (r && !owned.has(r)) {
        const dispose = r.destroy || r.dispose;
        if (typeof dispose !== 'function') throw new TypeError('Recurso sin destroy()/dispose()');
        owned.add(r);
        scope.add(() => dispose.call(r));
      }
      return r;
    },
    dispose(){
      if (!alive) return;
      alive = false;
      if (ac) ac.abort();
      for (const t of frames) run(() => cancelAnimationFrame(t));
      frames.clear();
      while (cleanups.length) run(cleanups.pop());
    },
  };
  return scope;
}

// Adaptador incremental: registry.render y módulos históricos mount/destroy comparten ámbito.
// Una limpieza devuelta por un mount async que termine tras salir se ejecuta inmediatamente.
export async function mountView(module, host, scope){
  const mount = module.render || module.mount;
  if (typeof mount !== 'function') throw new TypeError('Vista sin render()/mount()');
  if (typeof module.destroy === 'function') scope.own(module);
  const result = await mount.call(module, host, scope);
  if (typeof result === 'function') scope.add(result);
  else if (result && (typeof result.destroy === 'function' || typeof result.dispose === 'function')) scope.own(result);
  return result;
}
