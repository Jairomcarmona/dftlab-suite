// Estado de presentación, sin dominio de campañas ni persistencia autoritativa.
// Datos pequeños JSON; archivos, arrays científicos, funciones y recursos van fuera del store.
function snapshot(value, ancestors = new Set()){
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || ancestors.has(value)) throw new TypeError('Estado UI debe ser JSON finito y sin ciclos');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    throw new TypeError('Estado UI debe contener objetos planos o arrays');
  ancestors.add(value);
  const copy = Array.isArray(value) ? [] : Object.create(null);
  const keys = Object.keys(value);
  if (Array.isArray(value) && (keys.length !== value.length || keys.some((key, index) => key !== String(index))))
    throw new TypeError('Estado UI no admite arrays dispersos o con propiedades extra');
  for (const key of keys) copy[key] = snapshot(value[key], ancestors);
  ancestors.delete(value);
  return Object.freeze(copy);
}

// Un consumidor que falla no impide invalidar a los demás. Emisiones reentrantes en FIFO.
function notifier(listeners){
  const pending = []; let notifying = false;
  return value => {
    pending.push(value);
    if (notifying) return;
    notifying = true;
    try {
      while (pending.length) {
        const next = pending.shift();
        for (const listener of [...listeners]) if (listeners.has(listener)) {
          try { listener(next); } catch (error) { console.error(error); }
        }
      }
    } finally { notifying = false; }
  };
}

export function createStore(initial = {}){
  let state = snapshot(initial);
  const listeners = new Set();
  const notify = notifier(listeners);
  return Object.freeze({
    getState: () => state,
    // Sustitución explícita; no hay merge de estados educativos con producción.
    set(next){
      const value = snapshot(next);
      state = value;
      notify(value);
      return value;
    },
    subscribe(listener){
      if (typeof listener !== 'function') throw new TypeError('Suscriptor debe ser función');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}

// Una instancia por shell, no singleton global entre aplicaciones o tests.
// null es un espacio UI sin proyecto seleccionado; nunca una identidad de servidor.
export function createFrontendStores(){
  const learning = new Map(), projects = new Map(), shell = createStore();
  const listeners = new Set();
  const notify = notifier(listeners);
  let projectId = null, generation = 0, controller = new AbortController();
  const keyed = (map, key) => {
    if (!map.has(key)) map.set(key, createStore());
    return map.get(key);
  };
  const validateArea = area => {
    if (!['start', 'learn', 'tools', 'post'].includes(area)) throw new TypeError('Área UI desconocida');
  };
  const api = {
    get projectId(){ return projectId; },
    forArea(area, id = projectId){
      validateArea(area);
      if (area === 'start') return shell;
      if (area === 'learn') return keyed(learning, area);
      if (id !== null && (typeof id !== 'string' || !id.trim())) throw new TypeError('projectId inválido');
      if (!projects.has(id)) projects.set(id, new Map());
      return keyed(projects.get(id), area);
    },
    selectProject(id){
      if (id !== null && (typeof id !== 'string' || !id.trim())) throw new TypeError('projectId inválido');
      if (id === projectId) return;
      // Cambiar generación antes de abortar: los handlers de abort ya ven el proyecto nuevo.
      const previous = controller;
      projectId = id; generation++; controller = new AbortController();
      previous.abort();
      notify(id);
    },
    subscribe(listener){
      if (typeof listener !== 'function') throw new TypeError('Suscriptor debe ser función');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // Capturar ANTES de un await/fetch. Usar guard al aplicar éxito y error.
    captureProject(){
      const captured = generation, id = projectId, signal = controller.signal;
      const current = () => captured === generation && !signal.aborted;
      return Object.freeze({projectId: id, signal, get alive(){ return current(); },
        guard: f => function(...args){ return current() ? f.apply(this, args) : undefined; },
      });
    },
  };
  return Object.freeze(api);
}
