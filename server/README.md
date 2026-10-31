# SYNQ server

Node.js server for SYNQ. It handles rooms, live editing (Yjs), chat and code runs over
Socket.IO, and saves rooms and accounts in MongoDB.

## Run

```bash
npm install
npm run dev     # restarts on change
npm test
```

## Settings (`.env`)

| Variable         | Default       | What it does                                 |
| ---------------- | ------------- | -------------------------------------------- |
| `MONGODB_URI`    | none          | MongoDB URL (rooms go to `data/` if empty)   |
| `PORT`           | `4000`        | Server port                                  |
| `RUN_ENABLED`    | `true`        | Set to `false` to turn off running code      |
| `RUN_LANGUAGES`  | all found     | e.g. `javascript,python`                     |
| `SHELL_ENABLED`  | `true`        | Set to `false` to turn off terminal commands |
| `WORKSPACES_DIR` | `workspaces/` | Where each room's terminal folder lives      |

## Running code

| Language   | Uses             |
| ---------- | ---------------- |
| JavaScript | Node (sandboxed) |
| TypeScript | Node (sandboxed) |
| Python     | `python3` / `py` |
| C          | `gcc`            |
| C++        | `g++`            |
| Java       | `java`           |

Each run has a 5 second time limit. Python, C, C++ and Java are not sandboxed, so only
share rooms with people you trust.

## Terminal commands

Everything typed in the terminal that is not a built-in (`help`, `run`, `stdin`, `users`,
`whoami`, `theme`, `clear`) runs in the room's folder (`workspaces/<roomId>`): PowerShell
on Windows, `sh` elsewhere. The room's files are written there first, and files the
command creates, changes or deletes are copied back into the room. `node_modules`, `.git`
and similar folders stay on the server and show in Files read-only. npm always installs
into the room's folder (never into a folder above it). Commands are not interactive (use `npm init -y`),
stop after 10 minutes, and Ctrl+C stops them. Who may run them is a room setting (owner
only by default). They are **not sandboxed**: they run as the server's user.

## Push to GitHub

Files menu → **Push to GitHub...** (needs accounts, i.e. `MONGODB_URI`). Each user connects
their own GitHub personal access token once (classic with the `repo` scope, or fine-grained
with Contents and Administration: write). It is checked with GitHub and stored on the account
encrypted with a key derived from `JWT_SECRET` (changing `JWT_SECRET` means reconnecting).

A push is one commit made through GitHub's API: the repository is created if it doesn't
exist (private by default), and its files become exactly the room's files (`node_modules` is
never pushed). The room remembers the repository for next time.
