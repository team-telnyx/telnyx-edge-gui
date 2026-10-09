import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMock, KEYS } from './mock-telnyx.js';

const GOOD = 'KEY_GOOD_0123456789abcdef';
const OTHER = 'KEY_OTHER_0123456789abcdef';
let mock, proc, base, dataDir;

before(async () => {
  mock = await startMock();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cp-'));
  const port = 40000 + Math.floor(Math.random() * 20000);
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, ['server.js'], {
    cwd: path.dirname(path.dirname(fileURLToPath(import.meta.url))),
    env: { ...process.env, PORT: String(port), TELNYX_API_BASE: mock.url, EDGE_CP_DATA_DIR: dataDir, EDGE_CP_POLL_MS: '40' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve) => proc.stdout.on('data', (d) => { if (String(d).includes('Control Panel on')) resolve(); }));
});

after(() => { proc?.kill(); mock?.server.close(); fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 }); });

/** A tiny cookie-keeping client. */
function client() {
  let cookie = '';
  let csrf = '';
  const req = async (method, p, body, headers = {}) => {
    const res = await fetch(base + p, {
      method,
      headers: { ...(method !== 'GET' ? { 'X-Panel': '1', 'X-CSRF': csrf } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let data = text;
    try { data = JSON.parse(text); } catch { /* text */ }
    if (data?.csrf) csrf = data.csrf;
    return { status: res.status, data, headers: res.headers };
  };
  return { req, get cookie() { return cookie; } };
}

async function signedIn(key = GOOD) {
  const c = client();
  const r = await c.req('POST', '/auth/login', { apiKey: key, profileName: 'Main' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return c;
}

test('rejects unauthenticated and bad-key access', async () => {
  const c = client();
  assert.equal((await c.req('GET', '/api/functions')).status, 401);
  const bad = await c.req('POST', '/auth/login', { apiKey: 'KEY_WRONG_0123456789abcdef' });
  assert.equal(bad.status, 401);
  assert.match(bad.data.error, /rejected/);
  assert.equal((await c.req('POST', '/auth/login', { apiKey: 'short' })).status, 400);
});

test('sign-in sets an HttpOnly cookie and mutations need the panel + CSRF headers', async () => {
  const c = client();
  const r = await c.req('POST', '/auth/login', { apiKey: GOOD });
  assert.match(r.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.equal(r.data.profiles.length, 1);
  assert.equal(r.data.profiles[0].keyHint, '…cdef');
  assert.ok(!JSON.stringify(r.data).includes(GOOD), 'API key never reaches the browser');
  const noHeader = await fetch(`${base}/api/kvs`, { method: 'POST', headers: { Cookie: c.cookie, 'Content-Type': 'application/json' }, body: '{"name":"x"}' });
  assert.equal(noHeader.status, 403);
  const badCsrf = await fetch(`${base}/api/kvs`, { method: 'POST', headers: { Cookie: c.cookie, 'X-Panel': '1', 'X-CSRF': 'nope', 'Content-Type': 'application/json' }, body: '{"name":"x"}' });
  assert.equal(badCsrf.status, 403);
});

test('vault is encrypted at rest and reopens with the same key', async () => {
  const files = fs.readdirSync(path.join(dataDir, 'vaults'));
  assert.ok(files.length >= 1);
  for (const f of files) assert.ok(!fs.readFileSync(path.join(dataDir, 'vaults', f), 'utf8').includes('KEY_'), 'no plaintext keys on disk');
  const c = await signedIn();
  const me = await c.req('GET', '/auth/me');
  assert.equal(me.data.profiles.filter((p) => p.login).length, 1, 'same vault, no duplicate login profile');
});

test('profiles: add, switch, edit, duplicate, remove', async () => {
  const c = await signedIn();
  const bad = await c.req('POST', '/api/profiles', { name: 'Nope', apiKey: 'KEY_WRONG_0123456789abcdef' });
  assert.equal(bad.status, 400);
  const add = await c.req('POST', '/api/profiles', { name: 'Other', apiKey: OTHER, color: '#e5484d' });
  assert.equal(add.status, 200);
  const other = add.data.profile;
  assert.equal(other.color, '#e5484d');

  const login = add.data.profiles.find((p) => p.login);
  const fnsA = (await c.req('GET', '/api/functions')).data.items;
  await c.req('POST', `/api/profiles/${other.id}/activate`);
  const fnsB = (await c.req('GET', '/api/functions')).data.items;
  assert.notDeepEqual(fnsA.map((f) => f.id), fnsB.map((f) => f.id), 'each profile sees its own account');

  const ren = await c.req('PATCH', `/api/profiles/${other.id}`, { name: 'Staging' });
  assert.equal(ren.data.profiles.find((p) => p.id === other.id).name, 'Staging');
  const dup = await c.req('POST', `/api/profiles/${other.id}/duplicate`, { name: 'Staging 2' });
  assert.equal(dup.data.profiles.length, 3);
  assert.equal((await c.req('DELETE', `/api/profiles/${login.id}`)).status, 400, 'sign-in profile is protected');
  const del = await c.req('DELETE', `/api/profiles/${other.id}`);
  assert.equal(del.data.profiles.length, 2);
  assert.notEqual(del.data.activeId, other.id);
  await c.req('DELETE', `/api/profiles/${dup.data.profile.id}`);
});

test('overview counts objects and flags failures', async () => {
  const c = await signedIn();
  const o = (await c.req('GET', '/api/overview')).data;
  assert.equal(o.counts.functions, 2);
  assert.equal(o.counts.kvs, 1);
  assert.ok(o.attention.some((a) => a.name === 'broken' && a.status === 'deploy_failed'));
});

test('function detail resolves bindings, metrics, revisions, logs; rollback, reset, log export', async () => {
  const c = await signedIn();
  const fn = (await c.req('GET', '/api/functions')).data.items.find((f) => f.name === 'hello');
  const d = (await c.req('GET', `/api/functions/${fn.id}`)).data;
  assert.equal(d.item.bindings[0].target_name, 'cache');
  assert.equal(d.metrics[0].request_count, 42);
  assert.equal(d.revisions.length, 2);
  assert.equal(d.logExport, null);
  const logs = (await c.req('GET', `/api/functions/${fn.id}/logs?type=invocations&range=1h`)).data;
  assert.equal(logs.data[0].status_code, 200);
  assert.equal(d.regions[0].region, 'us-east-2');
  const all = (await c.req('GET', '/api/regions')).data.regions;
  assert.deepEqual(Object.keys(all).sort(), mock.accounts['acct-a'].funcs.map((f) => f.id).sort());
  assert.deepEqual(all[fn.id].map((r) => [r.region, r.requests]), [['us-east-2', 1]]);
  const rb = await c.req('POST', `/api/functions/${fn.id}/actions/rollback`, { revision_id: 'bbb222' });
  assert.equal(rb.status, 200);
  assert.equal((await c.req('POST', `/api/functions/${fn.id}/actions/log-export`, { endpoint: 'http://insecure' })).status, 400);
  const le = await c.req('POST', `/api/functions/${fn.id}/actions/log-export`, { endpoint: 'https://logs.example.com', headers: { Authorization: 'x' } });
  assert.equal(le.status, 200);
  assert.equal((await c.req('GET', `/api/functions/${fn.id}`)).data.logExport.endpoint, 'https://logs.example.com');
  assert.equal((await c.req('POST', `/api/functions/${fn.id}/actions/reset`, {})).status, 200);
});

test('function create, duplicate (copies log export) and delete', async () => {
  const c = await signedIn();
  const fn = (await c.req('GET', '/api/functions')).data.items.find((f) => f.name === 'hello');
  const dup = await c.req('POST', `/api/functions/${fn.id}/duplicate`, { name: 'hello-copy' });
  assert.equal(dup.status, 200, JSON.stringify(dup.data));
  assert.equal(dup.data.item.name, 'hello-copy');
  assert.ok(dup.data.notes.some((n) => /Log export destination copied/.test(n)));
  assert.equal((await c.req('DELETE', `/api/functions/${dup.data.item.id}`)).status, 200);
  assert.ok(!(await c.req('GET', '/api/functions')).data.items.some((f) => f.name === 'hello-copy'), 'list cache is invalidated');
});

test('SQL: tables with row counts, query with params, browse, dump', async () => {
  const c = await signedIn();
  const db = (await c.req('GET', '/api/sqldbs')).data.items[0];
  const d = (await c.req('GET', `/api/sqldbs/${db.id}`)).data;
  assert.deepEqual(d.tables, [{ name: 'notes', rows: 2 }]);
  assert.ok(d.objects.some((o) => o.type === 'index'));
  const q = (await c.req('POST', `/api/sqldbs/${db.id}/query`, { sql: 'SELECT body FROM notes WHERE id = ?', params: [2] })).data;
  assert.deepEqual(q.last.rows, [{ body: "it's" }]);
  const bad = await c.req('POST', `/api/sqldbs/${db.id}/query`, { sql: 'SELEC nope' });
  assert.equal(bad.status, 400);
  const page = (await c.req('GET', `/api/sqldbs/${db.id}/tables/notes?limit=1&offset=1`)).data;
  assert.equal(page.total, 2);
  assert.equal(page.rows.length, 1);
  assert.equal((await c.req('GET', `/api/sqldbs/${db.id}/tables/nope`)).status, 404);
  const dump = await c.req('GET', `/api/sqldbs/${db.id}/dump?name=app`);
  assert.match(dump.headers.get('content-disposition'), /app\.sql/);
  assert.match(dump.data, /INSERT INTO "notes" \("id", "body", "meta"\) VALUES \(2, 'it''s', '\{"a":1\}'\);/);
});

test('SQL duplicate runs as a job and copies schema and rows', async () => {
  const c = await signedIn();
  const db = (await c.req('GET', '/api/sqldbs')).data.items.find((x) => x.name === 'app');
  const r = await c.req('POST', `/api/sqldbs/${db.id}/duplicate`, { name: 'app-copy', withData: true });
  assert.ok(r.data.job);
  let job;
  for (let i = 0; i < 100; i++) {
    job = (await c.req('GET', `/api/jobs/${r.data.job}`)).data;
    if (job.status !== 'running') break;
    await new Promise((res) => setTimeout(res, 50));
  }
  assert.equal(job.status, 'done', JSON.stringify(job));
  const copy = (await c.req('GET', `/api/sqldbs/${job.result.id}`)).data;
  assert.deepEqual(copy.tables, [{ name: 'notes', rows: 2 }]);
  assert.ok(copy.objects.some((o) => o.name === 'notes_body'));
  const other = await signedIn(OTHER);
  assert.equal((await other.req('GET', `/api/jobs/${r.data.job}`)).status, 404, 'jobs are private to their vault');
});

test('KV: list keys, read, write, delete, duplicate', async () => {
  const c = await signedIn();
  const kv = (await c.req('GET', '/api/kvs')).data.items[0];
  const keys = (await c.req('GET', `/api/kvs/${kv.id}/keys?prefix=user/`)).data.keys;
  assert.equal(keys.length, 2);
  assert.equal((await c.req('GET', `/api/kvs/${kv.id}/keys?key=${encodeURIComponent('user/2')}`)).data.value, 'plain text');
  await c.req('PUT', `/api/kvs/${kv.id}/keys`, { key: 'user/3', value: '{"n":3}' });
  assert.equal((await c.req('GET', `/api/kvs/${kv.id}/keys?key=user%2F3`)).data.value, '{"n":3}');
  await c.req('DELETE', `/api/kvs/${kv.id}/keys?key=user%2F3`);
  assert.equal((await c.req('GET', `/api/kvs/${kv.id}/keys`)).data.keys.length, 2);
  const r = await c.req('POST', `/api/kvs/${kv.id}/duplicate`, { name: 'cache-copy' });
  let job;
  for (let i = 0; i < 100; i++) {
    job = (await c.req('GET', `/api/jobs/${r.data.job}`)).data;
    if (job.status !== 'running') break;
    await new Promise((res) => setTimeout(res, 50));
  }
  assert.equal(job.status, 'done', JSON.stringify(job));
  assert.equal((await c.req('GET', `/api/kvs/${job.result.id}/keys`)).data.keys.length, 2);
});

test('secrets: create, update, duplicate, delete; values never returned', async () => {
  const c = await signedIn();
  assert.equal((await c.req('POST', '/api/secrets', { secret_name: '1BAD', secret_value: 'x' })).status, 400);
  const s = (await c.req('POST', '/api/secrets', { secret_name: 'DB_PASS', secret_value: 'hunter2' })).data.item;
  assert.equal(s._name, 'DB_PASS');
  assert.equal((await c.req('PATCH', `/api/secrets/${s._id}`, { secret_value: 'hunter3' })).status, 200);
  assert.equal(mock.accounts['acct-a'].secretValues.DB_PASS, 'hunter3');
  const dup = await c.req('POST', `/api/secrets/${s._id}/duplicate`, { name: 'DB_PASS_2', secret_value: 'v' });
  assert.equal(dup.data.item._name, 'DB_PASS_2');
  const detail = await c.req('GET', `/api/secrets/${s._id}`);
  assert.ok(!JSON.stringify(detail.data).includes('hunter'));
  assert.equal((await c.req('DELETE', `/api/secrets/${s._id}`)).status, 200);
});

test('domains, bindings and the API explorer', async () => {
  const c = await signedIn();
  const fn = (await c.req('GET', '/api/functions')).data.items[0];
  const d = (await c.req('POST', '/api/domains', { domain: 'api.example.com', function_id: fn.id })).data.item;
  assert.equal((await c.req('POST', `/api/domains/${d._id}/actions/verify`, {})).data.result.data.verification_status, 'verified');
  assert.equal((await c.req('POST', `/api/domains/${d._id}/actions/cert`, { cert_pem: 'nope', key_pem: 'nope' })).status, 400);
  const b = (await c.req('GET', '/api/bindings')).data.items[0];
  assert.equal((await c.req('POST', `/api/bindings/${b._id}/actions/validate`, {})).data.result.data.valid, true);
  const x = await c.req('POST', '/api/explorer', { method: 'GET', path: '/v2/compute/funcs?page[size]=1' });
  assert.equal(x.data.status, 200);
  assert.equal(x.data.data.data.length, 1);
  assert.equal((await c.req('POST', '/api/explorer', { method: 'GET', path: '/v2/balance' })).status, 400, 'explorer stays on Edge endpoints');
  assert.equal((await c.req('POST', '/api/explorer', { method: 'GET', path: '/v2/compute/../balance' })).status, 400);
});

test('a revoked profile key is reported without ending the session', async () => {
  const c = await signedIn();
  const add = await c.req('POST', '/api/profiles', { name: 'Temp', apiKey: OTHER });
  await c.req('POST', `/api/profiles/${add.data.profile.id}/activate`);
  delete KEYS[OTHER];
  const r = await c.req('GET', '/api/functions?refresh=1');
  assert.equal(r.status, 424);
  assert.match(r.data.error, /rejected this profile's API key/);
  assert.equal((await c.req('GET', '/auth/me')).status, 200);
  KEYS[OTHER] = 'acct-b';
});

test('logout ends the session; static files and host checks', async () => {
  const c = await signedIn();
  await c.req('POST', '/auth/logout');
  assert.equal((await c.req('GET', '/api/functions')).status, 401);
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await fetch(`${base}/../server.js`)).status, 404);
  // fetch() forces the Host header, so use a raw request for the DNS-rebinding check.
  const status = await new Promise((resolve, reject) => {
    http.get(`${base}/auth/me`, { headers: { Host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(status, 403);
});

test('deleting the vault removes every profile and signs out', async () => {
  const c = await signedIn(OTHER);
  await c.req('POST', '/api/profiles', { name: 'Extra', apiKey: GOOD });
  const second = await signedIn(OTHER);
  assert.equal((await c.req('DELETE', '/auth/vault', undefined, { 'X-CSRF': 'wrong' })).status, 403);
  assert.equal((await c.req('DELETE', '/auth/vault')).status, 200);
  assert.equal((await c.req('GET', '/auth/me')).status, 401);
  assert.equal((await second.req('GET', '/auth/me')).status, 401);
  const fresh = await signedIn(OTHER);
  const me = await fresh.req('GET', '/auth/me');
  assert.deepEqual(me.data.profiles.map((p) => p.name), ['Main']);
});
