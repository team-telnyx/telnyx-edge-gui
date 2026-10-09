// Telnyx Edge Control Panel — single-page UI, no build step.

const root = document.getElementById('root');

// In the desktop apps, sign-in keys are kept by the OS (macOS Keychain, Windows
// Credential Manager) through a native shell. The page only ever sends it a key
// the user typed; saved keys never come back.
const MAC_BRIDGE = window.webkit?.messageHandlers?.edgeNative;
const WIN_BRIDGE = window.chrome?.webview; // WebView2
const NATIVE = !!(MAC_BRIDGE || WIN_BRIDGE);
const DEVICE = WIN_BRIDGE ? 'PC' : 'Mac';
const KEYSTORE = WIN_BRIDGE ? 'Windows Credential Manager' : 'macOS Keychain';
const pendingNative = new Map();
let nativeSeq = 0;
function native(cmd, args = {}) {
  if (MAC_BRIDGE) return MAC_BRIDGE.postMessage({ cmd, ...args });
  // WebView2 messages have no replies, so match them up by id.
  return new Promise((resolve, reject) => {
    const id = ++nativeSeq;
    pendingNative.set(id, { resolve, reject });
    WIN_BRIDGE.postMessage({ id, cmd, ...args });
  });
}
WIN_BRIDGE?.addEventListener('message', (e) => {
  const m = e.data || {};
  const p = m.id && pendingNative.get(m.id);
  if (p) { pendingNative.delete(m.id); m.error ? p.reject(new Error(m.error)) : p.resolve(m.value); return; }
  if (m.event) window.dispatchEvent(new CustomEvent('edge-native', { detail: m }));
});
const S = { me: null, overview: null, seq: 0, acts: {}, menuOpen: false, filter: '' };

// ---------- helpers ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const enc = encodeURIComponent;

const ICONS = {
  home: '<path d="M3 11 12 3l9 8"/><path d="M5 10v10h14V10"/>',
  fn: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  kv: '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 9.2-9.2M17 6l3 3M14 9l2 2"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  actor: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 9h6v6H9z"/>',
  terminal: '<path d="m5 7 5 5-5 5M12 19h7"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 8M22 21a7 7 0 0 0-5-6.7"/>',
  jobs: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  ext: '<path d="M14 3h7v7M10 14 21 3M19 14v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/>',
  play: '<path d="m6 4 14 8-14 8z"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
};
const icon = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;

