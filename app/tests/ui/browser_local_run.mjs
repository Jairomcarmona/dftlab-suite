import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {validate} from '../../dftlab/static/js/sdk/contracts.js';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const APP=path.resolve(HERE,'../..');
const ROOT=path.resolve(APP,'..');
const DIST=path.join(APP,'dist/operative');
const manifest=JSON.parse(fs.readFileSync(path.join(DIST,'manifest.json'),'utf8'));
const assets=new Map(manifest.files.map(item=>[item.path,fs.readFileSync(path.join(DIST,item.path))]));
const readFixture=(...parts)=>JSON.parse(fs.readFileSync(path.join(ROOT,'contracts/fixtures',...parts),'utf8'));
const clone=value=>structuredClone(value);
const now='2026-10-13T12:00:00Z';
const PROJECT='prj-local',OWNER='usr-local',DRAFT='drf-local',STRUCTURE='str-local',INTENT='int-local';
const CAMPAIGN='cmp-local',PLAN='pln-local',PACKAGE='pkg-local',RUN='run-local',ATTEMPT='att-local';
const PROFILE='wsl-slurm-openmpi-installed-qualification';
const state={draft:null,campaign:null,plan:null,run:null,operations:[],validation:null,artifacts:new Map(),project:{project_id:PROJECT,name:'Local Si fixture',revision:1,owner_principal_id:OWNER,created_at:now},calls:[]};
async function waitForStep(page,id,value){
  try{await page.waitForFunction(({id,value})=>document.querySelector('[data-step="'+id+'"]')?.textContent.includes(value),{id,value},{timeout:5000});}
  catch(error){console.error(JSON.stringify({step:id,status:await page.locator('[data-local-run-panel] [role="status"]').textContent(),steps:await page.locator('[data-workflow-steps]').innerText(),calls:state.calls}));throw error;}
}

