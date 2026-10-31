import { fileURLToPath } from 'node:url';
import { createSynqServer, lanAddresses } from './app.js';
import { detectLanguages } from './languages.js';
import { FileStore } from './db/fileStore.js';
import { MongoStore } from './db/mongoStore.js';
import { Accounts } from './accounts.js';
import { createSender } from './senders.js';
import { Shell } from './shell.js';
import { GitHub } from './github.js';

const PORT = Number(process.env.PORT) || 4000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || fileURLToPath(new URL('../data', import.meta.url));
const CORS_ORIGIN = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()) : true;
// MONGODB_URI=mongodb://localhost:27017/synq stores rooms and accounts in MongoDB (and
// imports any old .ybin files from DATA_DIR once). Without it, rooms are files in DATA_DIR.
const MONGODB_URI = (process.env.MONGODB_URI || '').trim();
const RUN_ENABLED = String(process.env.RUN_ENABLED ?? 'true').toLowerCase() !== 'false';

// RUN_LANGUAGES=javascript,typescript,python,c,cpp,java (default: every detected toolchain)
const wanted = (process.env.RUN_LANGUAGES || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const languages = Object.fromEntries(Object.entries(detectLanguages()).filter(([id]) => !wanted.length || wanted.includes(id)));

const store = MONGODB_URI ? new MongoStore({ uri: MONGODB_URI, dataDir: DATA_DIR }) : new FileStore({ dataDir: DATA_DIR });
// Accounts need the database. JWT_SECRET (32+ random characters) signs the access
// tokens; COOKIE_SECURE=true when the site is served over HTTPS.
const JWT_SECRET = (process.env.JWT_SECRET || '').trim();
if (MONGODB_URI && JWT_SECRET.length < 32) {
  console.error('[synq] JWT_SECRET is missing or shorter than 32 characters (see server/.env.example).');
  process.exit(1);
}
// Verification codes go out by email (SMTP_*) and SMS (TWILIO_*); see senders.js.
// GOOGLE_CLIENT_ID turns on "Continue with Google".
const sender = createSender(process.env);
const accounts = MONGODB_URI
  ? new Accounts({
      db: store.db,
      secret: JWT_SECRET,
      secureCookies: process.env.COOKIE_SECURE === 'true',
      sender,
      googleClientId: (process.env.GOOGLE_CLIENT_ID || '').trim(),
      defaultCountry: process.env.DEFAULT_COUNTRY_CODE || '91',
    })
  : null;
// "Push to GitHub": each user connects their own token (stored encrypted on the account).
const github = accounts ? new GitHub({ users: store.db.collection('users'), secret: JWT_SECRET }) : null;
// Terminal commands run in WORKSPACES_DIR/<roomId>. SHELL_ENABLED=false turns them off.
const SHELL_ENABLED = String(process.env.SHELL_ENABLED ?? 'true').toLowerCase() !== 'false';
const WORKSPACES_DIR = process.env.WORKSPACES_DIR || fileURLToPath(new URL('../workspaces', import.meta.url));
const shell = SHELL_ENABLED ? new Shell({ root: WORKSPACES_DIR }) : null;
const server = createSynqServer({ dataDir: DATA_DIR, store, accounts, github, shell, corsOrigin: CORS_ORIGIN, runEnabled: RUN_ENABLED, languages });
try {
  await server.listen(PORT, HOST);
} catch (err) {
  console.error(`[synq] could not start: ${store.label} is not reachable (${err.message}).`);
  if (MONGODB_URI) console.error('         Start MongoDB (the "MongoDB" Windows service, or "docker compose up -d"), or unset MONGODB_URI.');
  process.exit(1);
}

console.log(`SYNQ server listening on http://localhost:${PORT}`);
lanAddresses().forEach((ip) => console.log(`  on your network:  http://${ip}:${PORT}`));
console.log(`  rooms saved in:   ${store.label}`);
console.log(`  accounts:         ${accounts ? 'on (JWT, log in to create or join rooms)' : 'off (set MONGODB_URI to turn them on)'}`);
if (accounts) {
  console.log(`  codes:            ${sender.label}`);
  const smtp = await sender.checkEmail();
  if (smtp) console.log(`  email login:      ${smtp.ok ? smtp.message : `FAILED: ${smtp.message}`}`);
  console.log(`  Google sign-in:   ${accounts.googleClientId ? 'on' : 'off (set GOOGLE_CLIENT_ID)'}`);
  if (sender.devLog) console.log('  NOTE: OTP_DEV_LOG is on: codes that cannot be sent are printed here. Turn it off for real users.');
}
if (server.imported) console.log(`  imported ${server.imported} room file(s) from ${DATA_DIR} into the database`);
console.log(`  terminal shell:   ${shell ? `on, in ${WORKSPACES_DIR} (who may use it is a room setting)` : 'off'}`);
if (!RUN_ENABLED) console.log('  code execution:   off');
else {
  console.log('  code execution:');
  Object.values(languages).forEach((l) => console.log(`    ${l.label.padEnd(11)} ${l.tool}${l.kind === 'node' ? '  [sandboxed]' : ''}`));
  if (Object.values(languages).some((l) => l.kind === 'native')) {
    console.log('  WARNING: Python/C/C++/Java run with YOUR user permissions (no sandbox).');
    console.log('           Only invite people you trust, or set RUN_LANGUAGES / RUN_ENABLED=false.');
  }
}

const shutdown = async () => {
  await server.close();
  process.exit(0);
};
// A stray failure in one request must not take every room down with it.
process.on('unhandledRejection', (err) => console.error('[synq] unhandled error:', err?.message || err));

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
