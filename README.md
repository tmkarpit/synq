# SYNQ

A real-time collaborative code editor. Create a room, share the link, and code together in the same files with live cursors, chat and a shared terminal.

## Features

- Accounts (JWT): sign up with an emailed code, log in with a password, a one-time code by
  email or SMS, or one click with Google; add a verified phone on the Account page
- Live editing with everyone's cursor and selection visible
- Suggestions as you type: VS Code's IntelliSense for JavaScript, TypeScript, HTML and CSS,
  plus keywords, built-ins and snippets for Python, C, C++ and Java (`!` for an HTML page)
- Rooms start empty: create, open, rename (F2) and delete files and folders like in VS Code
- Run JavaScript, TypeScript, Python, C, C++ and Java, with output shared in one terminal
- Go Live for HTML files (like VS Code's Live Server): the page opens at
  `http://localhost:5173/live/...` in a new tab and follows your edits as you type. CSS
  changes apply instantly without a reload, HTML changes patch the page in place, and
  script changes reload it at the same scroll position. Half-typed JavaScript never breaks
  the preview: it keeps the last working version and shows the syntax error until it's
  fixed, and errors the page throws are shown in the same overlay
- A real terminal: `npm install`, `node app.js`, `cd src` and more run in the room's folder
  on the server, and the files they create or change appear for everyone
- Room chat and a list of who is online
- People who open an invite link ask to join; the room owner accepts or declines them
- The owner can remove people, make them editors or viewers, hand over ownership, and allow only themselves to create/delete files or run code
- Read-only viewers (`?role=viewer` on the link)
- Rooms are saved in MongoDB, so the code is still there after everyone leaves
- Download the whole project as a .zip
- Source Control like VS Code: see which files changed since the last push (M/A/D), write a
  commit message and push to GitHub in one click (a new repository is created if needed)

## Tech stack

- **Client:** React, Vite, Tailwind CSS, Monaco Editor, xterm.js
- **Server:** Node.js, Socket.IO, Yjs
- **Database:** MongoDB (local MongoDB Community Server; browse it with MongoDB Compass)

## Getting started

You need Node.js 20 or newer and MongoDB (the MongoDB Community Server Windows service,
or `docker compose up -d`).

```bash
npm run install:all
cp server/.env.example server/.env
```

Put your database URL and a secret for the login tokens (JWT) in `server/.env`:

```
MONGODB_URI=mongodb://localhost:27017/synq
JWT_SECRET=any-random-string-of-at-least-32-characters
```

For verification codes and Google sign-in, also set (all in `server/.env`, see
`server/.env.example`): `SMTP_*` for email (Gmail works with an app password),
`TWILIO_*` for SMS, and `GOOGLE_CLIENT_ID` for "Continue with Google". Until then,
`OTP_DEV_LOG=true` prints the codes in the server window (development only).

The tables are created on the first start. Then run the server and the client in two
terminals:

```bash
npm run dev:server                 # http://localhost:4000
npm --prefix client run dev:lan    # http://localhost:5173
```

Open http://localhost:5173, click **Log in** (top right) to create an account, then
create a room. Click **Invite** to copy a link for others on your network; when they
open it, you accept or decline them from the pop-up or the People panel.

## Pushing your code to GitHub

1. In a room, click **Source Control** (the branch icon on the left) and then **Publish to
   GitHub**, or use **Push to GitHub...** in the **⋯** menu next to **Files**.
2. The first time, click **Create a token**, create a GitHub token with the **repo**
   permission, paste it and click **Connect**. It is saved encrypted on your account, so
   you only do this once.
3. Enter a repository name (`my-project`, or `owner/my-project`), optionally a branch and
   a commit message, and click **Push**. If the repository doesn't exist yet, it is created
   (private unless you untick **Private if new**).
4. Use the links shown to open the repository or the commit on GitHub.

After the first push, the Source Control view lists every file changed since then (M =
modified, A = added, D = deleted) and its icon shows how many. Click a file to open it,
type a message and press **Commit & Push** (or Ctrl+Enter). Everyone in the room sees the
same list, and it clears after anyone's push.

The repository ends up with exactly the room's files: files deleted in the room are
deleted on GitHub too, and `node_modules` is never pushed. The room remembers the
repository, so pushing again only takes one click. **Disconnect** in the same dialog
removes your token.

Code from Python, C, C++ and Java runs on the server machine without a sandbox, so only
share rooms with people you trust.

## Project structure

```
client/   React app
server/   Socket.IO + Yjs server
docs/     Socket event reference
```

## License

Created by - Arpit Tamrakar
MIT