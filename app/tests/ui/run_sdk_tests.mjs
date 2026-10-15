import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createClient} from '../../dftlab/static/js/sdk/client.js';
import {promoteStructure} from '../../dftlab/static/js/learn/promote.js';
import {createViewScope,mountView} from '../../dftlab/static/js/core/lifecycle.js';

const origin='http://127.0.0.1:12345',baseUrl=origin+'/lab/api/v1/';
const calls=[];
const fetcher=async(url,options)=>{
  calls.push({url:String(url),options});
  const body=String(url).endsWith('/session')?{principal_id:'usr-alice',csrf_token:'c'.repeat(48),expires_at:'2026-10-11T05:00:00Z'}:String(url).endsWith('/health')?{status:'OK',api_version:'0.1.1'}:[];
  return {ok:true,status:options.method==='DELETE'?204:201,json:async()=>body};
};
assert.throws(()=>createClient({baseUrl:'https://elsewhere/api/v1/',origin,fetcher}));
const client=createClient({baseUrl,origin,fetcher});
await assert.rejects(()=>client.createProject('Si',crypto.randomUUID()),/fresh/);
assert.equal(calls.length,0);
await client.login('b'.repeat(48));await client.handshake();await client.logout();
assert.equal(calls[0].options.headers['X-CSRF-Token'],undefined);
assert.equal(JSON.parse(calls[0].options.body).bootstrap_token,'b'.repeat(48));
assert.equal(calls.at(-1).options.headers['X-CSRF-Token'],'c'.repeat(48));
assert.ok(calls.every(c=>c.url.startsWith(baseUrl)&&!c.url.includes('bbbb')&&c.options.credentials==='same-origin'));
assert.equal(client.canEdit,false);assert.equal(client.principalId,null);
const pageCalls=[];const pagedClient=createClient({baseUrl,origin,fetcher:async(url)=>{
  const target=new URL(url);pageCalls.push(target);
  const cursor=target.searchParams.get('cursor');
  return {ok:true,status:200,json:async()=>target.pathname.endsWith('/events')
    ?{events:[],next_cursor:'run-real:0'}
    :{items:[],next_cursor:cursor?null:'page-next'}};
}});
const campaigns=await pagedClient.campaigns('prj-real');
assert.deepEqual(campaigns.items,[]);assert.equal(campaigns.next_cursor,null);
assert.deepEqual(pageCalls.slice(0,2).map(url=>url.searchParams.get('cursor')),[null,'page-next']);
const events=await pagedClient.runEvents('run-real');
assert.deepEqual(events.events,[]);assert.equal(events.next_cursor,'run-real:0');
assert.equal(pageCalls[2].searchParams.get('after'),null);
assert.equal(typeof pagedClient.validationReceipt,'function');
const fixture=JSON.parse(fs.readFileSync(new URL('../../../contracts/fixtures/structure-revision/valid/si-diamond.json',import.meta.url)));
const original=JSON.stringify(fixture);let submission=null;
const first=await promoteStructure({structure:fixture,projectId:'prj-real',learningDatasetId:'ld-si',title:'Silicio',key:'promotion-key-001',createDraft:async(project,body)=>{submission={project,body};return 'server-bundle';}});
assert.equal(first,'server-bundle');assert.equal(submission.project,'prj-real');
assert.equal(submission.body.purpose,'EXPLORATORY');assert.equal(submission.body.intent,null);
assert.equal(submission.body.structure.structure_id,undefined);
assert.equal(submission.body.structure.revision,undefined);
assert.equal(JSON.stringify(fixture),original);
assert.deepEqual(submission.body.structure.sites,fixture.payload.sites);
assert.equal(calls.length,4,'Promotion uses only the injected application command');
await client.session();assert.equal(client.canEdit,true);assert.equal(client.principalId,'usr-alice');
assert.equal(calls.at(-1).options.method,'GET');assert.equal(calls.at(-1).options.headers['X-CSRF-Token'],undefined);
let release,mounted=0;
const scope=createViewScope();const mounting=mountView({load:()=>new Promise(resolve=>{release=resolve;})},{},scope);
scope.dispose();release({mount:()=>{mounted++;}});await mounting;assert.equal(mounted,0,'Late lazy module cannot mount resources');
console.log('SDK origin/CSRF/bootstrap, promotion isolation and stale lazy import passed.');
