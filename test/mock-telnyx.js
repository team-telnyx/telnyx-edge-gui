import http from 'node:http';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

// A small in-memory stand-in for the Telnyx Edge API, shaped like the live
// responses (see lib/edge.js). Each API key gets its own account.

export const KEYS = { KEY_GOOD_0123456789abcdef: 'acct-a', KEY_OTHER_0123456789abcdef: 'acct-b' };

const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

function seed() {
  const fnId = uuid();
  const kvId = uuid();
  const dbId = uuid();
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT, meta TEXT); INSERT INTO notes (body, meta) VALUES ('hello', NULL), ('it''s', '{\"a\":1}'); CREATE INDEX notes_body ON notes(body);");
  return {
    funcs: [
      { record_type: 'compute_func', id: fnId, name: 'hello', status: 'deploy_ok', message: 'Function deployed successfully', created_at: now(), updated_at: now(), invoke_url: 'hello-abc.telnyxcompute.com',
        bindings: [{ record_type: 'compute_binding', binding_id: uuid(), binding_type: 'kv', env_name: 'KV', status: 'ready', kv_id: kvId, func_id: fnId }] },
      { record_type: 'compute_func', id: uuid(), name: 'broken', status: 'deploy_failed', message: 'Build failed', created_at: now(), updated_at: now(), invoke_url: 'broken-abc.telnyxcompute.com', bindings: [] },
    ],
    revisions: { [fnId]: [
      { record_type: 'compute_func_revision', revision_id: 'aaa111', build_status: 'build_ok', deploy_status: 'deploy_ok', active: true, shipped_at: now() },
      { record_type: 'compute_func_revision', revision_id: 'bbb222', build_status: 'build_ok', deploy_status: 'deploy_ok', active: false, shipped_at: now() },
    ] },
    logExports: {},
    kvs: [{ record_type: 'storage_kv', id: kvId, name: 'cache', status: 'provision_ok', created_at: now(), updated_at: now() }],
    kvData: { [kvId]: new Map([['user/1', '{"n":1}'], ['user/2', 'plain text']]) },
    sqldbs: [{ record_type: 'storage_sqldb', id: dbId, name: 'app', status: 'provision_ok', created_at: now(), updated_at: now() }],
    dbs: { [dbId]: db },
    secrets: [{ record_type: 'compute_secret', secret_id: uuid(), secret_name: 'API_TOKEN', created_at: now(), updated_at: now() }],
    secretValues: {},
    bindings: [{ record_type: 'compute_binding', binding_id: uuid(), binding_type: 'telnyx-sdk', env_name: 'TELNYX', status: 'active', created_at: now(), updated_at: now() }],
    domains: [],
    actors: [],
    calls: [],
  };
}

