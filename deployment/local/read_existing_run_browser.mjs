import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(path.join(ROOT,'app','package.json'));
const {chromium}=require('playwright');
const args=new Map();
for(let index=2;index<process.argv.length;index+=2){
  if(!process.argv[index]?.startsWith('--')||process.argv[index+1]===undefined)throw new Error('Expected --name value arguments.');
  args.set(process.argv[index].slice(2),process.argv[index+1]);
}
const need=name=>{const value=args.get(name);if(!value)throw new Error(`Missing --${name}.`);return value;};
const accessFile=need('access-file');
const projectId=need('project-id');
const runId=need('run-id');
const outputDir=path.resolve(need('output-dir'));
const evidenceRoot=path.resolve(ROOT,'deployment/local/evidence');
if(!outputDir.startsWith(evidenceRoot+path.sep)||fs.existsSync(outputDir))throw new Error('Output must be a new child directory of deployment/local/evidence.');
fs.mkdirSync(outputDir,{recursive:false,mode:0o700});
fs.mkdirSync(path.join(outputDir,'artifacts'),{mode:0o700});
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const access=JSON.parse(execFileSync('wsl.exe',['-e','cat',accessFile],{encoding:'utf8',timeout:10000}));
const origin=new URL(access.origin);
if(origin.protocol!=='http:'||!['127.0.0.1','localhost'].includes(origin.hostname))throw new Error('Access origin must be a local HTTP origin.');
const evidence={schema_version:1,route:'BROWSER_READ_ONLY_EXISTING_RUN',started_at:new Date().toISOString(),status:'IN_PROGRESS',
  project_id:projectId,run_id:runId,claims:{purpose:'EXPLORATORY',scientific_assessment:'NOT_ESTABLISHED',capabilities_published_for_execution:false},
  run_reads:{},artifact_reads:[],cancelled_artifact_metadata_reads:[],mutating_requests:[],browser_errors:[]};
