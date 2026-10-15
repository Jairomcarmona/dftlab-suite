#!/usr/bin/env node
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
const PROFILE='wsl-slurm-openmpi-installed-qualification';
const args=new Map();
for(let i=2;i<process.argv.length;i+=2){
  if(!process.argv[i]?.startsWith('--')||process.argv[i+1]===undefined)throw new Error('Expected --name value arguments.');
  args.set(process.argv[i].slice(2),process.argv[i+1]);
}
const need=name=>{const value=args.get(name);if(!value)throw new Error(`Missing --${name}.`);return value;};
const stateDir=need('state-dir');
const accessFile=need('access-file');
const outputDir=path.resolve(need('output-dir'));
const cpuSeconds=Number(args.get('cpu-seconds')||480);
const timeoutMs=Number(args.get('timeout-ms')||120000);
const existingProjectId=args.get('http-project-id')||null;
const existingRunId=args.get('http-run-id')||null;
const evidenceRoot=path.resolve(ROOT,'deployment/local/evidence');
if(!outputDir.startsWith(evidenceRoot+path.sep)||fs.existsSync(outputDir))throw new Error('Output must be a new child directory of deployment/local/evidence.');
if(!Number.isInteger(cpuSeconds)||cpuSeconds<480)throw new Error('Budget must cover at least one recipe allocation.');
fs.mkdirSync(outputDir,{recursive:false,mode:0o700});
fs.mkdirSync(path.join(outputDir,'artifacts'),{mode:0o700});
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const wsl='wsl.exe';
const python=args.get('python')||'/home/jmc/.local/state/dftlab-qualification/t023b-consumer-v1/venv/bin/python';
const access=JSON.parse(execFileSync(wsl,['-e','cat',accessFile],{encoding:'utf8',timeout:10000}));
const origin=new URL(access.origin);
if(origin.protocol!=='http:'||!['127.0.0.1','localhost'].includes(origin.hostname))throw new Error('Access origin must be a local HTTP origin.');
const evidence={schema_version:1,route:'BROWSER',started_at:new Date().toISOString(),status:'IN_PROGRESS',
  existing_http_run:existingRunId?{project_id:existingProjectId,run_id:existingRunId}:null,
  claims:{purpose:'EXPLORATORY',scientific_assessment:'NOT_ESTABLISHED',capabilities_published_for_execution:false},
  run_reads:{},artifact_reads:[],browser_errors:[]};
