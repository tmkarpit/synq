import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'acorn';
import { allFileRows, contentHash, pathOf } from './projectFiles.js';

// "Go Live": serves a room's files over HTTP, like VS Code's Live Server.
//
//   /live/<token>/index.html   a file of the room (relative links work: style.css, js/app.js)
//   /live/<token>/__live       Server-Sent Events: what changed, as the room is edited
//
// The token is a random secret per room, handed only to people in the room (live:open),
// so nobody can guess another room's preview address. HTML pages get a small script that
// applies changes without a full reload where it can (hot updates):
//   - CSS: the stylesheet is swapped in place, no reload;
//   - the open HTML page without scripts: its head and body are patched in place;
//   - anything else (scripts, JSON, ...): a reload that keeps the scroll position.
// While a JavaScript file (or an inline <script>) has a syntax error, the preview keeps
// the last working page and shows the error in a small overlay instead of reloading into
// broken code; it updates as soon as the code parses again. Errors the page throws while
// running are shown in the same overlay.
//
// The pages run code anyone in the room wrote, on the same localhost as SYNQ. Every
// response is therefore sandboxed (Content-Security-Policy: sandbox without
// allow-same-origin): the page gets an opaque origin, so it cannot read SYNQ's cookies,
// login or storage, the way VS Code isolates its previews.

const TYPES = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  wasm: 'application/wasm',
};
const typeOf = (file) => TYPES[path.extname(file).slice(1).toLowerCase()] || 'text/plain; charset=utf-8';

