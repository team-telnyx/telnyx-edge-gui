// Page help: the "?" tooltip next to each page title (scope + Telnyx docs link)
// and the collapsible help column on the right. Keys come from helpKey() in app.js.

const DOCS = 'https://developers.telnyx.com/docs/edge-compute';

export const TOPICS = {
  overview: { scope: 'A summary of everything on Telnyx Edge for the active profile: counts, failures and recent changes.', doc: ['Edge Compute overview', `${DOCS}/overview`] },
  functions: { scope: 'Serverless functions: containerized HTTP handlers deployed to the Telnyx edge network.', doc: ['Edge Compute functions', `${DOCS}/overview`] },
  actors: { scope: 'Stateful actors: long-lived objects with their own persisted state, addressed by type and key.', doc: ['Stateful actors', `${DOCS}/stateful-actors`] },
  secrets: { scope: 'Encrypted values injected into functions as environment variables. Values are write-only.', doc: ['Configuration', `${DOCS}/configuration`] },
  bindings: { scope: 'Telnyx API key bindings: give a function credentials to call the Telnyx API without hard-coding a key.', doc: ['Telnyx API from functions', `${DOCS}/telnyx-api`] },
  domains: { scope: 'Custom domains: serve a function from your own hostname, with DNS verification and TLS.', doc: ['Custom domains', `${DOCS}/custom-domains`] },
  sqldbs: { scope: 'SQLite-compatible SQL databases that functions use through a binding.', doc: ['SQL databases', `${DOCS}/sqldb`] },
  kvs: { scope: 'Key-value namespaces: fast, globally readable storage that functions use through a binding.', doc: ['KV storage', `${DOCS}/kv`] },
  explorer: { scope: 'Send raw requests to the Edge REST API with the active profile’s key.', doc: ['Telnyx API reference', 'https://developers.telnyx.com/api-reference'] },
  jobs: { scope: 'Background work started from this panel in this session, such as copying a database.', doc: null },
  profiles: { scope: 'Named Telnyx API keys stored in your encrypted vault. Switch between accounts from the sidebar.', doc: ['API keys and authentication', 'https://developers.telnyx.com/docs/development/api-fundamentals/authentication'] },
};

const STATUS = ['Status', 'The state Telnyx reports. Green means working (for example <code>deploy_ok</code>, <code>provision_ok</code>, <code>active</code>), amber means in progress, red means it failed and needs attention.'];
const DETAILS = ['Details', 'Every field Telnyx returns for this object. Fields ending in <code>_id</code> can be clicked to copy; dates show the exact time on hover.'];
const RAW = ['Raw JSON', 'The unmodified API response. Useful for scripting or for reporting a problem to Telnyx support.'];
const ACTIONS = ['Edit · Duplicate · Delete', 'Change, copy or remove this object. Deleting asks you to type its name, because it cannot be undone.'];
const LIST = [
  ['Filter', 'The box at the top filters the rows on this page as you type. Press <kbd>/</kbd> to jump to it.'],
  ['Status buttons', 'When rows have different statuses, a button per status filters the table to just that status.'],
  ['Row actions', 'Open, edit, duplicate or delete a row with the icons on its right. Click anywhere else on the row to open it.'],
  ['Refresh', 'Reloads from Telnyx. Lists are cached for a few seconds to stay fast.'],
];

