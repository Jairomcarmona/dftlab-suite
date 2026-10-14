import {promoteStructure} from '../learn/promote.js';
import {lruView} from './lru-view.js';
import siStructure from '../../../../../contracts/fixtures/structure-revision/valid/si-diamond.json' with {type:'json'};

const PROFILE='wsl-slurm-openmpi-installed-qualification';
const PROTOCOL={protocol_id:'dftlab.siesta.single-derived',version:'0.1.0'};
const POLICY_DIGEST='5a3d78065c65bdbeba32d00f1e2bcc31050575718ec2c9f731aa1109428c69ff';
const TERMINAL=new Set(['COMPLETED','CANCELLED','INTERRUPTED','FAILED']);

const el=(tag,text,attrs={})=>{
  const value=document.createElement(tag);
  if(text!==undefined)value.textContent=text;
  for(const [key,val] of Object.entries(attrs))value.setAttribute(key,val);
  return value;
};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const hex=bytes=>Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');

function siIntent(){
  return {
    operation:'dftlab.scf',protocol:PROTOCOL,
    physical_model:{xc:{functional:'CA',family:'LDA'},total_charge:{value:0,unit:'e'},spin:'NONE',relativistic:'SCALAR',hubbard:null,assumptions:[]},
    numerical_policy:{
      policy:{policy_id:'dftlab.qualification-scf',version:'0.1.0',digest:POLICY_DIGEST},
      basis:{size:'DZP',energy_shift:{value:0.02,unit:'Ry'}},mesh_cutoff:{value:200,unit:'Ry'},
      kgrid:{kind:'MONKHORST_PACK',divisions:[2,2,2],shift:[0,0,0],k_includes_2pi:false},
      smearing:null,solver:'diagon',tolerances:{dm_tolerance:{value:'1e-5',unit:'1'}},
      convergence_target:'total_energy',justification:'Explicit local authoring case; fixed parameters, no universal convergence/science claim.'
    }
  };
}