function stampEnvelope(value,{recordId,projectId=PROJECT,payload={}}={}){
  const result=clone(value);result.record_id=recordId||result.record_id;result.project_id=projectId;result.created_at=now;
  result.payload={...result.payload,...payload};return result;
}
function page(items){return {items,next_cursor:null};}
function problem(res,status,code,operationId=null){const value={type:'about:blank',title:code,status,code,request_id:'req-local'};if(operationId)value.operation_id=operationId;res.writeHead(status,{'content-type':'application/problem+json'});res.end(JSON.stringify(value));}
function json(res,status,value,headers={}){res.writeHead(status,{'content-type':'application/json; charset=utf-8',...headers});res.end(JSON.stringify(value));}
function operation(action,request,result){
  const base=action==='CREATE_CAMPAIGN'?readFixture('operation-record','valid','create-campaign-succeeded.json'):
    action==='CREATE_PLAN'?readFixture('operation-record','valid','create-plan-succeeded.json'):
    readFixture('operation-record','valid','create-plan-succeeded.json');
  const id=`op-${action.toLowerCase().replaceAll('_','-')}`;
  const record=stampEnvelope(base,{
    recordId:`rec-${id}`,
    payload:{operation_id:id,action,state:'SUCCEEDED',revision:2,
      idempotency_key:request.idempotency_key,idempotency_scope:{owner_principal_id:OWNER,project_id:PROJECT},owner_principal_id:OWNER,
      accepted_at:now,updated_at:now,target_refs:[{kind:request.target.kind,id:request.target.id,revision:request.target.expected_revision}],result,error:null,
      event_cursor:`${id}:2`,key_retention:{effects_alive:true,retain_until:null}}
  });
  state.operations=[...state.operations.filter(item=>item.payload.action!==action),record];return record;
}
function createDraftBundle(request){
  const structure=stampEnvelope(readFixture('structure-revision','valid','si-diamond.json'),{recordId:'rec-str-local',payload:{...request.structure,structure_id:STRUCTURE,revision:1,parent_revision:null}});
  const draft=stampEnvelope(readFixture('draft','valid','promoted-from-learning.json'),{recordId:'rec-dr-local',payload:{draft_id:DRAFT,revision:1,title:request.title,
    purpose:'EXPLORATORY',provenance_state:'PARTIAL',scientific_assessment:'NOT_EVALUATED',structure:{structure_id:STRUCTURE,revision:1},intent_id:INTENT,
    origin:{kind:'LEARNING_PROMOTION',learning_dataset_id:'ld-si',exported_kind:'TEMPLATE',source_artifact:null},updated_at:now}});
  const runIntent=stampEnvelope(readFixture('run-intent','valid','promoted-to-draft.json'),{recordId:'rec-int-local',payload:{intent_id:INTENT,draft_id:DRAFT,
    structure:{structure_id:STRUCTURE,revision:1},physical_model_ref:'rec-pm-local',numerical_policy_ref:'rec-np-local'}});
  const physical=stampEnvelope(readFixture('physical-model','valid','pbe.json'),{recordId:'rec-pm-local'});
  const numerical=stampEnvelope(readFixture('numerical-policy','valid','scf.json'),{recordId:'rec-np-local'});
  state.draft={draft,structure,intent:{run_intent:runIntent,physical_model:physical,numerical_policy:numerical}};
  return state.draft;
}
const validation=()=>{
  if(!state.validation)state.validation=stampEnvelope(readFixture('validation-receipt','valid','heuristic-override.json'),{recordId:'rec-validation-local',payload:{decision:'ACCEPTED',diagnostics:[],overrides:[]}});
  return state.validation;
};
function createCampaign(request){
  state.campaign=stampEnvelope(readFixture('campaign','valid','one-draft.json'),{recordId:'rec-campaign-local',payload:{campaign_id:CAMPAIGN,name:request.payload.name,drafts:[{draft_id:DRAFT,revision:1}]}});
  return operation('CREATE_CAMPAIGN',request,{product_refs:[{kind:'CAMPAIGN',id:CAMPAIGN,revision:1}]});
}
function createPlan(request){
  state.plan=stampEnvelope(readFixture('plan','valid','locked.json'),{recordId:'rec-plan-local',payload:{plan_id:PLAN,campaign_id:CAMPAIGN,revision:1,draft:{draft_id:DRAFT,revision:1},intent_id:INTENT,validation_receipt_id:'rec-validation-local'}});
  return operation('CREATE_PLAN',request,{product_refs:[{kind:'PLAN',id:PLAN,revision:1}]});
}
const resultBytes=Buffer.from(JSON.stringify({attempt:{result:{execution_state:'COMPLETED',technical_validation:{status:'PASS',parser_summary:{scf_converged:true,normal_termination:true}}}}}));
function artifact(kind,id,mediaType,content){
  const bytes=Buffer.from(content);const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
  const record=stampEnvelope(readFixture('artifact-record','valid','siesta-output.json'),{recordId:`rec-${id}`,payload:{artifact_id:id,kind,media_type:mediaType,size_bytes:bytes.length,sha256,integrity_state:'VERIFIED',
    retention_class:'ESSENTIAL',producer_ref:{kind:'RUN_ATTEMPT',id:ATTEMPT},input_refs:[],parser:null,locator_id:`loc-${id}`}});
  const ref={artifact_id:id,sha256,media_type:mediaType};state.artifacts.set(id,{record,bytes,ref});return ref;
}
const admission=stampEnvelope(readFixture('admission-receipt','valid','exploratory.json'),{recordId:'rec-admission-local',payload:{principal_id:OWNER,profile:{profile_id:PROFILE,revision:1},decision:'ADMITTED',purpose:'EXPLORATORY',reasons:[]}});
const rejectedAdmission=stampEnvelope(readFixture('admission-receipt','valid','rejected-before-reservation.json'),{recordId:'rec-admission-rejected-local',payload:{principal_id:OWNER,action:'SUBMIT_RUN',profile:{profile_id:PROFILE,revision:1},decision:'REJECTED',purpose:'EXPLORATORY',reasons:['LOCAL_BUDGET_UNAVAILABLE'],reservation:null,runtime_probe_ref:null}});
const rawRef=artifact('qraft.runtime-result-observation','art-result-local','application/json',resultBytes);
const admissionRef=artifact('dftlab.admission-receipt','art-admission-local','application/json',JSON.stringify(admission));
const finalization=stampEnvelope(readFixture('finalization-receipt','valid','published.json'),{recordId:'rec-final-local',payload:{run_id:RUN,attempt_id:ATTEMPT,expected_artifacts:[rawRef,admissionRef],verified_artifacts:[rawRef,admissionRef],missing:[],assessment_refs:[],state:'PUBLISHED',unproduced_outputs:[]}});
const finalRef=artifact('dftlab.finalization-receipt','art-final-local','application/json',JSON.stringify(finalization));
const runProjection=stampEnvelope(readFixture('run-projection','valid','completed-not-established.json'),{recordId:'rec-run-local',payload:{run_id:RUN,current_attempt_id:ATTEMPT,source_revision:10,snapshot_cursor:`${RUN}:10`}});
function submitRun(request){
  state.run=runProjection;
  const record=operation('SUBMIT_RUN',request,{run_id:RUN,submission_receipt_id:'rec-submission-local'});
  const submission=stampEnvelope(readFixture('submission-receipt','valid','accepted.json'),{recordId:'rec-submission-local',payload:{operation_id:record.payload.operation_id,package_ref:{artifact_id:PACKAGE,sha256:'a'.repeat(64),media_type:'application/zip'},profile:{profile_id:PROFILE,revision:1},job:{job_id:'fixture-1',cluster:'fixture',remote_user:'local',submitted_at:now}}});
  record.payload.result={run_id:RUN,submission_receipt_id:submission.record_id};
  const refs=[admissionRef,finalRef,rawRef];
  state.events=refs.map((ref,index)=>({event_id:`ev-local-${index+1}`,stream_id:RUN,sequence:index+1,occurred_at:now,recorded_at:now,type:'artifact.committed',schema_version:'0.1.0',project_id:PROJECT,
    operation_id:record.payload.operation_id,run_id:RUN,attempt_id:ATTEMPT,payload:{artifact:ref},evidence_refs:[]}));
  for(let index=0;index<48;index++){
    const ref=artifact('dftlab.scheduler-observation',`art-scheduler-${index}`,'application/json',JSON.stringify({sequence:index+1}));
    const sequence=state.events.length+1;
    state.events.push({event_id:`ev-scheduler-${index+1}`,stream_id:RUN,sequence,occurred_at:now,recorded_at:now,type:'artifact.committed',schema_version:'0.1.0',project_id:PROJECT,
      operation_id:record.payload.operation_id,run_id:RUN,attempt_id:ATTEMPT,payload:{artifact:ref},evidence_refs:[]});
  }
  return record;
}

