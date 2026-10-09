import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Profiles live in a per-user vault, encrypted with a key derived from the Telnyx
// API key the user signs in with. The file name is an HMAC of that key, so
// neither the vault's owner nor its contents can be read from disk alone.

export const SELF_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const DATA_DIR = path.resolve(process.env.EDGE_CP_DATA_DIR || path.join(SELF_DIR, 'data'));
const VAULT_DIR = path.join(DATA_DIR, 'vaults');
const IDLE_MS = +(process.env.SESSION_IDLE_HOURS || 8) * 3600_000;
const MAX_MS = 24 * 3600_000;
export const COLORS = ['#2f6fed', '#00c08b', '#7c5cff', '#e5484d', '#f59e0b', '#0ea5e9', '#d946ef', '#64748b'];

fs.mkdirSync(VAULT_DIR, { recursive: true, mode: 0o700 });

function serverKey() {
  const file = path.join(DATA_DIR, 'server.key');
  try { return fs.readFileSync(file); } catch { /* first run */ }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(file, key, { mode: 0o600 });
  return key;
}
const SERVER_KEY = serverKey();

const vaultId = (apiKey) => crypto.createHmac('sha256', SERVER_KEY).update(apiKey).digest('hex').slice(0, 40);
const vaultFile = (id) => path.join(VAULT_DIR, `${id}.json`);
export const keyHint = (k) => `…${String(k).slice(-4)}`;
const newId = () => crypto.randomBytes(6).toString('hex');

function encrypt(key, obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}

function decrypt(key, box) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
  d.setAuthTag(Buffer.from(box.tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(box.ct, 'base64')), d.final()]).toString('utf8'));
}

/** Open (or create) the vault that belongs to this API key. */
export function openVault(apiKey) {
  const id = vaultId(apiKey);
  const file = vaultFile(id);
  if (fs.existsSync(file)) {
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    const key = crypto.scryptSync(apiKey, Buffer.from(stored.salt, 'base64'), 32);
    return { id, key, salt: stored.salt, data: decrypt(key, stored.box), created: false };
  }
  const salt = crypto.randomBytes(16).toString('base64');
  const key = crypto.scryptSync(apiKey, Buffer.from(salt, 'base64'), 32);
  return { id, key, salt, data: { profiles: [], activeId: null, createdAt: Date.now() }, created: true };
}

export function saveVault(vault) {
  const tmp = `${vaultFile(vault.id)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ v: 1, salt: vault.salt, box: encrypt(vault.key, vault.data) }), { mode: 0o600 });
  fs.renameSync(tmp, vaultFile(vault.id));
}

// ---------- profiles ----------

export const publicProfile = (p) => ({ id: p.id, name: p.name, color: p.color, keyHint: keyHint(p.apiKey), createdAt: p.createdAt, lastUsedAt: p.lastUsedAt || null, login: !!p.login });

function cleanName(name, fallback) {
  const n = String(name ?? '').trim().slice(0, 60);
  return n || fallback;
}

export function addProfile(vault, { name, apiKey, color, login = false }) {
  const data = vault.data;
  const profile = {
    id: newId(),
    name: cleanName(name, `Profile ${data.profiles.length + 1}`),
    apiKey,
    color: COLORS.includes(color) ? color : COLORS[data.profiles.length % COLORS.length],
    createdAt: Date.now(),
    login,
  };
  data.profiles.push(profile);
  return profile;
}

export function updateProfile(vault, id, patch) {
  const p = vault.data.profiles.find((x) => x.id === id);
  if (!p) throw Object.assign(new Error('Profile not found'), { status: 404 });
  if (patch.name !== undefined) p.name = cleanName(patch.name, p.name);
  if (patch.color !== undefined && COLORS.includes(patch.color)) p.color = patch.color;
  if (patch.apiKey) p.apiKey = patch.apiKey;
  return p;
}

export function removeProfile(vault, id) {
  const list = vault.data.profiles;
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) throw Object.assign(new Error('Profile not found'), { status: 404 });
  if (list[i].login) throw Object.assign(new Error('This profile holds the key you signed in with and unlocks the vault, so it cannot be removed'), { status: 400 });
  list.splice(i, 1);
  if (vault.data.activeId === id) vault.data.activeId = list[0]?.id || null;
}

// ---------- sessions ----------

const sessions = new Map();

export function createSession(vault) {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, { vault, activeId: vault.data.activeId, createdAt: Date.now(), lastSeen: Date.now(), csrf: crypto.randomBytes(16).toString('hex') });
  return token;
}

export function getSession(token) {
  const s = token && sessions.get(token);
  if (!s) return null;
  const now = Date.now();
  if (now - s.lastSeen > IDLE_MS || now - s.createdAt > MAX_MS) { sessions.delete(token); return null; }
  s.lastSeen = now;
  // Another tab may have removed the active profile.
  if (!s.vault.data.profiles.some((p) => p.id === s.activeId)) s.activeId = s.vault.data.activeId || s.vault.data.profiles[0]?.id || null;
  return s;
}

export const endSession = (token) => sessions.delete(token);

/** Delete a vault file and end every session that has it open. */
export function deleteVault(vault) {
  fs.rmSync(vaultFile(vault.id), { force: true });
  for (const [t, s] of sessions) if (s.vault.id === vault.id) sessions.delete(t);
}

/** Sessions of the same vault share one in-memory copy so edits are seen everywhere. */
export function liveVault(vault) {
  for (const s of sessions.values()) if (s.vault.id === vault.id) return s.vault;
  return vault;
}

export function activeProfile(session) {
  return session.vault.data.profiles.find((p) => p.id === session.activeId) || null;
}

setInterval(() => { for (const [t] of sessions) getSession(t); }, 10 * 60_000).unref();
