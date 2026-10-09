import crypto from 'node:crypto';
import { call, listAll, TelnyxError } from './telnyx.js';

// Telnyx Edge Compute resources, as seen through one API key.
// List/detail endpoints were checked against the live API; write endpoints follow
// the request shapes the telnyx-edge CLI (v0.5.x) sends. Any mismatch surfaces the
// Telnyx error verbatim, and the API explorer can always send a raw request.

const bad = (status, message) => Object.assign(new Error(message), { status });

export const KINDS = {
  functions: { path: '/v2/compute/funcs', label: 'Functions', id: (x) => x.id, name: (x) => x.name },
  sqldbs: { path: '/v2/storage/sqldbs', label: 'SQL databases', id: (x) => x.id, name: (x) => x.name },
  kvs: { path: '/v2/storage/kvs', label: 'KV namespaces', id: (x) => x.id, name: (x) => x.name },
  secrets: { path: '/v2/compute/secrets', label: 'Secrets', id: (x) => x.secret_id || x.id, name: (x) => x.secret_name || x.name },
  bindings: { path: '/v2/compute/bindings', label: 'API key bindings', id: (x) => x.binding_id || x.id, name: (x) => x.env_name || x.name },
  domains: { path: '/v2/compute/domains', label: 'Custom domains', id: (x) => x.id || x.domain || x.hostname, name: (x) => x.domain || x.hostname || x.id },
  actors: { path: '/v2/compute/actors', label: 'Actors', id: (x) => x.id || x.actor_type || x.name, name: (x) => x.actor_type || x.name || x.id, query: { sort: '-created_at' } },
};

export function kind(name) {
  const k = KINDS[name];
  if (!k) throw bad(404, `Unknown object type: ${name}`);
  return k;
}

export function checkId(id) {
  if (typeof id !== 'string' || !/^[\w.:@-]{1,200}$/.test(id)) throw bad(400, 'Invalid id');
  return id;
}

const norm = (k, x) => ({ ...x, _id: k.id(x), _name: k.name(x) });
const enc = encodeURIComponent;

// ---------- list cache (per profile, 15 s, dropped on any write) ----------

const cache = new Map();
const TTL = 15_000;

export function invalidate(profileId) {
  for (const key of cache.keys()) if (key.startsWith(`${profileId}:`)) cache.delete(key);
  for (const key of regionCache.keys()) if (key.startsWith(`${profileId}:`)) regionCache.delete(key);
}

export async function list(profile, kindName, { force = false } = {}) {
  const k = kind(kindName);
  const key = `${profile.id}:${kindName}`;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < TTL) return hit.items;
  const items = (await listAll(profile.apiKey, k.path, { query: k.query })).map((x) => norm(k, x));
  cache.set(key, { at: Date.now(), items });
  return items;
}

async function settle(promise) {
  try { return { ok: true, value: await promise }; } catch (e) { return { ok: false, error: e.message, status: e.status }; }
}

const ATTENTION = /fail|error|delete_failed|deploy_failed|provision_failed/i;

export async function overview(profile, { force = false } = {}) {
  const names = Object.keys(KINDS);
  const results = await Promise.all(names.map((n) => settle(list(profile, n, { force }))));
  const out = { counts: {}, errors: {}, attention: [], recent: [], statuses: {} };
  names.forEach((n, i) => {
    const r = results[i];
    if (!r.ok) { out.errors[n] = r.error; out.counts[n] = null; return; }
    out.counts[n] = r.value.length;
    const st = {};
    for (const x of r.value) {
      if (x.status) st[x.status] = (st[x.status] || 0) + 1;
      if (x.status && ATTENTION.test(x.status)) out.attention.push({ kind: n, id: x._id, name: x._name, status: x.status, message: x.message || '', updated_at: x.updated_at });
      if (x.updated_at || x.created_at) out.recent.push({ kind: n, id: x._id, name: x._name, status: x.status || '', at: x.updated_at || x.created_at });
    }
    out.statuses[n] = st;
  });
  out.recent.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  out.recent = out.recent.slice(0, 12);
  out.fetchedAt = Date.now();
  return out;
}

