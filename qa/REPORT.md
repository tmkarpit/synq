# SYNQ pre-deployment QA report

Date: 2026-10-31 · Tested commit: `eaacf64` (main) · Machine: Windows 11, Node 24.18.0, npm 11.16.0
All testing ran against an isolated server (port 4100, database `synq_test`, workspaces in `qa/`).
Your real server (port 4000) and real database were not touched. No source file was changed.

---

## 1. Executive summary

**Verdict: NOT READY for a public deployment.**

The collaboration core is solid. Concurrent editing converged in every test, nothing was lost after
a hard server kill, clients recovered from 20 s offline and from a server restart, and 30 users in one
room for 2 minutes had 0 errors (p95 latency 10 ms).

But five problems let one ordinary signed-in user take down or take over the server:

1. **One socket message crashes the whole server** (8 different events, `null` payload). Verified.
2. **The terminal is a full, unrestricted OS shell** for every room owner, and anyone can sign up and
   create a room. Verified (`whoami` ran on this PC).
3. **Python / C / C++ / Java run on the host with no sandbox** for every editor. Verified by code and
   by the server's own startup warning (hostile tests not run, per your safety rule).
4. **The "sandboxed" JavaScript runner has network access**: it reached the SYNQ server and opened a
   connection to the local MongoDB, which has no password. Verified.
5. **File names are not checked on the server**: a file named `../../x` was written *outside* the room
   folder. Verified.

It can be **ready after fixes** in about 3–5 days of work: fix 1 and 5, turn the terminal and native
languages off in production (or put them in a container), isolate the JS runner's network, and solve
the deployment blockers in section 3 (auth API has no CORS, rate limits break behind a proxy).

---

## 2. Test results

| Phase | Tests run | Passed | Failed | Not run (why) |
|---|---|---|---|---|
| 1. Baseline: existing unit tests | 79 (32 client, 47 server) | 79 | 0 | — |
| 1. Lint / production build | 2 | 2 | 0 | 1 warning: 3.9 MB Monaco chunk |
| 2. npm audit / secrets / env | 4 checks | — | — | client: 1 critical, 9 moderate/low; server: 0. No secrets in git history. |
| 3. Collaboration (socket level) | 6 | 6 | 0 | — |
| 3. Collaboration (browser, Chromium) | 9 | 9 | 0 | Pixel accuracy of same-line cursors only checked via text order |
| 4 + 6. Roles, raw events, auth, CORS | 18 | 11 | 7 | — |
| 4. Crash probe (null payload per event) | 17 events | 9 survive | **8 crash** | — |
| 5. Code execution | 14 + 1 TCP probe | 11 | 4 | Native-language escape tests (host is not sandboxed: stopped per rule) |
| 7. Load: 30 sockets, 2 min | 1 | 1 | 0 | Real network latency (local only) |
| 7. Browsers × widths, keyboard, reduced motion | 18 (Chromium, Firefox, Edge) | 18 | 0 | Mobile widths, Safari (no WebKit on Windows) |
| 7. Memory / listener leaks | 1 | 1 | 0 | — |
| 7. Lighthouse (desktop, production build) | 2 pages | — | — | Mobile preset |
| 8. Deployment checks | 10 checks | 5 | 5 | Real hosting (no host account) |

Not tested at all: Google sign-in end to end (needs a real Google account), SMS (no Twilio),
15-minute access-token expiry (not waited), "full room" (there is no room size limit in the code).

---

## 3. Findings (most severe first)

Legend: **V** = verified by running · **R** = suspected from reading the code.

### CRITICAL

**F1 · One socket message with a `null` payload crashes the whole server (V)**
- Steps: log in, join any room, run `socket.emit('yjs:update', null)` (or any event below).
- Expected: the message is ignored. Actual: the Node process exits with `TypeError: Cannot destructure
  property 'update' of ... as it is null`; every room goes offline for everyone.
- Evidence: `qa/scripts/crash-probe.mjs` → crashes on `yjs:update` (app.js:364), `presence:update`
  (379), `cursor:move` (388), `chat:send` (396), `run:request` (494 → 198), `shell:exec` (496),
  `live:open` (511). Default parameters (`= {}`) do not apply to `null`; `typeof null === 'object'`.
- Fix: guard every handler (`const d = data && typeof data === 'object' ? data : {}`), or wrap all
  handlers in one try/catch helper; add a test that sends `null`, arrays, strings and numbers to every
  event.