const fmtDate = (v) => {
  if (!v) return '<span class="muted">—</span>';
  const d = new Date(v);
  if (Number.isNaN(+d)) return esc(v);
  return `<span title="${esc(d.toISOString())}">${esc(d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }))}</span>`;
};
const ago = (v) => {
  const t = new Date(v).getTime();
  if (!Number.isFinite(t)) return '—';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
const bytes = (n) => {
  if (n === null || n === undefined || n === '') return '—';
  n = +n;
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
};
const statusClass = (s) => {
  s = String(s || '').toLowerCase();
  if (/fail|error|invalid|expired|rejected/.test(s)) return 'bad';
  if (/_ok$|^ok$|ready|active|success|verified|issued|deployed|valid/.test(s)) return 'ok';
  if (/ing$|pending|queued|created|unverified|provision/.test(s)) return 'warn';
  return '';
};
const chip = (s) => (s ? `<span class="chip ${statusClass(s)}">${esc(s)}</span>` : '<span class="muted">—</span>');
const code = (s) => `<code class="copy" data-copy="${esc(s)}" title="Click to copy">${esc(s)}</code>`;
const httpsUrl = (u) => (u ? (/^https?:\/\//.test(u) ? u : `https://${u}`) : '');

function jsonHtml(v) {
  const text = JSON.stringify(v, null, 2) ?? 'null';
  return esc(text).replace(/(&quot;(?:[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/g, (m, str, colon, lit, num) => {
    if (str) return colon ? `<span class="k">${str}</span>${colon}` : `<span class="s">${str}</span>`;
    if (lit) return `<span class="b">${lit}</span>`;
    return `<span class="n">${num}</span>`;
  });
}
const jsonBlock = (v) => `<pre class="code json">${jsonHtml(v)}</pre>`;

function toast(msg, bad = false) {
  const el = document.createElement('div');
  el.className = `toast${bad ? ' bad' : ''}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), bad ? 7000 : 3500);
}

class ApiError extends Error {}

async function api(method, path, body, { text = false } = {}) {
  const headers = { Accept: 'application/json' };
  if (method !== 'GET') { headers['X-Panel'] = '1'; headers['X-CSRF'] = S.me?.csrf || ''; }
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  if (res.status === 401 && !path.startsWith('/auth/')) { S.me = null; renderLogin('Your session ended. Sign in again.'); throw new ApiError('Not signed in'); }
  if (text && res.ok) return res.text();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new ApiError(data.error || `HTTP ${res.status}`), { status: res.status, data });
  return data;
}

// Global delegated click handling: [data-act] → S.acts[name], [data-copy] → clipboard.
document.addEventListener('click', (e) => {
  const copyEl = e.target.closest('[data-copy]');
  if (copyEl) { (NATIVE ? native('copy', { text: copyEl.dataset.copy }) : navigator.clipboard?.writeText(copyEl.dataset.copy))?.then(() => toast('Copied')); return; }
  const actEl = e.target.closest('[data-act]');
  if (actEl && S.acts[actEl.dataset.act]) { e.preventDefault(); e.stopPropagation(); S.acts[actEl.dataset.act](actEl, e); return; }
  const rowEl = e.target.closest('tr[data-href]');
  if (rowEl && !e.target.closest('a,button,input')) location.hash = rowEl.dataset.href;
  if (S.menuOpen && !e.target.closest('.profile-switch')) { S.menuOpen = false; $('.menu')?.remove(); }
});
const acts = (map) => Object.assign(S.acts, map);

// ---------- dialogs ----------

function fieldHtml(f) {
  const id = `f_${f.name}`;
  const req = f.required ? ' required' : '';
  const ph = f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : '';
  const hint = f.hint ? `<span class="hint">${f.hint}</span>` : '';
  if (f.type === 'checkbox') return `<label class="check"><input type="checkbox" name="${f.name}" id="${id}"${f.value ? ' checked' : ''}> ${esc(f.label)}</label>${f.hint ? `<div class="muted small">${f.hint}</div>` : ''}`;
  if (f.type === 'select') return `<label class="field">${esc(f.label)}<select name="${f.name}" id="${id}"${req}>${f.options.map((o) => `<option value="${esc(o.value)}"${o.value === f.value ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>${hint}</label>`;
  if (f.type === 'textarea' || f.type === 'json') return `<label class="field">${esc(f.label)}<textarea name="${f.name}" id="${id}" rows="${f.rows || 6}" class="${f.type === 'json' || f.mono ? 'mono' : ''}"${ph}${req} spellcheck="false">${esc(f.type === 'json' && typeof f.value === 'object' ? JSON.stringify(f.value, null, 2) : f.value ?? '')}</textarea>${hint}</label>`;
  if (f.type === 'color') return `<div class="field"><span>${esc(f.label)}</span><div class="swatches">${f.options.map((c) => `<button type="button" data-swatch="${c}" class="${c === f.value ? 'on' : ''}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div><input type="hidden" name="${f.name}" value="${esc(f.value)}"></div>`;
  if (f.type === 'html') return f.html;
  return `<label class="field">${esc(f.label)}<input type="${f.type || 'text'}" name="${f.name}" id="${id}" value="${esc(f.value ?? '')}"${ph}${req} autocomplete="off" spellcheck="false" class="${f.mono ? 'mono' : ''}">${hint}</label>`;
}

/**
 * Show a form dialog. `onSubmit(values)` may throw to keep the dialog open with
 * the error shown; its return value resolves the promise.
 */
function dialog({ title, fields = [], body = '', submit = 'Save', danger = false, wide = false, onSubmit, cancel = 'Cancel', onOpen }) {
  return new Promise((resolve) => {
    const bd = document.createElement('div');
    bd.className = 'backdrop';
    bd.innerHTML = `<form class="dialog${wide ? ' wide' : ''}" novalidate>
      <div class="hd"><h2>${esc(title)}</h2><button type="button" class="iconbtn" data-close aria-label="Close">${icon('x')}</button></div>
      <div class="bd">${body}${fields.map(fieldHtml).join('')}</div>
      <div class="ft"><span class="err"></span>${cancel ? `<button type="button" class="btn" data-close>${esc(cancel)}</button>` : ''}${submit ? `<button type="submit" class="btn ${danger ? 'danger solid' : 'primary'}">${esc(submit)}</button>` : ''}</div>
    </form>`;
    document.body.append(bd);
    const form = $('form', bd);
    const close = (v) => { bd.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    bd.addEventListener('mousedown', (e) => { if (e.target === bd) close(null); });
    $$('[data-close]', bd).forEach((b) => b.addEventListener('click', () => close(null)));
    $$('[data-swatch]', bd).forEach((b) => b.addEventListener('click', () => {
      $$('[data-swatch]', bd).forEach((x) => x.classList.toggle('on', x === b));
      b.closest('.field').querySelector('input').value = b.dataset.swatch;
    }));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const values = {};
      for (const f of fields) {
        const el = form.elements[f.name];
        if (!el) continue;
        if (f.type === 'checkbox') values[f.name] = el.checked;
        else if (f.type === 'json') {
          const raw = el.value.trim();
          if (!raw) values[f.name] = undefined;
          else { try { values[f.name] = JSON.parse(raw); } catch { $('.err', bd).textContent = `${f.label}: not valid JSON`; return; } }
        } else values[f.name] = el.value;
        if (f.required && !values[f.name]) { $('.err', bd).textContent = `${f.label} is required`; el.focus(); return; }
      }
      const btn = $('button[type=submit]', bd);
      btn.disabled = true;
      $('.err', bd).innerHTML = '<span class="spinner"></span>';
      try {
        const out = onSubmit ? await onSubmit(values, form) : values;
        close(out === undefined ? values : out);
      } catch (err) {
        $('.err', bd).textContent = err.message;
        btn.disabled = false;
      }
    });
    onOpen?.(bd, close);
    (form.querySelector('input:not([type=hidden]),textarea,select') || btn0(bd))?.focus();
  });
}
const btn0 = (bd) => $('button[type=submit]', bd);

function confirmDanger({ title, message, name, action = 'Delete', onConfirm }) {
  const typed = !!name;
  return dialog({
    title,
    body: `<p>${message}</p>${typed ? `<p class="muted small">Type <b>${esc(name)}</b> to confirm.</p>` : ''}`,
    fields: typed ? [{ name: 'confirm', label: 'Name', placeholder: name }] : [],
    submit: action,
    danger: true,
    onSubmit: async (v) => {
      if (typed && v.confirm !== name) throw new Error('The name does not match');
      return (await onConfirm()) ?? true;
    },
  });
}

// ---------- kinds ----------

const KIND = {
  functions: { title: 'Functions', one: 'function', icon: 'fn', desc: 'Serverless functions running on Telnyx Edge.', typed: true },
  sqldbs: { title: 'SQL databases', one: 'SQL database', icon: 'db', desc: 'SQLite-compatible databases bound to functions.', typed: true },
  kvs: { title: 'KV namespaces', one: 'KV namespace', icon: 'kv', desc: 'Key-value storage bound to functions.', typed: true },
  secrets: { title: 'Secrets', one: 'secret', icon: 'lock', desc: 'Encrypted environment values for your functions. Values are write-only.' },
  bindings: { title: 'API key bindings', one: 'binding', icon: 'link', desc: 'Telnyx API key bindings injected into functions.' },
  domains: { title: 'Custom domains', one: 'domain', icon: 'globe', desc: 'Your own hostnames routed to functions.' },
  actors: { title: 'Actors', one: 'actor type', icon: 'actor', desc: 'Account-scoped StatefulActor types and their instances.' },
};

async function listOf(kind, force = false) {
  return (await api('GET', `/api/${kind}${force ? '?refresh=1' : ''}`)).items;
}

async function functionOptions(selected) {
  const fns = await listOf('functions').catch(() => []);
  return [{ value: '', label: '— choose a function —' }, ...fns.map((f) => ({ value: f._id, label: `${f._name} (${f.status || '?'})` }))].map((o) => ({ ...o, selected: o.value === selected }));
}

async function openCreate(kind) {
  const k = KIND[kind];
  let fields;
  switch (kind) {
    case 'functions': fields = [{ name: 'name', label: 'Function name', required: true, placeholder: 'my-function', hint: 'Creates the function record. Ship code to it with <code>telnyx-edge ship</code>. Telnyx chooses the region: it cannot be set yet.' }]; break;
    case 'sqldbs': fields = [{ name: 'name', label: 'Database name', required: true, placeholder: 'my-db', hint: 'Provisioning can take several minutes.' }]; break;
    case 'kvs': fields = [{ name: 'name', label: 'Namespace name', required: true, placeholder: 'my-kv' }]; break;
    case 'secrets': fields = [
      { name: 'secret_name', label: 'Name', required: true, placeholder: 'MY_SECRET', mono: true },
      { name: 'secret_value', label: 'Value', type: 'textarea', rows: 3, required: true, mono: true, hint: 'Stored encrypted by Telnyx. It cannot be read back.' },
    ]; break;
    case 'domains': fields = [
      { name: 'domain', label: 'Hostname', required: true, placeholder: 'api.example.com' },
      { name: 'function_id', label: 'Function', type: 'select', options: await functionOptions(), required: true },
    ]; break;
    case 'bindings': fields = [
      { name: 'raw', label: 'Binding (JSON body)', type: 'json', rows: 8, value: { binding_type: 'telnyx-sdk', env_name: 'TELNYX' }, hint: 'Sent as-is to <code>POST /v2/compute/bindings</code>.' },
    ]; break;
    default: toast(`${k.title} are created by shipping a function.`, true); return;
  }
  const r = await dialog({ title: `New ${k.one}`, fields, submit: 'Create', onSubmit: (v) => api('POST', `/api/${kind}`, v) });
  if (r?.item) { toast(`Created ${r.item._name || k.one}`); refreshCounts(); location.hash = r.item._id ? `#/${kind}/${enc(r.item._id)}` : `#/${kind}`; route(); }
}

async function openEdit(kind, item) {
  const k = KIND[kind];
  let fields; let title = `Edit ${k.one}`;
  switch (kind) {
    case 'functions': location.hash = `#/functions/${enc(item._id)}/settings`; return;
    case 'sqldbs':
    case 'kvs': fields = [{ name: 'name', label: 'Name', value: item._name, required: true }]; title = `Rename ${k.one}`; break;
    case 'secrets': fields = [{ name: 'secret_value', label: `New value for ${item._name}`, type: 'textarea', rows: 3, required: true, mono: true, hint: 'Functions pick up the new value on their next deploy.' }]; title = 'Update secret value'; break;
    case 'domains': fields = [{ name: 'function_id', label: 'Route to function', type: 'select', options: await functionOptions(item.function_id || item.func_id), value: item.function_id || item.func_id, required: true }]; break;
    case 'bindings': {
      const { _id, _name, record_type, binding_id, created_at, updated_at, status, ...rest } = item;
      fields = [{ name: 'raw', label: 'Fields to change (JSON)', type: 'json', rows: 8, value: rest, hint: 'Sent as <code>PATCH /v2/compute/bindings/{id}</code>.' }];
      break;
    }
    default: toast(`${k.title} cannot be edited here.`, true); return;
  }
  const r = await dialog({ title, fields, onSubmit: (v) => api('PATCH', `/api/${kind}/${enc(item._id)}`, v) });
  if (r) { toast('Saved'); route(); }
}

async function openDuplicate(kind, item) {
  const k = KIND[kind];
  let fields;
  const copyName = `${item._name}-copy`;
  switch (kind) {
    case 'functions': fields = [{ name: 'name', label: 'New function name', value: copyName, required: true, hint: 'Creates a new function and copies its log export destination. Code and storage bindings come with <code>telnyx-edge ship</code>.' }]; break;
    case 'sqldbs': fields = [
      { name: 'name', label: 'New database name', value: copyName, required: true },
      { name: 'withData', label: 'Copy rows too (not only the schema)', type: 'checkbox', value: true, hint: 'Runs in the background: the new database is provisioned first, which can take several minutes.' },
    ]; break;
    case 'kvs': fields = [
      { name: 'name', label: 'New namespace name', value: copyName, required: true },
      { name: 'withData', label: 'Copy all keys and values', type: 'checkbox', value: true, hint: 'Runs in the background.' },
    ]; break;
    case 'secrets': fields = [
      { name: 'name', label: 'New secret name', value: `${item._name}_COPY`, required: true, mono: true },
      { name: 'secret_value', label: 'Value', type: 'textarea', rows: 3, required: true, mono: true, hint: 'Secret values cannot be read back, so enter the value again.' },
    ]; break;
    case 'domains': fields = [
      { name: 'name', label: 'New hostname', value: '', placeholder: `other.${item._name}`, required: true },
      { name: 'function_id', label: 'Function', type: 'select', options: await functionOptions(item.function_id || item.func_id), value: item.function_id || item.func_id, required: true },
    ]; break;
    case 'bindings': fields = [{ name: 'name', label: 'New env name', value: `${item._name}_COPY`, required: true, mono: true }]; break;
    default: toast(`${k.title} cannot be duplicated.`, true); return;
  }
  const r = await dialog({ title: `Duplicate ${k.one} “${item._name}”`, fields, submit: 'Duplicate', onSubmit: (v) => api('POST', `/api/${kind}/${enc(item._id)}/duplicate`, v) });
  if (!r) return;
  refreshCounts();
  if (r.job) return jobDialog(r.job);
  if (r.notes?.length) await dialog({ title: 'Duplicated', body: `<ul>${r.notes.map((n) => `<li>${esc(n).replace(/`([^`]+)`/g, '<code>$1</code>')}</li>`).join('')}</ul>`, submit: 'Open', cancel: 'Close', onSubmit: () => { location.hash = `#/${kind}/${enc(r.item._id)}`; } });
  else { toast('Duplicated'); if (r.item?._id) location.hash = `#/${kind}/${enc(r.item._id)}`; }
  route();
}

async function doDelete(kind, item, after) {
  const k = KIND[kind];
  const extra = {
    functions: 'The function stops serving traffic and its revisions are removed.',
    sqldbs: 'All tables and rows are deleted. Export a .sql dump first if you need them.',
    kvs: 'All keys and values in the namespace are deleted.',
    secrets: 'Functions that read this secret will no longer get it on their next deploy.',
    domains: 'Traffic to this hostname stops reaching the function.',
    bindings: 'Functions using this binding lose their Telnyx API credentials.',
    actors: 'Persisted actor instances of this type may be removed.',
  }[kind] || '';
  const ok = await confirmDanger({
    title: `Delete ${k.one}`,
    message: `Delete <b>${esc(item._name)}</b>? ${extra}`,
    name: k.typed ? item._name : null,
    onConfirm: () => api('DELETE', `/api/${kind}/${enc(item._id)}`),
  });
  if (!ok) return;
  toast(`Deleted ${item._name}`);
  refreshCounts();
  if (after) after(); else { location.hash = `#/${kind}`; route(); }
}

async function jobDialog(id) {
  let timer;
  await dialog({
    title: 'Background job',
    body: '<div id="jobbody" class="loading"><span class="spinner"></span></div>',
    submit: null,
    cancel: 'Close',
    wide: true,
    onOpen: (bd) => {
      const tick = async () => {
        if (!document.body.contains(bd)) return;
        const j = await api('GET', `/api/jobs/${id}`).catch((e) => ({ status: 'failed', error: e.message, log: [] }));
        const body = $('#jobbody', bd);
        if (!body) return;
        body.className = '';
        body.innerHTML = `<div class="row"><b>${esc(j.title || '')}</b> ${chip(j.status === 'done' ? 'done_ok' : j.status)}</div>
          <pre class="code">${esc((j.log || []).map((l) => `${new Date(l.at).toLocaleTimeString()}  ${l.msg}`).join('\n') || 'Starting…')}</pre>
          ${j.status === 'done' && j.result?.id ? `<a class="btn primary" href="#/${j.result.kind}/${enc(j.result.id)}">Open ${esc(j.result.name)}</a>` : ''}
          ${j.error ? `<div class="note bad">${esc(j.error)}</div>` : ''}`;
        $('a.btn', body)?.addEventListener('click', () => bd.querySelector('[data-close]').click());
        if (j.status === 'running') timer = setTimeout(tick, 2000);
      };
      tick();
    },
  });
  clearTimeout(timer);
}

// ---------- layout ----------

const NAV = [
  { group: null, items: [['', 'Overview', 'home']] },
  { group: 'Compute', items: [['functions', 'Functions', 'fn'], ['actors', 'Actors', 'actor'], ['secrets', 'Secrets', 'lock'], ['bindings', 'API key bindings', 'link'], ['domains', 'Custom domains', 'globe']] },
  { group: 'Storage', items: [['sqldbs', 'SQL databases', 'db'], ['kvs', 'KV namespaces', 'kv']] },
  { group: 'Tools', items: [['explorer', 'API explorer', 'terminal'], ['jobs', 'Jobs', 'jobs'], ['profiles', 'Profiles', 'users']] },
];

const activeProfile = () => S.me?.profiles.find((p) => p.id === S.me.activeId) || null;

function renderShell() {
  root.innerHTML = `<div class="app" id="app">
    <aside class="nav">
      <div class="brand"><img class="logo" src="telnyx-logo.svg" alt="Telnyx"><small><b>Edge</b> Control Panel</small></div>
      <div class="profile-switch" id="pswitch"></div>
      <nav id="navitems"></nav>
      <div class="navfoot">
        <span class="ellipsis" title="${esc(S.me.apiBase)}">API ${esc(S.me.apiBase.replace(/^https?:\/\//, ''))}</span>
        <button class="btn sm" data-act="logout">${icon('logout')} Sign out</button>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <button class="iconbtn only-mobile" data-act="navtoggle" aria-label="Menu">${icon('menu')}</button>
        <div class="crumbs" id="crumbs"></div>
        <input type="search" class="search" id="filter" placeholder="Filter this page…  ( / )" autocomplete="off">
        <button class="btn" data-act="refresh" title="Reload from Telnyx">${icon('refresh')} Refresh</button>
      </header>
      <main class="content" id="content"></main>
    </div>
  </div>`;
  $('#filter').addEventListener('input', (e) => { S.filter = e.target.value.toLowerCase(); applyFilter(); });
  renderProfileSwitch();
  renderNav();
}

function renderProfileSwitch() {
  const p = activeProfile();
  const el = $('#pswitch');
  if (!el) return;
  el.innerHTML = `<button class="profile-btn" data-act="pmenu" aria-haspopup="true">
    <span class="pdot" style="background:${esc(p?.color || '#999')}"></span>
    <span class="grow ellipsis"><span class="pname">${esc(p?.name || 'No profile')}</span><br><span class="phint">key ${esc(p?.keyHint || '')}</span></span>${icon('chevron')}</button>`;
}

function renderNav() {
  const hash = location.hash.replace(/^#\/?/, '');
  const first = hash.split('/')[0];
  const c = S.overview?.counts || {};
  const bad = {};
  for (const a of S.overview?.attention || []) bad[a.kind] = (bad[a.kind] || 0) + 1;
  $('#navitems').innerHTML = NAV.map((g) => `<div class="navgroup">${g.group ? `<div class="navhead">${g.group}</div>` : ''}${g.items.map(([k, label, ic]) => {
    const n = c[k];
    const count = k in c ? `<span class="count${bad[k] ? ' bad' : ''}" title="${bad[k] ? `${bad[k]} need attention` : ''}">${n ?? '!'}</span>` : '';
    return `<a class="navitem${first === k ? ' on' : ''}" href="#/${k}">${icon(ic)} ${label}${count}</a>`;
  }).join('')}</div>`).join('');
}

function setCrumbs(parts) {
  const p = activeProfile();
  $('#crumbs').innerHTML = [`<span class="envtag"><span class="pdot" style="background:${esc(p?.color)}"></span>${esc(p?.name || '')}</span>`, ...parts.map((x, i) => (i === parts.length - 1 ? `<b>${esc(x[0])}</b>` : `<a href="${x[1]}">${esc(x[0])}</a>`))].join('<span class="sep">/</span>');
  document.title = `${parts.at(-1)?.[0] || 'Overview'} · Edge Control Panel`;
}

function applyFilter() {
  const q = S.filter;
  $$('#content [data-text]').forEach((el) => { el.classList.toggle('hidden', !!q && !el.dataset.text.includes(q)); });
}

async function refreshCounts(force = false) {
  try {
    S.overview = await api('GET', `/api/overview${force ? '?refresh=1' : ''}`);
    renderNav();
  } catch { /* shown on the page itself */ }
}

acts({
  logout: async () => { await api('POST', '/auth/logout').catch(() => {}); S.me = null; S.overview = null; renderLogin(); },
  refresh: async () => { await refreshCounts(true); route(true); },
  navtoggle: () => $('#app').classList.toggle('navopen'),
  pmenu: (el) => {
    if (S.menuOpen) { S.menuOpen = false; $('.menu')?.remove(); return; }
    S.menuOpen = true;
    const m = document.createElement('div');
    m.className = 'menu';
    m.innerHTML = `${S.me.profiles.map((p) => `<button data-act="pswitch" data-id="${p.id}"><span class="pdot" style="background:${esc(p.color)}"></span><span class="grow ellipsis">${esc(p.name)}</span><span class="muted small">${esc(p.keyHint)}</span>${p.id === S.me.activeId ? icon('check') : ''}</button>`).join('')}
      <hr><button data-act="paddmenu">${icon('plus')} Add profile…</button><button data-act="pmanage">${icon('users')} Manage profiles</button>`;
    el.parentElement.append(m);
  },
  pswitch: (el) => switchProfile(el.dataset.id),
  paddmenu: () => { S.menuOpen = false; $('.menu')?.remove(); addProfile(); },
  pmanage: () => { S.menuOpen = false; $('.menu')?.remove(); location.hash = '#/profiles'; },
});

async function switchProfile(id) {
  S.menuOpen = false;
  $('.menu')?.remove();
  if (id === S.me.activeId) return;
  S.me = await api('POST', `/api/profiles/${id}/activate`);
  S.overview = null;
  renderProfileSwitch();
  toast(`Switched to ${activeProfile()?.name}`);
  // Object ids belong to one account, so leave any detail page.
  const first = location.hash.replace(/^#\/?/, '').split('/')[0];
  if (!['', 'explorer', 'profiles', 'jobs'].includes(first) && location.hash.split('/').length > 2) location.hash = `#/${first}`;
  refreshCounts();
  route();
}

async function addProfile() {
  const r = await dialog({
    title: 'Add profile',
    body: '<p class="muted">A profile is a named Telnyx API key. The key is checked against Telnyx before it is saved, encrypted, in your vault.</p>',
    fields: [
      { name: 'name', label: 'Profile name', required: true, placeholder: 'Production' },
      { name: 'apiKey', label: 'Telnyx API key', type: 'password', required: true, placeholder: 'KEY…', mono: true },
      { name: 'color', label: 'Color', type: 'color', options: S.me.colors, value: S.me.colors[S.me.profiles.length % S.me.colors.length] },
      { name: 'activate', label: 'Switch to it now', type: 'checkbox', value: true },
    ],
    submit: 'Verify & add',
    onSubmit: (v) => api('POST', '/api/profiles', { name: v.name, apiKey: v.apiKey, color: v.color }).then((res) => ({ ...res, activate: v.activate })),
  });
  if (!r) return;
  S.me = { ...S.me, profiles: r.profiles, activeId: r.activeId };
  toast(`Added ${r.profile.name}`);
  if (r.activate) await switchProfile(r.profile.id);
  else { renderProfileSwitch(); route(); }
}

// ---------- router ----------

const PAGES = {};

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  return parts;
}

async function route(force = false) {
  if (!S.me) return;
  const parts = parseHash();
  const seq = ++S.seq;
  S.acts = Object.fromEntries(Object.entries(S.acts).filter(([k]) => GLOBAL_ACTS.has(k)));
  $('#app')?.classList.remove('navopen');
  renderNav();
  const content = $('#content');
  content.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  const first = parts[0] || '';
  const page = first === '' ? PAGES.overview : KIND[first] ? (parts[1] ? PAGES[`${first}Detail`] || PAGES.genericDetail : PAGES.list) : PAGES[first];
  if (!page) { content.innerHTML = '<div class="empty">Page not found.</div>'; setCrumbs([['Not found']]); return; }
  try {
    await page({ parts, kind: first, id: parts[1], sub: parts[2], extra: parts[3], force, content, alive: () => seq === S.seq });
    if (seq === S.seq) applyFilter();
  } catch (e) {
    if (seq !== S.seq || e instanceof ApiError && e.message === 'Not signed in') return;
    content.innerHTML = `<div class="card"><div class="bd"><div class="note bad">${esc(e.message)}</div>${e.data?.telnyx ? jsonBlock(e.data.telnyx) : ''}</div></div>`;
  }
}
window.addEventListener('hashchange', () => route());
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !e.target.closest('input,textarea,select') && !$('.backdrop')) { e.preventDefault(); $('#filter')?.focus(); }
});
let GLOBAL_ACTS;

// ---------- overview ----------

PAGES.overview = async ({ content, force, alive }) => {
  setCrumbs([['Overview']]);
  const o = await api('GET', `/api/overview${force ? '?refresh=1' : ''}`);
  if (!alive()) return;
  S.overview = o;
  renderNav();
  const p = activeProfile();
  const kpi = (k) => {
    const n = o.counts[k];
    const st = Object.entries(o.statuses[k] || {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
    return `<a class="card kpi" href="#/${k}"><span class="l">${icon(KIND[k].icon)} ${KIND[k].title}</span><span class="v">${n ?? '—'}</span>
      <span class="small muted">${o.errors[k] ? `<span class="lvl-error">${esc(o.errors[k])}</span>` : st.map(([s, c]) => `${c} ${esc(s)}`).join(' · ') || '&nbsp;'}</span></a>`;
  };
  content.innerHTML = `
    <div class="pagehead"><div><h1>Overview</h1><p>Everything on Telnyx Edge for <b>${esc(p?.name)}</b> (key ${esc(p?.keyHint)}). Updated ${esc(ago(o.fetchedAt))}.</p></div></div>
    <div class="grid kpis">${Object.keys(KIND).map(kpi).join('')}</div>
    <div class="grid two" style="margin-top:14px">
      <div class="card"><div class="hd"><h3>Needs attention</h3><span class="chip ${o.attention.length ? 'bad' : 'ok'}">${o.attention.length}</span></div>
        <div class="bd flush">${o.attention.length ? `<table class="t"><tbody>${o.attention.map((a) => `<tr class="link" data-href="#/${a.kind}/${enc(a.id)}" data-text="${esc(`${a.name} ${a.status} ${a.message}`.toLowerCase())}">
          <td>${icon(KIND[a.kind].icon)} <b>${esc(a.name)}</b><div class="small muted">${esc(a.message)}</div></td><td>${chip(a.status)}</td><td class="small muted nowrap">${esc(ago(a.updated_at))}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">All good. Nothing is failing.</div>'}</div></div>
      <div class="card"><div class="hd"><h3>Recently changed</h3></div>
        <div class="bd flush">${o.recent.length ? `<table class="t"><tbody>${o.recent.map((a) => `<tr class="link" data-href="#/${a.kind}/${enc(a.id)}" data-text="${esc(`${a.name} ${a.kind}`.toLowerCase())}">
          <td>${icon(KIND[a.kind].icon)} ${esc(a.name)}</td><td>${chip(a.status)}</td><td class="small muted nowrap">${esc(ago(a.at))}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nothing yet.</div>'}</div></div>
    </div>`;
};

// ---------- generic list ----------

const COLS = {
  functions: [['Name', (x) => `<b>${esc(x._name)}</b>`], ['Status', (x) => chip(x.status)], ['Invoke URL', (x) => (x.invoke_url ? `<a href="${esc(httpsUrl(x.invoke_url))}" target="_blank" rel="noopener" class="small">${esc(x.invoke_url)}</a>` : '—')], ['Region', (x) => `<span data-region="${esc(x._id)}" class="muted small">…</span>`], ['Bindings', (x) => (x.bindings?.length ?? 0)], ['Updated', (x) => fmtDate(x.updated_at)]],
  sqldbs: [['Name', (x) => `<b>${esc(x._name)}</b>`], ['Status', (x) => chip(x.status)], ['Created', (x) => fmtDate(x.created_at)], ['Updated', (x) => fmtDate(x.updated_at)], ['ID', (x) => `<span class="mono small muted">${esc(x._id)}</span>`]],
  kvs: [['Name', (x) => `<b>${esc(x._name)}</b>`], ['Status', (x) => chip(x.status)], ['Created', (x) => fmtDate(x.created_at)], ['Updated', (x) => fmtDate(x.updated_at)], ['ID', (x) => `<span class="mono small muted">${esc(x._id)}</span>`]],
  secrets: [['Name', (x) => `<b class="mono">${esc(x._name)}</b>`], ['Value', () => '<span class="muted">••••••••</span>'], ['Created', (x) => fmtDate(x.created_at)], ['Updated', (x) => fmtDate(x.updated_at)]],
  bindings: [['Env name', (x) => `<b class="mono">${esc(x._name)}</b>`], ['Type', (x) => `<span class="chip plain">${esc(x.binding_type || '—')}</span>`], ['Status', (x) => chip(x.status)], ['Updated', (x) => fmtDate(x.updated_at)], ['ID', (x) => `<span class="mono small muted">${esc(x._id)}</span>`]],
  domains: [['Hostname', (x) => `<b>${esc(x._name)}</b>`], ['Verification', (x) => chip(x.verification_status)], ['Certificate', (x) => chip(x.cert_status)], ['Function', (x) => `<span class="mono small">${esc(x.function_name || x.function_id || x.func_id || '—')}</span>`], ['Created', (x) => fmtDate(x.created_at)]],
  actors: [['Actor type', (x) => `<b>${esc(x._name)}</b>`], ['Status', (x) => chip(x.status)], ['Owner function', (x) => `<span class="mono small">${esc(x.owner_function_id || '—')}</span>`], ['Created', (x) => fmtDate(x.created_at)]],
};
const CAN = {
  create: new Set(['functions', 'sqldbs', 'kvs', 'secrets', 'domains', 'bindings']),
  edit: new Set(['functions', 'sqldbs', 'kvs', 'secrets', 'domains', 'bindings']),
  dup: new Set(['functions', 'sqldbs', 'kvs', 'secrets', 'domains', 'bindings']),
};

function rowActions(kind) {
  return `<button class="iconbtn" data-act="open" title="Open">${icon('eye')}</button>
    ${CAN.edit.has(kind) ? `<button class="iconbtn" data-act="edit" title="Edit">${icon('edit')}</button>` : ''}
    ${CAN.dup.has(kind) ? `<button class="iconbtn" data-act="dup" title="Duplicate">${icon('copy')}</button>` : ''}
    <button class="iconbtn danger" data-act="del" title="Delete">${icon('trash')}</button>`;
}

PAGES.list = async ({ kind, content, force, alive }) => {
  const k = KIND[kind];
  setCrumbs([[k.title]]);
  const items = await listOf(kind, force);
  if (!alive()) return;
  if (kind === 'domains') {
    const fns = await listOf('functions').catch(() => []);
    const byId = new Map(fns.map((f) => [f._id, f._name]));
    items.forEach((d) => { d.function_name = byId.get(d.function_id || d.func_id); });
  }
  const byId = new Map(items.map((x) => [x._id, x]));
  const cols = COLS[kind];
  const statuses = {};
  items.forEach((x) => { if (x.status) statuses[x.status] = (statuses[x.status] || 0) + 1; });
  content.innerHTML = `
    <div class="pagehead"><div><h1>${icon(k.icon)} ${k.title} <span class="chip plain">${items.length}</span></h1><p>${k.desc}</p></div>
      <div class="actions">${CAN.create.has(kind) ? `<button class="btn primary" data-act="create">${icon('plus')} New ${k.one}</button>` : ''}</div></div>
    ${Object.keys(statuses).length > 1 ? `<div class="row" style="margin-bottom:12px">${Object.entries(statuses).map(([s, n]) => `<button class="btn sm" data-act="statusfilter" data-s="${esc(s)}">${chip(s)} ${n}</button>`).join('')}</div>` : ''}
    <div class="card"><div class="bd flush tablewrap">${items.length ? `<table class="t"><thead><tr>${cols.map((c) => `<th>${c[0]}</th>`).join('')}<th></th></tr></thead><tbody>
      ${items.map((x) => `<tr class="link" data-href="#/${kind}/${enc(x._id)}" data-id="${esc(x._id)}" data-text="${esc(JSON.stringify(x).toLowerCase())}">${cols.map((c) => `<td>${c[1](x)}</td>`).join('')}<td class="acts">${rowActions(kind)}</td></tr>`).join('')}
    </tbody></table>` : `<div class="empty">No ${k.title.toLowerCase()} yet.${CAN.create.has(kind) ? ' Use <b>New</b> to create one.' : ''}</div>`}</div></div>
    ${kind === 'actors' ? '<p class="muted small">Actor types are registered when a function that declares them is shipped.</p>' : ''}`;
  const item = (el) => byId.get(el.closest('tr').dataset.id);
  acts({
    create: () => openCreate(kind),
    open: (el) => { location.hash = `#/${kind}/${enc(item(el)._id)}`; },
    edit: (el) => openEdit(kind, item(el)),
    dup: (el) => openDuplicate(kind, item(el)),
    del: (el) => doDelete(kind, item(el), () => route(true)),
    statusfilter: (el) => { $('#filter').value = el.dataset.s; S.filter = el.dataset.s.toLowerCase(); applyFilter(); },
  });
  if (kind === 'functions' && items.length) {
    // Regions come from each function's request logs, so they load after the table.
    const r = await api('GET', `/api/regions${force ? '?refresh=1' : ''}`).catch(() => null);
    if (!alive()) return;
    content.querySelectorAll('[data-region]').forEach((el) => {
      const list = r?.regions?.[el.dataset.region];
      if (list?.length) el.closest('tr').dataset.text += ` ${list.map((x) => x.region).join(' ').toLowerCase()}`;
      el.outerHTML = regionChips(list);
    });
    applyFilter();
  }
};

// ---------- detail helpers ----------

function fieldsTable(item, skip = []) {
  const hidden = new Set(['_id', '_name', 'record_type', ...skip]);
  const rows = Object.entries(item).filter(([k]) => !hidden.has(k));
  return `<dl class="kv">${rows.map(([k, v]) => {
    let val;
    if (v === null || v === undefined || v === '') val = '<span class="muted">—</span>';
    else if (typeof v === 'object') val = Array.isArray(v) && !v.length ? '<span class="muted">none</span>' : jsonBlock(v);
    else if (/_at$/.test(k)) val = `${fmtDate(v)} <span class="muted small">${esc(ago(v))}</span>`;
    else if (/status$/.test(k)) val = chip(v);
    else if (/(^|_)id$/.test(k)) val = code(v);
    else if (k === 'invoke_url') val = `<a href="${esc(httpsUrl(v))}" target="_blank" rel="noopener">${esc(v)} ${icon('ext')}</a>`;
    else val = esc(v);
    return `<dt>${esc(k)}</dt><dd>${val}</dd>`;
  }).join('')}</dl>`;
}

function detailHead(kind, item, extraButtons = '') {
  const k = KIND[kind];
  return `<div class="pagehead"><div><h1>${icon(k.icon)} ${esc(item._name)} ${item.status ? chip(item.status) : ''}</h1>
    <p>${k.one[0].toUpperCase() + k.one.slice(1)} · ${code(item._id)}${item.message ? ` · ${esc(item.message)}` : ''}</p></div>
    <div class="actions">${extraButtons}
      ${CAN.edit.has(kind) ? `<button class="btn" data-act="dedit">${icon('edit')} Edit</button>` : ''}
      ${CAN.dup.has(kind) ? `<button class="btn" data-act="ddup">${icon('copy')} Duplicate</button>` : ''}
      <button class="btn danger" data-act="ddel">${icon('trash')} Delete</button></div></div>`;
}

function detailActs(kind, item) {
  acts({ dedit: () => openEdit(kind, item), ddup: () => openDuplicate(kind, item), ddel: () => doDelete(kind, item) });
}

const tabs = (base, list, on) => `<nav class="tabs">${list.map(([k, label]) => `<a href="${base}${k ? `/${k}` : ''}" class="${(on || '') === k ? 'on' : ''}">${label}</a>`).join('')}</nav>`;
const card = (title, body, extra = '') => `<div class="card"><div class="hd"><h3>${title}</h3>${extra}</div><div class="bd">${body}</div></div>`;

function dataTable(columns, rows, { empty = 'No rows.' } = {}) {
  if (!rows.length) return `<div class="empty">${empty}</div>`;
  const cell = (v) => {
    if (v === null || v === undefined) return '<span class="muted">NULL</span>';
    if (typeof v === 'object') v = JSON.stringify(v);
    const s = String(v);
    return s.length > 160 ? `<span title="${esc(s.slice(0, 2000))}">${esc(s.slice(0, 160))}…</span>` : esc(s);
  };
  return `<div class="tablewrap"><table class="t"><thead><tr>${columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>
    ${rows.map((r) => `<tr data-text="${esc(JSON.stringify(r).toLowerCase().slice(0, 4000))}">${columns.map((c) => `<td class="mono small">${cell(r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

// ---------- functions ----------

const METRIC_LABELS = {
  request_count: 'Requests', request_success_rate: 'Success rate', request_error_count: '5xx errors', request_client_error_count: '4xx errors',
  request_latency_p50_ms: 'Latency p50', request_latency_p95_ms: 'Latency p95', request_latency_p99_ms: 'Latency p99', request_latency_avg_ms: 'Latency avg',
  cpu_used_cores_avg: 'CPU avg', cpu_used_cores_max: 'CPU max', memory_used_bytes_avg: 'Memory avg', memory_used_bytes_max: 'Memory max',
};
const metricValue = (k, v) => {
  if (typeof v !== 'number') return esc(v ?? '—');
  if (/_rate$/.test(k)) return `${(v <= 1 ? v * 100 : v).toFixed(1)}%`;
  if (/_bytes/.test(k)) return bytes(v);
  if (/_ms$|latency/.test(k)) return `${v.toFixed(v < 10 ? 1 : 0)} ms`;
  if (/_cores/.test(k)) return `${v.toFixed(3)} cores`;
  return v.toLocaleString();
};
function metricsHtml(list) {
  if (!list?.length) return '<div class="empty">No metrics in this window.</div>';
  const m = list[0];
  const known = Object.keys(METRIC_LABELS).filter((k) => k in m);
  const rest = Object.entries(m).filter(([k, v]) => typeof v === 'number' && !known.includes(k));
  return `<div class="grid kpis">${known.map((k) => `<div class="card kpi"><span class="l">${METRIC_LABELS[k]}</span><span class="v">${metricValue(k, m[k])}</span></div>`).join('')}</div>
    ${rest.length ? `<dl class="kv" style="margin-top:14px">${rest.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${metricValue(k, v)}</dd>`).join('')}</dl>` : ''}
    ${list.length > 1 ? `<details style="margin-top:12px"><summary class="muted">All ${list.length} aggregates</summary>${jsonBlock(list)}</details>` : ''}`;
}

const NO_REGION = 'No requests in the last 24 hours, so the region is not known.';
/** Regions a function served requests from, busiest first. `null` means the logs could not be read. */
function regionChips(list) {
  if (!list) return '<span class="muted" title="The request logs could not be read.">?</span>';
  if (!list.length) return `<span class="muted" title="${NO_REGION}">—</span>`;
  const total = list.reduce((n, r) => n + r.requests, 0);
  return list.map((r) => `<span class="chip plain" title="${r.requests} of the last ${total} request(s)">${esc(r.region)}${list.length > 1 ? ` ${Math.round((r.requests / total) * 100)}%` : ''}</span>`).join(' ');
}

PAGES.functionsDetail = async ({ id, sub, content, alive }) => {
  const d = await api('GET', `/api/functions/${enc(id)}`);
  if (!alive()) return;
  const f = d.item;
  setCrumbs([['Functions', '#/functions'], [f._name]]);
  const base = `#/functions/${enc(id)}`;
  const url = httpsUrl(f.invoke_url);
  const failed = /fail/.test(f.status || '');
  content.innerHTML = `${detailHead('functions', f, `${url ? `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener">${icon('ext')} Open</a>` : ''}${failed ? `<button class="btn" data-act="reset">${icon('undo')} Reset</button>` : ''}`)}
    ${tabs(base, [['', 'Overview'], ['metrics', 'Metrics'], ['revisions', `Revisions (${d.revisions.length})`], ['logs', 'Logs'], ['settings', 'Log export'], ['raw', 'Raw JSON']], sub)}
    <div id="tab"></div>`;
  detailActs('functions', f);
  acts({
    reset: () => confirmDanger({ title: 'Reset function', message: `Reset <b>${esc(f._name)}</b> back to the <i>created</i> state so it can be shipped again?`, action: 'Reset', onConfirm: () => api('POST', `/api/functions/${enc(id)}/actions/reset`) }).then((ok) => { if (ok) { toast('Reset requested'); route(true); } }),
  });
  const tab = $('#tab');
  if (!sub) {
    tab.innerHTML = `<div class="grid two">
      ${card('Details', fieldsTable(f, ['bindings']))}
      <div class="stack">
        ${card('Region', d.regionsError ? `<div class="note warn">${esc(d.regionsError)}</div>` : `${d.regions.length ? regionChips(d.regions) : `<div class="muted">${NO_REGION}</div>`}
          <div class="muted small" style="margin-top:8px">Where requests ran in the last 24 hours. Telnyx chooses the region: it cannot be set yet.</div>`)}
        ${card('Bindings', f.bindings.length ? `<table class="t"><thead><tr><th>Env</th><th>Type</th><th>Target</th><th>Status</th></tr></thead><tbody>${f.bindings.map((b) => `<tr><td class="mono">${esc(b.env_name)}</td><td>${esc(b.binding_type)}</td>
          <td>${b.target_kind ? `<a href="#/${b.target_kind}/${enc(b.target_id)}">${esc(b.target_name || b.target_id)}</a>` : '—'}</td><td>${chip(b.status)}</td></tr>`).join('')}</tbody></table>` : '<div class="muted">No storage bindings. Declare them in <code>func.toml</code> and ship.</div>')}
        ${card('Last 24 hours', d.metricsError ? `<div class="note warn">${esc(d.metricsError)}</div>` : metricsHtml(d.metrics), `<a class="small" href="${base}/metrics" style="margin-left:auto">More</a>`)}
        ${card('Custom domains', d.domains.length ? d.domains.map((x) => `<div><a href="#/domains/${enc(x._id)}">${esc(x._name)}</a> ${chip(x.verification_status)}</div>`).join('') : '<div class="muted">None.</div>')}
        ${card('CLI', `<pre class="code">telnyx-edge ship            # from the function folder\ntelnyx-edge logs ${esc(f._name)} --follow\ntelnyx-edge deployments ${esc(f._name)}\ntelnyx-edge metrics ${esc(f._name)}</pre>`)}
      </div></div>`;
  } else if (sub === 'metrics') {
    const draw = async (range) => {
      $('#mbody').innerHTML = '<div class="loading"><span class="spinner"></span></div>';
      const m = await api('GET', `/api/functions/${enc(id)}/metrics?range=${range}`).catch((e) => ({ error: e.message }));
      if (!alive()) return;
      $('#mbody').innerHTML = m.error ? `<div class="note bad">${esc(m.error)}</div>` : metricsHtml(m.data);
    };
    tab.innerHTML = card('Metrics', '<div id="mbody"></div>', `<select id="mrange" style="margin-left:auto">${['1h', '6h', '24h', '7d'].map((r) => `<option${r === '24h' ? ' selected' : ''}>${r}</option>`).join('')}</select>`);
    $('#mrange').addEventListener('change', (e) => draw(e.target.value));
    draw('24h');
  } else if (sub === 'revisions') {
    tab.innerHTML = card('Deploy history', d.revisionsError ? `<div class="note bad">${esc(d.revisionsError)}</div>` : d.revisions.length ? `<div class="tablewrap"><table class="t"><thead><tr><th>Revision</th><th>Shipped</th><th>Build</th><th>Deploy</th><th>Commit</th><th></th></tr></thead><tbody>
      ${d.revisions.map((r) => `<tr data-text="${esc(JSON.stringify(r).toLowerCase())}"><td>${code(r.revision_id)} ${r.active ? '<span class="chip ok">serving</span>' : ''}</td><td>${fmtDate(r.shipped_at)}</td><td>${chip(r.build_status)}</td><td>${chip(r.deploy_status)}${r.failure_reason ? `<div class="small lvl-error">${esc(r.failure_stage || '')} ${esc(r.failure_reason)}</div>` : ''}</td>
        <td class="mono small">${esc((r.commit_sha || '').slice(0, 10))}</td>
        <td class="acts">${!r.active && /ok/.test(r.build_status || '') ? `<button class="btn sm" data-act="rollback" data-rev="${esc(r.revision_id)}">${icon('undo')} Roll back to this</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Never shipped.</div>');
    acts({
      rollback: (el) => confirmDanger({ title: 'Roll back', message: `Serve revision <code>${esc(el.dataset.rev)}</code> of <b>${esc(f._name)}</b>?`, action: 'Roll back', onConfirm: () => api('POST', `/api/functions/${enc(id)}/actions/rollback`, { revision_id: el.dataset.rev }) })
        .then((ok) => { if (ok) { toast('Rollback requested'); route(true); } }),
    });
  } else if (sub === 'logs') {
    tab.innerHTML = card('Logs', '<div id="lbody"></div>', `<div class="row" style="margin-left:auto">
      <select id="ltype"><option value="runtime">Runtime</option><option value="invocations">Requests</option></select>
      <select id="lrange"><option>1h</option><option>6h</option><option selected>24h</option><option>7d</option></select>
      <select id="llimit"><option>50</option><option selected>100</option><option>250</option><option>500</option></select>
      <button class="btn sm" id="lgo">${icon('refresh')}</button></div>`);
    const draw = async () => {
      const q = `type=${$('#ltype').value}&range=${$('#lrange').value}&limit=${$('#llimit').value}`;
      $('#lbody').innerHTML = '<div class="loading"><span class="spinner"></span></div>';
      const r = await api('GET', `/api/functions/${enc(id)}/logs?${q}`).catch((e) => ({ error: e.message }));
      if (!alive()) return;
      if (r.error) { $('#lbody').innerHTML = `<div class="note bad">${esc(r.error)}</div>`; return; }
      const rows = [...r.data].sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
      $('#lbody').innerHTML = !rows.length ? '<div class="empty">No logs in this window.</div>' : r.type === 'invocations'
        ? `<div class="tablewrap"><table class="t"><thead><tr><th>Time</th><th>Method</th><th>Path</th><th>Status</th><th class="right">Duration</th><th class="right">Size</th><th>Region</th></tr></thead><tbody>${rows.map((x) => `<tr data-text="${esc(JSON.stringify(x).toLowerCase())}">
            <td class="nowrap small">${esc(new Date(x.timestamp).toLocaleString())}</td><td>${esc(x.method)}</td><td class="mono small">${esc(x.path)}</td><td>${chip(String(x.status_code))}</td>
            <td class="right nowrap">${metricValue('duration_ms', x.duration_ms)}</td><td class="right nowrap">${bytes(x.response_size_bytes)}</td><td class="small">${esc(x.region || '')}</td></tr>`).join('')}</tbody></table></div>`
        : `<div class="tablewrap"><table class="t"><thead><tr><th>Time</th><th>Level</th><th>Message</th></tr></thead><tbody>${rows.filter((x) => x.message).map((x) => `<tr data-text="${esc(JSON.stringify(x).toLowerCase())}">
            <td class="nowrap small">${esc(new Date(x.timestamp).toLocaleString())}</td><td class="lvl-${esc(x.level)}">${esc(x.level)}</td><td class="mono small">${esc(x.message)}</td></tr>`).join('')}</tbody></table></div>`;
      applyFilter();
    };
    ['#ltype', '#lrange', '#llimit'].forEach((s) => $(s).addEventListener('change', draw));
    $('#lgo').addEventListener('click', draw);
    draw();
  } else if (sub === 'settings') {
    const le = d.logExport || {};
    const headerLines = Object.entries(le.headers || {}).map(([k, v]) => `${k}=${v}`).join('\n');
    tab.innerHTML = card('Log export destination', `${d.logExportError ? `<div class="note bad">${esc(d.logExportError)}</div>` : ''}
      <p class="muted" style="margin-top:0">Push this function's logs to your own HTTPS endpoint. ${d.logExport ? '<span class="chip ok">configured</span>' : '<span class="chip plain">not configured</span>'}</p>
      <form id="leform" class="stack">
        <label class="field">Endpoint<input type="url" name="endpoint" value="${esc(le.endpoint || '')}" placeholder="https://logs.example.com/ingest" required></label>
        <label class="field">Headers <span class="hint">One per line as KEY=VALUE, for example <code>Authorization=Bearer …</code></span><textarea name="headers" rows="3" class="mono" spellcheck="false">${esc(headerLines)}</textarea></label>
        <div class="row"><label class="check"><input type="checkbox" name="runtime"${le.runtime_export_enabled !== false ? ' checked' : ''}> Runtime logs</label>
          <label class="check"><input type="checkbox" name="invocations"${le.invocation_export_enabled !== false ? ' checked' : ''}> Request logs</label></div>
        <div class="row"><button class="btn primary" type="submit">Save</button>${d.logExport ? `<button class="btn danger" type="button" data-act="ledel">Stop exporting</button>` : ''}</div>
      </form>`);
    $('#leform').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const headers = Object.fromEntries(String(fd.get('headers') || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf('='); return i < 0 ? [l, ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
      try {
        await api('POST', `/api/functions/${enc(id)}/actions/log-export`, { endpoint: fd.get('endpoint'), headers, runtime: fd.get('runtime') === 'on', invocations: fd.get('invocations') === 'on' });
        toast('Log export saved'); route(true);
      } catch (err) { toast(err.message, true); }
    });
    acts({ ledel: () => confirmDanger({ title: 'Stop exporting logs', message: 'Remove the log export destination?', action: 'Remove', onConfirm: () => api('POST', `/api/functions/${enc(id)}/actions/log-export-delete`) }).then((ok) => { if (ok) { toast('Log export removed'); route(true); } }) });
  } else if (sub === 'raw') {
    tab.innerHTML = card('Raw JSON', jsonBlock({ function: f, revisions: d.revisions, log_export: d.logExport, metrics: d.metrics }));
  }
};

// ---------- SQL databases ----------

const WRITE_SQL = /^\s*(insert|update|delete|drop|alter|create|replace|pragma|vacuum|reindex|attach|detach)\b/im;

PAGES.sqldbsDetail = async ({ id, sub, extra, content, alive }) => {
  const d = await api('GET', `/api/sqldbs/${enc(id)}`);
  if (!alive()) return;
  const db = d.item;
  setCrumbs([['SQL databases', '#/sqldbs'], [db._name]]);
  const base = `#/sqldbs/${enc(id)}`;
  content.innerHTML = `${detailHead('sqldbs', db, `<a class="btn" href="/api/sqldbs/${enc(id)}/dump?name=${enc(db._name)}" download>${icon('download')} Export .sql</a>`)}
    ${tabs(base, [['', `Tables (${d.tables.length})`], ['query', 'Query'], ['schema', 'Schema'], ['info', 'Info']], sub === 'tables' ? '' : sub)}
    <div id="tab"></div>`;
  detailActs('sqldbs', db);
  const tab = $('#tab');
  if (d.schemaError && sub !== 'info') tab.insertAdjacentHTML('beforebegin', `<div class="note warn" style="margin-bottom:12px">Could not read the schema: ${esc(d.schemaError)}</div>`);
  if (!sub || (sub === 'tables' && !extra)) {
    tab.innerHTML = card('Tables', d.tables.length ? `<table class="t"><thead><tr><th>Table</th><th class="right">Rows</th><th></th></tr></thead><tbody>${d.tables.map((t) => `<tr class="link" data-href="${base}/tables/${enc(t.name)}" data-text="${esc(t.name.toLowerCase())}">
      <td class="mono"><b>${esc(t.name)}</b></td><td class="right">${t.rows ?? '—'}</td><td class="acts"><a class="btn sm" href="${base}/tables/${enc(t.name)}">Browse</a></td></tr>`).join('')}</tbody></table>` : '<div class="empty">No tables yet. Create one from the Query tab.</div>');
  } else if (sub === 'tables' && extra) {
    setCrumbs([['SQL databases', '#/sqldbs'], [db._name, base], [extra]]);
    let offset = 0;
    const limit = 50;
    const draw = async () => {
      tab.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
      const r = await api('GET', `/api/sqldbs/${enc(id)}/tables/${enc(extra)}?limit=${limit}&offset=${offset}`);
      if (!alive()) return;
      const to = Math.min(offset + r.rows.length, r.total ?? offset + r.rows.length);
      tab.innerHTML = card(`<span class="mono">${esc(extra)}</span>`, `<div class="bd flush">${dataTable(r.columns, r.rows, { empty: 'This table is empty.' })}</div>`,
        `<div class="row" style="margin-left:auto"><span class="muted small">${r.rows.length ? `${offset + 1}–${to}` : 0} of ${r.total ?? '?'}</span>
        <button class="btn sm" id="prev"${offset ? '' : ' disabled'}>Prev</button><button class="btn sm" id="next"${offset + limit < (r.total ?? 0) ? '' : ' disabled'}>Next</button>
        <a class="btn sm" href="${base}/query" id="qthis">Query</a></div>`);
      $('.card .bd', tab).classList.add('flush');
      $('#prev').addEventListener('click', () => { offset = Math.max(0, offset - limit); draw(); });
      $('#next').addEventListener('click', () => { offset += limit; draw(); });
      $('#qthis').addEventListener('click', () => sessionStorage.setItem(`sql:${id}`, `SELECT * FROM "${extra.replace(/"/g, '""')}" LIMIT 100;`));
      applyFilter();
    };
    await draw();
  } else if (sub === 'query') {
    const saved = sessionStorage.getItem(`sql:${id}`) || "SELECT name, type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name;";
    tab.innerHTML = `<div class="stack">${card('SQL', `<textarea id="sql" rows="8" class="mono" spellcheck="false">${esc(saved)}</textarea>
      <div class="row" style="margin-top:10px"><button class="btn primary" id="run">${icon('play')} Run</button><span class="muted small">⌘/Ctrl + Enter. Statements run against the live database.</span></div>`)}
      <div id="qres"></div></div>`;
    const run = async () => {
      const sql = $('#sql').value;
      sessionStorage.setItem(`sql:${id}`, sql);
      if (WRITE_SQL.test(sql)) {
        const ok = await confirmDanger({ title: 'Change the live database?', message: `This statement changes <b>${esc(db._name)}</b>. Run it?`, action: 'Run', onConfirm: () => true });
        if (!ok) return;
      }
      $('#qres').innerHTML = '<div class="loading"><span class="spinner"></span></div>';
      try {
        const r = await api('POST', `/api/sqldbs/${enc(id)}/query`, { sql });
        const last = r.last;
        const meta = Object.entries(last.meta).filter(([, v]) => v !== null).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(' · ');
        $('#qres').innerHTML = card(`Result <span class="muted small">${last.rows.length} row(s) · ${r.ms} ms${meta ? ` · ${esc(meta)}` : ''}${r.statements.length > 1 ? ` · last of ${r.statements.length} statements` : ''}</span>`, dataTable(last.columns, last.rows, { empty: 'The statement returned no rows.' }));
        $('#qres .card .bd').classList.add('flush');
      } catch (e) { $('#qres').innerHTML = `<div class="note bad">${esc(e.message)}</div>`; }
    };
    $('#run').addEventListener('click', run);
    $('#sql').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run(); } });
    $('#sql').focus();
  } else if (sub === 'schema') {
    tab.innerHTML = card('Schema', d.objects.length ? `<pre class="code">${esc(d.objects.map((o) => `-- ${o.type} ${o.name}\n${o.sql};`).join('\n\n'))}</pre>` : '<div class="empty">No schema objects.</div>');
  } else if (sub === 'info') {
    tab.innerHTML = `<div class="grid two">${card('Details', fieldsTable(db))}${card('Raw JSON', jsonBlock(db))}</div>`;
  }
};

// ---------- KV ----------

async function kvValueDialog(id, key, isNew = false) {
  let value = '';
  if (!isNew) value = (await api('GET', `/api/kvs/${enc(id)}/keys?key=${enc(key)}`)).value;
  let pretty = value;
  try { pretty = JSON.stringify(JSON.parse(value), null, 2); } catch { /* not JSON */ }
  const r = await dialog({
    title: isNew ? 'New key' : 'Key',
    wide: true,
    fields: [
      isNew ? { name: 'key', label: 'Key', required: true, mono: true, placeholder: 'user/123' } : { type: 'html', name: '_k', html: `<div>${code(key)} <span class="muted small">${bytes(new Blob([value]).size)}</span></div>` },
      { name: 'value', label: 'Value', type: 'textarea', rows: 16, mono: true, value: pretty },
    ],
    submit: 'Save',
    onOpen: (bd) => {
      if (isNew) return;
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'btn danger'; del.innerHTML = `${icon('trash')} Delete key`;
      del.addEventListener('click', async () => {
        const ok = await confirmDanger({ title: 'Delete key', message: `Delete <code>${esc(key)}</code>?`, onConfirm: () => api('DELETE', `/api/kvs/${enc(id)}/keys?key=${enc(key)}`) });
        if (ok) { bd.remove(); toast('Key deleted'); route(true); }
      });
      $('.ft', bd).insertBefore(del, $('.ft .err', bd).nextSibling);
    },
    onSubmit: async (v) => {
      let out = v.value;
      // Keep compact JSON on the wire if the value was JSON.
      if (out !== pretty || isNew) { try { out = JSON.stringify(JSON.parse(out)); } catch { /* raw text */ } } else out = value;
      await api('PUT', `/api/kvs/${enc(id)}/keys`, { key: isNew ? v.key : key, value: out });
      return true;
    },
  });
  if (r) { toast('Saved'); route(true); }
}

PAGES.kvsDetail = async ({ id, sub, content, alive }) => {
  const d = await api('GET', `/api/kvs/${enc(id)}`);
  if (!alive()) return;
  const kv = d.item;
  setCrumbs([['KV namespaces', '#/kvs'], [kv._name]]);
  const base = `#/kvs/${enc(id)}`;
  content.innerHTML = `${detailHead('kvs', kv, `<button class="btn primary" data-act="addkey">${icon('plus')} Add key</button>`)}
    ${tabs(base, [['', 'Keys'], ['info', 'Info']], sub)}<div id="tab"></div>`;
  detailActs('kvs', kv);
  acts({ addkey: () => kvValueDialog(id, '', true), kvopen: (el) => kvValueDialog(id, el.dataset.key) });
  const tab = $('#tab');
  if (sub === 'info') { tab.innerHTML = `<div class="grid two">${card('Details', fieldsTable(kv))}${card('Raw JSON', jsonBlock(kv))}</div>`; return; }
  let keys = d.keys;
  let cursor = d.cursor;
  let prefix = '';
  const draw = () => {
    tab.innerHTML = card(`Keys <span class="chip plain">${keys.length}${cursor ? '+' : ''}</span>`, `<div class="bd flush">${d.keysError ? `<div class="note bad">${esc(d.keysError)}</div>` : keys.length ? `<div class="tablewrap"><table class="t"><thead><tr><th>Key</th><th class="right">Size</th><th>Updated</th><th></th></tr></thead><tbody>
      ${keys.map((k) => { const name = k.key ?? k.name; return `<tr class="link" data-act="kvopen" data-key="${esc(name)}" data-text="${esc(String(name).toLowerCase())}"><td class="mono">${esc(name)}</td><td class="right nowrap">${bytes(k.size_bytes)}</td><td class="nowrap">${fmtDate(k.updated_at)}</td><td class="acts">${icon('eye')}</td></tr>`; }).join('')}
      </tbody></table></div>` : '<div class="empty">No keys.</div>'}${cursor ? '<div class="row" style="padding:10px"><button class="btn" id="more">Load more</button></div>' : ''}</div>`,
    `<form id="pfx" class="row" style="margin-left:auto"><input type="search" name="p" value="${esc(prefix)}" placeholder="Prefix, e.g. call/" class="mono"><button class="btn sm">Search</button></form>`);
    $('.card .bd', tab).classList.add('flush');
    $('#pfx').addEventListener('submit', async (e) => {
      e.preventDefault();
      prefix = e.target.p.value;
      const r = await api('GET', `/api/kvs/${enc(id)}/keys?prefix=${enc(prefix)}`);
      keys = r.keys; cursor = r.cursor; draw();
    });
    $('#more')?.addEventListener('click', async () => {
      const r = await api('GET', `/api/kvs/${enc(id)}/keys?prefix=${enc(prefix)}&cursor=${enc(cursor)}`);
      keys = keys.concat(r.keys); cursor = r.cursor !== cursor ? r.cursor : null; draw();
    });
    applyFilter();
  };
  draw();
};

// ---------- domains, bindings, actors, secrets, generic ----------

PAGES.domainsDetail = async ({ id, content, alive }) => {
  const { item: dm } = await api('GET', `/api/domains/${enc(id)}`);
  if (!alive()) return;
  setCrumbs([['Custom domains', '#/domains'], [dm._name]]);
  const fnId = dm.function_id || dm.func_id;
  const token = dm.verification_token;
  content.innerHTML = `${detailHead('domains', dm, `<button class="btn" data-act="verify">${icon('check')} Verify</button><button class="btn" data-act="cert">${icon('shield')} Upload certificate</button>`)}
    <div class="grid two">${card('Details', fieldsTable(dm))}
      <div class="stack">${card('DNS setup', `<p style="margin-top:0">Point <b>${esc(dm._name)}</b> at your function and prove you own it:</p>
        ${token ? `<dl class="kv"><dt>TXT record</dt><dd>${code(`_telnyx-verify.${dm._name}`)}</dd><dt>Value</dt><dd>${code(token)}</dd></dl>` : '<div class="muted">No verification token was returned for this domain.</div>'}
        <p class="muted small">Then use <b>Verify</b>. DNS changes can take a while to propagate.</p>`)}
        ${fnId ? card('Function', `<a href="#/functions/${enc(fnId)}">${esc(fnId)}</a>`) : ''}
        ${card('Raw JSON', jsonBlock(dm))}</div></div>`;
  detailActs('domains', dm);
  acts({
    verify: async () => { try { const r = await api('POST', `/api/domains/${enc(id)}/actions/verify`); toast(r.result?.data?.verification_status ? `Verification: ${r.result.data.verification_status}` : 'Verification requested'); route(true); } catch (e) { toast(e.message, true); } },
    cert: async () => {
      const r = await dialog({ title: `TLS certificate for ${dm._name}`, wide: true, fields: [
        { name: 'cert_pem', label: 'Certificate chain (PEM)', type: 'textarea', rows: 8, mono: true, required: true, placeholder: '-----BEGIN CERTIFICATE-----' },
        { name: 'key_pem', label: 'Private key (PEM)', type: 'textarea', rows: 6, mono: true, required: true, placeholder: '-----BEGIN PRIVATE KEY-----', hint: 'Sent straight to Telnyx; the panel does not store it.' },
      ], submit: 'Upload', onSubmit: (v) => api('POST', `/api/domains/${enc(id)}/actions/cert`, v) });
      if (r) { toast('Certificate uploaded'); route(true); }
    },
  });
};

PAGES.bindingsDetail = async ({ id, content, alive }) => {
  const { item: b } = await api('GET', `/api/bindings/${enc(id)}`);
  if (!alive()) return;
  setCrumbs([['API key bindings', '#/bindings'], [b._name]]);
  content.innerHTML = `${detailHead('bindings', b, `<button class="btn" data-act="validate">${icon('check')} Validate</button>`)}
    <div class="grid two">${card('Details', fieldsTable(b))}<div class="stack">${card('Validation', '<div id="vres" class="muted">Check that the binding still resolves to a working Telnyx API key.</div>')}${card('Raw JSON', jsonBlock(b))}</div></div>`;
  detailActs('bindings', b);
  acts({
    validate: async () => {
      $('#vres').innerHTML = '<span class="spinner"></span>';
      try { const r = await api('POST', `/api/bindings/${enc(id)}/actions/validate`); $('#vres').innerHTML = jsonBlock(r.result); } catch (e) { $('#vres').innerHTML = `<div class="note bad">${esc(e.message)}</div>`; }
    },
  });
};

PAGES.actorsDetail = async ({ id, content, alive }) => {
  const d = await api('GET', `/api/actors/${enc(id)}`);
  if (!alive()) return;
  const a = d.item;
  setCrumbs([['Actors', '#/actors'], [a._name]]);
  const cols = d.instances.length ? Object.keys(d.instances[0]).filter((k) => k !== 'record_type') : [];
  content.innerHTML = `${detailHead('actors', a)}
    <div class="grid two">${card('Details', fieldsTable(a))}${card(`Instances <span class="chip plain">${d.instances.length}</span>`, d.instancesError ? `<div class="note bad">${esc(d.instancesError)}</div>` : dataTable(cols, d.instances, { empty: 'No persisted instances.' }))}</div>`;
  detailActs('actors', a);
};

PAGES.secretsDetail = async ({ id, content, alive }) => {
  const { item: s } = await api('GET', `/api/secrets/${enc(id)}`);
  if (!alive()) return;
  setCrumbs([['Secrets', '#/secrets'], [s._name]]);
  content.innerHTML = `${detailHead('secrets', s)}
    <div class="grid two">${card('Details', fieldsTable(s))}${card('About secret values', `<p style="margin-top:0">Telnyx never returns a secret's value. Use <b>Edit</b> to replace it. Functions read it as <code>env.${esc(s._name)}</code> and pick up changes on their next deploy.</p>${jsonBlock(s)}`)}</div>`;
  detailActs('secrets', s);
};

PAGES.genericDetail = async ({ kind, id, content, alive }) => {
  const { item } = await api('GET', `/api/${kind}/${enc(id)}`);
  if (!alive()) return;
  setCrumbs([[KIND[kind].title, `#/${kind}`], [item._name]]);
  content.innerHTML = `${detailHead(kind, item)}<div class="grid two">${card('Details', fieldsTable(item))}${card('Raw JSON', jsonBlock(item))}</div>`;
  detailActs(kind, item);
};

// ---------- API explorer ----------

const ENDPOINTS = [
  ['GET', '/v2/compute/funcs?page[size]=50'], ['GET', '/v2/compute/funcs/{id}'], ['GET', '/v2/compute/funcs/{id}/revisions'], ['GET', '/v2/compute/funcs/{id}/logs/export'],
  ['GET', '/v2/storage/sqldbs'], ['POST', '/v2/storage/sqldbs/{id}/actions/query'], ['GET', '/v2/storage/kvs'], ['GET', '/v2/storage/kvs/{id}/keys'],
  ['GET', '/v2/compute/secrets'], ['GET', '/v2/compute/bindings'], ['GET', '/v2/compute/domains'], ['GET', '/v2/compute/actors'],
];

PAGES.explorer = async ({ content }) => {
  setCrumbs([['API explorer']]);
  const last = JSON.parse(sessionStorage.getItem('explorer') || 'null') || { method: 'GET', path: '/v2/compute/funcs?page[size]=20', body: '' };
  content.innerHTML = `<div class="pagehead"><div><h1>${icon('terminal')} API explorer</h1><p>Send any request to the Edge endpoints (<code>/v2/compute/…</code>, <code>/v2/storage/…</code>) with the active profile's key.</p></div></div>
    <div class="stack">${card('Request', `<form id="xform" class="stack">
      <div class="row"><select name="method">${['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => `<option${m === last.method ? ' selected' : ''}>${m}</option>`).join('')}</select>
        <input name="path" class="mono grow" value="${esc(last.path)}" list="eplist" spellcheck="false"><button class="btn primary">${icon('play')} Send</button></div>
      <datalist id="eplist">${ENDPOINTS.map(([, p]) => `<option value="${esc(p)}">`).join('')}</datalist>
      <label class="field">JSON body <span class="hint">Ignored for GET.</span><textarea name="body" rows="5" class="mono" spellcheck="false" placeholder='{"name": "example"}'>${esc(last.body)}</textarea></label>
      <div class="row small">${ENDPOINTS.map(([m, p]) => `<button type="button" class="btn sm" data-act="ep" data-m="${m}" data-p="${esc(p)}"><b>${m}</b>&nbsp;<span class="mono">${esc(p.split('?')[0].replace('/v2/', ''))}</span></button>`).join('')}</div>
    </form>`)}<div id="xres"></div></div>`;
  acts({ ep: (el) => { const f = $('#xform'); f.method.value = el.dataset.m; f.path.value = el.dataset.p; f.path.focus(); } });
  $('#xform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const req = { method: f.method.value, path: f.path.value.trim(), body: f.body.value };
    sessionStorage.setItem('explorer', JSON.stringify(req));
    if (req.method !== 'GET') {
      const ok = await confirmDanger({ title: `Send ${req.method}?`, message: `<code>${esc(req.method)} ${esc(req.path)}</code> may change your account.`, action: 'Send', onConfirm: () => true });
      if (!ok) return;
    }
    $('#xres').innerHTML = '<div class="loading"><span class="spinner"></span></div>';
    try {
      const r = await api('POST', '/api/explorer', req);
      const curl = `curl -X ${req.method} '${S.me.apiBase}${req.path}' -H "Authorization: Bearer $TELNYX_API_KEY"${req.body && req.method !== 'GET' ? ` -H 'Content-Type: application/json' -d '${req.body.replace(/'/g, "'\\''")}'` : ''}`;
      $('#xres').innerHTML = card(`Response ${chip(`${r.status}${r.status < 400 ? '_ok' : ' error'}`)} <span class="muted small">${r.ms} ms</span>`, `${typeof r.data === 'string' ? `<pre class="code">${esc(r.data)}</pre>` : jsonBlock(r.data)}`, `<button class="btn sm" style="margin-left:auto" data-copy="${esc(curl)}">${icon('copy')} Copy as curl</button>`);
    } catch (err) { $('#xres').innerHTML = `<div class="note bad">${esc(err.message)}</div>`; }
  });
};

// ---------- jobs ----------

PAGES.jobs = async ({ content, alive }) => {
  setCrumbs([['Jobs']]);
  const { jobs } = await api('GET', '/api/jobs');
  if (!alive()) return;
  content.innerHTML = `<div class="pagehead"><div><h1>${icon('jobs')} Jobs</h1><p>Background work from this session, such as duplicating a database.</p></div></div>
    <div class="card"><div class="bd flush">${jobs.length ? `<table class="t"><thead><tr><th>Job</th><th>Status</th><th>Started</th><th>Last step</th></tr></thead><tbody>${jobs.map((j) => `<tr class="link" data-act="job" data-id="${j.id}" data-text="${esc(j.title.toLowerCase())}">
      <td>${esc(j.title)}</td><td>${chip(j.status === 'done' ? 'done_ok' : j.status)}</td><td class="nowrap">${esc(ago(j.startedAt))}</td><td class="small muted">${esc(j.error || j.log.at(-1)?.msg || '')}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No jobs yet.</div>'}</div></div>`;
  acts({ job: (el) => jobDialog(el.dataset.id).then(() => route()) });
  if (jobs.some((j) => j.status === 'running')) setTimeout(() => { if (alive()) route(); }, 4000);
};

// ---------- profiles ----------

PAGES.profiles = async ({ content }) => {
  setCrumbs([['Profiles']]);
  const me = S.me;
  content.innerHTML = `<div class="pagehead"><div><h1>${icon('users')} Profiles</h1><p>Each profile is a Telnyx API key, stored encrypted in the vault that your sign-in key unlocks. Switch between them from the sidebar.</p></div>
    <div class="actions"><button class="btn primary" data-act="padd">${icon('plus')} Add profile</button></div></div>
    <div class="card"><div class="bd flush"><table class="t"><thead><tr><th>Profile</th><th>Key</th><th>Added</th><th>Last used</th><th></th></tr></thead><tbody>
    ${me.profiles.map((p) => `<tr data-id="${p.id}" data-text="${esc(p.name.toLowerCase())}">
      <td><span class="row"><span class="pdot" style="background:${esc(p.color)}"></span><b>${esc(p.name)}</b>${p.id === me.activeId ? '<span class="chip ok">active</span>' : ''}${p.login ? '<span class="chip plain" title="The key you signed in with. It unlocks this vault.">sign-in key</span>' : ''}</span></td>
      <td class="mono">${esc(p.keyHint)}</td><td class="nowrap">${fmtDate(p.createdAt)}</td><td class="nowrap">${p.lastUsedAt ? esc(ago(p.lastUsedAt)) : '—'}</td>
      <td class="acts">${p.id !== me.activeId ? `<button class="btn sm" data-act="puse">Use</button>` : ''}
        <button class="iconbtn" data-act="ptest" title="Test key">${icon('check')}</button>
        <button class="iconbtn" data-act="pedit" title="Edit">${icon('edit')}</button>
        <button class="iconbtn" data-act="pdup" title="Duplicate">${icon('copy')}</button>
        ${p.login ? `<button class="iconbtn danger" data-act="vaultdel" title="Delete vault">${icon('trash')}</button>` : `<button class="iconbtn danger" data-act="pdel" title="Remove">${icon('trash')}</button>`}</td></tr>`).join('')}
    </tbody></table></div></div>
    <p class="muted small">Signing in with a different key opens a different vault. Keys never leave this ${NATIVE ? DEVICE : 'server'}: the page only sees the last four characters.${NATIVE ? ` Saved sign-ins are kept in the ${KEYSTORE} and can be forgotten from the sign-in screen.` : ''}</p>`;
  const prof = (el) => me.profiles.find((p) => p.id === el.closest('tr').dataset.id);
  const apply = (r) => { S.me = { ...S.me, profiles: r.profiles, activeId: r.activeId }; renderProfileSwitch(); route(); };
  acts({
    padd: () => addProfile(),
    puse: (el) => switchProfile(prof(el).id),
    ptest: async (el) => {
      const p = prof(el);
      const r = await api('POST', `/api/profiles/${p.id}/test`);
      toast(r.ok ? `${p.name}: key works (${r.functions ?? 0} functions)` : `${p.name}: ${r.error}`, !r.ok);
    },
    pedit: async (el) => {
      const p = prof(el);
      const r = await dialog({ title: `Edit ${p.name}`, fields: [
        { name: 'name', label: 'Name', value: p.name, required: true },
        { name: 'color', label: 'Color', type: 'color', options: me.colors, value: p.color },
        ...(p.login ? [] : [{ name: 'apiKey', label: 'Replace API key', type: 'password', mono: true, placeholder: 'Leave empty to keep the current key', hint: 'The new key is checked with Telnyx first.' }]),
      ], onSubmit: (v) => api('PATCH', `/api/profiles/${p.id}`, v) });
      if (r) { apply(r); toast('Profile saved'); }
    },
    pdup: async (el) => {
      const p = prof(el);
      const r = await dialog({ title: `Duplicate ${p.name}`, body: '<p class="muted">Creates another profile with the same API key, for example to keep a separately named view.</p>', fields: [{ name: 'name', label: 'Name', value: `${p.name} copy`, required: true }], submit: 'Duplicate', onSubmit: (v) => api('POST', `/api/profiles/${p.id}/duplicate`, v) });
      if (r) { apply(r); toast('Profile duplicated'); }
    },
    vaultdel: async (el) => {
      const p = prof(el);
      const n = me.profiles.length;
      const r = await confirmDanger({
        title: 'Delete vault',
        message: `<b>${esc(p.name)}</b> is the key you signed in with, so removing it deletes the whole vault: all ${n} profile${n === 1 ? '' : 's'} on this ${NATIVE ? DEVICE : 'server'}${NATIVE ? `, and the saved sign-in in the ${KEYSTORE}` : ''}. Nothing changes on Telnyx. Signing in with this key again starts an empty vault.`,
        name: p.name, action: 'Delete vault', onConfirm: () => api('DELETE', '/auth/vault'),
      });
      if (!r) return;
      if (NATIVE) await native('forgetCurrent').catch(() => {});
      S.me = null; S.overview = null;
      renderLogin('Vault deleted.');
    },
    pdel: async (el) => {
      const p = prof(el);
      const r = await confirmDanger({ title: 'Remove profile', message: `Remove <b>${esc(p.name)}</b> (key ${esc(p.keyHint)}) from your vault? Nothing changes on Telnyx.`, action: 'Remove', onConfirm: () => api('DELETE', `/api/profiles/${p.id}`) });
      if (r) { apply(r); toast('Profile removed'); refreshCounts(); }
    },
  });
};

// ---------- login ----------

function renderLogin(message = '') {
  root.innerHTML = `<div class="login"><form class="card" id="login" autocomplete="off">
    <div class="brand" style="padding:0"><img class="logo" src="telnyx-logo.svg" alt="Telnyx"><small><b>Edge</b> Control Panel</small></div>
    <div><h1>Sign in with Telnyx</h1><p>Enter a Telnyx API key. It is checked against your Telnyx account and unlocks your saved profiles.</p></div>
    ${message ? `<div class="note warn">${esc(message)}</div>` : ''}
    <div class="saved hidden" id="saved"></div>
    <label class="field">API key<input type="password" name="apiKey" class="mono" placeholder="KEY0…" required autofocus></label>
    <label class="field">Profile name <span class="hint">Used the first time this key signs in.</span><input name="profileName" placeholder="Default"></label>
    ${NATIVE ? `<label class="check"><input type="checkbox" name="remember" checked> Remember on this ${DEVICE} <span class="hint">Saved in the ${KEYSTORE}</span></label>` : ''}
    <div class="err note bad hidden"></div>
    <button class="btn primary" type="submit">Sign in</button>
    <p class="small">Create or copy a key in the <a href="https://portal.telnyx.com/#/api-keys" target="_blank" rel="noopener">Telnyx portal</a>.</p>
  </form></div>`;
  renderSaved();
  $('#login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const btn = $('button[type=submit]', f);
    const err = $('.err', f);
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Checking with Telnyx…';
    err.classList.add('hidden');
    try {
      S.me = await api('POST', '/auth/login', { apiKey: f.apiKey.value, profileName: f.profileName.value });
      if (NATIVE && f.remember.checked) {
        const login = S.me.profiles.find((p) => p.login);
        await native('remember', { apiKey: f.apiKey.value.trim(), name: login?.name || 'Default' }).catch((x) => toast(`Could not save to the ${KEYSTORE}: ${x.message || x}`, true));
      }
      start();
    } catch (ex) {
      err.textContent = ex.message; err.classList.remove('hidden');
      btn.disabled = false; btn.textContent = 'Sign in';
    }
  });
}

async function renderSaved() {
  const box = $('#saved');
  if (!NATIVE || !box) return;
  const saved = await native('saved').catch(() => []);
  box.classList.toggle('hidden', !saved.length);
  box.innerHTML = `<div class="savedhead">Saved on this ${DEVICE}</div>${saved.map((a) => `<div class="savedrow" data-id="${esc(a.id)}">
      <button type="button" class="savedpick"><b>${esc(a.name)}</b><span class="mono muted">${esc(a.hint)}</span><span class="muted small">${a.lastUsedAt ? esc(ago(a.lastUsedAt)) : ''}</span></button>
      <button type="button" class="iconbtn danger savedforget" title="Forget this sign-in">${icon('trash')}</button></div>`).join('')}
    <div class="savedor"><span>or sign in with another key</span></div>`;
  box.querySelectorAll('.savedrow').forEach((row) => {
    const a = saved.find((x) => x.id === row.dataset.id);
    $('.savedpick', row).addEventListener('click', () => signInSaved(a, row));
    $('.savedforget', row).addEventListener('click', async () => {
      const ok = await confirmDanger({ title: 'Forget saved sign-in', message: `Remove <b>${esc(a.name)}</b> (key ${esc(a.hint)}) from the ${KEYSTORE}? Its vault and profiles stay on this ${DEVICE} and open again the next time you sign in with that key. To delete them too, use <i>Delete vault</i> on the Profiles page.`, action: 'Forget', onConfirm: () => native('forget', { id: a.id }) });
      if (ok) { toast('Sign-in forgotten'); renderSaved(); }
    });
  });
}

async function signInSaved(a, row) {
  const pick = row && $('.savedpick', row);
  if (pick) { pick.disabled = true; pick.insertAdjacentHTML('beforeend', '<span class="spinner"></span>'); }
  try {
    await native('signin', { id: a.id });
    S.me = await api('GET', '/auth/me');
    start();
    return true;
  } catch (ex) {
    if (!row) return false;
    const err = $('#login .err');
    err.textContent = `${a.name}: ${ex.message || ex}`; err.classList.remove('hidden');
    pick.disabled = false; $('.spinner', pick)?.remove();
    return false;
  }
}

if (NATIVE) {
  window.addEventListener('edge-native', (e) => {
    if (e.detail.event === 'saved-changed') renderSaved();
    if (e.detail.event === 'toast') toast(e.detail.text);
  });
}

function start() {
  renderShell();
  GLOBAL_ACTS = new Set(Object.keys(S.acts));
  refreshCounts();
  route();
}

(async () => {
  GLOBAL_ACTS = new Set(Object.keys(S.acts));
  try { S.me = await api('GET', '/auth/me'); start(); return; } catch { /* signed out */ }
  // The desktop apps sign in with the most recently used saved key when they open.
  if (NATIVE) {
    const [last] = await native('saved').catch(() => []);
    if (last && await signInSaved(last)) return;
  }
  renderLogin();
})();