// ---------- generic get / create / update / delete ----------

export async function get(profile, kindName, id) {
  const k = kind(kindName);
  checkId(id);
  if (kindName === 'secrets') {
    // Secrets have no GET-by-id; values are write-only.
    const found = (await list(profile, 'secrets')).find((s) => s._id === id);
    if (!found) throw bad(404, 'Secret not found');
    return found;
  }
  const { data } = await call(profile.apiKey, 'GET', `${k.path}/${enc(id)}`);
  return norm(k, data?.data ?? data);
}

const pick = (o, keys) => Object.fromEntries(keys.filter((key) => o[key] !== undefined && o[key] !== '').map((key) => [key, o[key]]));
const requireName = (v, what = 'name') => {
  const s = String(v ?? '').trim();
  if (!s) throw bad(400, `${what} is required`);
  return s;
};

/** Build the create body for a kind from the form fields, or pass `raw` through. */
function createBody(kindName, input) {
  if (input.raw && typeof input.raw === 'object') return input.raw;
  switch (kindName) {
    case 'functions':
    case 'sqldbs':
    case 'kvs':
      return { name: requireName(input.name) };
    case 'secrets':
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(input.secret_name || ''))) throw bad(400, 'Secret names use letters, digits and _ and cannot start with a digit');
      if (typeof input.secret_value !== 'string' || !input.secret_value) throw bad(400, 'secret_value is required');
      return { secret_name: input.secret_name, secret_value: input.secret_value };
    case 'domains':
      return { domain: requireName(input.domain, 'domain'), function_id: requireName(input.function_id, 'function_id') };
    case 'bindings':
      return pick(input, ['binding_type', 'env_name', 'api_key', 'func_id', 'kv_id', 'sqldb_id']);
    default:
      throw bad(400, `${KINDS[kindName].label} cannot be created from the panel`);
  }
}

export async function create(profile, kindName, input = {}) {
  const k = kind(kindName);
  const body = createBody(kindName, input);
  try {
    const { data } = await call(profile.apiKey, 'POST', k.path, { body });
    return norm(k, data?.data ?? data ?? {});
  } finally {
    invalidate(profile.id);
  }
}

export async function update(profile, kindName, id, input = {}) {
  const k = kind(kindName);
  checkId(id);
  try {
    if (kindName === 'secrets') {
      // "Add or update": the API upserts by name.
      const s = await get(profile, 'secrets', id);
      if (typeof input.secret_value !== 'string' || !input.secret_value) throw bad(400, 'secret_value is required');
      try {
        const { data } = await call(profile.apiKey, 'POST', k.path, { body: { secret_name: s._name, secret_value: input.secret_value } });
        return norm(k, data?.data ?? { ...s });
      } catch (e) {
        if (![400, 409, 422].includes(e.status)) throw e;
        const { data } = await call(profile.apiKey, 'PATCH', `${k.path}/${enc(id)}`, { body: { secret_value: input.secret_value } });
        return norm(k, data?.data ?? { ...s });
      }
    }
    const body = input.raw && typeof input.raw === 'object' ? input.raw : pick(input, ['name', 'env_name', 'function_id', 'api_key', 'kv_id', 'sqldb_id']);
    if (!Object.keys(body).length) throw bad(400, 'Nothing to update');
    const { data } = await call(profile.apiKey, 'PATCH', `${k.path}/${enc(id)}`, { body });
    return norm(k, data?.data ?? data ?? {});
  } finally {
    invalidate(profile.id);
  }
}

export async function remove(profile, kindName, id) {
  const k = kind(kindName);
  checkId(id);
  try {
    await call(profile.apiKey, 'DELETE', `${k.path}/${enc(id)}`);
    return { ok: true };
  } finally {
    invalidate(profile.id);
  }
}