async function readBody(req){const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);return bytes.length?JSON.parse(bytes.toString('utf8')):null;}
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://local.test');
  if(!url.pathname.startsWith('/api/v1/')){
    const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
    const asset=assets.get(name);if(!asset){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'content-type':name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.css')?'text/css':'text/javascript','cache-control':'no-store'});res.end(asset);return;
  }
  const route=url.pathname.slice('/api/v1/'.length);const method=req.method;
  state.calls.push(`${method} ${route}${url.search}`);
  if(route==='session'&&method==='GET'){
    if(req.headers.cookie?.includes('dftlab_session=local'))return json(res,200,{principal_id:OWNER,csrf_token:'c'.repeat(48),expires_at:'2026-10-14T12:00:00Z'});
    return problem(res,401,'NOT_AUTHENTICATED');
  }
  if(route==='session'&&method==='POST')return json(res,201,{principal_id:OWNER,csrf_token:'c'.repeat(48),expires_at:'2026-10-14T12:00:00Z'},{'set-cookie':'dftlab_session=local; Path=/; HttpOnly; SameSite=Strict'});
  if(route==='health')return json(res,200,{status:'OK',api_version:'0.1.0'});
  if(route==='capabilities')return json(res,200,[]);
  if(route==='projects'&&method==='GET')return json(res,200,[state.project]);
  if(route===`projects/${PROJECT}`&&method==='GET')return json(res,200,state.project);
  if(route===`projects/${PROJECT}/drafts`&&method==='GET')return json(res,200,state.draft?[state.draft.draft]:[]);
  if(route===`projects/${PROJECT}/drafts`&&method==='POST')return json(res,201,createDraftBundle(await readBody(req)));
  if(route===`projects/${PROJECT}/campaigns`&&method==='GET')return json(res,200,page(state.campaign?[state.campaign]:[]));
  if(route===`projects/${PROJECT}/campaigns`&&method==='POST')return json(res,202,createCampaign(await readBody(req)));
  if(route===`projects/${PROJECT}/validations`&&method==='POST'){
    const request=await readBody(req);return json(res,202,operation('VALIDATE_INPUT',request,{product_refs:[{kind:'VALIDATION_RECEIPT',id:'rec-validation-local',revision:1}]}));
  }
  if(route==='campaigns/'+CAMPAIGN&&method==='GET')return json(res,200,state.campaign);
  if(route===`campaigns/${CAMPAIGN}/plans`&&method==='GET')return json(res,200,page(state.plan?[state.plan]:[]));
  if(route===`campaigns/${CAMPAIGN}/plans`&&method==='POST')return json(res,202,createPlan(await readBody(req)));
  if(route==='plans/'+PLAN&&method==='GET')return json(res,200,state.plan);
  if(route===`plans/${PLAN}/packages`&&method==='POST'){
    const request=await readBody(req);return json(res,202,operation('PREPARE_PACKAGE',request,{product_refs:[{kind:'PACKAGE',id:PACKAGE,revision:1}]}));
  }
  if(route===`plans/${PLAN}/runs`&&method==='POST'){
    const request=await readBody(req);
    if(request.budget_ref==='budget-reject'){
      const rejected=operation('SUBMIT_RUN',request,{receipt:rejectedAdmission});
      rejected.payload.state='REJECTED';rejected.payload.error={type:'about:blank',title:'ADMISSION_REJECTED',status:409,code:'ADMISSION_REJECTED',request_id:'req-local',operation_id:rejected.payload.operation_id};
      validate('operation-record',rejected);
      return problem(res,409,'ADMISSION_REJECTED',rejected.payload.operation_id);
    }
    return json(res,202,submitRun(request));
  }
  if(route===`projects/${PROJECT}/runs`&&method==='GET')return json(res,200,page(state.run?[state.run]:[]));
  if(route===`projects/${PROJECT}/operations`&&method==='GET')return json(res,200,page(state.operations));
  if(route.startsWith('operations/')&&method==='GET'){
    const id=route.slice('operations/'.length);const value=state.operations.find(item=>item.payload.operation_id===id);return value?json(res,200,value):problem(res,404,'NOT_FOUND');
  }
  if(route==='validation-receipts/rec-validation-local'&&method==='GET')return json(res,200,validation());
  if(route==='runs/'+RUN&&method==='GET')return json(res,200,state.run||runProjection);
  if(route===`runs/${RUN}/events`&&method==='GET')return json(res,200,{events:url.searchParams.has('after')?[]:(state.events||[]),next_cursor:`${RUN}:3`});
  if(route.startsWith('artifacts/')&&method==='GET'){
    const parts=route.split('/');const id=parts[1];const item=state.artifacts.get(id);if(!item)return problem(res,404,'NOT_FOUND');
    if(parts[2]==='content'){res.writeHead(200,{'content-type':'application/octet-stream','content-length':String(item.bytes.length)});res.end(item.bytes);return;}
    return json(res,200,item.record);
  }
  return problem(res,404,'NOT_FOUND');
});

