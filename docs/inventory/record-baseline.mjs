// Reproduce T-002 without writing scientific sources or committing build outputs.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argument = process.argv.indexOf('--output');
if (argument < 0 || !process.argv[argument+1]) throw new Error('Usage: node docs/inventory/record-baseline.mjs --output runtime/x1-baseline.json');
const output = path.resolve(root, process.argv[argument+1]);
// Never overwrite source, an ancestor or an existing report.
const runtime = path.join(root,'runtime') + path.sep;
if (!output.startsWith(runtime) || fs.existsSync(output)) throw new Error('Output must be a new report under ignored runtime/');
const sha = f => createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex');
const git = args => {const p=spawnSync('git',args,{cwd:root,encoding:'utf8'}); if(p.status!==0) throw new Error(p.stderr); return p.stdout.trim();};
const run = (label, command, args, cwd=root) => {
  console.log(`Running ${label}`);
  const p=spawnSync(command,args,{cwd,encoding:'utf8',maxBuffer:20*1024*1024,env:{...process.env,REQUIRE_BROWSER:'1'}});
  const text=(p.stdout||'')+(p.stderr||'');
  fs.writeFileSync(output+`.${label}.log`,text);
  if(p.error || p.status!==0) throw new Error(`${label} failed: ${p.error||p.status}; see ${output}.${label}.log`);
  return {command:[command,...args],exitCode:p.status,logSha256:createHash('sha256').update(text).digest('hex')};
};
const npm = args => process.platform==='win32' ? ['cmd.exe',['/d','/s','/c',`npm ${args.join(' ')}`]] : ['npm',args];
fs.mkdirSync(path.dirname(output),{recursive:true});
const inputs=JSON.parse(fs.readFileSync(path.join(root,'docs/inventory/inventory.json'),'utf8')).sourceFiles;
for(const f of inputs) if(sha(f.file)!==f.sha256) throw new Error(`Inventory stale: ${f.file}`);
const report={schemaVersion:1,createdAt:new Date().toISOString(),sourceCommit:git(['rev-parse','HEAD']),sourceTreeDirty:!!git(['status','--porcelain','--untracked-files=no']),environment:{os:os.platform(),release:os.release(),arch:os.arch(),node:process.version,npm:spawnSync(...npm(['--version']),{encoding:'utf8'}).stdout.trim(),python:'Not invoked; Python references have their own uv environment/workflow'},commands:[],artifacts:[],regressions:[]};
try {
  report.commands.push(run('historical-baseline',process.execPath,['scripts/verify-original-baseline.mjs']));
  report.commands.push(run('npm-ci',...npm(['ci']),path.join(root,'app')));
  report.commands.push(run('npm-test',...npm(['test']),path.join(root,'app')));
  report.commands.push(run('inventory',process.execPath,['docs/inventory/audit.mjs']));
  for(const file of ['app/dist/dftlab.html','app/dist/dftlab_artifact.html']) report.artifacts.push({file,bytes:fs.statSync(path.join(root,file)).size,sha256:sha(file),tracked:false});
  for(const f of inputs) if(sha(f.file)!==f.sha256) throw new Error(`Authoritative source changed: ${f.file}`);
  report.authoritativeSourcesUnchanged=true;
  report.success=true;
} catch(error) {report.success=false;report.regressions.push(String(error));process.exitCode=1;}
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