// ---------- functions ----------

const isoMs = (t) => new Date(t).toISOString();
const isoS = (t) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
const RANGES = { '1h': 3600e3, '6h': 6 * 3600e3, '24h': 24 * 3600e3, '7d': 7 * 24 * 3600e3 };
const rangeMs = (r) => RANGES[r] || RANGES['24h'];

export async function functionMetrics(profile, id, range = '24h') {
  checkId(id);
  const end = Date.now();
  const { data } = await call(profile.apiKey, 'GET', `${KINDS.functions.path}/${id}/metric_aggregates`, {
    query: { start_time: isoMs(end - rangeMs(range)), end_time: isoMs(end), 'page[number]': 1, 'page[size]': 250 },
  });
  return { range, data: data?.data || [] };
}

export async function functionLogs(profile, id, { type = 'runtime', range = '24h', limit = 100 } = {}) {
  checkId(id);
  const end = Date.now();
  const { data } = await call(profile.apiKey, 'GET', `${KINDS.functions.path}/${id}/logs`, {
    query: { start_time: isoS(end - rangeMs(range)), end_time: isoS(end), limit: Math.min(Math.max(+limit || 100, 1), 500), type: type === 'invocations' ? 'invocations' : undefined },
  });
  return { type, range, data: data?.data || [], meta: data?.meta || {} };
}

// Telnyx places functions itself and has no region field on the function record.
// The region is reported per request, so the running region is read from the
// requests of the last 24 hours, busiest region first.
const regionCache = new Map();
const REGION_TTL = 60_000;

export async function functionRegions(profile, id, { force = false } = {}) {
  checkId(id);
  const key = `${profile.id}:${id}`;
  const hit = regionCache.get(key);
  if (!force && hit && Date.now() - hit.at < REGION_TTL) return hit.regions;
  const { data } = await functionLogs(profile, id, { type: 'invocations', range: '24h', limit: 250 });
  const seen = new Map();
  for (const x of data) {
    if (!x.region) continue;
    const r = seen.get(x.region) || { region: x.region, requests: 0, last_seen: '' };
    r.requests++;
    if (String(x.timestamp || '') > r.last_seen) r.last_seen = String(x.timestamp);
    seen.set(x.region, r);
  }
  const regions = [...seen.values()].sort((a, b) => b.requests - a.requests);
  regionCache.set(key, { at: Date.now(), regions });
  return regions;
}

/** Regions for every function, a few at a time. A function whose logs cannot be read gets null. */
export async function regions(profile, { force = false } = {}) {
  const fns = await list(profile, 'functions', { force });
  const out = {};
  for (let i = 0; i < fns.length; i += 6) {
    await Promise.all(fns.slice(i, i + 6).map(async (f) => {
      const r = await settle(functionRegions(profile, f._id, { force }));
      out[f._id] = r.ok ? r.value : null;
    }));
  }
  return { regions: out };
}

export async function functionRevisions(profile, id) {
  checkId(id);
  const { data } = await call(profile.apiKey, 'GET', `${KINDS.functions.path}/${id}/revisions`, { query: { 'page[number]': 1, 'page[size]': 25 } });
  return data?.data || [];
}

