# Telnyx Edge Control Panel: development

This page is for people working on the code. To install and use the desktop apps, see the [README](../README.md).

A web control panel for **Telnyx Edge Compute** that works with more than one account. It has no dependencies and runs on Node ≥ 22.

```bash
npm start            # http://127.0.0.1:3007
npm run dev          # same, with auto-reload
npm test             # integration tests against a mock Telnyx API
npm run mac          # build the Mac app and .dmg into dist/ (npm run mac:install copies it to /Applications)
```

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `3007` | Panel port |
| `HOST` | `127.0.0.1` | Bind address. Behind HTTPS on another host, also set `COOKIE_SECURE=1` |
| `COOKIE_SECURE` | — | `1` adds `Secure` to the session cookie |
| `SESSION_IDLE_HOURS` | `8` | Idle timeout. Sessions also end after 24 h |
| `EDGE_CP_DATA_DIR` | `./data` | Encrypted vaults and the server HMAC key |
| `TELNYX_API_BASE` | `https://api.telnyx.com` | Telnyx API base URL (the tests point it at a mock) |

## Sign-in and profiles

- **Sign in with a Telnyx API key.** The panel checks the key live against Telnyx (`GET /v2/compute/funcs`), so only keys that can read Edge Compute get in. Wrong keys are throttled: 8 failures per IP locks sign-in for 15 minutes.
- **Your vault.** The sign-in key unlocks a vault of **profiles**. A profile is a named, colored Telnyx API key, so one person can work across several accounts or environments. The vault is:
  - encrypted with AES-256-GCM, using a key derived by scrypt from the sign-in key;
  - stored under an HMAC of that key, so nothing on disk shows who owns it;
  - opened only by the same sign-in key. Signing in with another key opens a different vault.
- **Managing profiles.** Switch profiles from the sidebar. On the *Profiles* page you can add a profile, rename or recolor it, replace its key (the new key is verified first), test it, duplicate it, or remove it. The sign-in profile is the vault's key, so removing it means deleting the whole vault. That action asks you to type its name first.
- **Keys stay on the server.** The browser only ever sees the last 4 characters. Every Telnyx call is made server-side with the active profile's key.
- **Session protection.** The session is an `HttpOnly; SameSite=Strict` cookie. Mutations also need an `X-Panel` header and a per-session CSRF token, and on loopback, requests for other `Host` names are refused (DNS-rebinding guard). A strict CSP is set.

## Mac app

