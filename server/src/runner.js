import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Code execution for shared runs.
//
// JavaScript / TypeScript: a separate Node process with the permission model on (no file
// system, no child processes, no workers, no addons). The program is fed through stdin,
// user stdin through an env variable. Network access is NOT blocked by Node.
//
// Python / C / C++ / Java: compiled and run in a throwaway temp folder with a minimal
// environment, a time limit and an output cap. These are NOT sandboxed: they run with
// the server user's permissions. Only share rooms with people you trust, restrict
// languages with RUN_LANGUAGES, or run the server inside a container/VM.

export const RUN_TIMEOUT_MS = 5000;
export const COMPILE_TIMEOUT_MS = 20000;
export const RUN_OUTPUT_CAP = 64 * 1024;
export const STDIN_CAP = 16 * 1024;

const IS_WIN = process.platform === 'win32';
const PERMISSION_FLAG = process.allowedNodeEnvironmentFlags.has('--permission') ? '--permission' : '--experimental-permission';

// Kept on the first line (no trailing newline) so user line numbers stay correct.
const JS_PRELUDE =
  "const __synqLines = (process.env.SYNQ_STDIN ?? '').split(/\\r?\\n/); if (__synqLines.at(-1) === '') __synqLines.pop();" +
  "globalThis.stdin = process.env.SYNQ_STDIN ?? ''; globalThis.readline = () => (__synqLines.length ? __synqLines.shift() : null);" +
  'globalThis.prompt = globalThis.readline; delete process.env.SYNQ_STDIN;';

/** Kill a process and everything it started (compilers spawn helpers; Java forks threads). */
function killTree(child) {
  if (child.exitCode !== null || child.killed) return;
  if (IS_WIN) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

/** Minimal environment: enough for compilers/runtimes to start, nothing else from the server. */
function sandboxEnv(dir, extra = {}) {
  const keep = IS_WIN ? ['PATH', 'Path', 'SystemRoot', 'SystemDrive', 'COMSPEC', 'PATHEXT', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE'] : ['PATH', 'LANG'];
  const env = Object.fromEntries(keep.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]));
  return { ...env, TEMP: dir, TMP: dir, TMPDIR: dir, HOME: dir, USERPROFILE: dir, PYTHONIOENCODING: 'utf-8', ...extra };
}

/**
 * Run one process with a timeout and a shared output budget.
 * budget: { bytes, cap, truncated } shared across the compile and run steps.
 */
function runProcess({ cmd, args, cwd, env, input = '', timeoutMs, onOutput, budget }) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let timedOut = false;
    let settled = false;
    const child = spawn(cmd, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: !IS_WIN });

    const onData = (stream) => (buf) => {
      if (budget.truncated) return;
      const room = budget.cap - budget.bytes;
      if (buf.length > room) {
        if (room > 0) onOutput(stream, buf.subarray(0, room).toString('utf8'));
        onOutput('stderr', `\nOutput limit (${Math.round(budget.cap / 1024)}KB) exceeded; run stopped.\n`);
        budget.truncated = true;
        killTree(child);
        return;
      }
      budget.bytes += buf.length;
      onOutput(stream, buf.toString('utf8'));
    };
    child.stdout.on('data', onData('stdout'));
    child.stderr.on('data', onData('stderr'));

    const timer = setTimeout(() => {
      timedOut = true;
      onOutput('stderr', `\nTimed out after ${timeoutMs / 1000}s; run stopped.\n`);
      killTree(child);
    }, timeoutMs);

    const done = (code, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, timedOut, error, durationMs: Date.now() - startedAt });
    };
    child.on('close', (code) => done(code));
    child.on('error', (err) => {
      onOutput('stderr', `Could not start ${path.basename(cmd)}: ${err.message}\n`);
      done(127, err);
    });
    child.stdin.on('error', () => {}); // the program may exit without reading stdin
    child.stdin.end(input);
    budget.kill = () => killTree(child);
  });
}

async function removeDir(dir) {
  // Windows may hold the .exe for a moment after the process exits.
  for (let i = 0; i < 5; i += 1) {
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

/**
 * Run a file of a detected language (see languages.js).
 * @returns {{ promise: Promise<{exitCode, durationMs, timedOut, truncated, phase}>, cancel(): void }}
 */
export function runFile({ lang, name, code, stdin = '', onOutput, timeoutMs = RUN_TIMEOUT_MS, outputCap = RUN_OUTPUT_CAP }) {
  const budget = { bytes: 0, cap: outputCap, truncated: false, kill: null, cancelled: false };
  const input = String(stdin).slice(0, STDIN_CAP);
  const startedAt = Date.now();

  const promise = (async () => {
    const finish = (res, phase = 'run') => ({
      exitCode: res.timedOut ? 124 : budget.truncated ? 1 : budget.cancelled ? 130 : res.code ?? 1,
      durationMs: Date.now() - startedAt,
      timedOut: res.timedOut,
      truncated: budget.truncated,
      phase,
    });

    if (lang.kind === 'node') {
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'synq-run-'));
      try {
        const res = await runProcess({
          cmd: process.execPath,
          args: [PERMISSION_FLAG, '--max-old-space-size=96', `--input-type=${lang.inputType}`, '-'],
          cwd: dir,
          env: { SYNQ_STDIN: input },
          input: JS_PRELUDE + code,
          timeoutMs,
          onOutput,
          budget,
        });
        return finish(res);
      } finally {
        await removeDir(dir);
      }
    }

    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'synq-run-'));
    try {
      const file = lang.file(name);
      await fs.promises.writeFile(path.join(dir, file), code);
      const env = sandboxEnv(dir);

      if (lang.compile) {
        const [cmd, args] = lang.compile(file);
        onOutput('stdout', `$ ${path.basename(cmd)} ${args.join(' ')}\n`);
        const res = await runProcess({ cmd, args, cwd: dir, env, timeoutMs: COMPILE_TIMEOUT_MS, onOutput, budget });
        if (res.code !== 0 || res.timedOut || budget.truncated || budget.cancelled) return finish(res, 'compile');
      }

      const [cmd, args] = lang.run(file);
      const res = await runProcess({
        cmd: cmd.startsWith('./') || cmd.endsWith('.exe') ? path.join(dir, cmd) : cmd,
        args,
        cwd: dir,
        env,
        input,
        // The JVM needs a moment to start: give Java a little extra time.
        timeoutMs: lang.label === 'Java' ? timeoutMs + 3000 : timeoutMs,
        onOutput,
        budget,
      });
      return finish(res);
    } finally {
      await removeDir(dir);
    }
  })();

  return {
    promise,
    cancel: () => {
      budget.cancelled = true;
      budget.kill?.();
    },
  };
}

/** Backwards-compatible helper used by tests: run a JavaScript program. */
export function runJavaScript(opts) {
  return runFile({ ...opts, lang: { kind: 'node', inputType: 'module', label: 'JavaScript' }, name: 'main.js' });
}