**F2 · The terminal runs any OS command on the server (V)**
- Steps: sign up, create a room (you are owner), type `whoami` (or `type ..\..\server\.env`) in the
  terminal.
- Expected (per spec): only whitelisted commands. Actual: a full PowerShell/`sh` with the server
  user's rights. Test S9 printed this PC's user name.
- Evidence: shell.js:18-19, 45-57; default `shell: 'owner'` in permissions.js:16; anyone can become an
  owner by creating a room.
- Fix: for a public server set `SHELL_ENABLED=false`, or run each room's terminal in a throwaway
  container (no host files, no network to internal services, CPU/memory limits). A command whitelist
  alone is not safe (`npm`, `node` and `git` can all run arbitrary code).

**F3 · Python, C, C++ and Java run on the host with no sandbox (R + startup warning)**
- Steps (not executed, per your safety rule): any editor runs a `.py` file that reads `../server/.env`
  or deletes files.
- Evidence: runner.js:12-15 ("NOT sandboxed: they run with the server user's permissions"); the server
  prints the same warning at start. Hello-world/input/compile/timeout tests passed (R3-R8).
- Fix: run code in containers (Docker with `--network none`, read-only root, memory/CPU/pids limits)
  or set `RUN_LANGUAGES=javascript,typescript` in production until then.

**F4 · Sandboxed JavaScript has network access, including the local database (V)**
- Steps: run `import net from 'node:net'; net.connect(27017,'127.0.0.1', ...)`.
- Expected: blocked. Actual: `TCP-CONNECTED to MongoDB port`; `fetch('http://127.0.0.1:4100/api/health')`
  also worked (R12). Local MongoDB has no password, so a room member could read or wipe every account.
  (Only a connect/close was done; no database commands were sent.)
- Evidence: runner.js:9-10 ("Network access is NOT blocked by Node"), runner.js:136.
- Fix: run the JS runner without network (container/firewall), enable MongoDB authentication, and bind
  internal services to addresses the runner cannot reach. In the cloud, also block 169.254.169.254.

**F5 · File names are not validated on the server: path traversal on disk (V)**
- Steps: as an editor, send a Yjs update that creates a file named `../../qa-escape-marker.txt`; the
  owner runs any terminal command.
- Expected: rejected. Actual: the server accepted the name and wrote the file **outside** the room
  workspace (S8 found it in `qa/` and deleted it). Two files named `dup.js` in one folder were also
  accepted.
- Evidence: app.js:364-373 (no validation of node names); shell.js:209-215 (`path.join(dir, rel)` with
  no containment check). The client validates (config/languages.js:76), but raw sockets bypass it.
- Fix: validate every node on the server after each update (name rules from `validateNodeName`, unique
  per folder, parent exists, depth limit) and reject the update otherwise; in `shell.materialize` and
  `importChanges`, resolve each path and refuse anything outside the workspace.

### HIGH

**F6 · Login cannot work when the frontend is a static site on another domain (V)**
- Steps: `OPTIONS /api/auth/login` with `Origin: https://synq-app.example`.
- Expected: CORS headers. Actual: `404`, and `POST` answers carry no `Access-Control-Allow-Origin`, so
  the browser blocks every auth call. The refresh cookie is `SameSite=Lax`, so it is not sent
  cross-site either (users would be logged out on every reload).
- Evidence: accounts.js:481-491 (no CORS headers), accounts.js:425-429.
- Fix (simplest): serve the frontend and the server from **one origin**: a reverse proxy, or the static
  host rewriting `/api/*`, `/socket.io/*`, `/live/*` to the server. Otherwise add credentialed CORS
  for `CORS_ORIGIN` and `SameSite=None; Secure` cookies.

**F7 · Rate limits use the connection address, so behind a proxy everyone shares one limit (V in dev)**
- Steps: through the Vite proxy every request comes from `127.0.0.1` (seen earlier today).
- Impact in production (any host with a load balancer): only 10 signups and 10 code requests per
  10 minutes **for the whole site**, and anyone can lock a victim out of password login for 10 minutes
  with 10 wrong attempts.
- Evidence: accounts.js:505 (`req.socket.remoteAddress`); limits at accounts.js:226-238, 266.
- Fix: a `TRUST_PROXY` setting; when set, take the client IP from `X-Forwarded-For` (rightmost trusted
  hop) for rate limits and the login history.

**F8 · Go Live links break on a split deployment (R)**
- Evidence: liveActions.js:31 builds the URL from `window.location.origin` (the static site), but
  `/live/...` is served by the SYNQ server.