const persist=()=>fs.writeFileSync(path.join(outputDir,'browser-existing-run.json'),JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
const runCaptures=[],pendingCaptures=[];
const browser=await chromium.launch({args:['--no-sandbox']});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1100},deviceScaleFactor:1});
  page.on('pageerror',error=>evidence.browser_errors.push(error.message));
  page.on('requestfailed',request=>{
    const pathname=new URL(request.url()).pathname;const failure=request.failure()?.errorText||'request failed';
    if(request.method()==='GET'&&/^\/api\/v1\/artifacts\/[^/]+$/.test(pathname)&&failure==='net::ERR_ABORTED'){
      evidence.cancelled_artifact_metadata_reads.push(pathname);return;
    }
    evidence.browser_errors.push(`${request.method()} ${pathname}: ${failure}`);
  });
  page.on('request',request=>{
    const url=new URL(request.url());
    if(url.pathname.startsWith('/api/v1/')&&['POST','PUT','PATCH','DELETE'].includes(request.method())&&url.pathname!=='/api/v1/session'){
      evidence.mutating_requests.push(`${request.method()} ${url.pathname}`);
    }
  });
  page.on('response',response=>{
    const request=response.request();const url=new URL(response.url());
    if(request.method()==='GET'&&url.pathname===`/api/v1/runs/${runId}`){
      pendingCaptures.push((async()=>{try{runCaptures.push({body:await response.body(),status:response.status(),captured_at:new Date().toISOString()});}catch{}})());
    }
    const match=request.method()==='GET'&&url.pathname.match(/^\/api\/v1\/artifacts\/([^/]+)\/content$/);
    if(match){
      const artifactId=decodeURIComponent(match[1]);
      pendingCaptures.push((async()=>{
        try{
          const bytes=await response.body();const relative=`artifacts/${artifactId}.bin`;
          fs.writeFileSync(path.join(outputDir,relative),bytes,{mode:0o600});
          evidence.artifact_reads=evidence.artifact_reads.filter(item=>item.artifact_id!==artifactId);
          evidence.artifact_reads.push({artifact_id:artifactId,path:relative,status:response.status(),size_bytes:bytes.length,sha256:sha256(bytes)});
        }catch{}
      })());
    }
  });

  await page.goto(origin.href,{waitUntil:'domcontentloaded'});
  await page.locator('[data-operative-access-file]').setInputFiles({name:'access.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(access))});
  const project=page.locator('[data-project-selector]');await project.waitFor({timeout:30000});await project.selectOption(projectId);
  const openRun=page.locator(`button[data-run-id="${runId}"]`);await openRun.waitFor({timeout:30000});await openRun.click();
  const card=page.locator(`[data-run-id="${runId}"]`).filter({has:page.locator('[data-native-result]')});
  await card.waitFor({timeout:180000});
  await card.getByText(/Finalización: PUBLISHED/).waitFor({timeout:30000});
  const admission=page.locator('[data-admission-receipt] [data-decision="ADMITTED"]');await admission.waitFor({timeout:30000});
  assert.equal(await admission.getAttribute('data-purpose'),'EXPLORATORY');
  assert.equal(await card.locator('[data-run-events]').count(),1);
  const body=await card.innerText();
  assert.match(body,/NOT_ESTABLISHED/);
  const terminalItem=card.locator('[data-run-artifacts] li[data-artifact-kind="qraft.terminal-scheduler-evidence"]');
  await terminalItem.waitFor({state:'attached',timeout:30000});
  const terminalArtifactId=await terminalItem.getAttribute('data-artifact-id');
  await card.locator('details').filter({has:page.locator('[data-run-artifacts]')}).locator('summary').click();
  const terminalResponse=page.waitForResponse(response=>response.request().method()==='GET'&&new URL(response.url()).pathname===`/api/v1/artifacts/${terminalArtifactId}/content`,{timeout:30000});
  await terminalItem.locator(`[data-verify-artifact="${terminalArtifactId}"]`).click();
  await (await terminalResponse).body();
  await Promise.allSettled(pendingCaptures);
  const terminalRead=evidence.artifact_reads.find(item=>item.artifact_id===terminalArtifactId);
  assert.ok(terminalRead,'The browser must retrieve signed terminal evidence');
  const terminalDocument=JSON.parse(fs.readFileSync(path.join(outputDir,terminalRead.path),'utf8'));
  assert.equal(terminalDocument.run_id,runId);
  assert.equal(terminalDocument.state,'COMPLETED');
  assert.ok(terminalDocument.signature&&terminalDocument.job?.job_id);
  evidence.signed_terminal_evidence={artifact_id:terminalArtifactId,sha256:terminalRead.sha256,job:terminalDocument.job,state:terminalDocument.state,signature:terminalDocument.signature};
  evidence.run_reads.first={source:'existing run opened through the operative browser',visible_text_sha256:sha256(Buffer.from(body)),
    admission_decision:await admission.getAttribute('data-decision'),purpose:await admission.getAttribute('data-purpose'),
    event_count:await card.locator('[data-run-events] li').count(),artifact_count:await card.locator('[data-run-artifacts] li').count(),
    showed_native_result:true,showed_science_not_established:body.includes('NOT_ESTABLISHED')};
  await card.screenshot({path:path.join(outputDir,'existing-run-browser.png')});

  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('[data-local-run-panel]').waitFor({timeout:30000});
  const reloadedCard=page.locator(`[data-run-id="${runId}"]`).filter({has:page.locator('[data-native-result]')});
  await reloadedCard.waitFor({timeout:180000});
  await reloadedCard.getByText(/Finalización: PUBLISHED/).waitFor({timeout:30000});
  const afterReload=await reloadedCard.innerText();assert.match(afterReload,/NOT_ESTABLISHED/);
  assert.match(afterReload,/Finalización: PUBLISHED; salidas no producidas: 0\./);
  await reloadedCard.screenshot({path:path.join(outputDir,'existing-run-browser-after-reload.png')});
  await reloadedCard.locator('[data-run-admission]').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(outputDir,'result-overview.png')});
  await reloadedCard.getByText(/Finalización: PUBLISHED/).scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(outputDir,'result-finalization.png')});
  await Promise.allSettled(pendingCaptures);
  for(const capture of runCaptures){
    const relative='get-run.json';fs.writeFileSync(path.join(outputDir,relative),capture.body,{mode:0o600});
    let projection=null;try{projection=JSON.parse(capture.body.toString('utf8'));}catch{}
    evidence.run_reads.get_run={path:relative,status:capture.status,sha256:sha256(capture.body),dimensions:projection?.payload?.dimensions||null,captured_at:capture.captured_at};
  }
  evidence.run_reads.after_reload={showed_native_result:true,showed_finalization_published:true,showed_science_not_established:afterReload.includes('NOT_ESTABLISHED')};
  assert.deepEqual(evidence.mutating_requests,[]);
  evidence.elapsed_seconds=Math.round((Date.now()-Date.parse(evidence.started_at))/1000*1000)/1000;
  evidence.browser_errors=[...new Set(evidence.browser_errors)];
  if(evidence.browser_errors.length)throw new Error(`Browser errors: ${evidence.browser_errors.join('; ')}`);
  evidence.status='EXISTING_RUN_READ_AND_RELOADED';persist();
  console.log(JSON.stringify({status:evidence.status,project_id:projectId,run_id:runId,read_only:true,
    screenshot:path.join(outputDir,'existing-run-browser.png'),get_run:evidence.run_reads.get_run,
    artifact_reads:evidence.artifact_reads.length,error_count:evidence.browser_errors.length},null,2));
}catch(error){
  evidence.status='READ_FAILED_NO_WRITE';evidence.error=`${error.name}: ${error.message}`;
  await Promise.allSettled(pendingCaptures);
  evidence.elapsed_seconds=Math.round((Date.now()-Date.parse(evidence.started_at))/1000*1000)/1000;
  persist();console.error(JSON.stringify({status:evidence.status,error:evidence.error,project_id:projectId,run_id:runId,evidence_dir:outputDir},null,2));
  process.exitCode=1;
}finally{await browser.close();}