export async function logExport(profile, id) {
  checkId(id);
  try {
    const { data } = await call(profile.apiKey, 'GET', `${KINDS.functions.path}/${id}/logs/export`);
    return data?.data ?? data;
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

export async function functionDetail(profile, id) {
  const fn = await get(profile, 'functions', id);
  const [revisions, metrics, exportCfg, kvs, sqldbs, domains, regionList] = await Promise.all([
    settle(functionRevisions(profile, id)),
    settle(functionMetrics(profile, id, '24h')),
    settle(logExport(profile, id)),
    settle(list(profile, 'kvs')),
    settle(list(profile, 'sqldbs')),
    settle(list(profile, 'domains')),
    settle(functionRegions(profile, id)),
  ]);
  const storage = new Map([...(kvs.value || []), ...(sqldbs.value || [])].map((s) => [s._id, s]));
  fn.bindings = (fn.bindings || []).map((b) => {
    const target = b.kv_id || b.sqldb_id;
    return { ...b, target_id: target || null, target_kind: b.kv_id ? 'kvs' : b.sqldb_id ? 'sqldbs' : null, target_name: target ? storage.get(target)?._name || null : null };
  });
  return {
    item: fn,
    revisions: revisions.value || [],
    revisionsError: revisions.error || null,
    metrics: metrics.value?.data || [],
    metricsError: metrics.error || null,
    logExport: exportCfg.value ?? null,
    logExportError: exportCfg.error || null,
    regions: regionList.value || [],
    regionsError: regionList.error || null,
    domains: (domains.value || []).filter((d) => d.function_id === id || d.func_id === id),
  };
}

export async function functionAction(profile, id, action, input = {}) {
  checkId(id);
  const base = `${KINDS.functions.path}/${id}`;
  try {
    switch (action) {
      case 'reset':
        return (await call(profile.apiKey, 'POST', `${base}/actions/reset`, { body: {} })).data;
      case 'rollback': {
        const revision = checkId(String(input.revision_id || ''));
        return (await call(profile.apiKey, 'POST', `${base}/actions/rollback`, { body: { revision_id: revision } })).data;
      }
      case 'log-export': {
        const url = String(input.endpoint || '');
        if (!/^https:\/\/[^\s]+$/.test(url)) throw bad(400, 'The log endpoint must be an https:// URL');
        const headers = {};
        for (const [hk, hv] of Object.entries(input.headers || {})) if (hk.trim()) headers[hk.trim()] = String(hv);
        const body = { endpoint: url, headers, runtime_export_enabled: input.runtime !== false, invocation_export_enabled: input.invocations !== false };
        return (await call(profile.apiKey, 'PUT', `${base}/logs/export`, { body })).data;
      }
      case 'log-export-delete':
        return (await call(profile.apiKey, 'DELETE', `${base}/logs/export`)).data;
      default:
        throw bad(400, `Unknown function action: ${action}`);
    }
  } finally {
    invalidate(profile.id);
  }
}

// ---------- SQL databases ----------

export const quoteIdent = (s) => `"${String(s).replace(/"/g, '""')}"`;

/** Telnyx SQLDB answers in the D1 style; accept the shapes it may take. */
export function normalizeQuery(payload) {
  const d = payload?.data ?? payload;
  const isStmt = (x) => x && typeof x === 'object' && !Array.isArray(x) && ('results' in x || 'rows' in x || 'success' in x || 'columns' in x);
  let stmts;
  if (Array.isArray(d) && d.every(isStmt)) stmts = d;
  else if (Array.isArray(d?.results) && d.results.length && d.results.every(isStmt)) stmts = d.results;
  else if (isStmt(d)) stmts = [d];
  else if (Array.isArray(d)) stmts = [{ results: d }];
  else stmts = [{ results: [] }];
  return stmts.map((s) => {
    let rows = Array.isArray(s.results) ? s.results : Array.isArray(s.rows) ? s.rows : [];
    let columns = Array.isArray(s.columns) ? s.columns : null;
    if (rows.length && Array.isArray(rows[0])) {
      columns ||= rows[0].map((_, i) => `column_${i + 1}`);
      rows = rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]])));
    }
    columns ||= rows.length ? Object.keys(rows[0]) : [];
    const m = s.meta || {};
    return {
      success: s.success !== false && !s.error,
      error: s.error || null,
      columns,
      rows,
      meta: {
        rows_read: m.rows_read ?? s.rows_read ?? null,
        rows_written: m.rows_written ?? s.rows_written ?? null,
        changes: m.changes ?? s.changes ?? null,
        last_row_id: m.last_row_id ?? s.last_row_id ?? null,
        duration: m.duration ?? s.duration ?? null,
      },
    };
  });
}

