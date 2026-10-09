// Minimal Telnyx REST client. Every call is made with the caller's own API key;
// the panel never holds a key of its own.

export const API_BASE = (process.env.TELNYX_API_BASE || 'https://api.telnyx.com').replace(/\/+$/, '');
const TIMEOUT = +(process.env.TELNYX_TIMEOUT_MS || 30000);

export class TelnyxError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function errorMessage(status, body) {
  const e = body?.errors?.[0];
  if (e) return [e.title, e.detail].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(': ');
  if (typeof body === 'string' && body.trim()) return body.trim().slice(0, 300);
  return `Telnyx API returned HTTP ${status}`;
}

/** Build "a=1&page[size]=2" without escaping the brackets Telnyx expects. */
export function qs(query = {}) {
  const parts = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${k}=${encodeURIComponent(v)}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

/**
 * Call the Telnyx API. `body` is sent as JSON, `text` as text/plain.
 * Returns { status, data, ms } where data is parsed JSON, raw text or null.
 * Throws TelnyxError on HTTP >= 400 unless `raw` is set.
 */
export async function call(apiKey, method, path, { query, body, text, raw = false, timeout = TIMEOUT } = {}) {
  if (!apiKey) throw new TelnyxError(401, 'No API key for this profile');
  const headers = { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'User-Agent': 'telnyx-edge-gui/1.0' };
  let payload;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  else if (text !== undefined) { headers['Content-Type'] = 'text/plain'; payload = String(text); }
  const started = Date.now();
  let res;
  try {
    res = await fetch(API_BASE + path + qs(query), { method, headers, body: payload, signal: AbortSignal.timeout(timeout) });
  } catch (e) {
    throw new TelnyxError(502, `Could not reach Telnyx: ${e.cause?.code || e.name === 'TimeoutError' ? 'timed out' : e.message}`);
  }
  const ms = Date.now() - started;
  const type = res.headers.get('content-type') || '';
  const bodyText = res.status === 204 ? '' : await res.text();
  let data = bodyText;
  if (bodyText && (type.includes('json') || /^[[{]/.test(bodyText.trim()))) {
    try { data = JSON.parse(bodyText); } catch { /* keep text */ }
  }
  if (!bodyText) data = null;
  if (res.status >= 400 && !raw) throw new TelnyxError(res.status, errorMessage(res.status, data), data);
  return { status: res.status, data, ms, type };
}

/** Fetch every page of a page[number]/page[size] collection. */
export async function listAll(apiKey, path, { pageSize = 100, maxPages = 20, query = {} } = {}) {
  const items = [];
  for (let page = 1; page <= maxPages; page++) {
    const { data } = await call(apiKey, 'GET', path, { query: { ...query, 'page[number]': page, 'page[size]': pageSize } });
    const rows = Array.isArray(data?.data) ? data.data : [];
    items.push(...rows);
    const total = data?.meta?.total_pages;
    if (!rows.length || !total || page >= total) break;
  }
  return items;
}

/** A key is accepted when an Edge Compute read succeeds with it. */
export async function checkKey(apiKey) {
  try {
    const { data } = await call(apiKey, 'GET', '/v2/compute/funcs', { query: { 'page[number]': 1, 'page[size]': 1 }, timeout: 15000 });
    return { ok: true, functions: data?.meta?.total_results ?? null };
  } catch (e) {
    if (e.status === 401 || e.status === 403) return { ok: false, status: 401, error: 'Telnyx rejected this API key' };
    return { ok: false, status: e.status || 502, error: e.message };
  }
}
