// Phase 5: code execution through the real socket API (QA server, synq_test).
// Python / C / C++ / Java run directly on the host (no container), so per the QA safety
// rule only harmless programs are run for them. Escape attempts run only against the
// sandboxed JavaScript runner, and only at harmless targets inside qa/.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { addFile, closeDb, collect, next, ownerRoom, sleep } from './lib.mjs';

after(() => closeDb());
const QA_PKG = fileURLToPath(new URL('../package.json', import.meta.url)).replace(/\\/g, '/');

let room;
const ready = (async () => (room = await ownerRoom('Runner')))();

/** Runs a program; resolves { result, out } (out = stdout+stderr text). */
async function run(name, code, stdin = '', ms = 40000) {
  await ready;
  const fileId = addFile(room.doc, { name, content: code });
  await sleep(300);
  const out = collect(room.socket, 'run:output');
  const rejected = collect(room.socket, 'run:rejected');
  const started = next(room.socket, 'run:started', (r) => r.fileId === fileId, 5000).catch(() => null);
  room.socket.emit('run:request', { fileId, stdin });
  const run = await started;
  if (!run) {
    out.stop();
    rejected.stop();
    return { rejected: rejected.items[0] };
  }
  const result = await next(room.socket, 'run:result', (r) => r.runId === run.runId, ms);
  out.stop();
  rejected.stop();
  return { result, out: out.items.filter((o) => o.runId === run.runId).map((o) => o.chunk).join('') };
}

test('R1 JavaScript: hello world and input', async () => {
  const { result, out } = await run('hello.js', 'console.log("Hello, " + readline());', 'SYNQ\n');
  assert.equal(result.exitCode, 0);
  assert.match(out, /Hello, SYNQ/);
});

test('R2 TypeScript: hello world', async () => {
  const { result, out } = await run('hello.ts', 'const n: number = 6 * 7;\nconsole.log(`answer ${n}`);');
  assert.equal(result.exitCode, 0, out);
  assert.match(out, /answer 42/);
});

test('R3 Python: hello world and input', async () => {
  const { result, out } = await run('hello.py', 'name = input()\nprint(f"Hello, {name}")', 'Py\n');
  assert.equal(result.exitCode, 0, out);
  assert.match(out, /Hello, Py/);
});

test('R4 C: hello world and input', async () => {
  const { result, out } = await run('hello.c', '#include <stdio.h>\nint main(){char s[32];scanf("%31s",s);printf("Hello, %s\\n",s);return 0;}', 'C\n');
  assert.equal(result.exitCode, 0, out);
  assert.match(out, /Hello, C/);
});

test('R5 C++: hello world and input', async () => {
  const { result, out } = await run('hello.cpp', '#include <iostream>\n#include <string>\nint main(){std::string s;std::cin>>s;std::cout<<"Hello, "<<s<<std::endl;}', 'Cpp\n');
  assert.equal(result.exitCode, 0, out);
  assert.match(out, /Hello, Cpp/);
});

test('R6 Java: hello world and input', async () => {
  const { result, out } = await run('Main.java', 'import java.util.Scanner;\npublic class Main { public static void main(String[] a){ Scanner s=new Scanner(System.in); System.out.println("Hello, "+s.next()); } }', 'Java\n');
  assert.equal(result.exitCode, 0, out);
  assert.match(out, /Hello, Java/);
});

test('R7 compile errors are reported with a line number (C, Java, JS syntax)', async () => {
  const c = await run('bad.c', 'int main() {\n  int x = ;\n  return 0;\n}');
  assert.notEqual(c.result.exitCode, 0);
  assert.equal(c.result.phase, 'compile');
  assert.match(c.out, /bad\.c:2/);
  const j = await run('Main.java', 'public class Main {\n  public static void main(String[] a) {\n    int x = \n  }\n}');
  assert.notEqual(j.result.exitCode, 0);
  assert.match(j.out, /Main\.java:\d+/);
  const js = await run('broken.js', 'const a = 1;\nconst = 2;\n');
  assert.notEqual(js.result.exitCode, 0);
  assert.match(js.out, /SyntaxError/);
});

test('R8 an infinite loop is stopped at the time limit and the next run works (JS + Python)', async () => {
  const t0 = Date.now();
  const js = await run('loop.js', 'while (true) {}');
  assert.equal(js.result.timedOut, true);
  assert.ok(Date.now() - t0 < 12000, 'took too long to stop');
  assert.equal((await run('after.js', 'console.log("ok")')).result.exitCode, 0);
  const py = await run('loop.py', 'while True:\n    pass');
  assert.equal(py.result.timedOut, true);
});

test('R9 an output flood (1,000,000 lines) is capped', async () => {
  const { result, out } = await run('flood.js', 'for (let i = 0; i < 1e6; i++) console.log("line " + i);');
  assert.equal(result.truncated, true);
  assert.ok(out.length < 80 * 1024, `${out.length} chars reached the room`);
});

test('R10 memory-hungry JavaScript is stopped by the heap limit', async () => {
  const { result } = await run('mem.js', 'const a = []; while (true) a.push(new Array(1e6).fill(1));', '', 40000);
  assert.notEqual(result.exitCode, 0);
});

test('R11 JavaScript sandbox: no file system, no child processes, no server environment', async () => {
  const fsRun = await run('fs.js', `import fs from 'node:fs'; try { fs.readFileSync(${JSON.stringify(QA_PKG)}); console.log('READ-OK'); } catch (e) { console.log('DENIED', e.code); }`);
  assert.match(fsRun.out, /DENIED ERR_ACCESS_DENIED/);
  const cp = await run('cp.js', `import { execSync } from 'node:child_process'; try { execSync('echo x'); console.log('SPAWN-OK'); } catch (e) { console.log('DENIED', e.code); }`);
  assert.match(cp.out, /DENIED ERR_ACCESS_DENIED/);
  const env = await run('env.js', 'console.log("KEYS", JSON.stringify(Object.keys(process.env)));');
  assert.match(env.out, /KEYS \[\]/);
});

test('R12 JavaScript sandbox: no network access to the server or other machines', async () => {
  const { out } = await run('net.js', `try { const r = await fetch('http://127.0.0.1:4100/api/health'); console.log('NET-OK', r.status, await r.text()); } catch (e) { console.log('NET-BLOCKED', e.message); }`);
  assert.doesNotMatch(out, /NET-OK/, `user code reached the SYNQ server over the network: ${out.trim()}`);
});

test('R13 two runs at once: the second gets a clear "busy" message', async () => {
  await ready;
  const a = addFile(room.doc, { name: 'slow.js', content: 'const t = Date.now(); while (Date.now() - t < 2000) {}' });
  const b = addFile(room.doc, { name: 'other.js', content: 'console.log(1)' });
  await sleep(300);
  const rej = next(room.socket, 'run:rejected');
  const res = next(room.socket, 'run:result', () => true, 20000);
  room.socket.emit('run:request', { fileId: a });
  room.socket.emit('run:request', { fileId: b });
  const r = await rej;
  assert.equal(r.reason, 'busy');
  assert.match(r.message, /already running/);
  await res;
});

test('R14 stdin is capped and huge programs do not crash the server', async () => {
  const { result } = await run('big.js', `console.log(${JSON.stringify('x'.repeat(500000))}.length)`, 'y'.repeat(100000));
  assert.equal(result.exitCode, 0);
});
