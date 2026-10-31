# SYNQ socket contract

The client talks to a room only through the collab service
(`client/src/services/collab`). Two adapters implement this contract:

- **mock** (`mock/mockAdapter.js`): no backend. Tabs of the same room in one browser
  talk over a `BroadcastChannel`, so two tabs behave like two real collaborators.
- **socket** (`socketAdapter.js`): Socket.IO 4. The server relays every event below.

Event names are defined once in `client/src/services/collab/events.js`.

## Shared types

```ts
type Role = 'owner' | 'editor' | 'viewer';

type User = {
  userId: string;
  username: string;
  color: string;          // #RRGGBB from the collaborator palette
  role: Role;
  fileId: string | null;  // file the user currently has open
  isBot?: boolean;        // mock mode only
};

type Position = { lineNumber: number; column: number };   // 1-based, Monaco style
type Range = { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
type Rel = number[];      // Y.encodeRelativePosition() bytes, optional but preferred
```

Relative positions (`rel`) are Yjs relative positions inside the file's `Y.Text`.
Receivers resolve them first and fall back to `position`/`range`, so cursors stay
correct when text changes between sending and receiving.

## Connection and document

| Direction | Event | Payload |
| --- | --- | --- |
| C→S | `room:join` (ack) | `{ roomId, username, color, memberKey?, role?, roomName? }` → ack `{ self: User, users: User[], state?: Uint8Array, stateVector?: Uint8Array, activeRun?: RunStarted, settings: RoomSettings, room: { name }, error? }` or `{ pending: true, room }`. With accounts the name comes from the account. `roomName` names a new room. `role: 'viewer'` asks for read-only access. |
| C↔S | `yjs:update` | `{ update: Uint8Array }`, an incremental Yjs update. The server applies it to the room doc and relays it to everyone else. |
| C→S | `room:save` (ack) | `{}` → ack `{ ok: true }` or `{ error }`. Writes the room to disk now (Save button / Ctrl+S) instead of waiting for the autosave. |
| S→C | `room:saved` | `{ savedAt, userId?, username? }`, sent to the room after every write: the ~1s autosave (no user) or a `room:save` (with the user who saved). Clients clear their unsaved markers. |

The project is one `Y.Doc`: `getMap('nodes')` holds `{ id, name, type, parentId }` and
`getMap('texts')` holds one `Y.Text` per file (see `workspaceDoc.js`). A new room starts
empty.

## Accounts, access and permissions

With MongoDB (`MONGODB_URI`) the server has accounts (`server/src/accounts.js`), using JWTs:

- `POST /api/auth/signup` `{ name, email, password }` and `POST /api/auth/login`
  `{ email, password }` return `{ user, accessToken }` and set the refresh cookie.
- Sign-up is two steps: `POST /api/auth/signup` `{ name, email, password, phone? }` returns
  `{ verify: { id, channel, to, expiresIn, resendIn } }` and emails a 6-digit code;
  `POST /api/auth/verify` `{ id, code }` creates the account and signs in (with `next` when
  a phone code was texted too). `POST /api/auth/code` `{ identifier }` (email or phone) logs
  in with a code; `POST /api/auth/resend` `{ id }` sends a new one after 60 s;
  `POST /api/auth/phone` `{ phone }` (Bearer) verifies a phone by SMS;
  `POST /api/auth/google` `{ credential }` signs in with a Google ID token;
  `GET /api/auth/config` says which of these the server offers; `GET /api/auth/account`
  (Bearer) is the profile. Codes: 10 minutes, 5 tries, 5 per hour per address, stored as an HMAC.
- The **access token** is a JWT (HS256, signed with `JWT_SECRET`, 15 minutes). The client
  keeps it in memory and sends it as `Authorization: Bearer` (`GET /api/auth/me`,
  `GET /api/rooms`) and in the Socket.IO handshake, `auth: { token }`. Without a valid one
  the connection fails with `unauthorized`; the client refreshes and reconnects.
- The **refresh token** is an httpOnly cookie for `/api/auth` only. `POST /api/auth/refresh`
  replaces it and returns a new access token (`{ user: null }` without a cookie). A
  replaced token used again ends that whole login. `POST /api/auth/logout` ends it too.

A member is an account (`acct:<id>`), or a browser's `memberKey` when there are no
accounts. The first member in a room owns it. `room:join` acks `{ pending: true, room }`
for people the owner has not accepted yet; that socket then gets `room:admitted` (join
again) or `room:declined`.

`RoomSettings = { approval: boolean, newMembers: 'editor' | 'viewer', ownerOnlyFiles: boolean, ownerOnlyRun: boolean }`.

| Dir | Event | Payload |
| --- | --- | --- |
| C→S | `room:respond` (ack) | `{ member, accept: boolean, role? }`. Owner only. |
| C→S | `room:remove` (ack) | `{ member }`. Owner only; that member's tabs get `room:removed` and are disconnected. |
| C→S | `room:setRole` (ack) | `{ member, role: 'editor' \| 'viewer' \| 'owner' }`. Owner only; `'owner'` hands over ownership. |
| C→S | `room:settings` (ack) | `Partial<RoomSettings>` → ack `{ ok, settings }`. Owner only. |
| S→C | `room:access` | `{ members: [{ member, name, role, online }], requests: [{ member, name, email, role, at }] }`, to owner tabs after every change |
| S→C | `room:settings` | `RoomSettings`, to everyone after a change |
| S→C | `room:admitted` / `room:declined` / `room:removed` | `{ message? }` |
| S→C | `update:rejected` | `{ message }`, to a sender whose file create/delete was refused (`ownerOnlyFiles`) |

