import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { judge0Languages } from '../src/judge0.js';
import { runFile } from '../src/runner.js';

// A fake Judge0: records each request and answers with the next prepared reply.
const b64 = (s) => Buffer.from(s).toString('base64');
let server;
let base;
const requests = [];
let reply = () => ({ status: 200, body: {} });

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body: JSON.parse(body || '{}') });
      const { status, body: out, delayMs = 0 } = reply();
      setTimeout(() => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(out));
      }, delayMs);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function run(lang, code, { stdin = '' } = {}) {
  let out = '';
  const languages = judge0Languages({ key: 'test-key', url: base });
  const result = await runFile({ lang: languages[lang], name: { python: 'main.py', c: 'bad.c', cpp: 'a.cpp', java: 'Main.java' }[lang], code, stdin, onOutput: (_s, c) => (out += c) }).promise;
  return { result, out, request: requests.at(-1) };
}

test('no key: no Judge0 languages, nothing is sent', () => {
  assert.deepEqual(judge0Languages({}), {});
  assert.deepEqual(Object.keys(judge0Languages({ key: 'k' })), ['python', 'c', 'cpp', 'java']);
  assert.deepEqual(Object.keys(judge0Languages({ key: 'k', languages: ['python', 'cobol'] })), ['python']);
});

test('a Python run sends only the code and stdin (base64) and shows the output', async () => {
  reply = () => ({ status: 200, body: { status: { id: 3, description: 'Accepted' }, stdout: b64('Hello, Py\n'), time: '0.02' } });
  const { result, out, request } = await run('python', 'print(input())', { stdin: 'Py\n' });
  assert.equal(result.exitCode, 0);
  assert.equal(out, 'Hello, Py\n');
  assert.equal(result.durationMs, 20);
  assert.match(request.url, /^\/submissions\?base64_encoded=true&wait=true/);
  assert.equal(request.body.language_id, 71);
  assert.equal(Buffer.from(request.body.source_code, 'base64').toString(), 'print(input())');
  assert.equal(Buffer.from(request.body.stdin, 'base64').toString(), 'Py\n');
  assert.equal(request.body.cpu_time_limit, 5);
  assert.equal(request.headers['x-auth-token'], 'test-key', 'self-hosted Judge0 gets the key as X-Auth-Token');
  assert.deepEqual(Object.keys(request.body).sort(), ['cpu_time_limit', 'language_id', 'memory_limit', 'source_code', 'stdin', 'wall_time_limit']);
});

test('RapidAPI URLs get the RapidAPI headers', async () => {
  let seen = null;
  const fakeFetch = async (url, init) => {
    seen = { url, headers: init.headers };
    return new Response(JSON.stringify({ status: { id: 3 }, stdout: b64('ok') }), { status: 200 });
  };
  const langs = judge0Languages({ key: 'rk', fetchImpl: fakeFetch });
  await runFile({ lang: langs.c, name: 'a.c', code: 'int main(){}', onOutput: () => {} }).promise;
  assert.match(seen.url, /^https:\/\/judge0-ce\.p\.rapidapi\.com\/submissions/);
  assert.equal(seen.headers['x-rapidapi-key'], 'rk');
  assert.equal(seen.headers['x-rapidapi-host'], 'judge0-ce.p.rapidapi.com');
});

test('compile errors, timeouts and crashes map like local runs', async () => {
  reply = () => ({ status: 200, body: { status: { id: 6 }, compile_output: b64('main.c:2:11: error: expected expression\n') } });
  const compile = await run('c', 'int main() {\n  int x = ;\n}');
  assert.equal(compile.result.phase, 'compile');
  assert.equal(compile.result.exitCode, 1);
  assert.match(compile.out, /bad\.c:2:11: error/, 'shows the user file name');
  assert.equal(compile.request.body.language_id, 50);

  reply = () => ({ status: 200, body: { status: { id: 5, description: 'Time Limit Exceeded' } } });
  const slow = await run('java', 'class Main { public static void main(String[] a) { while (true) {} } }');
  assert.equal(slow.result.timedOut, true);
  assert.equal(slow.result.exitCode, 124);
  assert.equal(slow.request.body.cpu_time_limit, 8, 'Java gets 3 extra seconds for the JVM');
  assert.equal(slow.request.body.memory_limit, 256000);

  reply = () => ({ status: 200, body: { status: { id: 11, description: 'Runtime Error (NZEC)' }, stderr: b64('Traceback...\nZeroDivisionError\n') } });
  const crash = await run('python', '1/0');
  assert.equal(crash.result.exitCode, 1);
  assert.match(crash.out, /ZeroDivisionError/);
});

test('plan limit, bad key and server errors give a clear message', async () => {
  reply = () => ({ status: 429, body: { message: 'Too many requests' } });
  assert.match((await run('python', 'print(1)')).out, /limit for now is reached/);
  reply = () => ({ status: 403, body: {} });
  assert.match((await run('python', 'print(1)')).out, /not set up correctly/);
  reply = () => ({ status: 502, body: {} });
  assert.match((await run('cpp', 'int main(){}')).out, /HTTP 502/);
});

test('output is capped and a run can be cancelled', async () => {
  reply = () => ({ status: 200, body: { status: { id: 3 }, stdout: b64('x'.repeat(200_000)) } });
  const big = await run('python', 'print("x"*200000)');
  assert.equal(big.result.truncated, true);
  assert.ok(big.out.length < 70 * 1024);

  reply = () => ({ status: 200, body: { status: { id: 3 } }, delayMs: 3000 });
  const job = runFile({ lang: judge0Languages({ key: 'k', url: base }).python, name: 'x', code: 'x', onOutput: () => {} });
  setTimeout(() => job.cancel(), 100);
  assert.equal((await job.promise).exitCode, 130);
});
