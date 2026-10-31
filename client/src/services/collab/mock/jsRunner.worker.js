// Mock-mode JavaScript sandbox. Runs one program per Worker instance; the main thread
// enforces the timeout and output cap with worker.terminate() (see jsRunner.js).
// Loaded as raw text into a Blob worker: keep this file free of imports.
//
// Isolation: a dedicated Worker has no DOM, no cookies API and no access to the page's
// state. Network and storage globals are removed below before user code runs. This is
// a demo sandbox for mock mode only; real mode executes code on the backend.

const BLOCKED_GLOBALS = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'WebTransport',
  'EventSource',
  'BroadcastChannel',
  'importScripts',
  'indexedDB',
  'caches',
  'Worker',
  'SharedWorker',
  'Request',
  'Response',
];

function harden() {
  let proto = self;
  while (proto && proto !== Object.prototype) {
    for (const key of BLOCKED_GLOBALS) {
      try {
        if (Object.prototype.hasOwnProperty.call(proto, key)) delete proto[key];
      } catch {
        // non-configurable: shadowed below
      }
    }
    proto = Object.getPrototypeOf(proto);
  }
  for (const key of BLOCKED_GLOBALS) {
    try {
      Object.defineProperty(self, key, { value: undefined, configurable: false, writable: false });
    } catch {
      // already gone
    }
  }
  // The worker only talks to the page through the captured `post` below.
  try {
    Object.defineProperty(self, 'onmessage', { value: null, configurable: false, writable: false });
  } catch {
    // ignore
  }
}

function inspect(value, depth = 0, seen = new WeakSet()) {
  if (typeof value === 'string') return depth === 0 ? value : JSON.stringify(value);
  if (typeof value === 'function') return `[Function: ${value.name || 'anonymous'}]`;
  if (typeof value === 'symbol' || typeof value === 'bigint')
    return value.toString() + (typeof value === 'bigint' ? 'n' : '');
  if (value === null || typeof value !== 'object') return String(value);
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  if (seen.has(value)) return '[Circular]';
  if (depth > 3) return Array.isArray(value) ? '[Array]' : '[Object]';
  seen.add(value);
  if (Array.isArray(value)) {
    const items = value.slice(0, 100).map((v) => inspect(v, depth + 1, seen));
    if (value.length > 100) items.push(`... ${value.length - 100} more items`);
    return `[ ${items.join(', ')} ]`;
  }
  if (value instanceof Map) {
    return `Map(${value.size}) { ${[...value].map(([k, v]) => `${inspect(k, depth + 1, seen)} => ${inspect(v, depth + 1, seen)}`).join(', ')} }`;
  }
  if (value instanceof Set) {
    return `Set(${value.size}) { ${[...value].map((v) => inspect(v, depth + 1, seen)).join(', ')} }`;
  }
  const entries = Object.entries(value).map(([k, v]) => `${k}: ${inspect(v, depth + 1, seen)}`);
  return entries.length ? `{ ${entries.join(', ')} }` : '{}';
}

const format = (args) => args.map((a) => inspect(a)).join(' ');

self.addEventListener(
  'message',
  async (event) => {
    const { code = '', stdin = '', path = 'main.js' } = event.data || {};
    const post = self.postMessage.bind(self);
    const out =
      (stream) =>
      (...args) =>
        post({ type: 'output', stream, chunk: `${format(args)}\n` });

    let finished = false;
    let moduleDone = false;
    let pendingTimers = 0;
    let exitCode = 0;

    const finish = () => {
      if (finished) return;
      finished = true;
      post({ type: 'done', exitCode });
    };
    const realSetTimeout = self.setTimeout.bind(self);
    const maybeFinish = () =>
      realSetTimeout(() => moduleDone && pendingTimers === 0 && finish(), 0);

    const fail = (err) => {
      exitCode = 1;
      const text =
        err instanceof Error
          ? err.stack || `${err.name}: ${err.message}`
          : `Uncaught ${inspect(err)}`;
      post({ type: 'output', stream: 'stderr', chunk: `${text.replace(/blob:[^\s)]+/g, path)}\n` });
      finish();
    };

    self.addEventListener('error', (e) => {
      e.preventDefault();
      fail(e.error || e.message);
    });
    self.addEventListener('unhandledrejection', (e) => {
      e.preventDefault();
      fail(e.reason);
    });

    // Count pending timers so "done" waits for setTimeout callbacks, like Node does.
    // A running setInterval keeps the program alive until the 5s timeout kills it.
    const timers = new Set();
    const wrapTimer =
      (realFn, clearFn, repeat) =>
      (fn, ms, ...rest) => {
        let id;
        const cb = () => {
          try {
            if (typeof fn === 'function') fn(...rest);
          } finally {
            if (!repeat && timers.delete(id)) {
              pendingTimers -= 1;
              maybeFinish();
            }
          }
        };
        id = realFn(cb, ms);
        timers.add(id);
        pendingTimers += 1;
        return id;
      };
    const wrapClear = (clearFn) => (id) => {
      clearFn(id);
      if (timers.delete(id)) {
        pendingTimers -= 1;
        maybeFinish();
      }
    };
    self.setTimeout = wrapTimer(self.setTimeout.bind(self), null, false);
    self.setInterval = wrapTimer(self.setInterval.bind(self), null, true);
    self.clearTimeout = wrapClear(self.clearTimeout.bind(self));
    self.clearInterval = wrapClear(self.clearInterval.bind(self));

    self.console = {
      ...self.console,
      log: out('stdout'),
      info: out('stdout'),
      debug: out('stdout'),
      table: out('stdout'),
      dir: out('stdout'),
      error: out('stderr'),
      warn: out('stderr'),
      trace: out('stderr'),
    };

    // stdin: available as the `stdin` string, plus readline()/prompt() line by line.
    const lines = String(stdin).split(/\r?\n/);
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    self.stdin = String(stdin);
    self.readline = () => (lines.length ? lines.shift() : null);
    self.prompt = self.readline;

    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    harden();
    try {
      await import(/* @vite-ignore */ url);
      moduleDone = true;
      maybeFinish();
    } catch (err) {
      fail(err);
    }
  },
  { once: true },
);