export async function query(profile, id, sql, params = []) {
  checkId(id);
  if (typeof sql !== 'string' || !sql.trim()) throw bad(400, 'SQL is required');
  if (!Array.isArray(params)) throw bad(400, 'params must be an array');
  const started = Date.now();
  const { data } = await call(profile.apiKey, 'POST', `${KINDS.sqldbs.path}/${id}/actions/query`, { body: { sql, params }, timeout: 120000 });
  const statements = normalizeQuery(data);
  const failed = statements.find((s) => !s.success);
  if (failed) throw bad(400, failed.error || 'Query failed');
  return { statements, last: statements[statements.length - 1], ms: Date.now() - started };
}

const INTERNAL_TABLE = /^(sqlite_|_cf_|d1_|_litestream)/;

export async function schema(profile, id) {
  const r = await query(profile, id, "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END, name");
  return r.last.rows.filter((o) => !INTERNAL_TABLE.test(o.name));
}

export async function sqldbDetail(profile, id) {
  const item = await get(profile, 'sqldbs', id);
  const objects = await settle(schema(profile, id));
  let tables = [];
  if (objects.ok) {
    const names = objects.value.filter((o) => o.type === 'table').map((o) => o.name);
    if (names.length) {
      const counts = await settle(query(profile, id, names.map((n) => `SELECT ${sqlLiteral(n)} AS t, COUNT(*) AS n FROM ${quoteIdent(n)}`).join(' UNION ALL ')));
      const byName = new Map((counts.value?.last.rows || []).map((r) => [r.t, r.n]));
      tables = names.map((n) => ({ name: n, rows: byName.get(n) ?? null }));
    }
  }
  return { item, objects: objects.value || [], tables, schemaError: objects.error || null };
}

export async function tableRows(profile, id, table, { limit = 50, offset = 0 } = {}) {
  const objects = await schema(profile, id);
  if (!objects.some((o) => o.type === 'table' && o.name === table) && !objects.some((o) => o.type === 'view' && o.name === table)) throw bad(404, 'Table not found');
  const lim = Math.min(Math.max(+limit || 50, 1), 500);
  const off = Math.max(+offset || 0, 0);
  const [rows, count] = await Promise.all([
    query(profile, id, `SELECT * FROM ${quoteIdent(table)} LIMIT ${lim} OFFSET ${off}`),
    query(profile, id, `SELECT COUNT(*) AS n FROM ${quoteIdent(table)}`),
  ]);
  return { table, columns: rows.last.columns, rows: rows.last.rows, total: count.last.rows[0]?.n ?? null, limit: lim, offset: off };
}

const sqlLiteral = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
};

async function* tableChunks(profile, id, table, size = 500) {
  for (let off = 0; ; off += size) {
    const r = await query(profile, id, `SELECT * FROM ${quoteIdent(table)} LIMIT ${size} OFFSET ${off}`);
    if (!r.last.rows.length) return;
    yield r.last;
    if (r.last.rows.length < size) return;
  }
}

/** A plain SQL dump: schema, then data, then indexes, views and triggers. */
export async function dump(profile, id) {
  const objects = await schema(profile, id);
  const out = [`-- Telnyx Edge SQL database ${id}`, `-- Exported ${new Date().toISOString()}`, 'PRAGMA foreign_keys=OFF;', 'BEGIN TRANSACTION;'];
  for (const t of objects.filter((o) => o.type === 'table')) {
    out.push(`${t.sql};`);
    for await (const chunk of tableChunks(profile, id, t.name)) {
      const cols = chunk.columns.map(quoteIdent).join(', ');
      for (const row of chunk.rows) out.push(`INSERT INTO ${quoteIdent(t.name)} (${cols}) VALUES (${chunk.columns.map((c) => sqlLiteral(row[c])).join(', ')});`);
    }
  }
  for (const o of objects.filter((x) => x.type !== 'table')) out.push(`${o.sql};`);
  out.push('COMMIT;');
  return `${out.join('\n')}\n`;
}

