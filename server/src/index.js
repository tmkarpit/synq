import { createSynqServer, lanAddresses } from './app.js';
import { loadConfig } from './config.js';
import { detectLanguages } from './languages.js';
import { FileStore } from './db/fileStore.js';
import { MongoStore } from './db/mongoStore.js';
import { Accounts } from './accounts.js';
import { createSender } from './senders.js';
import { Shell } from './shell.js';
import { GitHub } from './github.js';

const config = loadConfig();
const { port: PORT, host: HOST, dataDir: DATA_DIR, mongodbUri: MONGODB_URI, jwtSecret: JWT_SECRET } = config;

// RUN_LANGUAGES=javascript,typescript,python,c,cpp,java (default: every detected toolchain;
// in production only the sandboxed JavaScript and TypeScript).
const languages = Object.fromEntries(Object.entries(detectLanguages()).filter(([id]) => !config.runLanguages || config.runLanguages.includes(id)));

// MONGODB_URI=mongodb://localhost:27017/synq stores rooms and accounts in MongoDB (and
// imports any old .ybin files from DATA_DIR once). Without it, rooms are files in DATA_DIR.
const store = MONGODB_URI ? new MongoStore({ uri: MONGODB_URI, dataDir: DATA_DIR }) : new FileStore({ dataDir: DATA_DIR });
// Accounts need the database. JWT_SECRET (32+ random characters) signs the access
// tokens; COOKIE_SECURE=true when the site is served over HTTPS.
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
      secureCookies: config.cookieSecure,
      sender,
      googleClientId: (process.env.GOOGLE_CLIENT_ID || '').trim(),
      defaultCountry: process.env.DEFAULT_COUNTRY_CODE || '91',
    })
  : null;
// "Push to GitHub": each user connects their own token (stored encrypted on the account).
const github = accounts ? new GitHub({ users: store.db.collection('users'), secret: JWT_SECRET }) : null;
// Terminal commands run in WORKSPACES_DIR/<roomId>. SHELL_ENABLED=false turns them off.
const shell = config.shellEnabled ? new Shell({ root: config.workspacesDir }) : null;
const server = createSynqServer({
  dataDir: DATA_DIR,
  store,
  accounts,
  github,
  shell,
  corsOrigin: config.corsOrigin,
  runEnabled: config.runEnabled,
  languages,
  trustProxy: config.trustProxy,
  staticDir: config.staticDir,
  production: config.production,
});
try {
  await server.listen(PORT, HOST);
} catch (err) {
  console.error(`[synq] could not start: ${store.label} is not reachable (${err.message}).`);
  if (MONGODB_URI) console.error('         Start MongoDB (the "MongoDB" Windows service, or "docker compose up -d"), or unset MONGODB_URI.');
  process.exit(1);
}

console.log(`SYNQ server listening on http://localhost:${PORT}${config.production ? ' (production)' : ''}`);
lanAddresses().forEach((ip) => console.log(`  on your network:  http://${ip}:${PORT}`));
console.log(`  rooms saved in:   ${store.label}`);
if (config.staticDir) console.log(`  website:          ${config.staticDir}`);
console.log(`  accounts:         ${accounts ? 'on (JWT, log in to create or join rooms)' : 'off (set MONGODB_URI to turn them on)'}`);
if (accounts) {
  console.log(`  codes:            ${sender.label}`);
  const smtp = await sender.checkEmail();
  if (smtp) console.log(`  email login:      ${smtp.ok ? smtp.message : `FAILED: ${smtp.message}`}`);
  console.log(`  Google sign-in:   ${accounts.googleClientId ? 'on' : 'off (set GOOGLE_CLIENT_ID)'}`);
  if (sender.devLog) console.log('  NOTE: OTP_DEV_LOG is on: codes that cannot be sent are printed here. Turn it off for real users.');
}
if (server.imported) console.log(`  imported ${server.imported} room file(s) from ${DATA_DIR} into the database`);
console.log(`  terminal shell:   ${shell ? `on, in ${config.workspacesDir} (who may use it is a room setting)` : 'off'}`);
if (!config.runEnabled) console.log('  code execution:   off');
else {
  console.log('  code execution:');
  Object.values(languages).forEach((l) => console.log(`    ${l.label.padEnd(11)} ${l.tool}${l.kind === 'node' ? '  [sandboxed]' : ''}`));
  if (Object.values(languages).some((l) => l.kind === 'native')) {
    console.log('  WARNING: Python/C/C++/Java run with YOUR user permissions (no sandbox).');
    console.log('           Only invite people you trust, or set RUN_LANGUAGES / RUN_ENABLED=false.');
  }
}
if (config.production && (shell || Object.values(languages).some((l) => l.kind === 'native'))) {
  console.log('  WARNING: production with the terminal or native languages on: run the server in a container.');
}

const shutdown = async () => {
  await server.close();
  process.exit(0);
};
// A stray failure in one request must not take every room down with it.
process.on('unhandledRejection', (err) => console.error('[synq] unhandled error:', err?.message || err));

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
