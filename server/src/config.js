import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const CLIENT_DIST = fileURLToPath(new URL('../../client/dist', import.meta.url));

// Server settings from the environment (server/.env, see .env.example), with safe
// defaults for production: NODE_ENV=production turns off running code and the terminal
// unless they are switched on on purpose (RUN_ENABLED, RUN_LANGUAGES, SHELL_ENABLED), and
// only accepts requests and sockets from the site's own origin (CLIENT_ORIGINS).

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

/**
 * Which browser origins may call the API and open sockets: true (any, development),
 * false (same origin only), or a function of the Origin header. CLIENT_ORIGINS lists
 * exact origins; VERCEL_PREVIEW_PROJECT=<name> also allows that project's Vercel preview
 * deployments (https://<name>-<hash>-<team>.vercel.app), and nobody else's.
 */
export function originPolicy({ origins = [], vercelProject = '', production = false } = {}) {
  const exact = new Set(origins.map((o) => o.replace(/\/+$/, '')));
  const project = vercelProject.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  const preview = project ? new RegExp(`^https://${project}(-[a-z0-9-]+)?\\.vercel\\.app$`) : null;
  if (!exact.size && !preview) return !production;
  return (origin) => exact.has(origin) || (preview ? preview.test(origin) : false);
}

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const languages = list(env.RUN_LANGUAGES).map((s) => s.toLowerCase());
  const origins = list(env.CLIENT_ORIGINS || env.CORS_ORIGIN);
  return {
    production,
    port: Number(env.PORT) || 4000,
    host: env.HOST || '0.0.0.0',
    dataDir: env.DATA_DIR || fileURLToPath(new URL('../data', import.meta.url)),
    workspacesDir: env.WORKSPACES_DIR || fileURLToPath(new URL('../workspaces', import.meta.url)),
    mongodbUri: (env.MONGODB_URI || '').trim(),
    // 4 = reach the database over IPv4 only. Some mobile networks route IPv6 through a
    // translator with another public address, which MongoDB Atlas' IP access list blocks.
    mongodbFamily: [4, 6].includes(Number(env.MONGODB_IP_FAMILY)) ? Number(env.MONGODB_IP_FAMILY) : undefined,
    jwtSecret: (env.JWT_SECRET || '').trim(),
    // Off by default in production: switch on deliberately (RUN_ENABLED=true), together with
    // RUN_LANGUAGES (default there: only the sandboxed JavaScript and TypeScript).
    runEnabled: flag(env.RUN_ENABLED, !production),
    // Empty = every detected toolchain in development, only the sandboxed ones in production.
    runLanguages: languages.length ? languages : production ? SAFE_LANGUAGES : null,
    shellEnabled: flag(env.SHELL_ENABLED, !production),
    // Python, C, C++ and Java on JDoodle's free compiler API instead of this server (jdoodle.js).
    jdoodle: {
      clientId: (env.JDOODLE_CLIENT_ID || '').trim(),
      clientSecret: (env.JDOODLE_CLIENT_SECRET || '').trim(),
      url: (env.JDOODLE_URL || '').trim() || undefined,
      languages: list(env.JDOODLE_LANGUAGES).map((s) => s.toLowerCase()),
      // "python:4,cpp:1": override JDoodle version indexes.
      versions: Object.fromEntries(list(env.JDOODLE_VERSIONS).map((pair) => pair.split(':').map((s) => s.trim().toLowerCase()))),
    },
    // Python, C, C++ and Java on Judge0's sandbox instead of this server (judge0.js).
    judge0: {
      key: (env.JUDGE0_API_KEY || '').trim(),
      url: (env.JUDGE0_URL || '').trim() || undefined,
      languages: list(env.JUDGE0_LANGUAGES).map((s) => s.toLowerCase()),
    },
    // Origins allowed to use the API and sockets (originPolicy). Production without any:
    // same origin only.
    corsOrigin: originPolicy({ origins, vercelProject: env.VERCEL_PREVIEW_PROJECT || '', production }),
    // lax (default): the site and the API share an origin (one service, or a Vercel rewrite).
    // none: the site calls the API on another domain directly (needs HTTPS; Safari and
    // browsers that block third-party cookies will still log people out on reload).
    cookieSameSite: String(env.COOKIE_SAMESITE || '').toLowerCase() === 'none' ? 'None' : 'Lax',
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