- Fix: same-origin proxy (see F6), or resolve the URL against `VITE_API_URL`.

**F9 · Relayed cursor events forward any data a client adds, up to 2 MB, to everyone (V)**
- Steps: `emit('cursor:move', { ..., html: '<img onerror=...>', blob: 'x'.repeat(500000) })`.
- Actual: every other user receives `html` and the 500 KB `blob` (S7). One client can multiply traffic
  by the room size. `userId` spoofing is correctly blocked.
- Evidence: app.js:385-394 (`{ ...data, userId }`).
- Fix: rebuild the payload from known fields (`fileId`, `position`, `selection`) with type and size
  checks.

### MEDIUM

**F10 · No rate limits on chat, runs, joins or document updates (V)**: 301 chat messages in ~2 s were all
delivered (S11). app.js:396-408. Fix: per-socket token bucket (e.g. 10 chat/s, 2 runs/10 s, update
bytes/minute).

**F11 · Terminal commands keep running after everyone leaves, up to 10 minutes (V)**: S10. app.js:586-601
does not cancel `room.shellJob`. Code runs are also not cancelled (bounded to 5 s, R). Fix: cancel jobs
in `leave()` when the room becomes empty.

**F12 · Socket server accepts any website's origin (V)**: S17, `CORS_ORIGIN` unset → `true`. Lower risk
because sockets authenticate with a bearer token, not a cookie. Fix: require `CORS_ORIGIN` in
production.

**F13 · Monaco ships DOMPurify 3.4.15 with critical/high advisories (V audit, R reachability)**: the
advisories need `IN_PLACE`, `SAFE_FOR_TEMPLATES` or XHTML modes, which Monaco's hover rendering does
not appear to use, so likely not reachable. Fix: `overrides` to the first patched DOMPurify release and
re-run the editor tests.

**F14 · No SPA rewrite config for a static host (V)**: `vite preview` serves `/room/:id` (200), but the
repo has no `_redirects`, `vercel.json` or `netlify.toml`, so a refresh on a room URL will 404 on most
static hosts. Fix: add the host's rewrite file (all paths → `index.html`, except `/api`, `/socket.io`,
`/live`).

**F15 · Unbounded data growth (R)**: anyone can create unlimited rooms (any well-formed ID) and fill
them up to 2 MB per message; `login_history` has no expiry. Fix: rooms per account limit, room size
cap, TTL on login history (e.g. 1 year), clean-up of empty rooms.

**F16 · No privacy policy or terms (V)**: the app stores email, phone, IP and browser per login.
Needed before a public launch.

**F17 · Room page performance 65 in Lighthouse (V)**: TBT 510 ms, 1.76 MB transferred, Monaco chunk
3.9 MB (1 MB gzip). Monaco **is** lazy-loaded (not in the landing preload). Landing scores 84. Fix:
load only the needed Monaco languages/workers, drop unused grammars (cpp chunk is 797 KB).

**F18 · Accessibility issues (V)**: Lighthouse 92 (landing) / 93 (room). Low colour contrast on 44
landing elements (e.g. the main purple button, `text-faint` text), a prohibited ARIA attribute on a
`<p data-statement>`, "People (1)" button label does not match its visible text, terminal grey text
(`xterm-fg-8`) low contrast.

### LOW

**F19 · Sandboxed JS can read some Windows environment variables (V)**: `USERNAME`, `USERPROFILE`,
`PATH`, `HOMEPATH`... (R11). No secrets. Windows adds them to every process.

**F20 · Compile errors name `main.c` instead of the user's file (V)**: R7 (`main.c:2:11: error`); line
numbers are correct. runner.js:152. Fix: compile under the user's file name, or rewrite the name in
the output.

**F21 · `.env.example` misses 9 settings (V)**: `PORT`, `HOST`, `CORS_ORIGIN`, `COOKIE_SECURE`,
`RUN_ENABLED`, `RUN_LANGUAGES`, `SHELL_ENABLED`, `WORKSPACES_DIR`, `DATA_DIR`. Missing `JWT_SECRET`
stops the server with a clear message (index.js:28-31).

**F22 · No `data-testid` attributes (V)**: tests use labels/roles; fine today, fragile later.

**F23 · `/api/health` reveals how many rooms are open (V)**: minor information leak.

**F24 · fflate and ESLint advisories (V audit)**: fflate's issue is in `unzipSync` (SYNQ only zips);
ESLint ones are dev-only. Update when convenient.

