#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { checkKey, API_BASE } from './lib/telnyx.js';
import {
  SELF_DIR, COLORS, openVault, saveVault, liveVault, addProfile, updateProfile, removeProfile, publicProfile,
  createSession, getSession, endSession, deleteVault, activeProfile,
} from './lib/vault.js';
import * as edge from './lib/edge.js';

const PORT = +(process.env.PORT || 3007);
const HOST = process.env.HOST || '127.0.0.1';
const LOOPBACK = ['127.0.0.1', 'localhost', '::1'].includes(HOST);
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';
const COOKIE = 'ecp_sid';
const PUBLIC = path.join(SELF_DIR, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

if (!LOOPBACK && !COOKIE_SECURE) {
  console.warn(`Warning: listening on ${HOST} without COOKIE_SECURE=1. Put the panel behind HTTPS before exposing it.`);
}

const send = (res, status, body, type = 'application/json', extra = {}) => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...SECURITY_HEADERS, ...extra });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

const readBody = (req, limit = 2e6) => new Promise((resolve, reject) => {
  let data = '';
  req.on('data', (c) => {
    data += c;
    if (data.length > limit) { reject(Object.assign(new Error('Request too large'), { status: 413 })); req.destroy(); }
  });
  req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); } });
  req.on('error', reject);
});

const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter(([k]) => k).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const setCookie = (token, maxAge) => `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${COOKIE_SECURE ? '; Secure' : ''}`;

