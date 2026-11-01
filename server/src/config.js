import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const CLIENT_DIST = fileURLToPath(new URL('../../client/dist', import.meta.url));

// Server settings from the environment (server/.env, see .env.example), with safe
// defaults for production: NODE_ENV=production turns off the two features that run
// commands on the host (the terminal, and Python/C/C++/Java) unless they are switched on
// on purpose, and only accepts sockets from the site's own origin.

const list = (value) =>
  String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const flag = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return String(value).toLowerCase() !== 'false';
};

export const SAFE_LANGUAGES = ['javascript', 'typescript'];

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const languages = list(env.RUN_LANGUAGES).map((s) => s.toLowerCase());
  const origins = list(env.CORS_ORIGIN);
  return {
    production,
    port: Number(env.PORT) || 4000,
    host: env.HOST || '0.0.0.0',
    dataDir: env.DATA_DIR || fileURLToPath(new URL('../data', import.meta.url)),
    workspacesDir: env.WORKSPACES_DIR || fileURLToPath(new URL('../workspaces', import.meta.url)),
    mongodbUri: (env.MONGODB_URI || '').trim(),
    jwtSecret: (env.JWT_SECRET || '').trim(),
    runEnabled: flag(env.RUN_ENABLED, true),
    // Empty = every detected toolchain in development, only the sandboxed ones in production.
    runLanguages: languages.length ? languages : production ? SAFE_LANGUAGES : null,
    shellEnabled: flag(env.SHELL_ENABLED, !production),
    // Socket.IO origins. Production without CORS_ORIGIN: same origin only (false).
    corsOrigin: origins.length ? origins : production ? false : true,
    // How many proxies (load balancer, CDN) sit in front of the server: their
    // X-Forwarded-For entries tell the real client address for rate limits.
    trustProxy: Math.max(0, Number(env.TRUST_PROXY) || 0),
    // The built client (client/dist) to serve from this server, so the site, the API and
    // the sockets share one origin. In production it is found by itself after a build.
    staticDir: (env.STATIC_DIR || '').trim() || (production && fs.existsSync(CLIENT_DIST) ? CLIENT_DIST : null),
    cookieSecure: env.COOKIE_SECURE === 'true',
  };
}

/**
 * The client's address. With trustProxy = N, the Nth X-Forwarded-For entry from the
 * right (the one the outermost trusted proxy saw); otherwise the socket address. Local
 * requests through the Vite dev proxy also pass the browser's address on.
 */
export function clientIp(remoteAddress, forwardedFor, trustProxy = 0) {
  const hops = String(forwardedFor || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (trustProxy > 0 && hops.length) return hops[Math.max(0, hops.length - trustProxy)];
  if (/^(127\.|::1$|::ffff:127\.)/.test(remoteAddress || '') && hops.length) return hops.at(-1);
  return remoteAddress || '';
}
