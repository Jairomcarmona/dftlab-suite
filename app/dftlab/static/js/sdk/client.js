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
      const error=new Error(document.code);error.code=document.code;error.status=response.status;throw error;
    }
    return document;
  }
  const envelope=async(name,value)=>{validate(name,value);await verifyEnvelope(name,value);return value;};
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
    async createProject(name,key,options={}){const body=validateApi('createProject','request',{name,idempotency_key:key});return validateApi('createProject',201,await request('projects',{...options,method:'POST',body}));},
    async operation(id,options){return envelope('operation-record',await request('operations/'+encodeURIComponent(id),options));},
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
