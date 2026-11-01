import fs from 'node:fs';
import path from 'node:path';

// Serves the built client (client/dist) from the SYNQ server, so the website, the API,
// the sockets and Go Live share one origin: login cookies stay first-party, and no CORS
// or host rewrite rules are needed. Page routes (/room/..., /login) get index.html.

const TYPES = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  ico: 'image/x-icon',
  webp: 'image/webp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  txt: 'text/plain; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  webmanifest: 'application/manifest+json',
  wasm: 'application/wasm',
};

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'cross-origin-opener-policy': 'same-origin-allow-popups',
};

/** A request handler for `root`, or null when there is no build there. */
export function createStaticHandler(root, { hsts = false } = {}) {
  const base = path.resolve(root);
  const indexFile = path.join(base, 'index.html');
  if (!fs.existsSync(indexFile)) return null;
  const headers = hsts ? { ...SECURITY_HEADERS, 'strict-transport-security': 'max-age=31536000; includeSubDomains' } : SECURITY_HEADERS;

  const send = (req, res, file, cache) => {
    const stat = fs.statSync(file);
    const type = TYPES[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { ...headers, 'content-type': type, 'content-length': stat.size, 'cache-control': cache });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(file).pipe(res);
  };

  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    let rel;
    try {
      rel = decodeURIComponent(req.url.split('?')[0]);
    } catch {
      return false;
    }
    if (rel.startsWith('/api/') || rel.startsWith('/socket.io/') || rel.startsWith('/live/')) return false;
    const full = path.resolve(base, `.${rel}`);
    if (full.startsWith(base + path.sep) && fs.existsSync(full) && fs.statSync(full).isFile()) {
      // Hashed build files never change; everything else is checked on every visit.
      const cache = rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
      send(req, res, full, cache);
      return true;
    }
    // A missing file with an extension is a real 404; anything else is a page route.
    if (path.extname(rel)) return false;
    send(req, res, indexFile, 'no-cache');
    return true;
  };
}