// ---------- KV namespaces ----------

export async function kvKeys(profile, id, { prefix = '', cursor = '', limit = 200 } = {}) {
  checkId(id);
  const { data } = await call(profile.apiKey, 'GET', `${KINDS.kvs.path}/${id}/keys`, { query: { prefix, cursor, limit: Math.min(Math.max(+limit || 200, 1), 1000) } });
  const keys = Array.isArray(data?.data) ? data.data : [];
  return { keys, cursor: data?.meta?.cursor || data?.cursor || null };
}

const checkKey = (key) => {
  if (typeof key !== 'string' || !key || key.length > 512) throw bad(400, 'Invalid key');
  return key;
};

export async function kvGet(profile, id, key) {
  checkId(id);
  const { data, type } = await call(profile.apiKey, 'GET', `${KINDS.kvs.path}/${id}/keys/${enc(checkKey(key))}`);
  // Values come back raw; tolerate a JSON envelope too.
  const value = data && typeof data === 'object' && !type.includes('text/plain') && 'data' in data
    ? (typeof data.data === 'object' && data.data !== null && 'value' in data.data ? data.data.value : data.data)
    : data;
  return { key, value: typeof value === 'string' ? value : value === null ? '' : JSON.stringify(value) };
}

export async function kvPut(profile, id, key, value) {
  checkId(id);
  if (typeof value !== 'string') throw bad(400, 'value must be a string');
  await call(profile.apiKey, 'PUT', `${KINDS.kvs.path}/${id}/keys/${enc(checkKey(key))}`, { text: value });
  return { ok: true };
}

export async function kvDelete(profile, id, key) {
  checkId(id);
  await call(profile.apiKey, 'DELETE', `${KINDS.kvs.path}/${id}/keys/${enc(checkKey(key))}`);
  return { ok: true };
}

export async function kvDetail(profile, id) {
  const [item, keys] = await Promise.all([get(profile, 'kvs', id), settle(kvKeys(profile, id))]);
  return { item, keys: keys.value?.keys || [], cursor: keys.value?.cursor || null, keysError: keys.error || null };
}

// ---------- domains, bindings, actors ----------

export async function domainAction(profile, id, action, input = {}) {
  checkId(id);
  const base = `${KINDS.domains.path}/${enc(id)}`;
  try {
    if (action === 'verify') return (await call(profile.apiKey, 'POST', `${base}/actions/verify`, { body: {} })).data;
    if (action === 'cert') {
      const cert = String(input.cert_pem || ''), key = String(input.key_pem || '');
      if (!cert.includes('BEGIN CERTIFICATE') || !/BEGIN [A-Z ]*PRIVATE KEY/.test(key)) throw bad(400, 'Paste a PEM certificate (chain) and its PEM private key');
      return (await call(profile.apiKey, 'POST', `${base}/cert`, { body: { cert_pem: cert, key_pem: key } })).data;
    }
    throw bad(400, `Unknown domain action: ${action}`);
  } finally {
    invalidate(profile.id);
  }
}

export async function bindingAction(profile, id, action) {
  checkId(id);
  if (action !== 'validate') throw bad(400, `Unknown binding action: ${action}`);
  return (await call(profile.apiKey, 'POST', `${KINDS.bindings.path}/${id}/actions/validate`, { body: {} })).data;
}

export async function actorDetail(profile, id) {
  const item = await get(profile, 'actors', id);
  const instances = await settle(call(profile.apiKey, 'GET', `${KINDS.actors.path}/${enc(id)}/instances`, { query: { 'page[number]': 1, 'page[size]': 50 } }));
  return { item, instances: instances.value?.data?.data || [], instancesError: instances.error || null };
}

export async function genericDetail(profile, kindName, id) {
  return { item: await get(profile, kindName, id) };
}

// ---------- jobs (long-running duplicates) ----------

const jobs = new Map();