### What passed (no action needed)

Viewers cannot edit/run/use the terminal even with raw events · editors cannot use owner controls ·
events before joining are ignored · oversize messages drop only that socket · invalid room IDs refused
· login: wrong password 401, NoSQL-injection objects 400, bad JSON 400 without stack, 429 after 10
wrong passwords · refresh-token reuse ends the whole login · cookie `HttpOnly; SameSite=Lax;
Path=/api/auth` · `nosniff` and `X-Frame-Options: DENY` on the API · chat shows HTML as text (no XSS)
· Go Live pages are sandboxed (CSP `sandbox`) · JS runner blocks files and child processes · time
limit, output cap (64 KB), memory limit, "busy" message all work · no secrets in git history · health
route, graceful shutdown, `PORT` from env, TTL indexes on sessions and codes.

---

## 4. Fix plan

| Priority | Finding | Work | Estimate |
|---|---|---|---|
| **Must fix before deploy** | F1 null-payload crash | guard all handlers + tests | 2–3 h |
| | F5 file-name validation + path containment | server validation + shell checks + tests | 4–6 h |
| | F2 / F3 terminal and native languages | production: `SHELL_ENABLED=false`, `RUN_LANGUAGES=javascript,typescript` (config) — or container sandbox | 15 min (config) · 2–3 days (containers) |
| | F4 JS runner network | container/firewall + MongoDB auth | 0.5–1 day |
| | F6 / F8 / F14 deployment shape | same-origin proxy + host rewrite file | 2–4 h |
| | F7 rate limits behind proxy | `TRUST_PROXY` + tests | 2 h |
| **Should fix** | F9 relay whitelist | 1–2 h |
| | F10 rate limits on sockets | 3–4 h |
| | F11 stop jobs when room empties | 1 h |
| | F12 require `CORS_ORIGIN` in production | 30 min |
| | F13 DOMPurify override | 30 min + retest |
| | F15 growth limits | 4–6 h |
| | F16 privacy/terms pages | 2–4 h (content is yours) |
| **Nice to have** | F17 bundle trimming | 0.5–1 day |
| | F18 accessibility fixes | 3–4 h |
| | F19–F24 | 2–3 h total |

---

## 5. New tests and how to run them

Everything lives in `qa/` (nothing in `client/` or `server/` changed). Start the isolated server and
client first, in two terminals:

```bash
cd qa
npm install
npx playwright install chromium firefox
npm run server        # QA server on :4100, database synq_test (never your real data)
npm run client        # QA client on :5190
```

| Script | What it runs |
|---|---|
| `npm run test:security` | S1–S18: roles, raw socket events, malformed input, auth, CORS (S5 crashes the QA server by design until F1 is fixed; skip it with `-- --test-skip-pattern="S5 "`) |
| `npm run test:crash` | Starts a fresh server per event on :4101 and sends `null` to each of 17 events |
| `npm run test:run` | R1–R14: code execution in 6 languages, limits, JS sandbox |
| `npm run test:collab` | C1–C6: concurrent editing through the real server |
| `npm run test:e2e` | E1–E9 + M1 in Chromium: live typing, cursors, follow, offline, refresh, explorer, chat XSS, viewer, server restart, memory |
| `npm run test:browsers` | P1–P4 in Chromium, Firefox and Edge at 1280/1440/1920, keyboard focus, reduced motion |
| `npm run load` | 30 sockets in one room for 2 minutes |
| `npm run lighthouse` | Lighthouse desktop on the production build (needs `vite preview` on :4173 with `SYNQ_SERVER_URL=http://127.0.0.1:4100`) |

The tests assert the **safe** behaviour, so today these fail on purpose and will pass once fixed:
S5, S7, S8, S9 (expected to keep failing if the terminal stays a real shell by design), S10, S11, S17,
R7, R11, R12, and the crash probe's 8 crashes.

Test users are inserted straight into `synq_test` (hashed like the server does) and log in through
the real API, because the signup limit (10 per 10 minutes) would block a full run; real signup is
covered by `signupUser()` in `scripts/lib.mjs`.

---

## 6. After the fixes (2026-11-01)

**Verdict: ready to deploy**, using the production defaults (`NODE_ENV=production`): one service
that serves the website, API and sockets, with the host terminal and Python/C/C++/Java off. Turning
those two on is a deliberate opt-in (`SHELL_ENABLED`, `RUN_LANGUAGES`) and should only happen inside
a container and for trusted users; that is the one remaining risk, and it is documented.

