import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { jdoodleLanguages } from '../src/jdoodle.js';
import { runFile } from '../src/runner.js';
import { loadConfig } from '../src/config.js';

// A fake JDoodle: records each request and answers with the next prepared reply.
let server;
let url;
const requests = [];
let reply = () => ({ status: 200, body: {} });

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      requests.push({ headers: req.headers, body: JSON.parse(body || '{}') });
      const { status, body: out, delayMs = 0 } = reply();
      setTimeout(() => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(out));
      }, delayMs);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}/v1/execute`;
});
after(() => server.close());

const NAMES = { python: 'main.py', c: 'bad.c', cpp: 'a.cpp', java: 'Main.java' };
async function run(lang, code, { stdin = '' } = {}) {
  let out = '';
  const languages = jdoodleLanguages({ clientId: 'id-1', clientSecret: 'secret-1', url });
  const result = await runFile({ lang: languages[lang], name: NAMES[lang], code, stdin, onOutput: (_s, c) => (out += c) }).promise;
  return { result, out, request: requests.at(-1) };
}

test('no credentials: no JDoodle languages, nothing is sent', () => {
  assert.deepEqual(jdoodleLanguages({}), {});
  assert.deepEqual(jdoodleLanguages({ clientId: 'only-id' }), {});
  assert.deepEqual(Object.keys(jdoodleLanguages({ clientId: 'a', clientSecret: 'b' })), ['python', 'c', 'cpp', 'java']);
});

test('a Python run sends the code, stdin and language, and shows the output', async () => {
  reply = () => ({ status: 200, body: { output: 'Hello, Py\n', statusCode: 200, cpuTime: '0.03', isExecutionSuccess: true, isCompiled: true } });
  const { result, out, request } = await run('python', 'print("Hello, " + input())', { stdin: 'Py\n' });
  assert.equal(result.exitCode, 0);
  assert.equal(out, 'Hello, Py\n');
  assert.equal(result.durationMs, 30);
  assert.equal(request.body.script, 'print("Hello, " + input())');
  assert.equal(request.body.stdin, 'Py\n');
  assert.equal(request.body.language, 'python3');
  assert.equal(request.body.clientId, 'id-1');
  assert.deepEqual(Object.keys(request.body).sort(), ['clientId', 'clientSecret', 'compileOnly', 'language', 'script', 'stdin', 'versionIndex']);
});

test('compile errors show the user file name; runtime errors and timeouts map like local runs', async () => {
  reply = () => ({ status: 200, body: { output: "jdoodle.c: In function 'main':\njdoodle.c:2:11: error: expected expression\n", isCompiled: false, isExecutionSuccess: false } });
  const compile = await run('c', 'int main() {\n  int x = ;\n}');
  assert.equal(compile.result.phase, 'compile');
  assert.equal(compile.result.exitCode, 1);
  assert.match(compile.out, /bad\.c:2:11: error/);
  assert.doesNotMatch(compile.out, /jdoodle\.c/);
  assert.equal(compile.request.body.language, 'c');

  reply = () => ({ status: 200, body: { output: 'Traceback (most recent call last):\nZeroDivisionError\n', isCompiled: true, isExecutionSuccess: false } });
  const crash = await run('python', '1/0');
  assert.equal(crash.result.exitCode, 1);
  assert.match(crash.out, /ZeroDivisionError/);

  reply = () => ({ status: 200, body: { output: '\n\n\n JDoodle - Timeout \n', isCompiled: true, isExecutionSuccess: false } });
  const slow = await run('java', 'class Main { public static void main(String[] a) { while (true) {} } }');
  assert.equal(slow.result.timedOut, true);
  assert.equal(slow.result.exitCode, 124);
  assert.equal(slow.request.body.language, 'java');
});

test('the daily limit, bad credentials and server errors give a clear message', async () => {
  reply = () => ({ status: 429, body: { error: 'Daily limit reached' } });
  assert.match((await run('python', 'print(1)')).out, /used up/);
  reply = () => ({ status: 401, body: { error: 'Unauthorized Request' } });
  assert.match((await run('python', 'print(1)')).out, /not set up correctly/);
  reply = () => ({ status: 500, body: {} });
  assert.match((await run('cpp', 'int main(){}')).out, /HTTP 500/);
});

test('output is capped and a run can be cancelled', async () => {
  reply = () => ({ status: 200, body: { output: 'x'.repeat(200_000), isCompiled: true, isExecutionSuccess: true } });
  const big = await run('python', 'print("x"*200000)');
  assert.equal(big.result.truncated, true);
  assert.ok(big.out.length < 70 * 1024);

  reply = () => ({ status: 200, body: { output: 'late', isExecutionSuccess: true }, delayMs: 3000 });
  const job = runFile({ lang: jdoodleLanguages({ clientId: 'a', clientSecret: 'b', url }).python, name: 'x.py', code: 'x', onOutput: () => {} });
  setTimeout(() => job.cancel(), 100);
  assert.equal((await job.promise).exitCode, 130);
});

test('JDOODLE_* settings are read from the environment', () => {
  const c = loadConfig({ JDOODLE_CLIENT_ID: ' id ', JDOODLE_CLIENT_SECRET: 's', JDOODLE_LANGUAGES: 'Python,cpp', JDOODLE_VERSIONS: 'python:5, cpp:0' }).jdoodle;
  assert.equal(c.clientId, 'id');
  assert.deepEqual(c.languages, ['python', 'cpp']);
  assert.deepEqual(c.versions, { python: '5', cpp: '0' });
  const langs = jdoodleLanguages({ clientId: 'a', clientSecret: 'b', versions: { python: '5' } });
  assert.equal(langs.python.versionIndex, '5');
});