export function getJob(owner, id) {
  const j = jobs.get(id);
  if (!j || j.owner !== owner) throw bad(404, 'Job not found');
  const { owner: _o, ...pub } = j;
  return pub;
}

export function listJobs(owner) {
  return [...jobs.values()].filter((j) => j.owner === owner).map(({ owner: _o, ...pub }) => pub).sort((a, b) => b.startedAt - a.startedAt);
}

function startJob(owner, title, fn) {
  const job = { id: crypto.randomBytes(6).toString('hex'), owner, title, status: 'running', log: [], result: null, error: null, startedAt: Date.now(), endedAt: null };
  jobs.set(job.id, job);
  const say = (msg) => { job.log.push({ at: Date.now(), msg }); if (job.log.length > 400) job.log.splice(0, 100); };
  fn(say).then((result) => { job.status = 'done'; job.result = result; }, (e) => { job.status = 'failed'; job.error = e.message; say(`Failed: ${e.message}`); })
    .finally(() => {
      job.endedAt = Date.now();
      const mine = [...jobs.values()].filter((j) => j.owner === owner && j.status !== 'running');
      for (const old of mine.slice(0, Math.max(0, mine.length - 30))) jobs.delete(old.id);
    });
  return { job: job.id };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitProvisioned(profile, kindName, id, say, timeoutMs = 20 * 60_000) {
  const until = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < until) {
    const s = await get(profile, kindName, id).catch(() => null);
    const status = s?.status || 'unknown';
    if (status !== last) { say(`Status: ${status}`); last = status; }
    if (/ok|ready|active/i.test(status) && !/fail/i.test(status)) return s;
    if (/fail/i.test(status)) throw new Error(`Provisioning ended in ${status}`);
    await sleep(+process.env.EDGE_CP_POLL_MS || 10_000);
  }
  throw new Error('Timed out waiting for provisioning');
}

/** Rows per multi-row INSERT, keeping bound parameters under 100 per statement. */
const rowsPerInsert = (cols) => Math.max(1, Math.min(50, Math.floor(99 / Math.max(cols, 1))));

async function copySqldb(profile, fromId, toId, { withData }, say) {
  const objects = await schema(profile, fromId);
  const tables = objects.filter((o) => o.type === 'table');
  say(`Copying ${tables.length} table(s)${withData ? ' with data' : ' (schema only)'}`);
  for (const t of tables) {
    await query(profile, toId, t.sql);
    if (!withData) continue;
    let copied = 0;
    for await (const chunk of tableChunks(profile, fromId, t.name)) {
      const per = rowsPerInsert(chunk.columns.length);
      for (let i = 0; i < chunk.rows.length; i += per) {
        const batch = chunk.rows.slice(i, i + per);
        const tuple = `(${chunk.columns.map(() => '?').join(', ')})`;
        const params = batch.flatMap((r) => chunk.columns.map((c) => (r[c] !== null && typeof r[c] === 'object' ? JSON.stringify(r[c]) : r[c])));
        await query(profile, toId, `INSERT INTO ${quoteIdent(t.name)} (${chunk.columns.map(quoteIdent).join(', ')}) VALUES ${batch.map(() => tuple).join(', ')}`, params);
      }
      copied += chunk.rows.length;
      say(`${t.name}: ${copied} row(s)`);
    }
  }
  for (const o of objects.filter((x) => x.type !== 'table')) await query(profile, toId, o.sql);
  say('Schema objects copied');
}

async function copyKv(profile, fromId, toId, say) {
  let cursor = '';
  let n = 0;
  do {
    const page = await kvKeys(profile, fromId, { cursor, limit: 1000 });
    for (const k of page.keys) {
      const name = k.key ?? k.name;
      const { value } = await kvGet(profile, fromId, name);
      await kvPut(profile, toId, name, value);
      if (++n % 25 === 0) say(`${n} key(s) copied`);
    }
    cursor = page.cursor && page.cursor !== cursor ? page.cursor : '';
  } while (cursor);
  say(`${n} key(s) copied`);
  return n;
}

