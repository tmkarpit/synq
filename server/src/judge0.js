// Python, C, C++ and Java runs on Judge0 (https://judge0.com), a sandbox built for running
// untrusted code, instead of on this server (where they would have the server's
// permissions: its files, its environment, its network). Turned on by JUDGE0_API_KEY.
//
// The code and its stdin are sent to Judge0; nothing else (no file names, no user data).
// Works with Judge0 CE on RapidAPI (the default URL) and with a self-hosted Judge0
// (JUDGE0_URL=https://your-judge0, key sent as X-Auth-Token).

import { RUN_OUTPUT_CAP, RUN_TIMEOUT_MS, STDIN_CAP } from './runner.js';

export const JUDGE0_DEFAULT_URL = 'https://judge0-ce.p.rapidapi.com';

// Judge0 CE language ids.
const LANGUAGES = {
  python: { label: 'Python', id: 71, tool: 'Python 3.8 (Judge0 sandbox)' },
  c: { label: 'C', id: 50, tool: 'GCC 9.2 (Judge0 sandbox)' },
  cpp: { label: 'C++', id: 54, tool: 'G++ 9.2 (Judge0 sandbox)' },
  java: { label: 'Java', id: 62, tool: 'OpenJDK 13 (Judge0 sandbox)', memoryKb: 256_000, extraSeconds: 3 },
};

const REQUEST_TIMEOUT_MS = 30_000;
const b64 = (text) => Buffer.from(String(text ?? ''), 'utf8').toString('base64');
const unb64 = (text) => (text ? Buffer.from(text, 'base64').toString('utf8') : '');

/** Language entries for languages.js-style maps: { python: { kind: 'remote', ... }, ... }. */
export function judge0Languages({ key, url = JUDGE0_DEFAULT_URL, languages = Object.keys(LANGUAGES), fetchImpl = fetch } = {}) {
  if (!key) return {};
  const base = url.replace(/\/+$/, '');
  const rapid = new URL(base).hostname.endsWith('.rapidapi.com');
  const headers = rapid ? { 'x-rapidapi-key': key, 'x-rapidapi-host': new URL(base).host } : { 'x-auth-token': key };
  return Object.fromEntries(
    languages
      .filter((id) => LANGUAGES[id])
      .map((id) => [id, { ...LANGUAGES[id], kind: 'remote', available: true, run: (opts) => execute({ ...opts, lang: LANGUAGES[id], base, headers, fetchImpl }) }]),
  );
}

/** One run on Judge0. Same shape as runner.runFile: { promise, cancel }. */
function execute({ lang, base, headers, fetchImpl, name = '', code, stdin = '', onOutput, timeoutMs = RUN_TIMEOUT_MS, outputCap = RUN_OUTPUT_CAP }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();
  let cancelled = false;

  const promise = (async () => {
    const result = (exitCode, extra = {}) => ({ exitCode, durationMs: Date.now() - startedAt, timedOut: false, truncated: false, phase: 'run', ...extra });
    let res;
    try {
      res = await fetchImpl(`${base}/submissions?base64_encoded=true&wait=true&fields=stdout,stderr,compile_output,message,status,time`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({
          source_code: b64(code),
          language_id: lang.id,
          stdin: b64(String(stdin).slice(0, STDIN_CAP)),
          cpu_time_limit: timeoutMs / 1000 + (lang.extraSeconds || 0),
          wall_time_limit: timeoutMs / 1000 + (lang.extraSeconds || 0) + 5,
          memory_limit: lang.memoryKb || 128_000,
        }),
        signal: controller.signal,
      });
    } catch {
      if (cancelled) return result(130);
      onOutput('stderr', 'The code runner (Judge0) did not answer. Try again in a moment.\n');
      return result(1);
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 429) {
      onOutput('stderr', "The code runner's limit for now is reached (Judge0 plan). JavaScript and TypeScript still run; try again later.\n");
      return result(1);
    }
    if (res.status === 401 || res.status === 403) {
      console.error(`[synq] Judge0 refused the API key (HTTP ${res.status}); check JUDGE0_API_KEY.`);
      onOutput('stderr', `${lang.label} can't run right now: the code runner is not set up correctly on this server.\n`);
      return result(1);
    }
    if (!res.ok) {
      onOutput('stderr', `The code runner (Judge0) failed (HTTP ${res.status}). Try again in a moment.\n`);
      return result(1);
    }
    const data = await res.json().catch(() => ({}));
    const status = data.status?.id ?? 0;

    // Shown in the order a local run would print them, within the shared output budget.
    let budget = outputCap;
    let truncated = false;
    const emit = (stream, text) => {
      if (!text || truncated) return;
      if (text.length > budget) {
        if (budget > 0) onOutput(stream, text.slice(0, budget));
        onOutput('stderr', `\nOutput limit (${Math.round(outputCap / 1024)}KB) exceeded; run stopped.\n`);
        truncated = true;
        return;
      }
      budget -= text.length;
      onOutput(stream, text);
    };
    // Judge0 compiles C/C++ as main.c / main.cpp: show the user's file name instead.
    const shown = String(name).split(/[\\/]/).pop();
    const compileOutput = unb64(data.compile_output);
    emit('stderr', shown ? compileOutput.replace(/\bmain\.(c|cpp)\b/g, shown) : compileOutput);
    emit('stdout', unb64(data.stdout));
    emit('stderr', unb64(data.stderr));

    const durationMs = Math.round(Number(data.time || 0) * 1000) || Date.now() - startedAt;
    if (status === 3) return { ...result(0, { truncated }), durationMs };
    if (status === 5) {
      onOutput('stderr', `\nTimed out after ${timeoutMs / 1000 + (lang.extraSeconds || 0)}s; run stopped.\n`);
      return { ...result(124, { timedOut: true, truncated }), durationMs };
    }
    if (status === 6) return { ...result(1, { truncated, phase: 'compile' }), durationMs };
    // 7-12: runtime errors (segfault, non-zero exit, ...), 13+: Judge0 internal problems.
    if (status >= 13 || !status) emit('stderr', `\nThe code runner could not run this (${data.status?.description || 'unknown error'}).\n`);
    else if (data.message) emit('stderr', `\n${unb64(data.message)}\n`);
    return { ...result(1, { truncated }), durationMs };
  })();

  return {
    promise,
    cancel: () => {
      cancelled = true;
      controller.abort();
    },
  };
}
