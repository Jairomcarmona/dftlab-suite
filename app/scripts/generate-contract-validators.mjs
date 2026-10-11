// Compile authoritative schemas to static ESM. Runtime validation needs no eval,
// network or schema compilation, including with the operational CSP.
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import standaloneCode from 'ajv/dist/standalone/index.js';
import {build} from 'esbuild';
import {readFileSync, readdirSync, writeFileSync, mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
const root=join(dirname(fileURLToPath(import.meta.url)),'../..');
const ajv=new Ajv2020({strict:false,strictNumbers:true,allErrors:true,code:{source:true,esm:true}});
addFormats(ajv);
const exports={};
for(const name of readdirSync(join(root,'contracts/schemas')).filter(n=>n.endsWith('.schema.json')).sort()){
  const schema=JSON.parse(readFileSync(join(root,'contracts/schemas',name),'utf8'));
  ajv.addSchema(schema);
  exports[name.replace('.schema.json','').replaceAll('-','_')]=schema.$id;
}
const apiUri='https://dftlab.invalid/contracts/openapi/dftlab-api.v1.json';
const api=JSON.parse(readFileSync(join(root,'contracts/openapi/dftlab-api.v1.json'),'utf8'));
ajv.addSchema({...api,$id:apiUri});
const pointer=s=>s.replaceAll('~','~0').replaceAll('/','~1');
for(const [path,methods]of Object.entries(api.paths))for(const [method,operation]of Object.entries(methods)){
  if(!operation.operationId)continue;
  const prefix='/paths/'+pointer(path)+'/'+method;
  if(operation.requestBody?.content?.['application/json'])exports['api_'+operation.operationId+'_request']=apiUri+'#'+prefix+'/requestBody/content/application~1json/schema';
  for(const [status,response]of Object.entries(operation.responses)){
    const schema=response.content?.['application/json']?.schema;
    if(schema)exports['api_'+operation.operationId+'_'+status]=apiUri+'#'+prefix+'/responses/'+status+'/content/application~1json/schema';
  }
}
const generated=standaloneCode(ajv,exports);
const result=await build({stdin:{contents:generated,resolveDir:join(root,'app'),sourcefile:'contracts-standalone.js'},bundle:true,format:'esm',write:false,minify:true,target:'es2020',legalComments:'none'});
const bytes='// Generated from contracts/schemas by generate-contract-validators.mjs. Do not edit.\n'+result.outputFiles[0].text;
const output=join(root,'app/dftlab/static/js/sdk/validators.generated.js');
if(process.argv.includes('--check')){
  if(readFileSync(output,'utf8')!==bytes)throw new Error('Generated validators are stale; run npm run contracts:generate');
}else{
  mkdirSync(dirname(output),{recursive:true});writeFileSync(output,bytes);
}
console.log(`Static contract validators: ${Object.keys(exports).length} schemas/API documents`);