/**
 * Duplicate an object. Quick ones answer directly; storage copies run as a job
 * because a new database can take minutes to provision.
 */
export async function duplicate(profile, owner, kindName, id, input = {}) {
  checkId(id);
  const src = await get(profile, kindName, id);
  const name = String(input.name || '').trim();
  switch (kindName) {
    case 'functions': {
      const created = await create(profile, 'functions', { name: requireName(name) });
      const notes = ['Code is not copied: ship it to the new function with `telnyx-edge ship`.'];
      const cfg = await logExport(profile, id).catch(() => null);
      if (cfg?.endpoint) {
        await functionAction(profile, created._id, 'log-export', { endpoint: cfg.endpoint, headers: cfg.headers || {}, runtime: cfg.runtime_export_enabled !== false, invocations: cfg.invocation_export_enabled !== false })
          .then(() => notes.push('Log export destination copied.'), (e) => notes.push(`Log export not copied: ${e.message}`));
      }
      if (src.bindings?.length) notes.push(`${src.bindings.length} storage binding(s) come from func.toml and are applied when you ship.`);
      return { item: created, notes };
    }
    case 'sqldbs':
      return startJob(owner, `Duplicate SQL DB ${src._name} → ${requireName(name)}`, async (say) => {
        const created = await create(profile, 'sqldbs', { name });
        say(`Created ${created._name || name} (${created._id}); waiting for it to provision`);
        await waitProvisioned(profile, 'sqldbs', created._id, say);
        await copySqldb(profile, id, created._id, { withData: input.withData !== false }, say);
        invalidate(profile.id);
        return { kind: 'sqldbs', id: created._id, name: created._name || name };
      });
    case 'kvs':
      return startJob(owner, `Duplicate KV ${src._name} → ${requireName(name)}`, async (say) => {
        const created = await create(profile, 'kvs', { name });
        say(`Created ${created._name || name} (${created._id}); waiting for it to provision`);
        await waitProvisioned(profile, 'kvs', created._id, say);
        if (input.withData !== false) await copyKv(profile, id, created._id, say);
        invalidate(profile.id);
        return { kind: 'kvs', id: created._id, name: created._name || name };
      });
    case 'secrets':
      return { item: await create(profile, 'secrets', { secret_name: name, secret_value: input.secret_value }) };
    case 'domains':
      return { item: await create(profile, 'domains', { domain: name, function_id: input.function_id || src.function_id || src.func_id }) };
    case 'bindings':
      return { item: await create(profile, 'bindings', { raw: input.raw || { ...pick(src, ['binding_type', 'kv_id', 'sqldb_id', 'func_id']), env_name: requireName(name, 'env_name') } }) };
    default:
      throw bad(400, `${KINDS[kindName].label} cannot be duplicated`);
  }
}

// ---------- API explorer ----------

const EXPLORER_PREFIX = /^\/v2\/(compute|storage)\//;

export async function explore(profile, { method = 'GET', path = '', body } = {}) {
  const m = String(method).toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(m)) throw bad(400, 'Unsupported method');
  const [p, q = ''] = String(path).split('?');
  if (!EXPLORER_PREFIX.test(p) || p.includes('..') || /[\s#\\]/.test(p)) throw bad(400, 'The explorer only reaches Edge endpoints under /v2/compute/ and /v2/storage/');
  const query = Object.fromEntries(new URLSearchParams(q));
  let payload;
  if (body !== undefined && body !== null && body !== '' && m !== 'GET') {
    try { payload = typeof body === 'string' ? JSON.parse(body) : body; } catch { throw bad(400, 'Body is not valid JSON'); }
  }
  try {
    const r = await call(profile.apiKey, m, p, { query, body: payload, raw: true, timeout: 60000 });
    return { status: r.status, ms: r.ms, data: r.data };
  } finally {
    if (m !== 'GET') invalidate(profile.id);
  }
}

export { TelnyxError };
