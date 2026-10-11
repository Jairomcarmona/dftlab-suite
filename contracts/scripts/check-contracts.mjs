// Structural checks for contracts/ with no dependencies (runs in scripts/verify.mjs on Windows and Linux).
// Full JSON Schema validation of fixtures: contracts/scripts/validate_fixtures.py (and X5 validators).
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://dftlab.invalid/contracts/schemas/';
const failures = [];
const fail = (msg) => failures.push(msg);
const rel = (p) => path.relative(root, p).split(path.sep).join('/');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const docs = new Map();
for (const file of walk(root).filter((p) => p.endsWith('.json'))) {
  try { docs.set(rel(file), JSON.parse(readFileSync(file, 'utf8'))); } catch (e) { fail(`${rel(file)}: ${e.message}`); }
}
const doc = (p) => docs.get(p);

export function jcs(v) {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('non-finite number');
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(jcs).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${jcs(v[k])}`).join(',')}}`;
}
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

function pointer(target, ptr) {
  let node = target;
  for (const raw of ptr.split('/').slice(1)) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (node === null || typeof node !== 'object' || !(key in node)) return undefined;
    node = node[key];
  }
  return node;
}

function checkRefs(file, node) {
  if (Array.isArray(node)) return node.forEach((n) => checkRefs(file, n));
  if (node === null || typeof node !== 'object') return;
  if (typeof node.$ref === 'string') {
    const [target, frag = ''] = node.$ref.split('#');
    const targetFile = target ? path.posix.normalize(path.posix.join(path.posix.dirname(file), target)) : file;
    const targetDoc = doc(targetFile);
    if (!targetDoc) fail(`${file}: $ref ${node.$ref} -> missing ${targetFile}`);
    else if (frag && pointer(targetDoc, frag) === undefined) fail(`${file}: $ref ${node.$ref} -> missing pointer`);
  }
  Object.values(node).forEach((n) => checkRefs(file, n));
}

// 1. Schemas
const schemaFiles = [...docs.keys()].filter((p) => p.startsWith('schemas/'));
for (const file of schemaFiles) {
  const s = doc(file);
  const name = path.posix.basename(file, '.schema.json');
  if (s.$schema !== 'https://json-schema.org/draft/2020-12/schema') fail(`${file}: $schema must be 2020-12`);
  if (s.$id !== BASE + path.posix.basename(file)) fail(`${file}: $id must be ${BASE}${path.posix.basename(file)}`);
  if (s.$ref === 'envelope.schema.json' && s.properties?.schema_id?.const !== `dftlab.${name}`) fail(`${file}: schema_id const must be dftlab.${name}`);
  checkRefs(file, s);
}