export const HELP = {
  overview: {
    sections: [
      ['On this page', [
        ['Tiles', 'One per kind of object, with how many exist and their most common statuses. Click a tile to open its list.'],
        ['Needs attention', 'Objects whose status is failing (a failed deploy, a domain that did not verify…). Click a row to see the error.'],
        ['Recently changed', 'The objects updated most recently, across every kind.'],
        ['Profile', 'Everything shown belongs to the account of the active profile (top of the sidebar). Switching profile switches account.'],
      ]],
    ],
  },

  functions: {
    sections: [
      ['Columns', [
        ['Name', 'The function name, also used by the CLI: <code>telnyx-edge logs &lt;name&gt;</code>.'],
        STATUS,
        ['Invoke URL', 'The public HTTPS address of the function. Opens in your browser.'],
        ['Region', 'Where the function served requests in the last 24 hours, read from its request logs. Telnyx chooses the region; it cannot be set yet.'],
        ['Bindings', 'How many storage or API bindings (KV, SQL, Telnyx API) the function has.'],
        ['Updated', 'Last time the function record changed, usually the last ship.'],
      ]],
      ['Tips', [['New function', 'Creates an empty function record. Ship code to it from its folder with <code>telnyx-edge ship</code>.'], ...LIST]],
    ],
  },
  'functions/detail': {
    sections: [
      ['Header', [
        STATUS,
        ['Open', 'Opens the invoke URL in your browser.'],
        ['Reset', 'Only shown when a deploy failed. Puts the function back in the <i>created</i> state so it can be shipped again.'],
        ACTIONS,
      ]],
      ['Overview tab', [
        DETAILS,
        ['Region', 'Regions that served the last 24 hours of requests, with each one’s share. Empty when there was no traffic.'],
        ['Bindings', 'Resources injected into the function’s environment. <b>Env</b> is the variable name the code reads, <b>Type</b> is what it points at (<code>kv</code>, <code>sqldb</code>, <code>telnyx-sdk</code>), <b>Target</b> links to the bound object. Declare them in <code>func.toml</code> and ship.'],
        ['Last 24 hours', 'Request count, success rate, errors, latency percentiles, CPU and memory. <b>More</b> opens the Metrics tab.'],
        ['Custom domains', 'Your own hostnames routed to this function, with their verification status.'],
        ['CLI', 'Handy <code>telnyx-edge</code> commands for this function.'],
      ]],
      ['Other tabs', [
        ['Metrics', 'The same aggregates over 1 hour to 7 days.'],
        ['Revisions', 'Every ship, newest first. <b>serving</b> marks the live one. <b>Roll back to this</b> serves an older revision that built successfully.'],
        ['Logs', '<b>Runtime</b> is what your code printed; <b>Requests</b> is one row per HTTP request with status, duration, size and region.'],
        ['Log export', 'Pushes this function’s logs to your own HTTPS endpoint, with optional headers such as an <code>Authorization</code> token.'],
        RAW,
      ]],
    ],
  },
  'functions/detail/metrics': { sections: [['Metrics', [
    ['Range', 'The time window the aggregates cover.'],
    ['Requests', 'Total HTTP requests handled.'],
    ['Success rate', 'Share of requests that did not return a 5xx error.'],
    ['4xx · 5xx errors', 'Client errors (bad requests, not found…) and server errors (your code failed or timed out).'],
    ['Latency p50 · p95 · p99', 'Half, 95% and 99% of requests finished faster than this. p99 shows the slowest outliers.'],
    ['CPU · Memory', 'Average and peak resources used by the function’s instances.'],
  ]]] },
  'functions/detail/revisions': { sections: [['Revisions', [
    ['Revision', 'The ID of one shipped build. Click to copy.'],
    ['Shipped', 'When it was uploaded.'],
    ['Build · Deploy', 'Whether the image built, and whether it went live. A failure shows the stage and reason underneath.'],
    ['Commit', 'The git commit it was shipped from, if any.'],
    ['Roll back to this', 'Serve this revision again instead of the current one. Only offered for revisions that built.'],
  ]]] },
  'functions/detail/logs': { sections: [['Logs', [
    ['Runtime / Requests', '<b>Runtime</b>: lines your code wrote, with a level (info, warn, error). <b>Requests</b>: one row per HTTP call.'],
    ['Range · Limit', 'How far back to look and how many lines to fetch. Newest first.'],
    ['Region', 'The edge location that handled the request.'],
    ['Follow live', 'For a live tail, use the CLI: <code>telnyx-edge logs &lt;name&gt; --follow</code>.'],
  ]]] },
  'functions/detail/settings': { sections: [['Log export', [
    ['Endpoint', 'An HTTPS URL that receives the logs as they are produced.'],
    ['Headers', 'Sent with every push, one <code>KEY=VALUE</code> per line. Use it for authentication.'],
    ['Runtime · Request logs', 'Which of the two log streams to export.'],
    ['Stop exporting', 'Removes the destination. Logs stay readable in the Logs tab.'],
  ]]] },
  'functions/detail/raw': { sections: [['Raw JSON', [['Contents', 'The function record, its revisions, its log export destination and its latest metrics, as returned by the API.']]]] },

  actors: {
    sections: [
      ['Columns', [
        ['Actor type', 'A StatefulActor class declared by a function. Each type can have many instances, one per key.'],
        STATUS,
        ['Owner function', 'The function whose code implements this actor type.'],
        ['Created', 'When the type was first registered.'],
      ]],
      ['Tips', [['Creating actors', 'Actor types cannot be created here: they are registered when a function that declares them is shipped.'], ...LIST]],
    ],
  },
  'actors/detail': {
    sections: [['On this page', [
      DETAILS,
      ['Instances', 'Actor instances that have persisted state, one per key. Instances with no saved state are not listed.'],
      ['Delete', 'Removes the actor type. Its persisted instances may be removed too.'],
    ]]],
  },

  secrets: {
    sections: [
      ['Columns', [
        ['Name', 'The environment variable name your function reads, e.g. <code>env.MY_SECRET</code>.'],
        ['Value', 'Always hidden: Telnyx never returns a secret value once it is stored.'],
        ['Created · Updated', 'When the secret was added and last replaced.'],
      ]],
      ['Tips', [['Changes', 'Functions pick up a new or changed secret on their next deploy.'], ...LIST]],
    ],
  },
  'secrets/detail': {
    sections: [['On this page', [
      DETAILS,
      ['About secret values', 'Values are write-only. <b>Edit</b> replaces the value; there is no way to read the old one.'],
      ['Duplicate', 'Creates a secret with a new name. You must type the value again.'],
      ['Delete', 'Functions that read it stop getting it on their next deploy.'],
    ]]],
  },

  bindings: {
    sections: [
      ['Columns', [
        ['Env name', 'The environment variable the function reads the credentials from, e.g. <code>TELNYX</code>.'],
        ['Type', 'The kind of binding, usually <code>telnyx-sdk</code> for Telnyx API access.'],
        STATUS,
        ['ID', 'The binding ID. Click to copy.'],
      ]],
      ['Tips', [['New binding', 'Takes the JSON body sent to <code>POST /v2/compute/bindings</code>.'], ...LIST]],
    ],
  },
  'bindings/detail': {
    sections: [['On this page', [
      DETAILS,
      ['Validate', 'Asks Telnyx whether the binding still resolves to a working API key. The answer is shown in the Validation card.'],
      ['Edit', 'Sends the changed fields as <code>PATCH /v2/compute/bindings/{id}</code>.'],
      ['Delete', 'Functions using it lose their Telnyx API credentials.'],
      RAW,
    ]]],
  },

  domains: {
    sections: [
      ['Columns', [
        ['Hostname', 'Your domain, e.g. <code>api.example.com</code>.'],
        ['Verification', 'Whether Telnyx has seen the DNS TXT record proving you own the domain.'],
        ['Certificate', 'The TLS certificate status for HTTPS on this hostname.'],
        ['Function', 'The function that receives the traffic.'],
      ]],
      ['Tips', LIST],
    ],
  },
  'domains/detail': {
    sections: [['On this page', [
      DETAILS,
      ['DNS setup', 'Add the TXT record shown (name and value) at your DNS provider, then use <b>Verify</b>. DNS changes can take a while to propagate.'],
      ['Verify', 'Asks Telnyx to check the TXT record now.'],
      ['Upload certificate', 'Use your own TLS certificate chain and private key (PEM). The key goes straight to Telnyx; the panel does not keep it.'],
      ['Function', 'The function this hostname routes to. <b>Edit</b> points it at another one.'],
      RAW,
    ]]],
  },

  sqldbs: {
    sections: [
      ['Columns', [
        ['Name', 'The database name, used in <code>func.toml</code> bindings.'],
        STATUS,
        ['Created · Updated', 'When it was provisioned and last changed.'],
        ['ID', 'The database ID. Click to copy.'],
      ]],
      ['Tips', [['Provisioning', 'A new database can take several minutes before it is <code>provision_ok</code>.'], ['Duplicate', 'Copies the schema and optionally the rows, as a background job.'], ...LIST]],
    ],
  },
  'sqldbs/detail': {
    sections: [['On this page', [
      ['Export .sql', 'Downloads a SQL dump (schema and rows) you can keep as a backup or load elsewhere.'],
      ['Tables', 'Every table with its row count. <b>Browse</b> shows its rows, 50 at a time.'],
      ['Query', 'Run SQL against the live database. Statements that change data ask for confirmation first.'],
      ['Schema', 'The <code>CREATE</code> statements for every table, index, view and trigger.'],
      ['Info', 'All fields and the raw JSON of the database record.'],
      ACTIONS,
    ]]],
  },
  'sqldbs/detail/table': { sections: [['Browsing a table', [
    ['Rows', 'Cells longer than 160 characters are cut; hover to see more. <code>NULL</code> is shown in grey.'],
    ['Prev · Next', 'Page through the table 50 rows at a time.'],
    ['Query', 'Opens the Query tab with a <code>SELECT</code> for this table.'],
  ]]] },
  'sqldbs/detail/query': { sections: [['Query', [
    ['Run', 'Runs the statements. <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>Enter</kbd> also works.'],
    ['Writes', '<code>INSERT</code>, <code>UPDATE</code>, <code>DELETE</code>, <code>DROP</code>, <code>ALTER</code>, <code>CREATE</code>… change the live database, so they ask first.'],
    ['Result', 'Rows from the last statement, with timing and metadata such as rows written.'],
    ['SQL dialect', 'SQLite. List tables with <code>SELECT name FROM sqlite_master</code>.'],
  ]]] },
  'sqldbs/detail/schema': { sections: [['Schema', [['Statements', 'The SQL that recreates every table, index, view and trigger, read from <code>sqlite_master</code>.']]]] },
  'sqldbs/detail/info': { sections: [['Info', [DETAILS, RAW]]] },

  kvs: {
    sections: [
      ['Columns', [
        ['Name', 'The namespace name, used in <code>func.toml</code> bindings.'],
        STATUS,
        ['Created · Updated', 'When it was provisioned and last changed.'],
        ['ID', 'The namespace ID. Click to copy.'],
      ]],
      ['Tips', [['Duplicate', 'Copies every key and value into a new namespace, as a background job.'], ...LIST]],
    ],
  },
  'kvs/detail': {
    sections: [['On this page', [
      ['Keys', 'The keys in this namespace with size and update time. A <b>+</b> on the count means more can be loaded.'],
      ['Prefix', 'Lists only keys starting with the text, e.g. <code>call/</code>. Searched on Telnyx, unlike the page filter.'],
      ['Open a key', 'Click a row to view or edit the value. JSON values are pretty-printed and saved compact.'],
      ['Add key', 'Writes a new key. Writing an existing key overwrites it.'],
      ['Info', 'All fields and the raw JSON of the namespace record.'],
      ACTIONS,
    ]]],
  },
  'kvs/detail/info': { sections: [['Info', [DETAILS, RAW]]] },

  explorer: {
    sections: [['On this page', [
      ['Method · Path', 'Any Edge endpoint under <code>/v2/compute/…</code> or <code>/v2/storage/…</code>. Replace <code>{id}</code> with a real ID.'],
      ['JSON body', 'Sent with POST, PUT and PATCH. Ignored for GET.'],
      ['Shortcuts', 'The buttons fill in common endpoints.'],
      ['Confirmation', 'Anything but GET asks first, because it can change your account.'],
      ['Copy as curl', 'The same request as a <code>curl</code> command, with the key left as <code>$TELNYX_API_KEY</code>.'],
    ]]],
  },
  jobs: {
    sections: [['On this page', [
      ['Job', 'Long work started from the panel, such as duplicating a database or namespace.'],
      ['Status', '<code>running</code>, <code>done</code> or <code>failed</code>. The list refreshes while a job runs.'],
      ['Last step', 'The latest log line, or the error. Click a row for the full log.'],
      ['Lifetime', 'Jobs belong to this session and are not kept after the panel restarts.'],
    ]]],
  },
  profiles: {
    sections: [['On this page', [
      ['Profile', 'A name and color for one Telnyx API key. <b>active</b> is the one in use; <b>sign-in key</b> is the key that unlocks this vault.'],
      ['Key', 'Only the last characters are shown. Full keys never reach the page.'],
      ['Use', 'Switch the whole panel to that account.'],
      ['Test', 'Checks the key still works with Telnyx.'],
      ['Edit', 'Rename, recolor, or replace the key (checked with Telnyx first).'],
      ['Duplicate', 'Another profile with the same key, under a different name.'],
      ['Remove · Delete vault', 'Removing a profile deletes only that entry. Removing the sign-in key deletes the whole vault. Nothing changes on Telnyx either way.'],
    ]]],
  },
};