export function localRunPanel({client,projectId,isCurrent,runPage=null}){
  const panel=el('section',undefined,{ 'data-local-run-panel':'' });
  panel.className='navgrp local-run-panel';
  panel.append(el('h4','Primer cálculo local'));
  panel.append(el('p','Receta registrada de Si: finalidad EXPLORATORY. La admisión depende del perfil y presupuesto locales; el resultado científico queda NOT_ESTABLISHED.'));
  const geometryNote=el('p','La plantilla de esta receta usa una celda de diamante de 2.7155 Å. El fixture compartido de aprendizaje permanece intacto.');
  geometryNote.dataset.recipeCellAngstrom='2.7155';panel.append(geometryNote);
  const projectRef=el('p',`ID de proyecto para registrar presupuesto: ${projectId}`);projectRef.dataset.projectId=projectId;panel.append(projectRef);
  const promote=el('button','Crear borrador Si de la receta local');promote.type='button';promote.dataset.localAction='promote';panel.append(promote);
  const selector=el('select',undefined,{'aria-label':'Borrador de Si','data-draft-selector':''});
  const draftLabel=el('label','Borrador para ejecutar');draftLabel.append(selector);panel.append(draftLabel);
  const budget=el('input',undefined,{type:'text',autocomplete:'off','aria-label':'Referencia del presupuesto local',placeholder:'budget_id del operador','data-budget-ref':''});
  const budgetLabel=el('label','Presupuesto local');budgetLabel.append(budget);panel.append(budgetLabel);
  const profile=el('select',undefined,{'aria-label':'Perfil de ejecución','data-execution-profile':''});const profileOption=el('option',PROFILE,{value:PROFILE});profile.append(profileOption);
  const profileLabel=el('label','Perfil de ejecución');profileLabel.append(profile);panel.append(profileLabel);
  panel.append(el('p','La receta de Si admite únicamente el perfil WSL/SLURM calificado.'));
  const actions=el('div');actions.className='local-run-actions';panel.append(actions);
  const buttons={
    validate:el('button','1. Validar entrada'),campaign:el('button','2. Crear campaña'),
    plan:el('button','3. Crear plan QRAFT'),package:el('button','4. Preparar paquete'),
    submit:el('button','5. Solicitar admisión y enviar')
  };
  for(const [name,button] of Object.entries(buttons)){button.type='button';button.dataset.localAction=name;actions.append(button);}
  const status=el('p','Carga o crea la plantilla Si para comenzar.',{'role':'status','aria-live':'polite'});panel.append(status);
  const steps=el('ol');steps.dataset.workflowSteps='';
  for(const [id,label] of [['draft','Borrador Si'],['validation','Validación'],['campaign','Campaña'],['plan','Plan QRAFT'],['package','Paquete'],['admission','Admisión'],['run','Run y resultado']]){
    const item=el('li',`${label}: pendiente`);item.dataset.step=id;steps.append(item);
  }
  panel.append(steps);
  const receipts=el('div');receipts.dataset.admissionReceipt='';panel.append(receipts);
  const validationView=el('div');validationView.dataset.validationReceipt='';panel.append(validationView);
  const operationList=el('div');operationList.dataset.operationList='';panel.append(operationList);
  const planList=el('div');planList.dataset.planList='';panel.append(planList);
  const runList=el('div');runList.dataset.runList='';panel.append(runList);
  const detailHost=runPage?.content||runList;
  const key=`dftlab.local-run.v1.${projectId}`;
  let state={draftId:null,validationReceiptId:null,campaignId:null,planId:null,packageId:null,runId:null,budgetId:'',keys:{},activeOperations:{},templateKey:null};
  try{const stored=JSON.parse(localStorage.getItem(key)||'null');if(stored&&stored.projectId===projectId)state={...state,...stored.state,keys:{...state.keys,...stored.state?.keys},activeOperations:{...state.activeOperations,...stored.state?.activeOperations}};}catch{}
  budget.value=state.budgetId||'';
  let drafts=[],runs=[],campaigns=[],plans=[],operations=[],generation=0,polling=false,resumingOperations=false,activeRunCard=null;
  const artifactMetadataCache=new Map(),artifactDocumentCache=new Map();
  const persist=()=>{try{localStorage.setItem(key,JSON.stringify({projectId,state}));}catch{}};
  const current=()=>isCurrent();
  const say=value=>{if(current())status.textContent=value;};
  const selectedDraft=()=>drafts.find(item=>item.payload.draft_id===state.draftId)||null;
  const clearDownstream=()=>{state.validationReceiptId=null;state.campaignId=null;state.planId=null;state.packageId=null;state.runId=null;state.keys={};receipts.replaceChildren();validationView.replaceChildren();persist();};
  const product=(operation,kind)=>{
    const result=operation.payload.result;
    return result?.product_refs?.find(ref=>ref.kind===kind)?.id
      ||result?.receipt?.payload?.product_refs?.find(ref=>ref.kind===kind)?.id||null;
  };

  function showValidation(receipt){
    validationView.replaceChildren();
    const payload=receipt.payload;
    validationView.append(el('h5',`Validación: ${payload.decision}`));
    validationView.append(el('p',`${payload.diagnostics.length} diagnóstico(s) · recibo ${receipt.record_id||payload.validation_receipt_id||state.validationReceiptId}`));
    if(payload.diagnostics.length){const list=el('ul');for(const diagnostic of payload.diagnostics)list.append(el('li',`${diagnostic.code} · ${diagnostic.severity}`));validationView.append(list);}
  }

  async function waitOperation(operation,step=null){
    let value=operation;
    const id=value.payload.operation_id;
    if(step){state.activeOperations[step]=id;persist();}
    for(let attempt=0;attempt<40&&['PENDING','RUNNING'].includes(value.payload.state);attempt++){
      await pause(350);
      if(!current())return value;
      value=await client.operation(value.payload.operation_id);
      operations=[value,...operations.filter(item=>item.payload.operation_id!==id)];
      renderOperations();
    }
    if(step&&value.payload.state!=='OUTCOME_UNKNOWN'){delete state.activeOperations[step];persist();}
    return value;
  }

  async function issue(name,step,path,target,payload,{profileRef=null,budgetRef=null}={}){
    const idempotency=state.keys[step]||(state.keys[step]=crypto.randomUUID());persist();
    const request={action:name.replace(/([a-z0-9])([A-Z])/g,'$1_$2').toUpperCase(),project_id:projectId,
      target:{kind:target.kind,id:target.id,expected_revision:target.revision},payload,idempotency_key:idempotency};
    if(profileRef!==null)request.profile_ref=profileRef;
    if(budgetRef!==null)request.budget_ref=budgetRef;
    let operation;
    try{operation=await client.action(name,path,request);}
    catch(error){
      if(!error.operationId)throw error;
      operation=await client.operation(error.operationId);
    }
    operation=await waitOperation(operation,step);
    if(operation.payload.state==='REJECTED'){
      delete state.keys[step];persist();
      const receipt=operation.payload.result?.receipt;
      if(receipt)showAdmission(receipt);
      throw Object.assign(new Error(operation.payload.error?.code||'ADMISSION_REJECTED'),{operationId:operation.payload.operation_id,operation});
    }
    if(operation.payload.state==='OUTCOME_UNKNOWN'){
      state.runId=state.runId||null;persist();
      throw Object.assign(new Error('OUTCOME_UNKNOWN: consultar y reconciliar la operación antes de continuar.'),{operationId:operation.payload.operation_id,operation});
    }
    if(operation.payload.state!=='SUCCEEDED')throw Object.assign(new Error(operation.payload.error?.code||operation.payload.state),{operationId:operation.payload.operation_id,operation});
    delete state.keys[step];persist();
    return operation;
  }

  function admissionBox(receipt){
    const payload=receipt.payload;
    const box=el('article');box.dataset.decision=payload.decision;box.dataset.purpose=payload.purpose;
    box.append(el('h5',`Admisión: ${payload.decision} · ${payload.purpose}`));
    box.append(el('p',payload.decision==='ADMITTED'?'La receta local admitió la ejecución exploratoria. Esto no evalúa validez científica.':'La ejecución se rechazó antes de enviar un trabajo.'));
    if(payload.reasons?.length){const reasons=el('p',`Motivos: ${payload.reasons.join(', ')}`);reasons.dataset.admissionReasons=payload.reasons.join(' ');box.append(reasons);}
    if(payload.reservation)box.append(el('p',`Reserva: ${payload.reservation.reservation_id} · ${payload.reservation.amount.value} ${payload.reservation.amount.unit}`));
    return box;
  }

  function showAdmission(receipt){
    receipts.replaceChildren(admissionBox(receipt));
    if(activeRunCard){
      activeRunCard.querySelector('[data-run-admission]')?.remove();
      const visible=admissionBox(receipt);visible.dataset.runAdmission='';activeRunCard.prepend(visible);
    }
    updateSteps();
  }

  function stepState(id,value){const item=steps.querySelector(`[data-step="${id}"]`);if(item)item.textContent=`${item.textContent.split(':',1)[0]}: ${value}`;}
  function updateSteps(){
    stepState('draft',state.draftId?'LISTO':'PENDIENTE');
    stepState('validation',state.validationReceiptId?'SUCCEEDED':'PENDIENTE');
    stepState('campaign',state.campaignId?'SUCCEEDED':'PENDIENTE');
    stepState('plan',state.planId?'SUCCEEDED':'PENDIENTE');
    stepState('package',state.packageId?'SUCCEEDED':'PENDIENTE');
    const admission=receipts.querySelector('[data-decision]')?.dataset.decision;
    stepState('admission',admission|| (state.runId?'EN CURSO':'PENDIENTE'));
    const execution=runs.find(item=>item.payload.run_id===state.runId)?.payload.dimensions?.execution?.value;
    stepState('run',state.runId?(execution||'DISPONIBLE'):'PENDIENTE');
  }

  function renderOperations(){
    operationList.replaceChildren();
    operationList.append(el('h5','Operaciones del proyecto'));
    if(!operations.length){operationList.append(el('p','Sin operaciones registradas.'));return;}
    const list=el('ul');
    for(const operation of operations){
      const value=operation.payload;const item=el('li',`${value.action} · ${value.state} · ${value.operation_id}`);item.dataset.operationState=value.state;
      if(value.state==='OUTCOME_UNKNOWN')item.append(el('p','OUTCOME_UNKNOWN: consulta la operación antes de repetir una acción.'));
      list.append(item);
    }
    operationList.append(list);
  }

  async function resumePendingOperations(){
    if(resumingOperations)return;
    const pending=operations.filter(item=>['PENDING','RUNNING'].includes(item.payload.state));
    if(!pending.length)return;
    resumingOperations=true;
    try{
      await Promise.all(pending.map(async item=>{
        const value=await waitOperation(await client.operation(item.payload.operation_id));
        operations=[value,...operations.filter(candidate=>candidate.payload.operation_id!==value.payload.operation_id)];
      }));
      renderOperations();
      await refresh();
    }catch(error){say(error.code||'No se pudo retomar la lectura de la operación.');}
    finally{resumingOperations=false;}
  }

  function renderPlans(){
    planList.replaceChildren();planList.append(el('h5','Planes del proyecto'));
    if(!plans.length){planList.append(el('p','Sin planes registrados.'));return;}
    const list=el('ul');
    for(const item of plans){const value=item.payload;list.append(el('li',`Plan ${value.plan_id} · campaña ${value.campaign_id} · revisión ${value.revision}`));}
    planList.append(list);
  }

  async function refresh(){
    const mine=++generation;
    try{
      const [draftPage,runPageData,campaignPage,operationPage]=await Promise.all([client.drafts(projectId),client.runs(projectId),client.campaigns(projectId),client.operations(projectId)]);
      const planPages=await Promise.all(campaignPage.items.map(item=>client.plans(item.payload.campaign_id)));
      const validation=state.validationReceiptId?await client.validationReceipt(state.validationReceiptId):null;
      if(!current()||mine!==generation)return;
      drafts=draftPage;
      runs=runPageData.items;
      campaigns=campaignPage.items;
      plans=planPages.flatMap(page=>page.items);
      operations=operationPage.items;
      if(validation)showValidation(validation);
      selector.replaceChildren();
      for(const record of drafts){const option=el('option',`${record.payload.title} · ${record.payload.scientific_assessment}`);option.value=record.payload.draft_id;selector.append(option);}
      if(state.draftId&&!drafts.some(item=>item.payload.draft_id===state.draftId))clearDownstream();
      if(!state.draftId&&drafts.length)state.draftId=drafts.find(item=>item.payload.intent_id)?.payload.draft_id||drafts.at(-1).payload.draft_id;
      selector.value=state.draftId||'';
      if(state.campaignId&&!campaigns.some(item=>item.payload.campaign_id===state.campaignId))state.campaignId=null;
      if(!state.campaignId&&state.draftId)state.campaignId=campaigns.find(item=>item.payload.drafts.some(ref=>ref.draft_id===state.draftId))?.payload.campaign_id||null;
      if(state.planId&&!plans.some(item=>item.payload.plan_id===state.planId))state.planId=null;
      if(!state.planId&&state.campaignId)state.planId=plans.find(item=>item.payload.campaign_id===state.campaignId)?.payload.plan_id||null;
      if(state.planId){
        const prepared=[...operations].reverse().find(item=>item.payload.action==='PREPARE_PACKAGE'&&item.payload.state==='SUCCEEDED'&&item.payload.target_refs.some(ref=>ref.id===state.planId));
        state.packageId=prepared?product(prepared,'PACKAGE'):null;
      }
      if(state.runId&&!runs.some(item=>item.payload.run_id===state.runId))state.runId=null;
      persist();renderPlans();renderOperations();renderRuns();updateButtons();
      if(state.runId&&!polling){runPage?.open(state.runId);pollRun(state.runId);}
      resumePendingOperations();
    }catch(error){if(current()&&mine===generation)say(error.code||error.message||'No se pudieron recuperar los recursos del proyecto.');}
  }

  function updateButtons(){
    const draft=selectedDraft();
    const hasIntent=Boolean(draft?.payload.intent_id);
    buttons.validate.disabled=!draft||!hasIntent;
    buttons.campaign.disabled=!state.validationReceiptId||Boolean(state.campaignId);
    buttons.plan.disabled=!state.validationReceiptId||!state.campaignId||Boolean(state.planId);
    buttons.package.disabled=!state.planId||Boolean(state.packageId);
    buttons.submit.disabled=!state.packageId||!budget.value.trim()||!profile.value||Boolean(state.runId);
    promote.disabled=false;
    updateSteps();
  }

  async function template(){
    promote.disabled=true;
    try{
      const structure=structuredClone(siStructure);
      const a=2.7155;
      structure.payload.cell.vectors=[[0,a,a],[a,0,a],[a,a,0]];
      structure.payload.sites[0].atom_id='si-1';structure.payload.sites[1].atom_id='si-2';
      state.templateKey=state.templateKey||crypto.randomUUID();persist();
      const created=await promoteStructure({structure,projectId,learningDatasetId:'ld-si',title:'Si diamante · plantilla exploratoria local',key:state.templateKey,intent:siIntent(),createDraft:client.createDraft});
      state.templateKey=null;clearDownstream();state.draftId=created.draft.payload.draft_id;persist();
      say('Plantilla Si guardada como EXPLORATORY, PARTIAL y NOT_EVALUATED.');await refresh();
    }catch(error){say(error.code||error.message||'No se pudo crear la plantilla Si. Reintentar conserva la misma identidad.');}
    finally{if(current())promote.disabled=false;}
  }

  async function validateDraft(){
    const draft=selectedDraft();if(!draft)return;
    buttons.validate.disabled=true;say('Validando el borrador con la receta local…');
    try{
      const project=await client.project(projectId);
      const operation=await issue('validateInput','validate',`projects/${encodeURIComponent(projectId)}/validations`,{kind:'PROJECT',id:projectId,revision:project.revision},{draft:{draft_id:draft.payload.draft_id,revision:draft.payload.revision}});
      state.validationReceiptId=product(operation,'VALIDATION_RECEIPT');
      if(!state.validationReceiptId)throw new Error('No se recibió el identificador del recibo de validación.');
      showValidation(await client.validationReceipt(state.validationReceiptId));
      persist();say('Validación autoritativa recibida.');updateButtons();
    }catch(error){say(error.message||error.code||'Falló la validación.');}
    finally{updateButtons();}
  }

  async function createCampaign(){
    const draft=selectedDraft();if(!draft)return;
    buttons.campaign.disabled=true;say('Creando campaña…');
    try{
      const project=await client.project(projectId);
      const operation=await issue('createCampaign','campaign',`projects/${encodeURIComponent(projectId)}/campaigns`,{kind:'PROJECT',id:projectId,revision:project.revision},
        {name:'Si diamante · primer cálculo local',drafts:[{draft_id:draft.payload.draft_id,revision:draft.payload.revision}]});
      state.campaignId=product(operation,'CAMPAIGN');if(!state.campaignId)throw new Error('No se recibió la campaña creada.');
      persist();say('Campaña creada.');await refresh();
    }catch(error){say(error.message||error.code||'No se pudo crear la campaña.');}
    finally{updateButtons();}
  }

  async function createPlan(){
    const draft=selectedDraft();if(!draft||!state.campaignId||!state.validationReceiptId)return;
    buttons.plan.disabled=true;say('Compilando el plan con QRAFT…');
    try{
      const campaign=await client.campaign(state.campaignId);
      const operation=await issue('createPlan','plan',`campaigns/${encodeURIComponent(state.campaignId)}/plans`,{kind:'CAMPAIGN',id:state.campaignId,revision:campaign.payload.revision},
        {draft:{draft_id:draft.payload.draft_id,revision:draft.payload.revision},intent_id:draft.payload.intent_id,validation_receipt_id:state.validationReceiptId});
      state.planId=product(operation,'PLAN');if(!state.planId)throw new Error('No se recibió el plan creado.');
      persist();say('Plan QRAFT creado con los parámetros de la plantilla.');updateButtons();
    }catch(error){say(error.message||error.code||'No se pudo compilar el plan.');}
    finally{updateButtons();}
  }

  async function preparePackage(){
    if(!state.planId)return;
    buttons.package.disabled=true;say('Preparando el paquete del perfil local…');
    try{
      const plan=await client.plan(state.planId);const native=plan.native_contract_refs?.[0];
      if(!native?.digest)throw new Error('El plan no contiene el digest QRAFT esperado.');
      const operation=await issue('preparePackage','package',`plans/${encodeURIComponent(state.planId)}/packages`,{kind:'PLAN',id:state.planId,revision:plan.payload.revision},
        {expected_plan_digest:native.digest},{profileRef:profile.value});
      state.packageId=product(operation,'PACKAGE');if(!state.packageId)throw new Error('No se recibió el paquete preparado.');
      persist();say('Paquete QRAFT preparado y verificado.');updateButtons();
    }catch(error){say(error.message||error.code||'No se pudo preparar el paquete.');}
    finally{updateButtons();}
  }

  async function submitRun(){
    if(!state.planId||!state.packageId||!budget.value.trim())return;
    buttons.submit.disabled=true;say('Comprobando perfil, presupuesto y probe SLURM antes del envío…');
    try{
      const plan=await client.plan(state.planId);
      const operation=await issue('submitRun','submit',`plans/${encodeURIComponent(state.planId)}/runs`,{kind:'PLAN',id:state.planId,revision:plan.payload.revision},
        {plan_id:state.planId,package_id:state.packageId,admission_purpose:'EXPLORATORY'},
        {profileRef:profile.value,budgetRef:budget.value.trim()});
      state.runId=operation.payload.result?.run_id||product(operation,'RUN')||null;
      persist();say('Operación aceptada. Leyendo proyección, recibo de admisión y artefactos…');
      if(state.runId){runPage?.open(state.runId);pollRun(state.runId);}else await refresh();
    }catch(error){
      if(error.operationId){try{const operation=await client.operation(error.operationId);if(operation.payload.result?.receipt?.schema_id==='dftlab.admission-receipt')showAdmission(operation.payload.result.receipt);}catch{}}
      say(error.message||error.code||'No se pudo completar la solicitud. Revisa la operación y su recibo antes de volver a intentar.');
      await refresh();
    }finally{updateButtons();}
  }

  function renderRuns(){
    runList.replaceChildren();
    if(!runs.length){runList.append(el('p','Aún no hay una fila RUN en este proyecto.'));return;}
    for(const run of [...runs].reverse()){
      const value=run.payload,button=el('button',`Abrir run ${value.run_id}`);
      button.type='button';button.dataset.runId=value.run_id;button.onclick=()=>{state.runId=value.run_id;persist();runPage?.open(value.run_id);pollRun(value.run_id);};
      const row=el('article');row.append(button);runList.append(row);
    }
  }

  async function artifactMetadata(reference){
    let pending=artifactMetadataCache.get(reference.artifact_id);
    if(!pending){
      pending=client.artifact(reference.artifact_id).then(record=>{
        if(record.payload.sha256!==reference.sha256||record.payload.integrity_state!=='VERIFIED')throw new Error('ARTIFACT_METADATA_MISMATCH');
        return record.payload;
      }).catch(error=>{artifactMetadataCache.delete(reference.artifact_id);throw error;});
      artifactMetadataCache.set(reference.artifact_id,pending);
    }
    return pending;
  }

  async function verifiedArtifact(reference,metadata=null){
    const value=metadata||await artifactMetadata(reference);
    const bytes=await client.artifactContent(reference.artifact_id);
    if(hex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)))!==reference.sha256)throw new Error('ARTIFACT_CONTENT_DIGEST_MISMATCH');
    return {metadata:value,bytes};
  }

  async function artifactDocument(reference,metadata){
    let pending=artifactDocumentCache.get(reference.artifact_id);
    if(!pending){
      pending=verifiedArtifact(reference,metadata).then(({bytes})=>({bytes,document:JSON.parse(new TextDecoder().decode(bytes))}))
        .catch(error=>{artifactDocumentCache.delete(reference.artifact_id);throw error;});
      artifactDocumentCache.set(reference.artifact_id,pending);
    }
    return pending;
  }

  async function showRun(runId){
    const [run,stream]=await Promise.all([client.run(runId),client.runEvents(runId)]);
    if(!current())return {terminal:true};
    const dimensions=run.payload.dimensions;
    const lru=lruView({projection:{science:dimensions.science.value,integrity:dimensions.integrity.value,scheduler:dimensions.scheduler.value,execution:dimensions.execution.value},
      responses:[],attempts:[{attempt_id:run.payload.current_attempt_id,generation:1,state:dimensions.execution.value,previous_attempt_id:null}],
      resume_plan:null,run:{plan_digest:run.payload.native_refs?.[0]?.digest?.value||'unknown',policy_digests:[]},cancel_requested:false,platform_resume_enabled:false,admission:null});
    const card=el('article');card.dataset.runId=runId;
    card.append(el('h5',`Run ${runId} · ${lru.headline}`));
    card.append(el('p',`Ciencia: ${dimensions.science.value} · base ${lru.science.basis}. La proyección no declara validez física.`));
    const table=el('dl');
    for(const name of ['scheduler','execution','integrity','science']){
      const dimension=dimensions[name];table.append(el('dt',name),el('dd',`${dimension.value} · ${dimension.source} · ${dimension.observed_at||'sin observación'}`));
    }
    card.append(table);
    const refs=new Map();
    for(const event of stream.events){
      const reference=event.payload?.artifact||event.evidence_refs?.[0];
      if(reference?.artifact_id&&!refs.has(reference.artifact_id))refs.set(reference.artifact_id,{reference,event});
    }
    const eventList=el('ol');eventList.dataset.runEvents='';
    for(const event of stream.events){
      const type=event.type||'UNKNOWN';
      const sequence=Number.isInteger(event.sequence)?`#${event.sequence} · `:'';
      eventList.append(el('li',`${sequence}${type} · ${event.occurred_at||event.recorded_at||'sin hora'}`,{'data-event-type':type}));
    }
    const eventDetails=el('details');eventDetails.append(el('summary',`Eventos del run · ${stream.events.length}`),eventList);card.append(eventDetails);
    const artifactList=el('ul');artifactList.dataset.runArtifacts='';
    const entries=[...refs.values()];
    card.append(el('p',`${entries.length} artefacto(s) vinculados al run.`));
    const artifactDetails=el('details');artifactDetails.append(el('summary','Artefactos vinculados al run'),artifactList);card.append(artifactDetails);
    detailHost.replaceChildren(card);activeRunCard=card;
    const terminal=TERMINAL.has(dimensions.execution.value);
    let done=false;
    say(terminal?'Run terminal; revisa el recibo de finalización y las salidas.':'Run activo; el estado se actualizará desde la proyección del servidor.');

    for(const {reference,event} of entries){
      artifactList.append(el('li',`${event.type||'artifact.committed'} · ${reference.sha256||reference.artifact_id}`,{'data-artifact-id':reference.artifact_id}));
    }
    let next=0;
    const readArtifact=async({reference},item)=>{
      try{
        const metadata=await artifactMetadata(reference);
        if(!current())return;
        item.dataset.artifactKind=metadata.kind;
        item.replaceChildren(el('span',`${metadata.kind} · ${metadata.sha256} · ${metadata.size_bytes} bytes`));
        const link=el('button','Verificar y descargar');link.type='button';link.dataset.verifyArtifact=reference.artifact_id;
        link.onclick=async()=>{
          link.disabled=true;
          try{
            const {bytes}=await verifiedArtifact(reference,metadata);
            const blob=new Blob([bytes],{type:metadata.media_type});const url=URL.createObjectURL(blob);
            const anchor=el('a','Descargar artefacto',{href:url,download:`${metadata.kind.replace(/[^a-z0-9.-]/gi,'_')}-${metadata.artifact_id}.json`});item.append(anchor);anchor.click();
            setTimeout(()=>URL.revokeObjectURL(url),1000);
          }catch(error){say(error.code||error.message||'ARTIFACT_DOWNLOAD_FAILED');}finally{link.disabled=false;}
        };
        item.append(link);
        if(['dftlab.admission-receipt','dftlab.finalization-receipt','qraft.runtime-result-observation'].includes(metadata.kind)){
          const {document}=await artifactDocument(reference,metadata);
          if(!current())return;
          if(metadata.kind==='dftlab.admission-receipt')showAdmission(document);
          if(metadata.kind==='dftlab.finalization-receipt'){
            card.append(el('p',`Finalización: ${document.payload.state}; salidas no producidas: ${document.payload.unproduced_outputs.length}.`));
            done=document.payload.state==='PUBLISHED';
          }
          if(metadata.kind==='qraft.runtime-result-observation'){
            const pre=el('pre');pre.dataset.nativeResult='';
            const nativeAttempt=document.attempt||Object.values(document.attempts||{})[0]||null;
            const nativeResult=nativeAttempt?.result||Object.values(document.node_results||{})[0]||null;
            const technical=nativeResult?.technical_validation||null;
            const parser=technical?.parser_summary||{};
            const facts=el('dl');facts.dataset.nativeFacts='';
            if(nativeResult?.execution_state)facts.append(el('dt','Estado técnico'),el('dd',`${nativeResult.execution_state}${technical?.status?` · ${technical.status}`:''}`));
            if(Object.hasOwn(parser,'scf_converged'))facts.append(el('dt','SCF convergido (QRAFT)'),el('dd',String(parser.scf_converged)));
            const energies=[];
            const visit=(value,path='')=>{
              if(!value||typeof value!=='object')return;
              for(const [name,item] of Object.entries(value)){
                const next=path?`${path}.${name}`:name;
                if(/(^|_)(total_)?energy(_ev)?$/i.test(name))energies.push([next,item]);
                if(item&&typeof item==='object')visit(item,next);
              }
            };
            visit(document);
            for(const [name,value] of energies)facts.append(el('dt',`Campo QRAFT ${name}`),el('dd',typeof value==='object'?JSON.stringify(value):String(value)));
            if(facts.childElementCount)card.append(facts);
            card.append(el('p','Ciencia: NOT_ESTABLISHED. Este run comprueba el recorrido numérico; QRAFT no aporta aquí una validación física establecida.'));
            pre.textContent=JSON.stringify(document,null,2);card.append(el('h6','Resultado nativo original · sin reinterpretación'),pre);
          }
        }
      }catch(error){if(current())item.append(el('span',` · ${error.code||error.message||'ARTIFACT_READ_FAILED'}`));}
    };
    const worker=async()=>{while(next<entries.length){const index=next++;await readArtifact(entries[index],artifactList.children[index]);}};
    await Promise.all(Array.from({length:Math.min(12,entries.length)},worker));
    say(done?'Run finalizado y artefactos publicados. Resultado científico: NOT_ESTABLISHED.':terminal?'Run terminal; revisa el recibo de finalización y las salidas.':'Run activo; el estado se actualizará desde la proyección del servidor.');
    return {terminal};
  }

  async function pollRun(runId){
    if(polling)return;polling=true;
    try{
      for(let attempt=0;attempt<240&&current();attempt++){
        const state=await showRun(runId);
        if(state.terminal)break;
        await pause(2500);
      }
    }catch(error){say(error.code||error.message||'No se pudo leer el run.');}
    finally{polling=false;}
  }

  selector.onchange=()=>{
    const next=selector.value;
    if(next!==state.draftId){state.draftId=next;clearDownstream();persist();}
    updateButtons();
  };
  budget.oninput=()=>{state.budgetId=budget.value.trim();delete state.keys.submit;persist();updateButtons();};
  promote.onclick=template;buttons.validate.onclick=validateDraft;buttons.campaign.onclick=createCampaign;
  buttons.plan.onclick=createPlan;buttons.package.onclick=preparePackage;buttons.submit.onclick=submitRun;
  updateButtons();refresh();
  return {element:panel,refresh};
}