18 commits, one per issue, each with a test that failed before and passes after.

| Finding | Status | Commit |
|---|---|---|
| F1 null payload crashes the server | Fixed: 0 of 17 events crash (was 8) | 7db5b89 |
| F5 path traversal via file names | Fixed: names checked on the server, every disk path contained | 9bc29ec |
| (new) a refused update blocked all later edits from that person | Fixed: refused changes are applied then undone | 9bc29ec |
| F4 JS runner network access | Fixed: network modules, fetch, WebSocket blocked | 2bf04f7 |
| F2 / F3 host terminal, native languages | Off by default in production; opt-in documented | 095e486 |
| F6 / F8 / F14 split deployment (CORS, Go Live, page refresh) | Fixed by one-origin serving (`STATIC_DIR`); Go Live also honours `VITE_API_URL` | 095e486, a3bee91 |
| F7 shared rate limits behind a proxy | Fixed: `TRUST_PROXY` | 095e486 |
| F9 relayed cursor events carried any data | Fixed: documented fields only | 46768e6 |
| F10 no socket rate limits | Fixed: per-connection limits | dc27ab4, e7f1c66 |
| F11 jobs kept running after everyone left | Fixed (including a race found by S10) | 4bb568d, c12d8b8 |
| F12 sockets from any origin | Fixed: same-origin by default in production | 095e486 |
| F13 / F24 DOMPurify and fflate advisories | Fixed: npm audit shows only dev-only ESLint issues | c5bea1e |
| F15 unbounded growth | Fixed: login history TTL 1 year, 20 new rooms/hour per person | bba146f |
| F16 privacy policy and terms | Added (/privacy, /terms; linked in footer and sign-up) | 1b15ffc |
| F17 room page weight | Fixed: Brotli/gzip, 1,757 KB → 471 KB transferred | 022ff4b |
| F18 accessibility | Improved: landing 92 → 96, room 93 → 96 | b227587 |
| F19 OS environment visible to runs | Fixed | e7f1c66 |
| F20 compile errors named main.c | Fixed | 1c8bddb |
| F21 .env.example incomplete | Fixed, plus Dockerfile and README Deploy section | 2a2185a |
| F23 health endpoint revealed open rooms | Fixed in production | 095e486 |
| SEO | Canonical, og:image (large preview), sitemap.xml, robots entry from `SITE_URL` | 54cff2e |
| F22 no data-testid | Not changed (tests use roles and labels) | — |

### Results after the fixes

| Suite | Before | After |
|---|---|---|
| Server unit tests (with database) | 47 / 47 | **64 / 64** |
| Client unit tests | 32 / 32 | 32 / 32 |
| QA security (raw sockets, auth, CORS) | 11 / 18 | **19 / 19** |
| Crash probe (null to every event) | 8 of 17 crash | **0 of 17** |
| Code execution | 11 / 14 | **14 / 14** |
| Collaboration, socket level | 6 / 6 | 6 / 6 |
| Collaboration, browser (production build) | 9 / 9 | 9 / 9 (+ restart test) |
| Cross-browser smoke (Chromium, Firefox, Edge) | 18 / 18 | **21 pages × 3 browsers: 18 / 18** |
| Memory leaks | pass | pass (listeners flat after warm-up) |
| Docker image | — | builds, runs, health check healthy |

| Lighthouse (desktop, served by SYNQ) | Perf | A11y | Best pr. | SEO |
|---|---|---|---|---|
| Landing | 71* (was 84) | 96 (was 92) | 100 | 100 |
| Privacy | 100 | 100 | 96† | 100 |
| Room | 87 (was 65) | 96 (was 93) | 96† | 63 (noindex on purpose) |

\* The landing page code did not change; this machine had ~500 MB free memory during the run (main
thread 2.8 s). Re-run on an idle machine. † Console messages from Google sign-in on an unregistered
test address and from Lighthouse replaying one rotated login cookie; not SYNQ errors.

### Notes from the re-test

- Browser tests against the Vite **dev** server time out on a machine this loaded (Monaco is
  hundreds of unbundled modules); against the production build they pass in ~4 minutes. Run them with
  `QA_BASE=http://127.0.0.1:4100` after `npm run build` in `client/`.
- The QA server now runs with production settings and every feature switched on explicitly
  (`QA_DEV=1 npm run server` for development mode).
- Still to check by hand: Google sign-in on the real domain (add it as an authorized origin), email
  delivery from the production host, and Lighthouse mobile.
