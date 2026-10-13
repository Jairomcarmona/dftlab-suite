import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {chromium} from 'playwright';

const html=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../dist/dftlab.html');
const raw={policy_id:'qraft.electronic.policy@1',authority:'NUMERICAL_CANDIDATE',
  origin:'PROVISIONAL_DIRECT_SCF',worker_environment_sha256:'a'.repeat(64),
  gap:{status:'GAP',scope:'PATH',gap_eV:.5562},
  groups:[{k_index:0,spin:0,bands:[2,3,4],size:3,weights:{s:-.2,p:3.2}}]};
const browser=await chromium.launch({args:['--enable-unsafe-swiftshader']});
try {
  const page=await browser.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>/^(file|data|blob):/.test(r.request().url())?r.continue():r.abort());
  await page.goto(pathToFileURL(html).href+'#post');
  await page.setInputFiles('input[type=file]',{name:'native<script>.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(raw))});
  const node=page.locator('#native0 pre');await node.waitFor();
  const shown=JSON.parse(await node.textContent());
  assert.deepEqual(shown.native_result,raw);
  assert.equal(shown.authority,'NUMERICAL_CANDIDATE');
  assert.equal(shown.worker_environment_sha256,raw.worker_environment_sha256);
  assert.deepEqual(shown.groups,raw.groups);
  assert.equal(shown.capability,'CONTRACT_TESTED');
  assert.equal(await page.locator('#native0 h2').textContent(),'native<script>.json');
  assert.equal(await page.locator('#native0 script').count(),0);
  assert.deepEqual(errors,[]);
  console.log('Native results browser: 8 assertions PASS');
} finally {await browser.close();}
