# SYNQ (Real-time Collaborative Code Editor)

SYNQ is a code editor that runs in the browser and lets a whole team work in the same files at
the same time. Create a room, share the link, and everyone codes together with live cursors,
chat, a shared terminal and one-click push to GitHub. I built it to make pair programming,
study groups and coding interviews feel like sitting at the same desk, with no screen sharing
and no sending files back and forth.

## Tech Stack

**Client:** React, Vite, Tailwind CSS, Monaco Editor, xterm.js, Zustand

**Server:** Node.js, Socket.IO, Yjs, MongoDB, JWT, Nodemailer

## Features

- Real-time editing with live cursors for everyone in the room
- VS Code–like editor with IntelliSense and snippets
- Run JavaScript, TypeScript, Python, C, C++ and Java with shared output
- Shared terminal (`npm install`, `node app.js` and more)
- Go Live preview for HTML pages that updates as you type
- Room chat and a list of who is online
- Invite links, with the owner accepting or declining people
- Editor and viewer roles, and owner-only controls
- Push the room's code to GitHub in one click
- Log in with password, email/SMS code or Google
- Login history (every signup, login and logout is recorded)
- Rooms are saved in MongoDB and can be downloaded as a `.zip`

## Demo

There's no hosted version yet. Follow [Run Locally](#run-locally) below.

To just look around without setting up a database, start the client in demo mode with
`VITE_USE_MOCK=true`. It opens a sample room with two simulated teammates.


## Screenshots

**Home Page**
![Home Page](docs/screenshots/landing.png)

**Login Page** (Google, password or a one-time code)
![Login Page](docs/screenshots/login.png)

**Start a Room** (pick your name, cursor color and room ID)
![Start a Room](docs/screenshots/create-room.png)

**Editor** (live cursors of teammates and the shared run output)
![Editor](docs/screenshots/editor.png)

**People in the Room** (who is online, their role and the file they're in)
![People](docs/screenshots/people.png)

**Room Chat**
![Chat](docs/screenshots/chat.png)

<sub>The room screenshots were taken in demo mode, so the teammates are simulated.</sub>

## Run Locally

Clone the project

```bash
  git clone https://github.com/tmkarpit/synq
```

Go to the project directory

```bash
  cd synq
```

Install dependencies (client and server)

```bash
  npm run install:all
```

Copy `server/.env.example` to `server/.env` and set the environment variables
(at least `MONGODB_URI` and `JWT_SECRET`)

```bash
  cp server/.env.example server/.env
```

Start the server

```bash
  npm run dev:server
```

In a second terminal, start the client

```bash
  npm --prefix client run dev:lan
```

Open http://localhost:5173 in your browser

## Deploy

SYNQ needs a host that keeps WebSockets open, so the server cannot run on serverless
functions. The recommended setup:

| Part | Host | Config in this repo |
|---|---|---|
| Website | Vercel (static Vite build) | `client/vercel.json` |
| Server (API + WebSockets) | Render Web Service | `render.yaml` |
| Database | MongoDB Atlas | `MONGODB_URI` |

Vercel passes `/api` on to Render, so the login cookie stays first-party (Safari and
privacy modes block third-party cookies); live editing connects to Render directly.

1. **MongoDB Atlas**: create a free cluster and a database user, allow `0.0.0.0/0` under
   Network Access, and copy the connection string with `/synq` as the database name.
2. **Render**: New > Blueprint > this repo. Fill in the secrets it asks for
   (`MONGODB_URI`, `CLIENT_ORIGINS`, `GOOGLE_CLIENT_ID`, `SMTP_USER`, `SMTP_PASS`,
   `MAIL_FROM`). Check that https://YOUR-SERVICE.onrender.com/health answers `{"ok":true}`.
3. **Vercel**: import this repo with Root Directory `client`. Set `VITE_SOCKET_URL` to
   the Render address, `VITE_USE_MOCK=false` and `SITE_URL` to the Vercel address. If
   the Render service is not called `synq-server`, change the address in
   `client/vercel.json` too.
4. Put the Vercel address in `CLIENT_ORIGINS` on Render (https, no trailing slash), add
   it to the Google OAuth client's authorized JavaScript origins, and redeploy both.

Every setting is described in `server/.env.example` and `client/.env.example`.

In production, running code and the terminal are off unless switched on. The Blueprint
turns on only the sandboxed JavaScript/TypeScript runner (no files, processes or
network). Python, C, C++ and Java would run without a sandbox, so keep them off on a
shared server.

**Free tier:** Render's free server sleeps after 15 minutes without traffic; the first
visit then takes up to a minute and the site shows "Waking up the server…". A free
uptime monitor (for example UptimeRobot) checking `/health` every 10 minutes keeps it
awake. The server itself never pings itself.

**One service instead** (no Vercel): the server can also serve the website.

```bash
  docker build --build-arg SITE_URL=https://your-domain.com -t synq .
  docker run -p 4000:4000 --env-file server/.env -e NODE_ENV=production -e RUN_ENABLED=true synq
```

## Contributing

Contributions are always welcome!

## Authors

- [@tmkarpit](https://www.github.com/tmkarpit) (Arpit Tamrakar)

## License

[MIT](https://choosealicense.com/licenses/mit/)