// 2. Fixtures manifest
const manifest = doc('fixtures/manifest.json')?.fixtures ?? [];
const listed = new Set();
const coverage = new Map();
for (const entry of manifest) {
  listed.add(entry.path);
  if (!doc(entry.path)) fail(`manifest: missing ${entry.path}`);
  if (!doc(`schemas/${entry.schema}`)) fail(`manifest: unknown schema ${entry.schema}`);
  if (!['valid', 'invalid'].includes(entry.expect) || !entry.rule) fail(`manifest: bad entry ${entry.path}`);
  const c = coverage.get(entry.schema) ?? { valid: 0, invalid: 0 };
  c[entry.expect] += 1;
  coverage.set(entry.schema, c);
  const fixture = doc(entry.path);
  if (entry.expect === 'valid' && fixture) {
    (function safe(n, at) {
      if (typeof n === 'number' && Number.isInteger(n) && !Number.isSafeInteger(n)) fail(`${entry.path}${at}: integer outside JS safe range`);
      if (n && typeof n === 'object') Object.entries(n).forEach(([k, v]) => safe(v, `${at}/${k}`));
    })(fixture, '');
    if (fixture.integrity?.status === 'VERIFIED') {
      const { integrity, ...body } = fixture;
      if (sha256(jcs(body)) !== integrity.digest) fail(`${entry.path}: integrity digest does not match JCS`);
    }
  }
}
for (const file of [...docs.keys()].filter((p) => /^fixtures\/[^/]+\/(valid|invalid)\//.test(p))) {
  if (!listed.has(file)) fail(`${file}: fixture not listed in manifest`);
}
for (const file of schemaFiles.filter((f) => f !== 'schemas/defs.schema.json')) {
  const c = coverage.get(path.posix.basename(file)) ?? { valid: 0, invalid: 0 };
  if (!c.valid || !c.invalid) fail(`${file}: needs at least one valid and one invalid fixture`);
}

// 3. Canonicalization and native digests
const inputs = doc('fixtures/canonicalization/inputs.json') ?? [];
const expected = doc('fixtures/canonicalization/expected.json') ?? {};
for (const { name, input } of inputs) {
  const canonical = jcs(input);
  const want = expected[name];
  if (!want || want.canonical !== canonical || want.sha256 !== sha256(canonical)) fail(`canonicalization ${name}: expected ${JSON.stringify({ canonical, sha256: sha256(canonical) })}`);
}
const native = doc('fixtures/native-digests/two-algorithms.json');
if (native) {
  const compact = jcs(native.document);
  const ascii = compact.replace(/[\u0080-￿]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
  if (sha256(compact) !== native['qraft.content-sha256-v1']) fail('native-digests: qraft digest mismatch');
  if (sha256(ascii) !== native['hubbardflow.plan-digest-v1']) fail('native-digests: hubbardflow digest mismatch');
  if (compact === ascii) fail('native-digests: fixture must contain non-ASCII text');
}

// 4. OpenAPI
const api = doc('openapi/dftlab-api.v1.json');
const actions = new Set(doc('schemas/operation-request.schema.json')?.properties?.action?.enum ?? []);
const opIds = new Set();
if (!api?.openapi?.startsWith('3.1.')) fail('openapi: must be OpenAPI 3.1');
checkRefs('openapi/dftlab-api.v1.json', api ?? {});
for (const [route, item] of Object.entries(api?.paths ?? {})) {
  for (const [method, op] of Object.entries(item)) {
    if (opIds.has(op.operationId)) fail(`openapi: duplicate operationId ${op.operationId}`);
    opIds.add(op.operationId);
    const body = op.requestBody?.content?.['application/json']?.schema?.$ref;
    if (body === '../schemas/operation-request.schema.json' && !actions.has(op['x-dftlab-action'])) fail(`openapi: ${method} ${route} lacks a known x-dftlab-action`);
    if (method !== 'get' && op.security?.length && !op.security.some((s) => 'csrf' in s)) fail(`openapi: ${method} ${route} mutation without CSRF`);
    for (const [status, resp] of Object.entries(op.responses ?? {})) {
      if (Number(status) >= 400 && !resp.$ref?.startsWith('#/components/responses/P')) fail(`openapi: ${method} ${route} ${status} must use Problem`);
    }
  }
}
const codeStatuses = new Set(Object.values(doc('errors/error-codes.json')?.codes ?? {}).map((c) => String(c.status)));
for (const key of Object.keys(api?.components?.responses ?? {})) {
  if (!codeStatuses.has(key.slice(1))) fail(`errors: no error code for HTTP ${key.slice(1)}`);
}

// 5. Transitions and vocabularies
const tr = doc('transitions/operation-transitions.json');
const recordStates = doc('schemas/operation-record.schema.json')?.$defs?.payload?.properties?.state?.enum ?? [];
if (tr) {
  if (jcs(tr.states) !== jcs(recordStates)) fail('transitions: states differ from OperationRecord.state');
  for (const t of tr.transitions) {
    if (!tr.states.includes(t.from) || !tr.states.includes(t.to)) fail(`transitions: unknown state in ${t.from}->${t.to}`);
    if (tr.terminal.includes(t.from)) fail(`transitions: terminal state ${t.from} has an exit`);
  }
  for (const s of tr.states.filter((x) => !tr.terminal.includes(x))) {
    if (!tr.transitions.some((t) => t.from === s)) fail(`transitions: ${s} has no exit`);
  }
}
const passport = doc('schemas/defs.schema.json')?.$defs?.passport_state?.enum ?? [];
const proj = doc('vocabularies/native-status-projection.json');
if (proj?.default_projection !== 'NOT_ESTABLISHED') fail('vocabularies: default projection must be NOT_ESTABLISHED');
for (const [vocab, v] of Object.entries(proj?.vocabularies ?? {})) {
  for (const [value, target] of Object.entries(v.projection)) {
    if (!passport.includes(target)) fail(`vocabularies: ${vocab}.${value} -> ${target} is not a passport state`);
  }
}

for (const f of failures) console.error(`FAIL ${f}`);
console.log(`contracts: ${schemaFiles.length} schemas, ${manifest.length} fixtures, ${opIds.size} API operations; ${failures.length} failures.`);
if (failures.length) process.exit(1);
