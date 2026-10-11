// Build two self-contained HTML variants into dist/ (file:// and offline).
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root=join(dirname(fileURLToPath(import.meta.url)),'..'), src=join(root,'dftlab','static'), out=join(root,'dist');
mkdirSync(out,{recursive:true});
const r=await build({entryPoints:[join(src,'js','main.js')], bundle:true, format:'iife', minify:true, write:false,
  loader:{'.json':'json','.wasm':'binary'}, target:['es2020'], legalComments:'none', external:['node:*'], define:{__DFTLAB_OPERATIVE__:'false'}});
const js=r.outputFiles[0].text;
// app.css = shared tokens and components; css/views/<id>.css = styles of one section only
const viewCss=existsSync(join(src,'css','views'))?readdirSync(join(src,'css','views')).filter(f=>f.endsWith('.css')).sort().map(f=>readFileSync(join(src,'css','views',f),'utf8')):[];
const cssTxt=[readFileSync(join(src,'css','app.css'),'utf8'),...viewCss].join('\n');
let html=readFileSync(join(src,'index.html'),'utf8');
// The portable build uses the existing system-font fallbacks. Do not request
// optional Google fonts/preconnects when opening the delivered HTML offline.
html=html.replace(/<link\b[^>]*\bhref="https:\/\/fonts\.(?:googleapis|gstatic)\.com[^"\n]*"[^>]*>\s*/g,'');
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
// Same sources, ESM splitting and relative asset URLs for the served target.
const operative=join(out,'operative');
mkdirSync(operative,{recursive:true});
const split=await build({entryPoints:[join(src,'js','main.js')],outdir:operative,bundle:true,splitting:true,format:'esm',minify:true,metafile:true,write:false,
  entryNames:'assets/[name]-[hash]',chunkNames:'assets/chunk-[hash]',assetNames:'assets/[name]-[hash]',loader:{'.json':'json','.wasm':'binary'},target:['es2022'],legalComments:'none',external:['node:*'],define:{__DFTLAB_OPERATIVE__:'true'}});
const entry=Object.entries(split.metafile.outputs).find(([,info])=>info.entryPoint?.endsWith('/main.js'))[0];
const entryRelative=relative(operative,join(process.cwd(),entry)).replaceAll('\\','/');
const csp="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'";
let served=readFileSync(join(src,'index.html'),'utf8').replace(/<link\b[^>]*\bhref="https:\/\/fonts\.(?:googleapis|gstatic)\.com[^"\n]*"[^>]*>\s*/g,'');
served=served.replace('<link rel="stylesheet" href="css/app.css">','<link rel="stylesheet" href="assets/app.css">')
  .replace('<script type="module" src="js/main.js"></script>',`<script type="module" src="${entryRelative}"></script>`)
  .replace('<title>DFT Lab</title>',`<title>DFT Lab</title><meta http-equiv="Content-Security-Policy" content="${csp}">`);
const outputs=split.outputFiles.map(file=>({path:relative(operative,file.path).replaceAll('\\','/'),bytes:file.contents}));
outputs.push({path:'assets/app.css',bytes:Buffer.from(cssTxt)},{path:'index.html',bytes:Buffer.from(served)});
const manifest={format:'dftlab.operative-assets',version:1,api_version:'0.1.0',entry:entryRelative,files:outputs.map(file=>({path:file.path,size_bytes:file.bytes.length,sha256:createHash('sha256').update(file.bytes).digest('hex')})).sort((a,b)=>a.path.localeCompare(b.path))};
for(const file of outputs){const target=join(operative,file.path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,file.bytes);}
writeFileSync(join(operative,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log('dist/operative',outputs.length,'assets; API version',manifest.api_version);
