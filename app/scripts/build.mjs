// Build DFT Lab into dist/: a single self-contained HTML (works from file:// and offline) plus the multi-file version.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=join(dirname(fileURLToPath(import.meta.url)),'..'), src=join(root,'dftlab','static'), out=join(root,'dist');
mkdirSync(out,{recursive:true});
const nodePaths=[];
let esb; try{ esb=await import('esbuild'); }catch(e){ const alt=process.env.DFTLAB_NODE_MODULES||'/opt/run/tools/node_modules'; esb=await import(join(alt,'esbuild','lib','main.js')); }
const build=esb.build||esb.default.build;
const r=await build({entryPoints:[join(src,'js','main.js')], bundle:true, format:'iife', minify:true, write:false, nodePaths,
  loader:{'.json':'json','.wasm':'binary'}, target:['es2020'], legalComments:'none', external:['node:*']});
const js=r.outputFiles[0].text;
// app.css = shared tokens and components; css/views/<id>.css = styles of one section only
const viewCss=existsSync(join(src,'css','views'))?readdirSync(join(src,'css','views')).filter(f=>f.endsWith('.css')).sort().map(f=>readFileSync(join(src,'css','views',f),'utf8')):[];
const cssTxt=[readFileSync(join(src,'css','app.css'),'utf8'),...viewCss].join('\n');
let html=readFileSync(join(src,'index.html'),'utf8');
html=html.replace('<link rel="stylesheet" href="css/app.css">',()=>`<style>${cssTxt}</style>`)
         .replace('<script type="module" src="js/main.js"></script>',()=>`<script>${js.replace(/<\/script/g,'<\\/script')}</script>`);
writeFileSync(join(out,'dftlab.html'),html);
// artifact variant: no doctype/html/head/body wrappers
// (las sustituciones no tocan el JS: /<meta[^>]*>/ borraba '<metalnessmap_fragment>' de los shaders de three.js)
const iS=html.indexOf('<script>'), iE=html.lastIndexOf('</script>')+9;
const strip=t=>t.replace(/^[\s\S]*?<head>/,'').replace('</head>','').replace(/<body>|<\/body>|<\/html>/g,'').replace(/<meta[^>]*>/g,'');
const body=strip(html.slice(0,iS))+html.slice(iS,iE)+strip(html.slice(iE));
writeFileSync(join(out,'dftlab_artifact.html'),body);
console.log('dist/dftlab.html', (html.length/1e6).toFixed(2),'MB');
