// Python, C, C++ and Java runs on JDoodle (https://www.jdoodle.com/compiler-api), an online
// compiler service with a free plan (no card), instead of on this server (where they
// would have the server's permissions). Turned on by JDOODLE_CLIENT_ID and
// JDOODLE_CLIENT_SECRET. Only the code and its stdin are sent.

import { RUN_OUTPUT_CAP, RUN_TIMEOUT_MS, STDIN_CAP } from './runner.js';

export const JDOODLE_DEFAULT_URL = 'https://api.jdoodle.com/v1/execute';

// JDoodle language codes and version indexes (https://www.jdoodle.com/docs/compiler-apis).
// JDOODLE_VERSIONS=python:4,cpp:1 overrides an index if JDoodle changes them.
const LANGUAGES = {
  python: { label: 'Python', language: 'python3', versionIndex: '4', tool: 'Python 3 (JDoodle sandbox)', file: /jdoodle\.py/g },
  c: { label: 'C', language: 'c', versionIndex: '5', tool: 'GCC (JDoodle sandbox)', file: /jdoodle\.c\b/g },
  cpp: { label: 'C++', language: 'cpp17', versionIndex: '1', tool: 'G++ C++17 (JDoodle sandbox)', file: /jdoodle\.cpp/g },
  java: { label: 'Java', language: 'java', versionIndex: '4', tool: 'JDK (JDoodle sandbox)', file: null },
};

const REQUEST_TIMEOUT_MS = 30_000;

/** Language entries for languages.js-style maps: { python: { kind: 'remote', ... }, ... }. */
export function jdoodleLanguages({ clientId, clientSecret, url = JDOODLE_DEFAULT_URL, languages = Object.keys(LANGUAGES), versions = {}, fetchImpl = fetch } = {}) {
  if (!clientId || !clientSecret) return {};
  return Object.fromEntries(
    languages
      .filter((id) => LANGUAGES[id])
      .map((id) => {
        const lang = { ...LANGUAGES[id], versionIndex: versions[id] ?? LANGUAGES[id].versionIndex };
        return [id, { ...lang, kind: 'remote', available: true, run: (opts) => execute({ ...opts, lang, url, clientId, clientSecret, fetchImpl }) }];
      }),
  );
}

/** One run on JDoodle. Same shape as runner.runFile: { promise, cancel }. */
function execute({ lang, url, clientId, clientSecret, fetchImpl, name = '', code, stdin = '', onOutput, timeoutMs = RUN_TIMEOUT_MS, outputCap = RUN_OUTPUT_CAP }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();
  let cancelled = false;

  const promise = (async () => {
    const result = (exitCode, extra = {}) => ({ exitCode, durationMs: Date.now() - startedAt, timedOut: false, truncated: false, phase: 'run', ...extra });
    let res;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId,
          clientSecret,
          script: String(code ?? ''),
          stdin: String(stdin).slice(0, STDIN_CAP),
          language: lang.language,
          versionIndex: lang.versionIndex,
          compileOnly: false,
        }),
        signal: controller.signal,
      });
    } catch {
      if (cancelled) return result(130);
      onOutput('stderr', 'The code runner (JDoodle) did not answer. Try again in a moment.\n');
      return result(1);
    } finally {
      clearTimeout(timer);
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 429 || /daily limit/i.test(data.error || '')) {
      onOutput('stderr', "Today's runs for Python, C, C++ and Java are used up (free plan). JavaScript and TypeScript still run; try again tomorrow.\n");
      return result(1);
    }
    if (res.status === 401 || res.status === 403) {
      console.error(`[synq] JDoodle refused the credentials (HTTP ${res.status}); check JDOODLE_CLIENT_ID / JDOODLE_CLIENT_SECRET.`);
      onOutput('stderr', `${lang.label} can't run right now: the code runner is not set up correctly on this server.\n`);
      return result(1);
    }
    if (!res.ok) {
      if (data.error) console.error(`[synq] JDoodle error (HTTP ${res.status}): ${data.error}`);
      onOutput('stderr', `The code runner (JDoodle) failed (HTTP ${res.status}). Try again in a moment.\n`);
      return result(1);
    }

    // JDoodle names the file jdoodle.py / jdoodle.c / ...: show the user's file name.
    const shown = String(name).split(/[\\/]/).pop();
    let output = String(data.output ?? '');
    if (shown && lang.file) output = output.replace(lang.file, shown);
    const timedOut = /JDoodle - Timeout|Timeout/i.test(output) && !data.isExecutionSuccess;
    const truncated = output.length > outputCap;
    if (truncated) output = output.slice(0, outputCap);
    const failed = data.isExecutionSuccess === false || data.isCompiled === false;
    if (output) onOutput(failed ? 'stderr' : 'stdout', output);
    if (truncated) onOutput('stderr', `\nOutput limit (${Math.round(outputCap / 1024)}KB) exceeded; run stopped.\n`);
    const durationMs = Math.round(Number(data.cpuTime || 0) * 1000) || Date.now() - startedAt;
    if (timedOut) {
      onOutput('stderr', `\nTimed out; run stopped.\n`);
      return { ...result(124, { timedOut: true, truncated }), durationMs };
    }
    if (data.isCompiled === false) return { ...result(1, { truncated, phase: 'compile' }), durationMs };
    return { ...result(failed ? 1 : 0, { truncated }), durationMs };
  })();

  return {
    promise,
    cancel: () => {
      cancelled = true;
      controller.abort();
    },
  };
}