export function startMock() {
  const accounts = Object.fromEntries(Object.values(KEYS).map((a) => [a, seed()]));
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    let raw = '';
    for await (const c of req) raw += c;
    const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); };
    const err = (status, title, detail) => json(status, { errors: [{ code: String(status), title, detail }] });
    const acct = accounts[KEYS[(req.headers.authorization || '').replace(/^Bearer /, '')]];
    if (!acct) return err(401, 'Authentication failed', 'The API key is invalid');
    acct.calls.push({ method: req.method, path: url.pathname, body: raw });
    const body = raw && (req.headers['content-type'] || '').includes('json') ? JSON.parse(raw) : raw;
    const p = url.pathname.split('/').filter(Boolean).map(decodeURIComponent); // v2, area, coll, id, ...
    const page = (items) => {
      const size = +(url.searchParams.get('page[size]') || 20);
      const number = +(url.searchParams.get('page[number]') || 1);
      return json(200, { meta: { total_pages: Math.max(1, Math.ceil(items.length / size)), total_results: items.length, page_number: number, page_size: size }, data: items.slice((number - 1) * size, number * size) });
    };
    const coll = { funcs: acct.funcs, sqldbs: acct.sqldbs, kvs: acct.kvs, secrets: acct.secrets, bindings: acct.bindings, domains: acct.domains, actors: acct.actors }[p[2]];
    const idOf = (x) => x.id || x.secret_id || x.binding_id || x.domain;
    if (!coll) return err(404, 'Resource not found');
    const [, , name, id, sub, subId, subsub] = p;

    if (!id) {
      if (req.method === 'GET') return page(coll);
      if (req.method === 'POST') {
        if (name === 'secrets') {
          const existing = coll.find((s) => s.secret_name === body.secret_name);
          acct.secretValues[body.secret_name] = body.secret_value;
          if (existing) { existing.updated_at = now(); return json(200, { data: existing }); }
          const s = { record_type: 'compute_secret', secret_id: uuid(), secret_name: body.secret_name, created_at: now(), updated_at: now() };
          coll.push(s); return json(201, { data: s });
        }
        if (name === 'domains') {
          const d = { record_type: 'compute_domain', id: uuid(), domain: body.domain, function_id: body.function_id, verification_status: 'pending', verification_token: 'tok-123', created_at: now() };
          coll.push(d); return json(201, { data: d });
        }
        if (name === 'bindings') {
          const b = { record_type: 'compute_binding', binding_id: uuid(), status: 'active', created_at: now(), updated_at: now(), ...body };
          coll.push(b); return json(201, { data: b });
        }
        if (!body.name) return err(422, 'Invalid parameter', 'name is required');
        const rec = { record_type: `x_${name}`, id: uuid(), name: body.name, status: name === 'funcs' ? 'created' : 'provisioning', created_at: now(), updated_at: now(), ...(name === 'funcs' ? { invoke_url: `${body.name}.telnyxcompute.com`, bindings: [] } : {}) };
        coll.push(rec);
        if (name === 'sqldbs') acct.dbs[rec.id] = new DatabaseSync(':memory:');
        if (name === 'kvs') acct.kvData[rec.id] = new Map();
        // Storage provisions after a short delay, like the real thing.
        if (name !== 'funcs') setTimeout(() => { rec.status = 'provision_ok'; }, 120);
        return json(201, { data: rec });
      }
    }
    const item = coll.find((x) => idOf(x) === id);
    if (!item) return err(404, 'Resource not found', `No ${name} ${id}`);

    if (!sub) {
      if (req.method === 'GET') return name === 'secrets' ? json(405) : json(200, { data: item });
      if (req.method === 'PATCH') { Object.assign(item, body, { updated_at: now() }); return json(200, { data: item }); }
      if (req.method === 'DELETE') { coll.splice(coll.indexOf(item), 1); return json(200, { data: item }); }
    }
    if (name === 'funcs') {
      if (sub === 'revisions') return page(acct.revisions[id] || []);
      if (sub === 'metric_aggregates') {
        if (!/\.\d{3}Z$/.test(url.searchParams.get('start_time') || '')) return err(422, 'Invalid query parameter', 'start_time must use UTC millisecond format');
        return json(200, { data: [{ request_count: 42, request_success_rate: 0.95, request_latency_p50_ms: 12.5, cpu_used_cores_avg: 0.01, memory_used_bytes_max: 3e7 }] });
      }
      if (sub === 'logs' && !subId) {
        const inv = url.searchParams.get('type') === 'invocations';
        return json(200, { meta: { has_more: false }, data: inv ? [{ record_type: 'compute_func_invocation_log', timestamp: now(), method: 'GET', path: '/', status_code: 200, duration_ms: 3.2, region: 'us-east-2' }] : [{ record_type: 'compute_func_runtime_log', timestamp: now(), level: 'info', message: 'hi' }] });
      }
      if (sub === 'logs' && subId === 'export') {
        if (req.method === 'GET') return acct.logExports[id] ? json(200, { data: acct.logExports[id] }) : err(404, 'Log export config not found');
        if (req.method === 'PUT') { acct.logExports[id] = body; return json(200, { data: body }); }
        if (req.method === 'DELETE') { delete acct.logExports[id]; return json(204); }
      }
      if (sub === 'actions' && subId === 'reset') { item.status = 'created'; return json(200, { data: item }); }
      if (sub === 'actions' && subId === 'rollback') {
        const revs = acct.revisions[id] || [];
        const target = revs.find((r) => r.revision_id === body.revision_id);
        if (!target) return err(422, 'Invalid revision');
        revs.forEach((r) => { r.active = r === target; });
        return json(200, { data: { from_revision: 'aaa111', to_revision: body.revision_id } });
      }
    }
    if (name === 'sqldbs' && sub === 'actions' && subId === 'query') {
      const db = acct.dbs[id];
      try {
        const stmt = db.prepare(body.sql);
        const params = body.params || [];
        if (stmt.columns().length) return json(200, { data: [{ results: stmt.all(...params), success: true, meta: { rows_read: 1 } }] });
        const r = stmt.run(...params);
        return json(200, { data: [{ results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }] });
      } catch (e) {
        // Multi-statement DDL goes through exec.
        if (/more than one statement|only one statement/i.test(e.message)) { db.exec(body.sql); return json(200, { data: [{ results: [], success: true, meta: {} }] }); }
        return err(400, 'SQL error', e.message);
      }
    }
    if (name === 'kvs' && sub === 'keys') {
      const data = acct.kvData[id];
      if (!subId) {
        const prefix = url.searchParams.get('prefix') || '';
        return json(200, { record_type: 'storage_kv_key', data: [...data.keys()].filter((k) => k.startsWith(prefix)).map((k) => ({ key: k, size_bytes: data.get(k).length, updated_at: now() })) });
      }
      const key = subsub ? `${subId}/${subsub}` : subId;
      if (req.method === 'GET') { if (!data.has(key)) return err(404, 'Key not found'); res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(data.get(key)); }
      if (req.method === 'PUT') { data.set(key, raw); return json(200, { data: { key } }); }
      if (req.method === 'DELETE') { data.delete(key); return json(204); }
    }
    if (name === 'domains' && sub === 'actions' && subId === 'verify') { item.verification_status = 'verified'; return json(200, { data: item }); }
    if (name === 'domains' && sub === 'cert') { item.cert_status = 'issued'; return json(200, { data: item }); }
    if (name === 'bindings' && sub === 'actions' && subId === 'validate') return json(200, { data: { valid: true } });
    return err(404, 'Resource not found');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, accounts, url: `http://127.0.0.1:${server.address().port}` })));
}