const HEADERS = {
  'content-security-policy': 'sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads',
  'access-control-allow-origin': '*', // sandboxed pages have a "null" origin
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

const DEBOUNCE_MS = 250;
// Edits to these never change what the page shows.
const INERT = /\.(md|markdown|txt|gitignore|env)$|(^|\/)(LICENSE|README)[^/]*$/i;

/** { line, column, message } of the first syntax error in JavaScript code, or null. */
function jsError(code, lineOffset = 0) {
  const options = { ecmaVersion: 'latest', allowHashBang: true, allowAwaitOutsideFunction: true };
  try {
    parse(code, { ...options, sourceType: 'module' });
    return null;
  } catch (err) {
    // Old-style scripts can be valid only as a classic script (e.g. "with", octal literals).
    try {
      parse(code, { ...options, sourceType: 'script' });
      return null;
    } catch {
      return {
        line: (err.loc?.line ?? 1) + lineOffset,
        column: (err.loc?.column ?? 0) + 1,
        message: String(err.message).replace(/ \(\d+:\d+\)$/, ''),
      };
    }
  }
}

const SCRIPT_TAG = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const JS_TYPE = /^\s*$|^\s*(text|application)\/(java|ecma)script\s*$|^\s*module\s*$/i;

/** The first syntax error in a file the browser would run (JS, or HTML inline scripts). */
export function syntaxError(filePath, text) {
  if (/\.(m?js|cjs)$/i.test(filePath)) return jsError(text);
  if (!/\.html?$/i.test(filePath)) return null;
  for (const m of text.matchAll(SCRIPT_TAG)) {
    const attrs = m[1];
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = /\btype\s*=\s*["']?([^"'\s>]*)/i.exec(attrs)?.[1] ?? '';
    if (!JS_TYPE.test(type)) continue;
    const before = text.slice(0, m.index + m[0].indexOf('>') + 1);
    const error = jsError(m[2], before.split('\n').length - 1);
    if (error) return error;
  }
  return null;
}

/**
 * Runs in the preview page (injected as source text, never on the server). Applies the
 * updates from /__live and shows syntax and runtime errors in an overlay.
 */
function liveClient(token) {
  const base = `/live/${token}/`;
  const here = () => {
    let rel = decodeURIComponent(location.pathname.slice(base.length));
    if (!rel || rel.endsWith('/')) rel += 'index.html';
    return rel;
  };
  const own = (el) => el.hasAttribute && el.hasAttribute('data-synq-live');

  // Keep the scroll position across reloads (window.name survives a reload; storage is
  // not available in the sandbox).
  const MARK = 'synq-live-scroll:';
  const reload = () => {
    try {
      window.name = `${MARK}${window.scrollX},${window.scrollY}`;
    } catch {
      /* ignore */
    }
    location.reload();
  };
  if (String(window.name).startsWith(MARK)) {
    const [x, y] = window.name.slice(MARK.length).split(',').map(Number);
    window.name = '';
    const restore = () => window.scrollTo(x || 0, y || 0);
    window.addEventListener('load', () => {
      restore();
      requestAnimationFrame(restore);
    });
  }

  // The error overlay, in a shadow root so the page's CSS cannot touch it (and patching
  // the body does not remove it).
  let box = null;
  let kind = null;
  const overlay = (type, title, detail) => {
    if (!box) {
      const host = document.createElement('synq-live-overlay');
      host.setAttribute('data-synq-live', '');
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML =
        '<style>' +
        '.b{position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;max-width:720px;margin:0 auto;' +
        'background:#1e1e24;color:#eee;border:1px solid #f14c4c;border-left-width:4px;border-radius:8px;' +
        'box-shadow:0 8px 30px rgba(0,0,0,.45);font:13px/1.5 ui-monospace,Menlo,Consolas,monospace;padding:10px 36px 10px 12px}' +
        '.t{color:#ff8a8a;font-weight:700;margin-bottom:2px;font-family:system-ui,sans-serif}' +
        '.d{white-space:pre-wrap;word-break:break-word}.h{color:#9aa0aa;font-family:system-ui,sans-serif;font-size:12px;margin-top:4px}' +
        'button{position:absolute;top:6px;right:6px;background:none;border:0;color:#aaa;font-size:18px;cursor:pointer;line-height:1}' +
        'button:hover{color:#fff}</style>' +
        '<div class="b" role="alert"><button aria-label="Close">×</button><div class="t"></div><div class="d"></div><div class="h"></div></div>';
      root.querySelector('button').onclick = () => hide();
      box = { host, title: root.querySelector('.t'), detail: root.querySelector('.d'), hint: root.querySelector('.h') };
    }
    kind = type;
    box.title.textContent = title;
    box.detail.textContent = detail;
    box.hint.textContent =
      type === 'syntax'
        ? 'SYNQ Live Server: still showing the last working version. It updates as soon as this is fixed.'
        : 'SYNQ Live Server: an error in the page. It updates on your next change.';
    if (!box.host.isConnected) document.documentElement.appendChild(box.host);
  };
  const hide = () => {
    kind = null;
    if (box) box.host.remove();
  };

  const where = (file, line, col) => {
    if (!file) return '';
    const name = String(file).includes(base) ? decodeURIComponent(String(file).split(base)[1].split('?')[0]) : file;
    return ` (${name}${line ? `:${line}` : ''}${col ? `:${col}` : ''})`;
  };
  window.addEventListener('error', (e) => {
    if (!(e instanceof ErrorEvent)) return; // a failed image or stylesheet, not code
    overlay('runtime', 'Uncaught error', `${e.message}${where(e.filename, e.lineno, e.colno)}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    overlay('runtime', 'Unhandled promise rejection', r && r.stack ? String(r.stack) : String(r));
  });

  // CSS: load the new stylesheet next to the old one, then drop the old (no flash).
  const swapCss = (paths) => {
    const wanted = new Set(paths.map((p) => base + p));
    document.querySelectorAll('link[rel~="stylesheet"]').forEach((link) => {
      const url = new URL(link.getAttribute('href'), location.href);
      if (!wanted.has(decodeURIComponent(url.pathname))) return;
      const next = link.cloneNode();
      url.searchParams.set('synq', String(Date.now()));
      next.href = url.pathname + url.search;
      next.onload = () => link.remove();
      next.onerror = () => next.remove();
      link.after(next);
    });
  };

  // The open page changed: patch it in place when it has no scripts of its own (nothing
  // would re-run them); otherwise reload.
  const pageScripts = (doc) => [...doc.querySelectorAll('script')].filter((s) => !own(s)).length;
  const patchPage = async () => {
    if (pageScripts(document)) return reload();
    let html;
    try {
      const res = await fetch(location.pathname, { cache: 'no-store' });
      if (!res.ok) return reload();
      html = await res.text();
    } catch {
      return reload();
    }
    const next = new DOMParser().parseFromString(html, 'text/html');
    if (pageScripts(next)) return reload();
    const sig = (head) =>
      [...head.children]
        .filter((el) => !own(el))
        .map((el) => el.outerHTML.replace(/[?&]synq=\d+/, ''))
        .join('');
    if (sig(document.head) !== sig(next.head)) {
      [...document.head.children].filter((el) => !own(el)).forEach((el) => el.remove());
      [...next.head.children].filter((el) => !own(el)).forEach((el) => document.head.appendChild(document.importNode(el, true)));
    }
    document.title = next.title;
    const body = document.importNode(next.body, true);
    body.querySelectorAll('[data-synq-live]').forEach((el) => el.remove());
    document.body.replaceWith(body);
    return undefined;
  };

  const source = new EventSource(`${base}__live`);
  source.onmessage = (e) => {
    if (e.data === 'reload') return reload();
    if (e.data === 'stopped') {
      source.close();
      document.title = `(stopped) ${document.title}`;
      return undefined;
    }
    let m;
    try {
      m = JSON.parse(e.data);
    } catch {
      return undefined;
    }
    if (m.type === 'error') {
      overlay('syntax', `Syntax error in ${m.file}`, `${m.message} (line ${m.line}, column ${m.column})`);
    } else if (m.type === 'ok') {
      if (kind === 'syntax') hide();
    } else if (m.type === 'update') {
      if (kind === 'runtime' && (m.reload || m.html.length)) hide();
      if (m.reload) return reload();
      if (m.css.length) swapCss(m.css);
      if (m.html.includes(here())) return patchPage();
    }
    return undefined;
  };
}

const clientScript = (token) =>
  `<script data-synq-live>/* SYNQ Live Server: hot updates and error overlay */(${liveClient.toString()})(${JSON.stringify(token)});</script>`;

/**
 * Puts the live script first in <head>, so it also catches errors thrown by the page's own
 * scripts. Never before the doctype (that would switch the page to quirks mode).
 */
function inject(source, token) {
  const script = clientScript(token);
  // The sandboxed page has an opaque origin, so the browser hides the details of errors
  // in the room's own scripts ("Script error.") unless they are loaded with CORS, which
  // the live server allows. Scripts from other sites are left alone.
  const html = source.replace(/<script\b(?![^>]*\bcrossorigin\b)(?=[^>]*\bsrc\s*=\s*["']?(?!https?:|\/\/))/gi, '<script crossorigin="anonymous"');
  for (const re of [/<head\b[^>]*>/i, /<html\b[^>]*>/i, /<!doctype[^>]*>/i]) {
    const m = re.exec(html);
    if (m) return html.slice(0, m.index + m[0].length) + script + html.slice(m.index + m[0].length);
  }
  return script + html;
}

export class LiveServer {
  /** getRoom(roomId): the loaded room (rooms.get); shell: shell.js, for files only on disk. */
  constructor({ getRoom, releaseRoom = () => {}, shell = null }) {
    this.getRoom = getRoom;
    this.releaseRoom = releaseRoom;
    this.shell = shell;
    this.tokens = new Map(); // token -> roomId
    this.byRoom = new Map(); // roomId -> token
    this.clients = new Map(); // roomId -> Set<res> (event streams)
    this.timers = new Map(); // roomId -> debounce timer
    this.snapshots = new Map(); // roomId -> Map<path, fingerprint> the previews were last told about
    this.broken = new Map(); // roomId -> Map<path, syntax error>
    this.pending = new Map(); // roomId -> { html: Set, reload } held back while code is broken
  }

  /** The preview address of a file ("/live/<token>/<path>"). One token per room. */
  urlFor(roomId, filePath) {
    let token = this.byRoom.get(roomId);
    if (!token) {
      token = randomBytes(18).toString('base64url');
      this.tokens.set(token, roomId);
      this.byRoom.set(roomId, token);
    }
    return `/live/${token}/${filePath.split('/').map(encodeURIComponent).join('/')}`;
  }

  isLive(roomId) {
    return this.byRoom.has(roomId);
  }

  /** Stops the room's live server: its address stops working and open previews are told. */
  stop(roomId) {
    const token = this.byRoom.get(roomId);
    if (!token) return false;
    this.byRoom.delete(roomId);
    this.tokens.delete(token);
    clearTimeout(this.timers.get(roomId));
    this.clients.get(roomId)?.forEach((res) => res.end('data: stopped\n\n'));
    this.forget(roomId);
    return true;
  }

  forget(roomId) {
    this.clients.delete(roomId);
    this.snapshots.delete(roomId);
    this.broken.delete(roomId);
    this.pending.delete(roomId);
  }

  /** The room changed: shortly after the last edit, open previews get what changed. */
  changed(room) {
    if (!this.clients.get(room.id)?.size) return;
    clearTimeout(this.timers.get(room.id));
    this.timers.set(
      room.id,
      setTimeout(() => {
        this.timers.delete(room.id);
        this.flush(room);
      }, DEBOUNCE_MS),
    );
  }

  fingerprints(room) {
    return new Map(allFileRows(room.doc).map((f) => [f.path, { hash: contentHash(f.content), content: f.content }]));
  }

  flush(room) {
    const id = room.id;
    const files = this.fingerprints(room);
    const before = this.snapshots.get(id) ?? new Map();
    this.snapshots.set(id, new Map([...files].map(([p, f]) => [p, f.hash])));
    const changed = [...new Set([...files.keys(), ...before.keys()])].filter((p) => files.get(p)?.hash !== before.get(p));
    if (!changed.length) return;

    const broken = this.broken.get(id) ?? new Map();
    changed.forEach((p) => {
      const error = files.has(p) ? syntaxError(p, files.get(p).content) : null;
      if (error) broken.set(p, error);
      else broken.delete(p);
    });
    this.broken.set(id, broken);

    const pending = this.pending.get(id) ?? { html: new Set(), reload: false };
    const css = [];
    changed.forEach((p) => {
      if (/\.css$/i.test(p)) css.push(p);
      else if (/\.html?$/i.test(p)) pending.html.add(p);
      else if (!INERT.test(p)) pending.reload = true;
    });

    const send = (message) => this.clients.get(id)?.forEach((res) => res.write(`data: ${JSON.stringify(message)}\n\n`));
    if (broken.size) {
      // Keep the last working page; styles still update.
      if (css.length) send({ type: 'update', css, html: [], reload: false });
      const [file, error] = [...broken][0];
      send({ type: 'error', file, ...error });
      this.pending.set(id, pending);
      return;
    }
    if (this.pending.has(id)) send({ type: 'ok' }); // fixed: the overlay goes away
    this.pending.delete(id);
    if (css.length || pending.html.size || pending.reload) send({ type: 'update', css, html: [...pending.html], reload: pending.reload });
  }

  /** Handles /live/... requests. Resolves true when it handled the request. */
  async handle(req, res) {
    const url = req.url.split('?')[0];
    if (!url.startsWith('/live/')) return false;
    const send = (status, body, type = 'text/plain; charset=utf-8') => {
      res.writeHead(status, { ...HEADERS, 'content-type': type });
      res.end(body);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'Method not allowed'), true;

    const [, , token, ...rest] = url.split('/');
    const roomId = this.tokens.get(token);
    if (!roomId) return send(404, 'This preview link has expired. Open it again from SYNQ (Go Live).'), true;

    let rel;
    try {
      rel = rest.map(decodeURIComponent).join('/');
    } catch {
      return send(400, 'Bad path'), true;
    }
    if (rel.split('/').some((part) => part === '..' || part === '.')) return send(400, 'Bad path'), true;

    const room = await this.getRoom(roomId);
    try {
      if (rel === '__live') return this.stream(room, req, res), true;
      if (!rel || rel.endsWith('/')) rel += 'index.html';
      const nodes = room?.doc.getMap('nodes');
      let fileId = null;
      nodes?.forEach((node, id) => {
        if (node.type === 'file' && pathOf(nodes, id) === rel) fileId = id;
      });
      if (fileId) {
        let body = room.doc.getMap('texts').get(fileId)?.toString() ?? '';
        if (/\.html?$/i.test(rel)) body = inject(body, token);
        return send(200, req.method === 'HEAD' ? '' : body, typeOf(rel)), true;
      }
      // Files only on disk (images from the terminal, node_modules, ...).
      const disk = this.diskFile(roomId, rel);
      if (disk) {
        res.writeHead(200, { ...HEADERS, 'content-type': typeOf(rel), 'content-length': disk.size });
        if (req.method === 'HEAD') res.end();
        else fs.createReadStream(disk.full).pipe(res);
        return true;
      }
      return send(404, `Not found: ${rel}`), true;
    } finally {
      if (room) this.releaseRoom(room);
    }
  }

  diskFile(roomId, rel) {
    if (!this.shell) return null;
    const root = this.shell.dir(roomId);
    const full = path.resolve(root, rel);
    const back = path.relative(root, full);
    if (!back || back.startsWith('..') || path.isAbsolute(back)) return null;
    try {
      const stat = fs.statSync(full);
      return stat.isFile() ? { full, size: stat.size } : null;
    } catch {
      return null;
    }
  }

  stream(room, req, res) {
    const roomId = room.id;
    res.writeHead(200, { ...HEADERS, 'content-type': 'text/event-stream', connection: 'keep-alive' });
    res.write(': connected\n\n');
    if (!this.clients.get(roomId)?.size) {
      // The first preview: changes are counted from now.
      this.clients.set(roomId, new Set());
      this.snapshots.set(roomId, new Map([...this.fingerprints(room)].map(([p, f]) => [p, f.hash])));
      this.broken.delete(roomId);
      this.pending.delete(roomId);
    }
    this.clients.get(roomId).add(res);
    // A preview opened while code is broken shows the error right away.
    const [file, error] = [...(this.broken.get(roomId) ?? [])][0] ?? [];
    if (file) res.write(`data: ${JSON.stringify({ type: 'error', file, ...error })}\n\n`);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      this.clients.get(roomId)?.delete(res);
    });
  }

  close() {
    this.clients.forEach((set) => set.forEach((res) => res.end()));
    this.clients.clear();
  }
}
