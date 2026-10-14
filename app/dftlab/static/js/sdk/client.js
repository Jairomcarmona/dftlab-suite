import {validate, verifyEnvelope, validateApi} from './contracts.js';

// One SDK per shell/session. Tokens stay in this closure, never in a store,
// URL, log or browser persistence. The page and API share the serving origin.
export function createClient({baseUrl=new URL('./api/v1/',location.href),fetcher=fetch,origin=location.origin}={}){
  const base=new URL(baseUrl);
  if(base.origin!==origin||!base.pathname.endsWith('/api/v1/')||base.search||base.hash||base.username||base.password)throw new Error('API base must share the operative origin');
  let csrf=null, principal=null;
  async function request(path,{method='GET',body,signal,headers={}}={}){
    if(!/^[a-z][a-z0-9%._/-]*(?:\?[a-z0-9%=&_.:-]+)?$/i.test(path))throw new Error('Invalid API path');
    const target=new URL(path,base);
    if(!target.pathname.startsWith(base.pathname))throw new Error('API path escapes its version');
    const fields={Accept:'application/json',...headers};
    if(method!=='GET'&&method!=='HEAD'&&!(method==='POST'&&path==='session')){
      if(!csrf)throw new Error('A fresh local access code is required for editing');
      fields['X-CSRF-Token']=csrf;
    }
    if(body!==undefined){fields['Content-Type']='application/json';body=JSON.stringify(body);}
    const response=await fetcher(target,{method,body,signal,headers:fields,credentials:'same-origin',cache:'no-store',redirect:'error'});
    const document=response.status===204?null:await response.json();
    if(!response.ok){
      validate('problem',document);
      const error=new Error(document.code);error.code=document.code;error.status=response.status;error.operationId=document.operation_id??null;error.document=document;throw error;
    }
    return document;
  }
  const envelope=async(name,value)=>{validate(name,value);await verifyEnvelope(name,value);return value;};
  async function allPages(path,operation,filters={},options={}){
    const items=[],seen=new Set();let cursor=null,last=null;
    for(let page=0;page<1000;page++){
      const query=new URLSearchParams({limit:'200',...filters});
      if(cursor)query.set('cursor',cursor);
      last=validateApi(operation,200,await request(`${path}?${query}`,options));
      items.push(...last.items);
      cursor=last.next_cursor;
      if(!cursor)return {...last,items};
      if(seen.has(cursor))throw new Error('API pagination cursor repeated');
      seen.add(cursor);
    }
    throw new Error('API pagination exceeded the local page limit');
  }
  async function allEventPages(runId,options={}){
    const events=[],seen=new Set();let cursor=null,last=null;
    for(let page=0;page<1000;page++){
      const query=new URLSearchParams({limit:'500'});if(cursor)query.set('after',cursor);
      last=validateApi('listRunEvents',200,await request(`runs/${encodeURIComponent(runId)}/events?${query}`,options));
      events.push(...last.events);
      if(!last.events.length||last.next_cursor===cursor)return {...last,events};
      cursor=last.next_cursor;
      if(!cursor||seen.has(cursor))throw new Error('API event cursor repeated');
      seen.add(cursor);
    }
    throw new Error('API event pagination exceeded the local page limit');
  }
  return Object.freeze({
    get principalId(){return principal;},get canEdit(){return csrf!==null;},
    async session(options){
      csrf=null;principal=null;
      const session=validateApi('getSession',200,await request('session',options));
      principal=session.principal_id;csrf=session.csrf_token;
      return {principalId:principal,expiresAt:session.expires_at};
    },
    async login(token,{signal}={}){
      if(typeof token!=='string'||token.length<32||token.length>256)throw new Error('Invalid access code');
      csrf=null;principal=null;
      const session=await request('session',{method:'POST',body:{bootstrap_token:token},signal});
      validateApi('createSession',201,session);
      principal=session.principal_id;csrf=session.csrf_token;return {principalId:principal,expiresAt:session.expires_at};
    },
    async handshake({signal}={}){
      const health=await request('health',{signal});
      validateApi('getHealth',200,health);
      if(!/^0\.1\.\d+$/.test(health.api_version))throw new Error('Unsupported API version');
      const capabilities=await request('capabilities',{signal});
      validateApi('listCapabilities',200,capabilities);
      for(const item of capabilities)await envelope('capability-descriptor',item);
      return Object.freeze({apiVersion:health.api_version,capabilities});
    },
    async projects(options){return validateApi('listProjects',200,await request('projects',options));},
    async project(id,options){return validateApi('getProject',200,await request('projects/'+encodeURIComponent(id),options));},
    async createProject(name,key,options={}){const body=validateApi('createProject','request',{name,idempotency_key:key});return validateApi('createProject',201,await request('projects',{...options,method:'POST',body}));},
    async operation(id,options){return envelope('operation-record',await request('operations/'+encodeURIComponent(id),options));},
    async action(name,path,body,options={}){
      validateApi(name,'request',body);
      const value=await request(path,{...options,method:'POST',body});
      let failure;
      for(const status of [202,200])try{return await envelope('operation-record',validateApi(name,status,value));}catch(error){failure=error;}
      throw failure;
    },
    async campaigns(projectId,options){return allPages('projects/'+encodeURIComponent(projectId)+'/campaigns','listCampaigns',{},options);},
    async campaign(id,options){return envelope('campaign',validateApi('getCampaign',200,await request('campaigns/'+encodeURIComponent(id),options)));},
    async plans(campaignId,options){return allPages('campaigns/'+encodeURIComponent(campaignId)+'/plans','listPlans',{},options);},
    async plan(id,options){return envelope('plan',validateApi('getPlan',200,await request('plans/'+encodeURIComponent(id),options)));},
    async validationReceipt(id,options){return envelope('validation-receipt',validateApi('getValidationReceipt',200,await request('validation-receipts/'+encodeURIComponent(id),options)));},
    async runs(projectId,options){return allPages('projects/'+encodeURIComponent(projectId)+'/runs','listRuns',{},options);},
    async run(id,options){return envelope('run-projection',validateApi('getRun',200,await request('runs/'+encodeURIComponent(id),options)));},
    async runEvents(id,options){return allEventPages(id,options);},
    async operations(projectId,filters={},options={}){return allPages('projects/'+encodeURIComponent(projectId)+'/operations','listOperations',filters,options);},
    async artifact(id,options){return envelope('artifact-record',validateApi('getArtifact',200,await request('artifacts/'+encodeURIComponent(id),options)));},
    async artifactContent(id,options={}){
      const target=new URL('artifacts/'+encodeURIComponent(id)+'/content',base);
      const response=await fetcher(target,{signal:options.signal,headers:{Accept:'application/octet-stream'},credentials:'same-origin',cache:'no-store',redirect:'error'});
      if(!response.ok){const document=await response.json();validate('problem',document);const error=new Error(document.code);error.code=document.code;error.status=response.status;throw error;}
      return new Uint8Array(await response.arrayBuffer());
    },
    async drafts(projectId,options){
      const values=validateApi('listDrafts',200,await request('projects/'+encodeURIComponent(projectId)+'/drafts',options));
      for(const item of values)await envelope('draft',item);return values;
    },
    async draft(id,options){return bundle(await request('drafts/'+encodeURIComponent(id),options));},
    async createDraft(projectId,body,options={}){
      validateApi('createDraft','request',body);
      return bundle(await request('projects/'+encodeURIComponent(projectId)+'/drafts',{...options,method:'POST',body}));
    },
    async reviseDraft(id,body,options={}){
      validateApi('reviseDraft','request',body);
      return bundle(await request('drafts/'+encodeURIComponent(id)+'/revisions',{...options,method:'POST',body}));
    },
    async logout(options){try{return await request('session',{...options,method:'DELETE'});}finally{csrf=null;principal=null;}},
  });
  async function bundle(value){
    validateApi('getDraft',200,value);
    await envelope('draft',value.draft);await envelope('structure-revision',value.structure);
    if(value.intent)for(const [key,name] of [['run_intent','run-intent'],['physical_model','physical-model'],['numerical_policy','numerical-policy']])await envelope(name,value.intent[key]);
    return value;
  }
}
