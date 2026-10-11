# Ámbito y estado de presentación (X4)

`main.js` crea una instancia de `createFrontendStores()` y un `createViewScope(context)` por montaje. No hay singleton exportado. Las 19 vistas conservan su contrato histórico, sus variables locales y sus resultados científicos; esta entrega añade el cimiento para migrarlas gradualmente.

`mountView(module, host, view)` admite `render` del registro o `mount` de un módulo; registra `destroy` y la limpieza opcional devuelta (función o disposable). Un montaje async que termine después de abandonar la vista libera inmediatamente su recurso devuelto. El router conserva un host nuevo por montaje y `releaseCharts(host)` de H.

## Recursos y respuestas async

El ámbito ofrece `signal`, `guard`, `listen`, `subscribe`, `worker`, `frame`, `timeout`, `interval`, `observer`, `own`, `onTheme` y `add`. `dispose` aborta, cancela frames pendientes y libera recursos una sola vez en orden inverso, continuando si falla una limpieza. Registrar el mismo objeto de nuevo con `own`, `observer` o `worker` no duplica su limpieza, tampoco si un mount devuelve su propio módulo con destroy. Un recurso adquirido tras salir se libera al registrarlo. `frame` solo conserva frames pendientes, sin acumular uno por frame completado. Cada worker registrado es exclusivo de la vista; un worker compartido no se registra como propio.

```js
export async function mount(host, view) {
  const {store, project} = view.context;
  view.subscribe(store, state => paint(host, state));
  const response = await fetch('/api/example', {signal: view.signal});
  if (!view.alive || !project.alive) return;
  const result = await response.json();
  view.guard(project.guard(data => store.set({selection: data.id})))(result);
}
```

El ejemplo es de una vista tools/post: ilustra cancelación de una lectura, sin implementar el SDK, seguridad ni el endpoint. En Aprender e Inicio, `context.project` es null; una lectura educativa usa solo `view.signal`/`view.guard` y conserva vigencia al seleccionar otro proyecto. Un Promise arbitrario no se puede detener: se comprueba `alive` después de cada `await` y se envuelve la aplicación de éxito **y de error**. `listen` elimina el listener y preserva el `this` de EventTarget; `subscribe(source, callback)` requiere una desuscripción devuelta. `own(resource)` requiere `destroy()` o `dispose()`.

## Stores y proyectos

`createStore()` conserva snapshots JSON pequeños, copiados y congelados recursivamente. `getState()` lee, `set(next)` sustituye y `subscribe(callback)` observa sin emisión inicial. Emisiones reentrantes se notifican en FIFO; si un consumidor falla se informa por consola y se continúa con los demás. Los blobs, typed arrays, arrays científicos grandes, funciones, instancias y recursos se mantienen fuera. No acepta ciclos, NaN/Infinity ni arrays dispersos. Los registros de contratos científicos no se reinterpretan como estado UI.

`forArea('learn')` es aprendizaje; `forArea('start')` es shell; `forArea('tools', projectId)` y `forArea('post', projectId)` son espacios de preparación/importación independientes entre áreas y proyectos. `null` es el espacio de vista previa sin proyecto elegido, **nunca** una identidad de proyecto del servidor. Cambiar proyecto no copia estado entre espacios ni promueve un ejemplo a producción. No hay persistencia, credenciales, autoridad de campañas, envíos automáticos ni comandos de ejecución en estos stores.

Un futuro selector/SDK llama `selectProject(id)` desde el shell. `captureProject()` se captura antes de la petición y devuelve `{projectId, signal, alive, guard}`. Cada cambio de identidad aborta el ticket anterior e incrementa su generación; A→B→A no vuelve vigente una respuesta de la primera A. Seleccionar la misma identidad no invalida peticiones. Las vistas deben combinar el ticket con `view.guard` para respetar tanto proyecto como navegación. El shell libera y vuelve a montar tools/post con el store del nuevo proyecto; Aprender conserva su ámbito y store. No hay todavía selector visible ni servicio: conectar la selección al SDK pertenece a una integración futura, sin lanzar cálculos al montar.

## Verificar

`node tests/ui/run_scope_store_tests.mjs` y `node tests/ui/browser_scope_store.mjs` desde `app/`. Ambas están incluidas en `npm test` y en CI Windows/Linux junto a las suites B/H y offline existentes. El fixture de navegador usa las mismas fuentes empaquetadas, Worker real, fetch abortable y respuesta tardía A→B→A, con red bloqueada. El recorrido B verifica la integración del router en las 19 pantallas.