`npm run mac` builds **Telnyx Edge.app** and `TelnyxEdge-<version>.dmg`. The app is a native macOS window around the panel. It is universal (Apple silicon and Intel) and bundles Node.js (`NODE_VERSION`, an LTS release, checked against the release's SHA-256 sums). The Mac that runs it needs nothing installed. Building needs only the Xcode command line tools.

- **Runs the panel privately.** The app starts the server on a random `127.0.0.1` port and stops it when you quit. If the app crashes, the server exits too.
- **Remembers sign-ins.** Tick *Remember on this Mac* when you sign in and the key is stored in the macOS Keychain. Next time, the app signs in with the key you used most recently. The sign-in screen lists every saved key, so you can pick another one. Saved keys never go to the page: the app signs in by itself and passes only the session cookie to the window.
- **Profiles stay on disk.** Vaults live in `~/Library/Application Support/Telnyx Edge Control Panel/` (*Telnyx Edge → Show Data Folder in Finder*), separate from the web version's `data/`.
- **Removing things:**
  - **Forget** (trash icon next to a saved sign-in, or *Telnyx Edge → Forget All Saved Sign-ins…*) removes the key from the Keychain. The vault and its profiles stay, and open again when you sign in with that key.
  - **Remove** on the Profiles page deletes one profile from the vault.
  - **Delete vault** (trash icon on the sign-in profile) deletes every profile in the vault, signs you out, and in the app also forgets the saved key. It is also available in the web version (`DELETE /auth/vault`).
- **Links and downloads.** External links open in your browser, and `.sql` exports open a Save dialog.
- The build is signed ad hoc, so macOS treats each rebuild as a new app. The first time a new build opens the Keychain, macOS asks for permission. Choose *Always Allow*.

## Windows app

`windows/` is the same idea for Windows: a C# (.NET 10, WinForms + WebView2) window around the panel. Saved sign-ins go in **Windows Credential Manager**, one generic credential per key (`TelnyxEdge/<id>`), and the page talks to the app over WebView2 messages. The window menu (Alt+Space) has *Show data folder* and *Forget all saved sign-ins…*. Profiles live in `%LOCALAPPDATA%\Telnyx Edge Control Panel\`, and the log is in `logs\app.log` there.

Build on Windows with the .NET 10 SDK, PowerShell 7 and [Inno Setup 6](https://jrsoftware.org/isinfo.php) (for the installer):

```powershell
pwsh windows/build.ps1 -Arch x64 -SmokeTest   # or -Arch arm64
```

It publishes a self-contained single-file `TelnyxEdge.exe`, bundles `node.exe` (checked against Node's SHA-256 sums) and the server files, and writes `dist\TelnyxEdge-<version>-win-<arch>.zip` and `…-Setup.exe`. The installer is per user, needs no admin rights, and installs to `%LOCALAPPDATA%\Programs\Telnyx Edge`. `TelnyxEdge.exe --smoke-test` starts the bundled server, checks `/` and `/auth/me`, round-trips a Credential Manager entry, checks WebView2 is present, and exits 0 or 1. The results go to the log.

The C# code also compiles on macOS or Linux (`EnableWindowsTargeting`), for example in Docker:

```bash
docker run --rm -v "$PWD/windows":/src -w /src mcr.microsoft.com/dotnet/sdk:10.0 dotnet publish -c Release -r win-x64 -o out
```

## Objects

Every Edge object type has its own page: a filterable list with per-row **open / edit / duplicate / delete** actions, and a detail page with all of its fields plus the raw JSON.

| Page | Explore | Edit | Duplicate |
|---|---|---|---|
| **Functions** | Details, the region requests ran in, bindings resolved to storage names, metrics (1h/6h/24h/7d), revisions with serving flag and failure reasons, runtime and request logs, custom domains, CLI commands | Log export destination, reset a failed function, roll back to a revision | New function, with the log export copied. Code is shipped with `telnyx-edge ship` |
| **SQL databases** | Tables with row counts, paged table browser, query console (⌘/Ctrl+Enter, asks before write statements), full schema, `.sql` export | Rename, run any SQL | New DB with the schema only, or schema plus rows (background job) |
| **KV namespaces** | Keys with prefix search and paging; values shown with JSON formatting | Add, edit and delete keys; rename | New namespace, optionally with every key (background job) |
| **Secrets** | Metadata only. Telnyx never returns values | Replace the value | New name with a value you enter |
| **API key bindings** | Details, validate | JSON patch | New env name |
| **Custom domains** | Verification status, DNS TXT record, certificate status | Route to another function, verify, upload a TLS cert | New hostname |
| **Actors** | Details and persisted instances | — (registered by shipping) | — |

Deletes of functions, databases and namespaces require typing the name. **Jobs** lists background duplicates with a live log. The **API explorer** sends any request under `/v2/compute/…` or `/v2/storage/…` with the active profile's key, and can copy it as `curl`.

## Regions

Telnyx chooses where a function runs. The API has no region field on functions, SQL databases or KV namespaces, and nothing accepts one on create, so the panel has no region selector. The only place a region appears is on each request log. The Functions list and the function overview read the last 24 hours of request logs (up to 250 requests, cached for a minute) and show the regions found there, busiest first. A function with no requests in that window shows `—`.

## API coverage

The read endpoints (lists, function detail, revisions, `metric_aggregates`, logs, log export, storage detail, KV keys, bindings) were checked against the live API. The write endpoints use the request shapes of the `telnyx-edge` CLI v0.5.x (for example `POST /funcs/{id}/actions/rollback`, `POST /sqldbs/{id}/actions/query`, `PUT /kvs/{id}/keys/{key}`, `POST /domains/{id}/actions/verify`), and they have been exercised only against the mock. If Telnyx answers differently, the panel shows the Telnyx error as-is, and the API explorer can send the corrected request. The endpoint paths are all in `lib/edge.js`.

## Files

```
server.js          HTTP server: auth, profiles, Edge routes, static UI
lib/telnyx.js      Telnyx REST client (pagination, errors, key check)
lib/vault.js       encrypted profile vaults and sessions
lib/edge.js        Edge objects: list/get/create/update/delete, details, SQL, KV, duplicates, jobs, explorer
public/            UI (vanilla JS, no build)
test/              node:test suite + mock Telnyx API (node:sqlite for SQL)
macos/             Mac app: main.swift (window, Keychain, server process) and build.sh
windows/           Windows app: C# WebView2 shell, Credential Manager, build.ps1, installer.iss
docs/              development notes, approving unsigned apps, screenshot
data/              vaults + server.key (git-ignored)
```

## Releasing

1. Bump `version` in `package.json` on a branch. It is the version of both apps.
2. Merge it into `main` through a pull request (`main` is protected), then tag the merge and push the tag: `git tag v1.0.0 && git push origin v1.0.0`.
3. The **Build and release** GitHub Action publishes a GitHub release with the Mac `.dmg`, the Windows installers and zips (x64 and arm64), and `SHA256SUMS.txt`. The tag must match `package.json`.

On every pull request and push to `main`, the action runs the tests on macOS and Windows and builds all the apps. It checks their architectures and runs the x64 Windows smoke test. The builds are attached to the run as artifacts, so you can try a pull request's build before merging and tagging it.

Neither app is signed with a paid certificate. Users approve each version once; see [APPROVING-UNSIGNED-APPS.md](APPROVING-UNSIGNED-APPS.md). To remove that step:

- **Mac:** sign with a Developer ID certificate, use the hardened runtime with the `allow-jit` and `allow-unsigned-executable-memory` entitlements (Node's JavaScript engine needs them), and notarize with `xcrun notarytool`.
- **Windows:** sign `TelnyxEdge.exe` and the installer with a code-signing certificate or Azure Trusted Signing (`signtool sign /fd SHA256 /tr <timestamp-url> /td SHA256`). Inno Setup can sign through its `SignTool` setting. `node.exe` is already signed by the Node.js project.
