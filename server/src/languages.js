import { spawnSync } from 'node:child_process';

// Toolchains for every runnable language. Each is detected once at startup; a language
// whose tools are missing prints a clear notice instead of failing mysteriously.
//
// kind 'node'   -> sandboxed Node process (permission model), program fed via stdin
// kind 'native' -> optional compile step, then run the program in a temp folder.
//                  NOT sandboxed: it runs with the server user's permissions.

const IS_WIN = process.platform === 'win32';

/** First command that answers `<cmd> <...probe>` successfully. */
function findCommand(candidates, probe = ['--version']) {
  for (const cmd of candidates) {
    const [bin, ...pre] = cmd;
    const res = spawnSync(bin, [...pre, ...probe], { encoding: 'utf8', timeout: 8000, windowsHide: true });
    if (res.status === 0) return { bin, pre, version: `${res.stdout || res.stderr}`.trim().split(/\r?\n/)[0] };
  }
  return null;
}

/** File name a program is written to (keeps Java's class/file name rule, strips odd chars). */
export const safeFileName = (name, fallback) => {
  const clean = String(name || '').replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^\.+/, '');
  return clean || fallback;
};

export function detectLanguages() {
  const exe = IS_WIN ? 'main.exe' : './main';
  const python = findCommand(IS_WIN ? [['py', '-3'], ['python'], ['python3']] : [['python3'], ['python']]);
  const gcc = findCommand([['gcc'], ['clang']]);
  const gpp = findCommand([['g++'], ['clang++']]);
  const java = findCommand([['java']], ['-version']);
  const cppStd = gpp ? (supportsStd(gpp.bin, 'c++17') ? 'c++17' : 'c++14') : null;

  const langs = {
    javascript: { label: 'JavaScript', kind: 'node', inputType: 'module', available: true, tool: `node ${process.version}` },
    typescript: { label: 'TypeScript', kind: 'node', inputType: 'module-typescript', available: true, tool: `node ${process.version} (type stripping)` },
    python: python && {
      label: 'Python',
      kind: 'native',
      file: (name) => safeFileName(name, 'main.py'),
      run: (file) => [python.bin, [...python.pre, '-I', '-u', file]],
      available: true,
      tool: python.version,
    },
    c: gcc && {
      label: 'C',
      kind: 'native',
      file: () => 'main.c',
      compile: (file) => [gcc.bin, ['-std=c11', '-O2', '-Wall', file, '-o', 'main', '-lm']],
      run: () => [exe, []],
      available: true,
      tool: gcc.version,
    },
    cpp: gpp && {
      label: 'C++',
      kind: 'native',
      file: () => 'main.cpp',
      compile: (file) => [gpp.bin, [`-std=${cppStd}`, '-O2', '-Wall', file, '-o', 'main']],
      run: () => [exe, []],
      available: true,
      tool: `${gpp.version} (-std=${cppStd})`,
    },
    // Single-file source launcher (JDK 11+): compiles in memory and runs the first class.
    java: java && {
      label: 'Java',
      kind: 'native',
      file: (name) => safeFileName(name, 'Main.java'),
      run: (file) => [java.bin, ['-Xmx256m', '-XX:+UseSerialGC', file]],
      available: true,
      tool: java.version,
    },
  };
  return Object.fromEntries(Object.entries(langs).filter(([, v]) => v));
}

function supportsStd(bin, std) {
  const res = spawnSync(bin, [`-std=${std}`, '-x', 'c++', '-E', '-'], { input: '', timeout: 8000, windowsHide: true });
  return res.status === 0;
}

const EXTENSIONS = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  py: 'python',
  c: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  java: 'java',
};

export const languageOfFile = (name = '') => EXTENSIONS[name.split('.').pop().toLowerCase()] || null;

const LABELS = { javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python', c: 'C', cpp: 'C++', java: 'Java' };
export const languageLabel = (id) => LABELS[id] || id;