function hostAllowed(req) {
  // Block DNS rebinding: on loopback only answer to loopback host names.
  if (!LOOPBACK) return true;
  const host = (req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return ['localhost', '127.0.0.1', '::1'].includes(host);
}

// ---------- sign-in throttling ----------

const attempts = new Map(); // ip -> { n, until }
const clientIp = (req) => req.socket.remoteAddress || 'unknown';
function throttled(ip) {
  const a = attempts.get(ip);
  return a && a.n >= 8 && Date.now() < a.until;
}
function failed(ip) {
  const a = attempts.get(ip);
  const fresh = !a || Date.now() > a.until;
  attempts.set(ip, { n: fresh ? 1 : a.n + 1, until: Date.now() + 15 * 60_000 });
}

const validKey = (k) => typeof k === 'string' && /^[\w.~+/=-]{16,300}$/.test(k.trim());

function sessionView(s) {
  return {
    profiles: s.vault.data.profiles.map(publicProfile),
    activeId: s.activeId,
    csrf: s.csrf,
    colors: COLORS,
    apiBase: API_BASE,
    kinds: Object.fromEntries(Object.entries(edge.KINDS).map(([k, v]) => [k, v.label])),
  };
}

// ---------- routes ----------

async function authRoutes(req, res, parts) {
  if (req.method === 'POST' && parts[1] === 'login') {
    const ip = clientIp(req);
    if (throttled(ip)) return send(res, 429, { error: 'Too many failed sign-ins. Try again in 15 minutes.' });
    const { apiKey, profileName } = await readBody(req, 1e4);
    if (!validKey(apiKey)) { failed(ip); return send(res, 400, { error: 'Enter a Telnyx API key' }); }
    const key = apiKey.trim();
    const check = await checkKey(key);
    if (!check.ok) {
      if (check.status === 401) failed(ip);
      return send(res, check.status === 401 ? 401 : 502, { error: check.error });
    }
    attempts.delete(ip);
    const vault = liveVault(openVault(key));
    let login = vault.data.profiles.find((p) => p.apiKey === key);
    if (!login) login = addProfile(vault, { name: profileName || 'Default', apiKey: key, login: true });
    login.login = true;
    login.lastUsedAt = Date.now();
    vault.data.activeId ||= login.id;
    saveVault(vault);
    const token = createSession(vault);
    const s = getSession(token);
    s.activeId = login.id;
    return send(res, 200, sessionView(s), 'application/json', { 'set-cookie': setCookie(token, 24 * 3600) });
  }
  const token = cookies(req)[COOKIE];
  if (req.method === 'POST' && parts[1] === 'logout') {
    endSession(token);
    return send(res, 200, { ok: true }, 'application/json', { 'set-cookie': setCookie('', 0) });
  }
  if (req.method === 'GET' && parts[1] === 'me') {
    const s = getSession(token);
    if (!s) return send(res, 401, { error: 'Not signed in' });
    return send(res, 200, sessionView(s));
  }
  if (req.method === 'DELETE' && parts[1] === 'vault') {
    // Removes every profile, including the sign-in one, and signs out everywhere.
    const s = getSession(token);
    if (!s) return send(res, 401, { error: 'Not signed in' });
    if (req.headers['x-csrf'] !== s.csrf) return send(res, 403, { error: 'Session token mismatch. Reload the page.' });
    for (const p of s.vault.data.profiles) edge.invalidate(p.id);
    deleteVault(s.vault);
    return send(res, 200, { ok: true }, 'application/json', { 'set-cookie': setCookie('', 0) });
  }
  return send(res, 404, { error: 'Not found' });
}

async function profileRoutes(req, res, s, parts) {
  const vault = s.vault;
  const [, , id, action] = parts; // api, profiles, id, action
  if (req.method === 'POST' && !id) {
    const { name, apiKey, color } = await readBody(req, 1e4);
    if (!validKey(apiKey)) return send(res, 400, { error: 'Enter a Telnyx API key' });
    const check = await checkKey(apiKey.trim());
    if (!check.ok) return send(res, check.status === 401 ? 400 : 502, { error: check.error });
    const p = addProfile(vault, { name, apiKey: apiKey.trim(), color });
    saveVault(vault);
    return send(res, 200, { profile: publicProfile(p), ...sessionView(s) });
  }
  if (!id) return send(res, 404, { error: 'Not found' });
  const profile = vault.data.profiles.find((p) => p.id === id);
  if (!profile) return send(res, 404, { error: 'Profile not found' });
  if (req.method === 'PATCH' && !action) {
    const body = await readBody(req, 1e4);
    if (body.apiKey !== undefined && body.apiKey !== '') {
      if (profile.login) return send(res, 400, { error: 'The key you signed in with unlocks the vault. Sign in with the new key instead.' });
      if (!validKey(body.apiKey)) return send(res, 400, { error: 'Enter a Telnyx API key' });
      const check = await checkKey(body.apiKey.trim());
      if (!check.ok) return send(res, check.status === 401 ? 400 : 502, { error: check.error });
      body.apiKey = body.apiKey.trim();
    } else delete body.apiKey;
    updateProfile(vault, id, body);
    edge.invalidate(id);
    saveVault(vault);
    return send(res, 200, sessionView(s));
  }
  if (req.method === 'DELETE' && !action) {
    removeProfile(vault, id);
    edge.invalidate(id);
    saveVault(vault);
    if (s.activeId === id) s.activeId = vault.data.activeId;
    return send(res, 200, sessionView(s));
  }
  if (req.method === 'POST' && action === 'activate') {
    s.activeId = id;
    vault.data.activeId = id;
    profile.lastUsedAt = Date.now();
    saveVault(vault);
    return send(res, 200, sessionView(s));
  }
  if (req.method === 'POST' && action === 'test') {
    const check = await checkKey(profile.apiKey);
    return send(res, 200, check);
  }
  if (req.method === 'POST' && action === 'duplicate') {
    const { name } = await readBody(req, 1e4);
    const p = addProfile(vault, { name: name || `${profile.name} copy`, apiKey: profile.apiKey, color: profile.color });
    saveVault(vault);
    return send(res, 200, { profile: publicProfile(p), ...sessionView(s) });
  }
  return send(res, 404, { error: 'Not found' });
}

const DETAIL = {
  functions: edge.functionDetail,
  sqldbs: edge.sqldbDetail,
  kvs: edge.kvDetail,
  actors: edge.actorDetail,
};

async function edgeRoutes(req, res, s, parts, url) {
  const profile = activeProfile(s);
  if (!profile) return send(res, 400, { error: 'No active profile. Add one under Profiles.' });
  const owner = s.vault.id;
  const force = url.searchParams.get('refresh') === '1';
  const [, kindName, id, sub, subId] = parts; // api, kind, id, sub, subId
  const M = req.method;

  if (kindName === 'overview' && M === 'GET') return send(res, 200, await edge.overview(profile, { force }));
  if (kindName === 'regions' && M === 'GET') return send(res, 200, await edge.regions(profile, { force }));
  if (kindName === 'explorer' && M === 'POST') return send(res, 200, await edge.explore(profile, await readBody(req)));
  if (kindName === 'jobs' && M === 'GET') return send(res, 200, id ? edge.getJob(owner, id) : { jobs: edge.listJobs(owner) });

  edge.kind(kindName);
  if (!id) {
    if (M === 'GET') return send(res, 200, { items: await edge.list(profile, kindName, { force }) });
    if (M === 'POST') return send(res, 200, { item: await edge.create(profile, kindName, await readBody(req)) });
    return send(res, 405, { error: 'Method not allowed' });
  }
  edge.checkId(id);
  if (!sub) {
    if (M === 'GET') return send(res, 200, await (DETAIL[kindName] || ((p, i) => edge.genericDetail(p, kindName, i)))(profile, id));
    if (M === 'PATCH') return send(res, 200, { item: await edge.update(profile, kindName, id, await readBody(req)) });
    if (M === 'DELETE') return send(res, 200, await edge.remove(profile, kindName, id));
    return send(res, 405, { error: 'Method not allowed' });
  }
  if (sub === 'duplicate' && M === 'POST') return send(res, 200, await edge.duplicate(profile, owner, kindName, id, await readBody(req)));
  if (sub === 'raw' && M === 'GET') return send(res, 200, await edge.get(profile, kindName, id));

  if (kindName === 'functions') {
    const q = Object.fromEntries(url.searchParams);
    if (sub === 'metrics' && M === 'GET') return send(res, 200, await edge.functionMetrics(profile, id, q.range));
    if (sub === 'logs' && M === 'GET') return send(res, 200, await edge.functionLogs(profile, id, q));
    if (sub === 'revisions' && M === 'GET') return send(res, 200, { revisions: await edge.functionRevisions(profile, id) });
    if (sub === 'actions' && M === 'POST') return send(res, 200, { result: await edge.functionAction(profile, id, subId, await readBody(req)) });
  }
  if (kindName === 'sqldbs') {
    if (sub === 'query' && M === 'POST') {
      const { sql, params } = await readBody(req);
      return send(res, 200, await edge.query(profile, id, sql, params || []));
    }
    if (sub === 'tables' && subId && M === 'GET') return send(res, 200, await edge.tableRows(profile, id, subId, Object.fromEntries(url.searchParams)));
    if (sub === 'dump' && M === 'GET') {
      const sql = await edge.dump(profile, id);
      const name = String(url.searchParams.get('name') || id).replace(/[^\w.-]/g, '_');
      return send(res, 200, sql, 'application/sql; charset=utf-8', { 'content-disposition': `attachment; filename="${name}.sql"` });
    }
  }
  if (kindName === 'kvs' && sub === 'keys') {
    const key = url.searchParams.get('key');
    if (M === 'GET' && key === null) return send(res, 200, await edge.kvKeys(profile, id, Object.fromEntries(url.searchParams)));
    if (M === 'GET') return send(res, 200, await edge.kvGet(profile, id, key));
    if (M === 'PUT') {
      const body = await readBody(req, 26e6);
      return send(res, 200, await edge.kvPut(profile, id, body.key, body.value));
    }
    if (M === 'DELETE') return send(res, 200, await edge.kvDelete(profile, id, key));
  }
  if (kindName === 'domains' && sub === 'actions' && M === 'POST') return send(res, 200, { result: await edge.domainAction(profile, id, subId, await readBody(req)) });
  if (kindName === 'bindings' && sub === 'actions' && M === 'POST') return send(res, 200, { result: await edge.bindingAction(profile, id, subId) });
  return send(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (!hostAllowed(req)) return send(res, 403, { error: 'Forbidden host' });
    const isApi = url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/');
    if (isApi) {
      // Mutations need a custom header, which a cross-site form cannot send.
      if (req.method !== 'GET' && req.headers['x-panel'] !== '1') return send(res, 403, { error: 'Forbidden' });
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (parts[0] === 'auth') return await authRoutes(req, res, parts);
      const s = getSession(cookies(req)[COOKIE]);
      if (!s) return send(res, 401, { error: 'Not signed in' });
      if (req.method !== 'GET' && req.headers['x-csrf'] !== s.csrf) return send(res, 403, { error: 'Session token mismatch. Reload the page.' });
      if (parts[1] === 'profiles') return await profileRoutes(req, res, s, parts);
      return await edgeRoutes(req, res, s, parts, url);
    }
    if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
    const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
    if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Not found', 'text/plain');
    return send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
  } catch (err) {
    if (!err.status) console.error(err);
    let status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    let message = err.message;
    // A 401 from Telnyx is about the profile's key, not the panel session.
    if (err instanceof edge.TelnyxError && status === 401) { status = 424; message = `Telnyx rejected this profile's API key: ${message}`; }
    return send(res, status, { error: message, telnyx: err.body?.errors || undefined, upstream: err instanceof edge.TelnyxError ? err.status : undefined });
  }
});

// The desktop apps hold our stdin open; when it exits, even by crashing, stdin closes and so do we.
if (process.env.EDGE_CP_EXIT_WITH_PARENT === '1') {
  process.stdin.on('end', () => process.exit(0)).on('error', () => process.exit(0)).resume();
}

server.listen(PORT, HOST, () => {
  console.log(`Telnyx Edge Control Panel on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  (API ${API_BASE})`);
});

export default server;