const persist=()=>fs.writeFileSync(path.join(outputDir,'browser-local-run.json'),JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
const captures=new Map(),pendingCaptures=[];
const browser=await chromium.launch({args:['--no-sandbox']});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1100},deviceScaleFactor:1});
  page.on('pageerror',error=>evidence.browser_errors.push(error.message));
  page.on('requestfailed',request=>evidence.browser_errors.push(`${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText||'request failed'}`));
  page.on('response',response=>{
    const request=response.request();
    const url=new URL(response.url());
    if(request.method()==='GET'&&/^\/api\/v1\/runs\/[^/]+$/.test(url.pathname)){
      const runId=decodeURIComponent(url.pathname.split('/').at(-1));
      pendingCaptures.push((async()=>{
        try{const body=await response.body();captures.set(runId,{body,status:response.status(),url:response.url(),captured_at:new Date().toISOString()});}
        catch{}
      })());
    }
    const artifactMatch=request.method()==='GET'&&url.pathname.match(/^\/api\/v1\/artifacts\/([^/]+)\/content$/);
    if(artifactMatch){
      const artifactId=decodeURIComponent(artifactMatch[1]);
      pendingCaptures.push((async()=>{
        try{
          const body=await response.body();
          const file=`artifacts/${artifactId}.bin`;
          fs.writeFileSync(path.join(outputDir,file),body,{mode:0o600});
          evidence.artifact_reads=evidence.artifact_reads.filter(item=>item.artifact_id!==artifactId);
          evidence.artifact_reads.push({artifact_id:artifactId,path:file,status:response.status(),size_bytes:body.length,sha256:sha256(body)});
        }catch{}
      })());
    }
  });
  const accessInput=page.locator('[data-operative-access-file]');
  await page.goto(origin.href,{waitUntil:'domcontentloaded'});
  await accessInput.setInputFiles({name:'access.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(access))});
  const projectSelect=page.locator('[data-project-selector]');
  await projectSelect.waitFor({timeout:timeoutMs});
  if(existingProjectId&&existingRunId){
    await projectSelect.selectOption(existingProjectId);
    const openExisting=page.getByRole('button',{name:`Abrir run ${existingRunId}`});
    await openExisting.waitFor({timeout:timeoutMs});
    await openExisting.click();
    const existingCard=page.locator(`[data-run-id="${existingRunId}"]`);
    await existingCard.locator('[data-native-result]').waitFor({timeout:timeoutMs});
    await page.waitForFunction(id=>Boolean(document.querySelector(`[data-run-id="${id}"] [data-native-result]`)),existingRunId,{timeout:timeoutMs});
    const body=await existingCard.innerText();
    evidence.run_reads[existingRunId]={source:'HTTP run opened in operative UI',visible_text_sha256:sha256(Buffer.from(body)),
      showed_native_result:body.includes('qraft.runtime-result-observation'),showed_science_not_established:body.includes('NOT_ESTABLISHED')};
    assert.match(body,/NOT_ESTABLISHED/);
    await existingCard.screenshot({path:path.join(outputDir,'http-run-in-browser.png')});
  }

  const projectName=`Si diamante · navegador ${new Date().toISOString().replace(/[:.]/g,'-')}`;
  const projectForm=page.locator('[data-remote-group] > form');
  await projectForm.locator('[data-project-name]').fill(projectName);
  await projectForm.locator('button[type="submit"]').click();
  await page.waitForFunction(name=>{
    const select=document.querySelector('[data-project-selector]');
    return Boolean(select?.selectedOptions[0]?.textContent.includes(name));
  },projectName,{timeout:timeoutMs});
  const projectId=await projectSelect.inputValue();
  if(!projectId)throw new Error('UI did not create a project.');
  const budgetArgs=['-I','-m','dftlab_platform.launcher','budget','add','--state-dir',stateDir,'--project',projectId,
    '--cpu-seconds',String(cpuSeconds),'--expires-hours','24'];
  const budgetOutput=execFileSync(wsl,['-e',python,...budgetArgs],{encoding:'utf8',timeout:30000});
  const budget=JSON.parse(budgetOutput);
  evidence.project_id=projectId;evidence.project_name=projectName;evidence.budget_id=budget.budget_id;
  evidence.budget_command={executable:python,args:budgetArgs,stdout:budgetOutput.trim()};
  evidence.budget={cpu_seconds:budget.cpu_seconds,unit:budget.unit,expires_at:budget.expires_at};persist();
  await page.locator('[data-local-run-panel]').waitFor({timeout:timeoutMs});

  const step=async(id,value)=>{
    await page.waitForFunction(({id,value})=>document.querySelector(`[data-step="${id}"]`)?.textContent.includes(value),{id,value},{timeout:timeoutMs});
  };
  await page.locator('[data-local-action="promote"]').click();
  await step('draft','LISTO');
  await page.locator('button[data-local-action="validate"]').click();await step('validation','SUCCEEDED');
  await page.locator('button[data-local-action="campaign"]').click();await step('campaign','SUCCEEDED');
  await page.locator('button[data-local-action="plan"]').click();await step('plan','SUCCEEDED');
  evidence.steps={promotion:'LISTO',validation:'SUCCEEDED',campaign:'SUCCEEDED',plan:'SUCCEEDED'};
  evidence.reload_midway={after:'plan',before:'package'};persist();
  await page.reload({waitUntil:'domcontentloaded'});
  await projectSelect.waitFor({timeout:timeoutMs});
  if(await projectSelect.inputValue()!==projectId)await projectSelect.selectOption(projectId);
  await page.locator('[data-local-run-panel]').waitFor({timeout:timeoutMs});
  await step('draft','LISTO');await step('validation','SUCCEEDED');await step('campaign','SUCCEEDED');await step('plan','SUCCEEDED');
  await page.locator('button[data-local-action="package"]').click();await step('package','SUCCEEDED');
  await page.locator('[data-budget-ref]').fill(budget.budget_id);
  await page.locator('[data-execution-profile]').selectOption(PROFILE);
  evidence.steps={promotion:'LISTO',validation:'SUCCEEDED',campaign:'SUCCEEDED',plan:'SUCCEEDED',package:'SUCCEEDED'};persist();
  await page.locator('button[data-local-action="submit"]').click();
  const admission=page.locator('[data-local-run-panel] [data-decision]');
  const runButton=page.locator('[data-run-list] button[data-run-id]').last();
  await Promise.race([admission.waitFor({timeout:timeoutMs}),runButton.waitFor({timeout:timeoutMs})]);
  if(await runButton.isVisible()){
    evidence.run_id=await runButton.getAttribute('data-run-id');persist();
    if(!await page.locator('[data-operative-run-page][open]').count())await runButton.click();
  }
  await admission.waitFor({timeout:timeoutMs});
  const decision=await admission.getAttribute('data-decision');
  evidence.admission={decision,purpose:await admission.getAttribute('data-purpose'),text:await admission.innerText()};persist();
  if(decision!=='ADMITTED')throw new Error(`Browser admission returned ${decision}; inspect receipt and do not resubmit.`);
  await runButton.waitFor({timeout:timeoutMs});
  const browserRunId=await runButton.getAttribute('data-run-id');
  evidence.run_id=browserRunId;persist();
  await page.locator('[data-operative-run-page][open]').waitFor({timeout:timeoutMs});
  const runCard=page.locator(`[data-operative-run-page][open] [data-run-id="${browserRunId}"]`);
  await runCard.waitFor({timeout:timeoutMs});
  await runCard.locator('[data-native-result]').waitFor({timeout:timeoutMs});
  await runCard.getByText(/Finalización: PUBLISHED/).waitFor({timeout:timeoutMs});
  await page.waitForFunction(id=>Boolean(document.querySelector(`[data-run-id="${id}"] [data-native-result]`)),browserRunId,{timeout:timeoutMs});
  const runText=await runCard.innerText();
  assert.match(runText,/Finalización: PUBLISHED; salidas no producidas: 0\./);
  const terminalItem=runCard.locator('[data-run-artifacts] li[data-artifact-kind="qraft.terminal-scheduler-evidence"]');
  await terminalItem.waitFor({state:'attached',timeout:timeoutMs});
  const terminalArtifactId=await terminalItem.getAttribute('data-artifact-id');
  await runCard.locator('details').filter({has:page.locator('[data-run-artifacts]')}).locator('summary').click();
  const terminalResponse=page.waitForResponse(response=>response.request().method()==='GET'&&new URL(response.url()).pathname===`/api/v1/artifacts/${terminalArtifactId}/content`,{timeout:timeoutMs});
  await terminalItem.locator(`[data-verify-artifact="${terminalArtifactId}"]`).click();
  await (await terminalResponse).body();
  await Promise.allSettled(pendingCaptures);
  const terminalRead=evidence.artifact_reads.find(item=>item.artifact_id===terminalArtifactId);
  if(!terminalRead)throw new Error('Signed terminal scheduler evidence content was not captured by the browser.');
  terminalRead.kind='qraft.terminal-scheduler-evidence';
  const terminalDocument=JSON.parse(fs.readFileSync(path.join(outputDir,terminalRead.path),'utf8'));
  assert.equal(terminalDocument.run_id,browserRunId);
  assert.equal(terminalDocument.state,'COMPLETED');
  if(!terminalDocument.signature||!terminalDocument.job?.job_id)throw new Error('Signed terminal evidence lacks its signature or job identity.');
  evidence.signed_terminal_evidence={artifact_id:terminalArtifactId,sha256:terminalRead.sha256,job:terminalDocument.job,
    state:terminalDocument.state,signature:terminalDocument.signature,workflow_lock_sha256:terminalDocument.workflow_lock_sha256,
    run_lock_sha256:terminalDocument.run_lock_sha256};
  evidence.run_reads[browserRunId]={source:'operative browser UI',visible_text_sha256:sha256(Buffer.from(runText)),
    showed_native_result:runText.includes('qraft.runtime-result-observation'),showed_science_not_established:runText.includes('NOT_ESTABLISHED'),
    showed_four_dimensions:['scheduler','execution','integrity','science'].every(name=>runText.includes(name)),
    showed_published_finalization:runText.includes('Finalización: PUBLISHED; salidas no producidas: 0.')};
  assert.match(runText,/NOT_ESTABLISHED/);
  await runCard.screenshot({path:path.join(outputDir,'browser-run.png')});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('[data-local-run-panel]').waitFor({timeout:timeoutMs});
  await page.locator('[data-operative-run-page][open]').waitFor({timeout:timeoutMs});
  const reloadedCard=page.locator(`[data-operative-run-page][open] [data-run-id="${browserRunId}"]`);
  await reloadedCard.waitFor({timeout:timeoutMs});
  await reloadedCard.locator('[data-native-result]').waitFor({timeout:timeoutMs});
  await reloadedCard.getByText(/Finalización: PUBLISHED/).waitFor({timeout:timeoutMs});
  const afterReload=await reloadedCard.innerText();
  assert.match(afterReload,/Finalización: PUBLISHED; salidas no producidas: 0\./);
  assert.match(afterReload,/NOT_ESTABLISHED/);
  assert.match(await page.locator('[data-operation-list]').innerText(),/SUBMIT_RUN · SUCCEEDED/);
  evidence.reload={project_id:await projectSelect.inputValue(),run_id:browserRunId,showed_native_result:afterReload.includes('qraft.runtime-result-observation')};
  evidence.browser_errors.push(...[]);
  await Promise.allSettled(pendingCaptures);
  for(const [runId,capture] of captures){
    const relative=`get-run-${runId}.json`;
    fs.writeFileSync(path.join(outputDir,relative),capture.body,{mode:0o600});
    let projection=null;try{projection=JSON.parse(capture.body.toString('utf8'));}catch{}
    evidence.run_reads[runId]={...evidence.run_reads[runId],get_run:{path:relative,status:capture.status,sha256:sha256(capture.body),
      dimensions:projection?.payload?.dimensions||null},captured_at:capture.captured_at};
  }
  for(const item of evidence.artifact_reads){
    const visible=runCard.locator(`[data-artifact-id="${item.artifact_id}"]`);
    item.kind=await visible.getAttribute('data-artifact-kind').catch(()=>null);
  }
  const finalizationRead=evidence.artifact_reads.find(item=>item.kind==='dftlab.finalization-receipt');
  const resultRead=evidence.artifact_reads.find(item=>item.kind==='qraft.runtime-result-observation');
  if(!finalizationRead||!resultRead)throw new Error('Finalization receipt or native result bytes were not read by the browser.');
  const finalizationDocument=JSON.parse(fs.readFileSync(path.join(outputDir,finalizationRead.path),'utf8'));
  evidence.finalization_receipt={artifact_id:finalizationRead.artifact_id,sha256:finalizationRead.sha256,
    state:finalizationDocument.payload?.state,integrity:finalizationDocument.integrity?.status,digest:finalizationDocument.integrity?.digest};
  evidence.native_result={artifact_id:resultRead.artifact_id,sha256:resultRead.sha256};
  await page.screenshot({path:path.join(outputDir,'browser-flow.png'),fullPage:true});
  evidence.screenshot_sha256=sha256(fs.readFileSync(path.join(outputDir,'browser-flow.png')));
  evidence.elapsed_seconds=Math.round((Date.now()-Date.parse(evidence.started_at))/1000*1000)/1000;
  evidence.status='SUBMITTED_AND_READ';
  evidence.browser_errors=[...new Set(evidence.browser_errors)];
  if(evidence.browser_errors.length)throw new Error(`Browser errors: ${evidence.browser_errors.join('; ')}`);
  persist();
  console.log(JSON.stringify({status:evidence.status,project_id:projectId,run_id:browserRunId,admission:decision,
    screenshot:path.join(outputDir,'browser-flow.png'),get_run:evidence.run_reads[browserRunId]?.get_run,
    error_count:evidence.browser_errors.length},null,2));
}catch(error){
  evidence.status='FAILED_NO_RESUBMIT';evidence.error=`${error.name}: ${error.message}`;
  evidence.elapsed_seconds=Math.round((Date.now()-Date.parse(evidence.started_at))/1000*1000)/1000;
  await Promise.allSettled(pendingCaptures);
  for(const [runId,capture] of captures){
    const relative=`get-run-${runId}.json`;
    fs.writeFileSync(path.join(outputDir,relative),capture.body,{mode:0o600});
    let projection=null;try{projection=JSON.parse(capture.body.toString('utf8'));}catch{}
    evidence.run_reads[runId]={...evidence.run_reads[runId],get_run:{path:relative,status:capture.status,sha256:sha256(capture.body),dimensions:projection?.payload?.dimensions||null},captured_at:capture.captured_at};
  }
  persist();
  console.error(JSON.stringify({status:evidence.status,error:evidence.error,project_id:evidence.project_id||null,run_id:evidence.run_id||null,evidence_dir:outputDir},null,2));
  process.exitCode=1;
}finally{await browser.close();}
