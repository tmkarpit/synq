// The sandbox source is imported as plain text and started from a Blob URL, so no
// bundler or dev-server code (e.g. Vite's HMR client) ever runs inside it.
import runnerSource from './jsRunner.worker.js?raw';

export const RUN_TIMEOUT_MS = 5000;
export const RUN_OUTPUT_CAP = 64 * 1024;

const defaultCreateWorker = () => {
  const url = URL.createObjectURL(new Blob([runnerSource], { type: 'text/javascript' }));
  try {
    return new Worker(url, { type: 'module', name: 'synq-js-runner' });
  } finally {
    // The worker has already been fetched/started from the URL; it is no longer needed.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
};

/**
 * Run JavaScript in a fresh, throwaway Worker.
 * Returns { promise, cancel } where promise resolves to { exitCode, durationMs, timedOut, truncated }.
 * onOutput(stream, chunk) receives stdout/stderr chunks; total output is capped.
 */
export function runJavaScript({
  code,
  stdin = '',
  path,
  onOutput,
  timeoutMs = RUN_TIMEOUT_MS,
  outputCap = RUN_OUTPUT_CAP,
  createWorker = defaultCreateWorker,
}) {
  const startedAt = performance.now();
  let worker = null;
  let timer = null;
  let settle;
  let bytes = 0;
  let done = false;

  const promise = new Promise((resolve) => {
    settle = resolve;
  });

  const finish = (exitCode, extra = {}) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    worker?.terminate();
    worker = null;
    settle({
      exitCode,
      durationMs: Math.round(performance.now() - startedAt),
      timedOut: false,
      truncated: false,
      ...extra,
    });
  };

  try {
    worker = createWorker();
  } catch (err) {
    onOutput('stderr', `Could not start the sandbox: ${err?.message || err}\n`);
    finish(1);
    return { promise, cancel: () => {} };
  }

  worker.onmessage = (e) => {
    const msg = e.data || {};
    if (done) return;
    if (msg.type === 'output') {
      const chunk = String(msg.chunk ?? '');
      const size = new TextEncoder().encode(chunk).length;
      if (bytes + size > outputCap) {
        const room = Math.max(0, outputCap - bytes);
        if (room > 0) onOutput(msg.stream, chunk.slice(0, room));
        onOutput(
          'stderr',
          `\nOutput limit (${Math.round(outputCap / 1024)}KB) exceeded; run stopped.\n`,
        );
        finish(1, { truncated: true });
        return;
      }
      bytes += size;
      onOutput(msg.stream === 'stderr' ? 'stderr' : 'stdout', chunk);
    } else if (msg.type === 'done') {
      finish(Number.isInteger(msg.exitCode) ? msg.exitCode : 0);
    }
  };
  worker.onerror = (e) => {
    e.preventDefault?.();
    onOutput('stderr', `${e.message || 'Worker error'}\n`);
    finish(1);
  };

  timer = setTimeout(() => {
    onOutput('stderr', `\nTimed out after ${timeoutMs / 1000}s; run stopped.\n`);
    finish(124, { timedOut: true });
  }, timeoutMs);

  worker.postMessage({ code, stdin, path });

  return {
    promise,
    cancel: () => finish(130, { cancelled: true }),
  };
}