await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({args:['--no-sandbox']});
try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/');
  await page.setInputFiles('[data-operative-access-file]',{name:'access.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({origin,bootstrap_token:'b'.repeat(48)}))});
  const projectSelect=page.locator('[data-project-selector]');await projectSelect.waitFor();await projectSelect.selectOption(PROJECT);
  await page.locator('[data-local-run-panel]').waitFor();
  assert.equal(await page.locator('[data-local-run-panel]').count(),1);
  assert.ok(state.calls.includes('GET capabilities'));
  assert.equal(await page.locator('[data-recipe-cell-angstrom="2.7155"]').count(),1);
  await page.locator('[data-local-action="promote"]').click();
  await waitForStep(page,'draft','LISTO');
  assert.deepEqual(state.draft.structure.payload.cell.vectors,[[0,2.7155,2.7155],[2.7155,0,2.7155],[2.7155,2.7155,0]]);
  assert.equal(readFixture('structure-revision','valid','si-diamond.json').payload.cell.vectors[0][1],2.715);
  await page.locator('button[data-local-action="validate"]').click();
  await waitForStep(page,'validation','SUCCEEDED');
  await page.locator('button[data-local-action="campaign"]').click();
  await waitForStep(page,'campaign','SUCCEEDED');
  await page.locator('button[data-local-action="plan"]').click();
  await waitForStep(page,'plan','SUCCEEDED');
  await page.locator('button[data-local-action="package"]').click();
  await waitForStep(page,'package','SUCCEEDED');
  const budget=page.locator('[data-budget-ref]');
  await budget.fill('budget-reject');
  await page.locator('[data-execution-profile]').selectOption(PROFILE);
  await page.locator('button[data-local-action="submit"]').click();
  const rejected=page.locator('[data-admission-receipt] [data-decision="REJECTED"]');
  try{await rejected.waitFor({timeout:8000});}catch(error){console.error(JSON.stringify({status:await page.locator('[data-local-run-panel] [role="status"]').textContent(),calls:state.calls,operations:state.operations.map(item=>({id:item.payload.operation_id,action:item.payload.action,state:item.payload.state,error:item.payload.error?.code}))}));throw error;}
  assert.equal(await rejected.getAttribute('data-purpose'),'EXPLORATORY');
  assert.equal(await rejected.locator('[data-admission-reasons]').getAttribute('data-admission-reasons'),'LOCAL_BUDGET_UNAVAILABLE');
  assert.equal(state.run,null);
  await budget.fill('budget-local');
  await page.locator('button[data-local-action="submit"]').click();
  const run=page.locator(`article[data-run-id="${RUN}"]`).filter({has:page.locator('[data-native-result]')});await run.waitFor({timeout:15000});
  await run.getByText(/Finalización: PUBLISHED/).waitFor({timeout:15000});
  await page.locator('[data-operative-run-page][open]').waitFor();
  const layout=await page.locator('[data-operative-run-page]').evaluate(dialog=>({
    width:dialog.clientWidth,scrollWidth:dialog.scrollWidth,
    titleLeft:dialog.querySelector('[data-run-page-title]').getBoundingClientRect().left,
    closeRight:dialog.querySelector('[data-close-run-page]').getBoundingClientRect().right
  }));
  assert.ok(layout.scrollWidth<=layout.width+1,`Run page overflows horizontally: ${JSON.stringify(layout)}`);
  assert.ok(layout.titleLeft>=0&&layout.closeRight<=layout.width+1,`Run page header is clipped: ${JSON.stringify(layout)}`);
  const admitted=page.locator('[data-admission-receipt] [data-decision="ADMITTED"]');await admitted.waitFor();
  assert.equal(await admitted.getAttribute('data-purpose'),'EXPLORATORY');
  assert.match(await admitted.innerText(),/EXPLORATORY/);
  const runAdmission=run.locator('[data-run-admission][data-decision="ADMITTED"]');await runAdmission.waitFor();
  assert.equal(await runAdmission.getAttribute('data-purpose'),'EXPLORATORY');
  assert.match(await run.innerText(),/Finalización: PUBLISHED; salidas no producidas: 0\./);
  assert.match(await run.innerText(),/scheduler[\s\S]*execution[\s\S]*integrity[\s\S]*science/);
  assert.match(await run.locator('[data-native-result]').textContent(),/scf_converged/);
  assert.equal(await run.locator('li').filter({hasText:'qraft.runtime-result-observation'}).count(),1);
  assert.equal(await run.locator('[data-run-events] [data-event-type="artifact.committed"]').count(),51);
  assert.equal(state.calls.some(call=>call==='GET artifacts/art-scheduler-0/content'),false);
  assert.equal(state.calls.some(call=>call==='GET artifacts/art-scheduler-47/content'),false);
  await page.reload();
  await page.locator('[data-local-run-panel]').waitFor();
  const reloadedRun=page.locator(`article[data-run-id="${RUN}"]`).filter({has:page.locator('[data-native-result]')});
  try{await page.locator('[data-operative-run-page][open]').waitFor({timeout:15000});}
  catch(error){console.error(JSON.stringify({dialogCount:await page.locator('[data-operative-run-page]').count(),project:await page.locator('[data-project-selector]').inputValue(),runCardCount:await page.locator('article[data-run-id]').count(),runList:await page.locator('[data-run-list]').innerText(),localStorage:await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('dftlab.local-run.v1.')).map(key=>[key,localStorage.getItem(key)])),status:await page.locator('[data-local-run-panel] [role="status"]').textContent(),calls:state.calls.slice(-15)}));throw error;}
  await reloadedRun.waitFor({timeout:15000});
  await reloadedRun.getByText(/Finalización: PUBLISHED/).waitFor({timeout:15000});
  assert.equal(await page.locator('[data-project-selector]').inputValue(),PROJECT);
  assert.match(await page.locator('[data-operation-list]').innerText(),/SUBMIT_RUN · SUCCEEDED/);
  assert.ok(state.calls.some(call=>call.startsWith(`GET projects/${PROJECT}/operations`)));
  assert.ok(state.calls.some(call=>call.startsWith(`GET campaigns/${CAMPAIGN}/plans`)));
  assert.ok(state.calls.some(call=>call.startsWith(`GET projects/${PROJECT}/runs`)));
  assert.deepEqual(errors,[]);
  console.log('Local run browser flow: empty capability catalog, recipe geometry, rejected/admitted receipts, API operations, artifacts, projections and reload PASS.');
}finally{await browser.close();server.close();}
