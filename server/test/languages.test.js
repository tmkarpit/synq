import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguages, languageOfFile } from '../src/languages.js';
import { runFile } from '../src/runner.js';

const langs = detectLanguages();

async function run(langId, name, code, opts = {}) {
  const out = { stdout: '', stderr: '' };
  const res = await runFile({
    lang: langs[langId],
    name,
    code,
    onOutput: (stream, chunk) => {
      out[stream] += chunk;
    },
    ...opts,
  }).promise;
  return { ...res, ...out };
}

const skip = (id) => (langs[id] ? false : `${id} toolchain not installed`);

test('maps file names to languages', () => {
  assert.equal(languageOfFile('main.py'), 'python');
  assert.equal(languageOfFile('a.cpp'), 'cpp');
  assert.equal(languageOfFile('x.c'), 'c');
  assert.equal(languageOfFile('Main.java'), 'java');
  assert.equal(languageOfFile('app.ts'), 'typescript');
  assert.equal(languageOfFile('README.md'), null);
});

test('TypeScript runs with type stripping in the Node sandbox', async () => {
  const r = await run('typescript', 'main.ts', 'const n: number = 21;\nconsole.log("ts", n * 2);\n');
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(r.stdout, 'ts 42\n');
});

test('Python runs and reads stdin', { skip: skip('python') }, async () => {
  const r = await run('python', 'main.py', 'name = input()\nprint(f"hello {name}")\n', { stdin: 'ada\n' });
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'hello ada');
});

test('Python errors keep a non-zero exit code', { skip: skip('python') }, async () => {
  const r = await run('python', 'main.py', 'raise ValueError("boom")\n');
  assert.notEqual(r.exitCode, 0);
  assert.match(r.stderr, /ValueError: boom/);
});

test('C compiles and runs', { skip: skip('c') }, async () => {
  const r = await run('c', 'hello.c', '#include <stdio.h>\nint main(void){int x; scanf("%d",&x); printf("%d\\n", x*2); return 0;}\n', { stdin: '21' });
  assert.equal(r.exitCode, 0, r.stderr);
  assert.match(r.stdout, /42\r?\n$/); // Windows C runtimes write CRLF
});

test('C++ compiles and runs', { skip: skip('cpp') }, async () => {
  const code = '#include <iostream>\n#include <vector>\nint main(){ std::vector<int> v{1,2,3}; int s=0; for(int x: v) s+=x; std::string n; std::cin >> n; std::cout << n << " " << s << std::endl; }\n';
  const r = await run('cpp', 'main.cpp', code, { stdin: 'sum' });
  assert.equal(r.exitCode, 0, r.stderr);
  assert.match(r.stdout, /sum 6\r?\n$/);
});

test('C++ compile errors are reported as a compile failure', { skip: skip('cpp') }, async () => {
  const r = await run('cpp', 'main.cpp', 'int main(){ return nope; }\n');
  assert.equal(r.phase, 'compile');
  assert.notEqual(r.exitCode, 0);
  assert.match(r.stderr, /nope/);
});

test('C++ endless loops are killed', { skip: skip('cpp') }, async () => {
  const r = await run('cpp', 'main.cpp', 'int main(){ volatile int x=0; for(;;) x++; }\n', { timeoutMs: 1500 });
  assert.equal(r.exitCode, 124);
  assert.equal(r.timedOut, true);
});

test('Java runs from a single source file', { skip: skip('java') }, async () => {
  const code = 'public class Main { public static void main(String[] a) { System.out.println("java " + (6 * 7)); } }\n';
  const r = await run('java', 'Main.java', code);
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'java 42');
});