## Terminal shell

Who may use it is `RoomSettings.shell`: `'owner'` (default), `'editors'` or `'off'`. The
`room:join` ack includes `shell: { enabled, cwd, running?, serverDirs }`.

| Dir | Event | Payload |
| --- | --- | --- |
| C→S | `shell:exec` | `{ command }`. `cd <folder>` is handled by the server (stays inside the project). |
| C→S | `live:open` (ack) | `{ path }` → `{ url }`: Go Live address `/live/<token>/<path>` (served sandboxed by the server; `/live/<token>/__live` streams JSON messages: `{ type: 'update', css, html, reload }` (what changed: stylesheets are swapped, the open page is patched or reloaded), `{ type: 'error', file, line, column, message }` (a syntax error; updates wait until it's fixed), `{ type: 'ok' }` (fixed), and `stopped`) |
| C→S | `live:stop` (ack) | Stops the room's live server (not viewers): the address stops working; previews get `stopped` |
| C→S | `github:push` (ack) | `{ repo, branch?, isPrivate?, message? }` → `{ repo, branch, url, commitUrl, created, files }`: the room's files as one commit to the user's GitHub (signed in, token connected via `POST /api/github/token`). The join ack's `github` is the last push (`null`: never; `undefined`: the server has no accounts) |
| S→C | `github:state` | `{ repo, branch, url, commitUrl, pushedAt, by, files: [[path, fingerprint]] }` after a push from the room; Source Control compares the room's files with `files` |
| S→C | `live:state` | `{ live, by }` to the room when the live server starts or stops; the `room:join` ack has `live` |
| C→S | `shell:list` (ack) | `{ path }` → `{ entries: [{ name, type }], truncated }`: one level of a server-only folder (node_modules), for the file tree |
| C→S | `shell:kill` | Stops the running command (who started it, or the owner). |
| S→C | `shell:started` | `{ id, command, userId, username, color, cwd }` |
| S→C | `shell:output` | `{ id, stream: 'stdout' \| 'stderr', chunk }` |
| S→C | `shell:exit` | `{ id, exitCode, durationMs, timedOut?, cancelled?, cwd, changes?: { added, changed, removed, hidden, skipped } }`; the file changes arrive as a `yjs:update` just before |
| S→C | `shell:rejected` | `{ message }`, to the sender only (not allowed, or another command is running) |

## Presence and cursors

| Direction | Event | Payload |
| --- | --- | --- |
| S→C | `user:joined` | `User` |
| S→C | `user:updated` | `Partial<User> & { userId }` |
| S→C | `user:left` | `{ userId }` |
| C→S | `presence:update` | `{ fileId }` |
| C→S, S→C | `cursor:move` | `{ fileId, position: Position, rel?: Rel }` (+ `userId` from the server) |
| C→S, S→C | `selection:change` | `{ fileId, range: Range \| null, rel?: { start: Rel, end: Rel } }` (+ `userId`) |
| C→S, S→C | `typing:start` / `typing:stop` | `{ fileId }` (+ `userId`) |

Clients throttle `cursor:move` and `selection:change` to 50ms and send `typing:stop`
after 1.5s without local edits. The server never echoes these back to the sender.

## Chat

| Direction | Event | Payload |
| --- | --- | --- |
| C→S | `chat:send` | `{ text }` (max 2000 chars) |
| S→C | `chat:message` | `{ id, userId, username, color, text, at }`, delivered to everyone including the sender |

## Running code

Only `owner` and `editor` may run. One run at a time per room. The server executes the
file in an external sandbox and **broadcasts** every run event to the whole room. The
client never evaluates user code in real mode.

| Direction | Event | Payload |
| --- | --- | --- |
| C→S | `run:request` | `{ fileId, stdin?: string }` |
| S→C | `run:started` | `{ runId, userId, username, fileId, path?, color?, startedAt? }` |
| S→C | `run:output` | `{ runId, stream: 'stdout' \| 'stderr', chunk }` |
| S→C | `run:result` | `{ runId, exitCode: number \| null, durationMs, timedOut?, skipped?, aborted?, phase?: 'compile' \| 'run' }`, where `phase: 'compile'` means compilation failed |
| S→C | `run:rejected` | `{ reason: 'busy' \| 'forbidden' \| 'not-found' \| 'offline', message, activeRun? }`, sent to the requester only |

A backend that does not stream may skip `run:started`/`run:output` and send one
`run:result` that also carries `userId, username, fileId, path, stdout, stderr`. The
client renders that the same way.

Mock mode runs JavaScript in a throwaway Worker (5s timeout via `worker.terminate()`,
64KB output cap). Other languages print a notice and finish with `exitCode: null,
skipped: true`.
