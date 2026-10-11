// X4: ownership, legacy mounting and project isolation/races, without scientific changes.
import assert from 'node:assert/strict';
import {createViewScope, mountView} from '../../dftlab/static/js/core/lifecycle.js';
import {createStore, createFrontendStores} from '../../dftlab/static/js/core/stores.js';

let checks = 0;
async function test(name, f){ await f(); checks++; console.log('ok '+name); }
await test('scoped listeners preserve this and cannot run after dispose', () => {
  const target = new EventTarget(), scope = createViewScope(); let calls = 0;
  scope.listen(target, 'update', function(){ assert.equal(this, target); calls++; });
  target.dispatchEvent(new Event('update')); scope.dispose(); target.dispatchEvent(new Event('update'));
  assert.equal(calls, 1);
  scope.listen(target, 'update', () => calls++); target.dispatchEvent(new Event('update'));
  assert.equal(calls, 1);
});
await test('unsubscribe/worker/disposable execute once including late ownership', () => {
  const scope = createViewScope(), store = createStore(); let called = 0, stopped = 0, disposed = 0;
  const worker = {terminate(){ stopped++; }}, resource = {dispose(){ disposed++; }};
  scope.subscribe(store, () => called++); scope.worker(worker); scope.worker(worker);
  scope.own(resource); scope.own(resource); store.set({value:1}); scope.dispose(); scope.dispose(); scope.own(resource); scope.worker(worker); store.set({value:2});
  assert.deepEqual([called, stopped, disposed], [1,1,1]);
  scope.worker({terminate(){ stopped++; }}); assert.equal(stopped, 2);
  assert.throws(() => scope.own({}), TypeError);
});
await test('completed frames do not remain owned; pending frames canceled', () => {
  const callbacks = new Map(), canceled = []; let id = 0, calls = 0;
  globalThis.requestAnimationFrame = f => {callbacks.set(++id, f); return id;};
  globalThis.cancelAnimationFrame = t => canceled.push(t);
  const scope = createViewScope(), done = scope.frame(() => calls++); callbacks.get(done)(0);
  const pending = scope.frame(() => calls++); scope.dispose(); callbacks.get(pending)(0);
  assert.equal(calls, 1); assert.deepEqual(canceled, [pending]); assert.equal(scope.frame(()=>{}), undefined);
  delete globalThis.requestAnimationFrame; delete globalThis.cancelAnimationFrame;
});
await test('legacy render/mount binding, destroy and returned cleanup are compatible', async () => {
  const scope = createViewScope(); let destroyed = 0, released = 0; const host = {};
  const module = {mount(el, view){assert.equal(this,module);assert.equal(el,host);assert.equal(view,scope);return ()=>released++;},destroy(){destroyed++;}};
  await mountView(module,host,scope); scope.dispose(); scope.dispose(); assert.deepEqual([destroyed,released],[1,1]);
  assert.equal(await mountView({render(){return 7;}},host,createViewScope()),7);
  const returningScope=createViewScope(); let returningDestroy=0;
  const returning={mount(){return this;},destroy(){returningDestroy++;}};
  await mountView(returning,host,returningScope); returningScope.dispose(); assert.equal(returningDestroy,1);
});
await test('async mount cleanup arriving after abandonment executes immediately', async () => {
  const scope = createViewScope(); let finish, freed = 0;
  const mounting = mountView({mount: () => new Promise(resolve=>finish=resolve)}, {}, scope);
  scope.dispose(); finish({dispose(){freed++;}}); await mounting; assert.equal(freed,1);
});
await test('store snapshots detach inputs, freeze recursively, reject non-JSON/cycles', () => {
  const input = {nested:{items:[1,2]}}; const store = createStore(input); input.nested.items[0]=9;
  assert.equal(store.getState().nested.items[0],1); assert.throws(()=>store.getState().nested.items.push(3),TypeError);
  for (const invalid of [NaN, Infinity, undefined, ()=>{}, new Date(), new Map(), Array(2)]) assert.throws(()=>store.set(invalid),TypeError);
  const holeWithExtra = [1,,]; holeWithExtra.foo=2; assert.throws(()=>store.set(holeWithExtra),TypeError);
  const cycle = {}; cycle.self=cycle; assert.throws(()=>store.set(cycle),TypeError);
  const previous = store.getState(); assert.throws(()=>store.set({bad:NaN}),TypeError); assert.equal(store.getState(),previous);
  const proto = JSON.parse('{"__proto__":{"polluted":true}}'); store.set(proto); assert.equal({}.polluted,undefined);
});
await test('learning, unselected preview, project and area state are distinct', () => {
  const stores = createFrontendStores(), learning = stores.forArea('learn'), preview = stores.forArea('tools');
  learning.set({example:'Si'}); preview.set({tab:'draft'}); stores.selectProject('A');
  const toolsA = stores.forArea('tools'); toolsA.set({tab:'pseudos'}); stores.forArea('post').set({selection:'bands'});
  stores.selectProject('B'); assert.equal(Object.keys(stores.forArea('tools').getState()).length,0);
  stores.selectProject('A'); assert.equal(stores.forArea('tools').getState().tab,'pseudos');
  assert.equal(stores.forArea('post').getState().selection,'bands'); assert.equal(learning.getState().example,'Si');
  stores.selectProject(null); assert.equal(stores.forArea('tools'),preview);
  assert.notEqual(createFrontendStores().forArea('learn'),learning);
  assert.throws(()=>stores.selectProject(''),TypeError); assert.throws(()=>stores.forArea('campaigns'),TypeError);
});
await test('failed subscriber cannot hide invalidation; reentrant updates preserve order', () => {
  const store = createStore(); const seen = [];
  store.subscribe(state=>{if(state.step===1)store.set({step:2});});
  store.subscribe(state=>seen.push(state.step)); store.set({step:1}); assert.deepEqual(seen,[1,2]);
  const stores=createFrontendStores(), scope=createViewScope(); const errors=[]; const original=console.error;
  console.error=e=>errors.push(e);
  try{
    stores.subscribe(()=>{throw new Error('consumer failure');});
    scope.subscribe(stores,()=>scope.dispose()); stores.selectProject('A');
    assert.equal(scope.alive,false); assert.equal(errors.length,1);
  } finally {console.error=original;}
});
await test('project tickets invalidate late success/error even A→B→A and abort handlers', () => {
  const stores = createFrontendStores(); stores.selectProject('A'); const old = stores.captureProject(); let writes = 0;
  const commit = old.guard(()=>writes++); old.signal.addEventListener('abort',commit);
  stores.selectProject('B'); stores.selectProject('A'); commit(); assert.equal(writes,0); assert.equal(old.alive,false); assert.equal(old.signal.aborted,true);
  const current = stores.captureProject(); stores.selectProject('A'); current.guard(()=>writes++)(); assert.equal(writes,1); assert.equal(current.alive,true);
});
await test('project change disposes bound scope and cancels subscriptions without touching learning', () => {
  const stores = createFrontendStores(), production = createViewScope(), learning = createViewScope();
  let notifications=0; production.subscribe(stores,()=>{notifications++;production.dispose();});
  stores.selectProject('A'); stores.selectProject('B'); assert.equal(production.alive,false); assert.equal(production.signal.aborted,true);
  assert.equal(notifications,1); assert.equal(learning.alive,true); learning.dispose();
});
console.log(`scope/stores: ${checks} scenarios passed`);
