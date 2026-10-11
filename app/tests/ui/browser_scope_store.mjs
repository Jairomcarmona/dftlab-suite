// Real browser primitives: listener, Worker, fetch abort and stale project responses.
// Bundle the same modules as the portable shell; no production debug hooks or network.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
const app=fileURLToPath(new URL('../../', import.meta.url));
const bundle=await build({stdin:{contents:`
  import {createViewScope,mountView} from './dftlab/static/js/core/lifecycle.js';
  import {createFrontendStores} from './dftlab/static/js/core/stores.js';
  window.fixture={createViewScope,mountView,createFrontendStores};
`,resolveDir:app},bundle:true,write:false,format:'iife',platform:'browser'});
const browser=await chromium.launch();
try{
  const page=await browser.newPage(); const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.abort());
  await page.setContent('<button id="control">control</button><div id="output"></div>');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const report=await page.evaluate(async()=>{
    const {createViewScope,mountView,createFrontendStores}=window.fixture, scope=createViewScope();
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)), stores=createFrontendStores();
    let clicks=0, messages=0, frames=0, timer=0, notices=0, terminations=0;
    const button=document.querySelector('#control'); scope.listen(button,'click',()=>clicks++);
    scope.subscribe(stores.forArea('tools'),()=>notices++);
    const url=URL.createObjectURL(new Blob(['postMessage("ready"); onmessage=()=>setTimeout(()=>postMessage("late"),80)'],{type:'text/javascript'}));
    const worker=scope.worker(new Worker(url)); scope.add(()=>URL.revokeObjectURL(url));
    const terminate=worker.terminate.bind(worker); worker.terminate=()=>{terminations++;terminate();};
    await new Promise(resolve=>worker.addEventListener('message',resolve,{once:true}));
    scope.listen(worker,'message',()=>messages++); worker.postMessage('start');
    scope.frame(()=>frames++); scope.timeout(()=>timer++,40); scope.interval(()=>timer++,40);
    button.click(); stores.forArea('tools').set({tab:'before'});
    // Fetch rejecting synchronously on abort, independent of blocked/offline networking.
    const pendingFetch=fetch('data:text/plain,hello',{signal:scope.signal}); scope.dispose();
    const aborted=await pendingFetch.then(()=>false,e=>e.name==='AbortError');
    button.click(); stores.forArea('tools').set({tab:'after'}); await wait(140);
    stores.selectProject('A'); const ticket=stores.captureProject(); let finish;
    const response=new Promise(resolve=>finish=resolve);
    const accepted=response.then(ticket.guard(text=>document.querySelector('#output').textContent=text));
    stores.selectProject('B'); stores.selectProject('A'); finish('STALE A'); await accepted;
    stores.captureProject().guard(text=>document.querySelector('#output').textContent=text)('CURRENT A');
    let destroy=0, lateCleanup=0, finishMount; const abandoned=createViewScope();
    const mounting=mountView({mount:()=>new Promise(resolve=>finishMount=resolve),destroy(){destroy++;}},button,abandoned);
    abandoned.dispose(); finishMount(()=>lateCleanup++); await mounting;
    return {clicks,messages,frames,timer,notices,terminations,aborted,signal:scope.signal.aborted,
      oldProjectAborted:ticket.signal.aborted,text:document.querySelector('#output').textContent,destroy,lateCleanup};
  });
  assert.deepEqual(report,{clicks:1,messages:0,frames:0,timer:0,notices:1,terminations:1,aborted:true,signal:true,oldProjectAborted:true,text:'CURRENT A',destroy:1,lateCleanup:1});
  assert.deepEqual(errors,[]);
  console.log('Browser ViewScope/stores: Worker, frame, listener, subscription, timers, fetch and stale A→B→A all passed (offline).');

  // Exercise the actual router with tiny non-scientific views. Inject access to its private
  // manager ONLY in this test bundle, never in sources/dist. B also checks all 19 real views.
  const routerBundle=await build({stdin:{contents:"import './dftlab/static/js/main.js'",resolveDir:app},bundle:true,write:false,format:'iife',platform:'browser',plugins:[{
    name:'test-router-boundary',setup(build){
      build.onResolve({filter:/views\/registry\.js$/},()=>({path:'registry',namespace:'fixture'}));
      build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`
        export const GROUPS=[{id:'start',title:'start'},{id:'learn',title:'learn'},{id:'tools',title:'tools'}];
        window.__mounts=[];
        export const VIEWS=['inicio','learn','tools'].map(id=>({id,group:id==='inicio'?'start':id,title:id,
          render(host,scope){window.__mounts.push({id,scope});host.textContent=id+':'+scope.context.project?.projectId;}}));
      `}));
      build.onLoad({filter:/[\\/]js[\\/]main\.js$/},async args=>{
        const source=await fs.readFile(args.path,'utf8'), anchor='const stores=createFrontendStores();';
        assert(source.includes(anchor),'router stores integration must remain present');
        return {contents:source.replace(anchor,anchor+'\nwindow.__projectStores=stores;'),resolveDir:fileURLToPath(new URL('../../dftlab/static/js/',import.meta.url))};
      });
    },
  }]});
  const router=await browser.newPage(); await router.route('**/*',route=>route.abort());
  await router.setContent('<aside id="side"></aside><h1 id="topTitle"></h1><button id="menuBtn"></button><main id="view"></main>');
  await router.addScriptTag({content:routerBundle.outputFiles[0].text});
  await router.evaluate(()=>location.hash='tools'); await router.waitForFunction(()=>window.__mounts.at(-1)?.id==='tools');
  const projectResult=await router.evaluate(async()=>{
    const old=window.__mounts.at(-1), oldHost=document.querySelector('.viewhost');
    window.__projectStores.selectProject('A'); await Promise.resolve();
    const current=window.__mounts.at(-1);
    return {oldDisposed:!old.scope.alive,oldAbort:old.scope.signal.aborted,hostChanged:document.querySelector('.viewhost')!==oldHost,
      newProject:current.scope.context.project.projectId,newAlive:current.scope.alive,selection:document.querySelector('.viewhost').textContent};
  });
  assert.deepEqual(projectResult,{oldDisposed:true,oldAbort:true,hostChanged:true,newProject:'A',newAlive:true,selection:'tools:A'});
  await router.evaluate(()=>location.hash='learn'); await router.waitForFunction(()=>window.__mounts.at(-1)?.id==='learn');
  const learnResult=await router.evaluate(()=>{
    const old=window.__mounts.at(-1), count=window.__mounts.length;
    old.scope.context.store.set({example:'educational'});window.__projectStores.selectProject('B');
    return {same:count===window.__mounts.length,alive:old.scope.alive,project:old.scope.context.project,state:old.scope.context.store.getState().example};
  });
  assert.deepEqual(learnResult,{same:true,alive:true,project:null,state:'educational'});
  console.log('Browser router: project switch remounts tools/new store and preserves learning without project tickets.');
}finally{await browser.close();}
