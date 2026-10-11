// Real installed launcher and HTTP browser: no source imports into Python.
import assert from 'node:assert/strict';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {chromium} from '../../app/node_modules/playwright/index.mjs';

const [python,state]=process.argv.slice(2);
assert.ok(python&&state);
function invoke(command,basePath='/lab'){
  const result=spawnSync(python,['-I','-m','dftlab_platform.launcher',command,'--state-dir',state,'--base-path',basePath],{encoding:'utf8',timeout:40_000,windowsHide:true,env:{...process.env,PYTHONPATH:''}});
  assert.equal(result.status,0,'Installed launcher '+command+' failed');
  return JSON.parse(result.stdout);
}
const browser=await chromium.launch({args:['--enable-unsafe-swiftshader']});
try{
  const runtime=invoke('start');
  const context=await browser.newContext();
  const page=await context.newPage();const errors=[],requests=[];
  await page.addInitScript(()=>document.addEventListener('securitypolicyviolation',event=>window.__cspViolations=(window.__cspViolations||[]).concat(event.violatedDirective)));
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>requests.push({url:request.url(),method:request.method()}));
  await page.goto(runtime.url);
  await page.locator('[data-operative-access]').waitFor();
  assert.equal(await page.locator('[data-remote-group]').count(),0,'No remote group before authenticated handshake');
  await page.setInputFiles('[aria-label="Archivo de acceso local"]',path.join(state,'access.json'));
  await page.locator('[data-remote-group]').waitFor();
  const initialChunks=requests.filter(r=>r.url.includes('/assets/')).length;
  const ids=['ks','pseudos','xc','base','scf','solvers','bandas','dftu','densidad','potencial','espin','lectura','fonones','fuerzas','beyond','estructura','calc','post','inicio'];
  for(const id of ids){
    await page.locator('a[data-id="'+id+'"]').click();
    await page.waitForFunction(id=>document.querySelector('[data-view="'+id+'"]')?.children.length>0,id,{timeout:30_000});
    assert.equal(await page.locator('.callout.warn').filter({hasText:'Esta sección no pudo cargarse'}).count(),0,'View '+id+' loads under CSP');
  }
  assert.ok(requests.filter(r=>r.url.includes('/assets/')).length>initialChunks,'Views fetch lazy chunks');
  assert.deepEqual(await page.evaluate(()=>window.__cspViolations||[]),[],'All existing views respect served CSP');
  await page.fill('[aria-label="Nombre del proyecto"]','Si <b>literal</b>');
  await page.getByRole('button',{name:'Crear proyecto',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[aria-label="Proyecto activo"]')?.selectedOptions[0]?.textContent==='Si <b>literal</b>');
  assert.equal(await page.locator('[data-remote-group] b').count(),0,'Imported text is not HTML');
  assert.ok((await context.cookies()).some(c=>c.name==='dftlab_session'&&c.httpOnly&&c.sameSite==='Strict'));
  assert.ok(!(await page.evaluate(()=>document.cookie)).includes('dftlab_session'));
  assert.deepEqual(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k!=='dftlab-theme')),[],'No session/draft credentials in localStorage');
  assert.ok(requests.filter(r=>r.method!=='GET').every(r=>r.url.endsWith('/lab/api/v1/session')||r.url.endsWith('/lab/api/v1/projects')),'Navigation never submits calculations');
  assert.ok(requests.every(r=>r.url.startsWith(new URL(runtime.url).origin+'/lab/')||/^(blob|data):/.test(r.url)),'No external origins or unversioned service calls');
  // CDP evaluation is allowed to bypass CSP. Trigger the callback later by a
  // normal page event so this measures page policy, not debugger privileges.
  await page.evaluate(()=>{
    const button=document.createElement('button');button.id='cspProbe';button.textContent='CSP probe';
    button.addEventListener('click',()=>{try{new Function('return 1')();window.__evalBlocked=false;}catch{window.__evalBlocked=true;}});
    document.body.append(button);
  });
  await page.click('#cspProbe');
  assert.equal(await page.evaluate(()=>window.__evalBlocked),true,'JS eval forbidden in page event');
  await page.evaluate(()=>{const script=document.createElement('script');script.textContent='window.__unsafeInline=true';document.body.append(script);});
  assert.equal(await page.evaluate(()=>window.__unsafeInline),undefined,'Inline JS forbidden');
  assert.deepEqual(errors,[],'No lazy-route or session page errors');
  await page.reload();await page.locator('[data-remote-group]').waitFor();
  assert.equal(await page.getByRole('button',{name:'Crear proyecto',exact:true}).count(),0,'Reload has read session only without persisted CSRF');
  await context.close();invoke('stop');
  const second=invoke('start','/scientific');
  assert.notEqual(second.instance_id,runtime.instance_id);
  const other=await browser.newContext();const otherPage=await other.newPage();
  await otherPage.goto(second.url+'#estructura');
  await otherPage.waitForFunction(()=>/\(227\)/.test(document.querySelector('#stKv')?.textContent||''),null,{timeout:30_000});
  await otherPage.setInputFiles('[aria-label="Archivo de acceso local"]',path.join(state,'access.json'));
  await otherPage.locator('[data-remote-group]').waitFor();
  assert.ok((await otherPage.locator('[aria-label="Proyecto activo"]').textContent()).includes('Si <b>literal</b>'),'Owner/project persist through changed port/base path');
  await otherPage.getByRole('button',{name:'Cerrar sesión',exact:true}).click();
  await otherPage.waitForFunction(()=>!document.querySelector('[data-remote-group]'));
  assert.ok(!(await other.cookies()).some(c=>c.name==='dftlab_session'),'Logout sends CSRF and revokes cookie');
  await other.close();
  console.log('Installed operative browser: 19 views, lazy assets, CSP, API-only session/projects, private cookies, restart and base paths passed.');
}finally{
  await browser.close();invoke('stop');
}
