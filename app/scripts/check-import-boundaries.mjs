import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../dftlab/static/js');
export function checkBoundary(area,source){
  const imports=[...source.matchAll(/(?:import\s*(?:[^;'"()]*?\sfrom\s*)?|export\s+[^;'"()]*?\sfrom\s*|import\s*\()\s*['"]([^'"]+)['"]/g)].map(m=>m[1]);
  if(area==='learn'&&imports.some(name=>/sdk\/client|\/remote\/|\/execution\/|\/application\/operative/.test(name)))throw new Error('Learning cannot import execution transport');
  if(area==='pure'&&(imports.some(name=>/\/views\/|\/application\/|sdk\/client|core\/(ui|chart|three-view)/.test(name))||/\b(?:document|window)\s*\./.test(source)))throw new Error('Scientific module cannot import presentation/transport or access DOM');
  if(area==='view'&&(/\b(?:WebSocket|EventSource)\s*\(/.test(source)||imports.some(name=>/ssh|scheduler|sdk\/client/.test(name))))throw new Error('Views must consume frontend application cases');
  return imports;
}
assert.throws(()=>checkBoundary('learn',"import {createClient} from '../sdk/client.js'"));
assert.throws(()=>checkBoundary('pure',"const node=document.createElement('div')"));
assert.throws(()=>checkBoundary('view',"new WebSocket('ws://example')"));
function walk(file,area,visited=new Set()){
  if(visited.has(file))return;visited.add(file);
  const imports=checkBoundary(area,fs.readFileSync(file,'utf8'));
  for(const name of imports){
    if(!name.startsWith('.')||!name.endsWith('.js'))continue;
    const target=path.resolve(path.dirname(file),name);
    if(target.startsWith(root+path.sep)&&fs.existsSync(target))walk(target,area,visited);
  }
}
for(const directory of ['learn','siesta','crystal','physics','views']){
  for(const name of fs.readdirSync(path.join(root,directory)).filter(n=>n.endsWith('.js'))){
    const area=directory==='learn'?'learn':directory==='views'?'view':'pure';
    const source=fs.readFileSync(path.join(root,directory,name),'utf8');checkBoundary(area,source);
    if(area!=='view')walk(path.join(root,directory,name),area);
    // Existing learning presentations also cannot import the command SDK.
    if(directory==='views'&&!['estructura.js','calc.js','postproc.js','registry.js'].includes(name))walk(path.join(root,directory,name),'learn');
  }
}
console.log('Import boundaries and deliberate forbidden examples passed.');
