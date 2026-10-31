import { describe, expect, it, vi } from 'vitest';
import { executeCommand, tokenize } from './commands';
import { truecolor, sanitizeLabel } from './ansi';

// eslint-disable-next-line no-control-regex -- strips ANSI escapes
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

function makeCtx(overrides = {}) {
  const out = [];
  let stdin = '';
  const ctx = {
    print: (t) => out.push(strip(t)),
    clear: vi.fn(),
    run: vi.fn(),
    files: () => [{ path: 'src/index.js' }, { path: 'main.py' }],
    readFile: (p) => (p === 'main.py' ? 'print(1)\n' : null),
    users: () => [{ username: 'ada', color: '#22D3EE', role: 'owner', isSelf: true }],
    whoami: () => ({ username: 'ada', color: '#22D3EE', role: 'owner', roomId: 'synq-abcd-efgh' }),
    setTheme: (n) =>
      n === 'navy'
        ? { ok: true, label: 'Midnight Navy' }
        : { ok: false, options: ['dark', 'navy'] },
    getStdin: () => stdin,
    setStdin: (t) => {
      stdin = t;
    },
    canShell: () => false,
    shell: vi.fn(),
    shellHint: () => 'only the room owner can run commands here.',
    ...overrides,
  };
  return { ctx, out, stdin: () => stdin };
}

describe('tokenize', () => {
  it('handles quotes and escapes', () => {
    expect(tokenize('stdin "a b\\nc"').tokens).toEqual(['stdin', 'a b\nc']);
    expect(tokenize("cat 'my file.js'").tokens).toEqual(['cat', 'my file.js']);
    expect(tokenize('stdin ""').tokens).toEqual(['stdin', '']);
    expect(tokenize('run "oops').error).toMatch(/unterminated/);
  });
});

describe('executeCommand', () => {
  it('without shell access, nothing else is executed and the reason is shown', () => {
    for (const line of ['rm -rf /', 'node -e "1"', 'npm install', '$(whoami)', 'ls; rm x']) {
      const { ctx, out } = makeCtx();
      executeCommand(line, ctx);
      // "ls;" is not "ls": the first token is matched literally.
      expect(out[0]).toMatch(/^.+: only the room owner can run commands here\. Type 'help'/);
      expect(ctx.shell).not.toHaveBeenCalled();
      expect(ctx.run).not.toHaveBeenCalled();
    }
  });

  it('with shell access, anything that is not built in goes to the room shell as typed', () => {
    const { ctx } = makeCtx({ canShell: () => true });
    executeCommand('npm install express', ctx);
    executeCommand('ls -la', ctx);
    executeCommand('help', ctx);
    expect(ctx.shell.mock.calls).toEqual([['npm install express'], ['ls -la']]);
  });

  it('runs the active file or a path', () => {
    const { ctx } = makeCtx();
    executeCommand('run', ctx);
    executeCommand('run src/index.js', ctx);
    expect(ctx.run.mock.calls).toEqual([[null], ['src/index.js']]);
  });

  it('sets and clears stdin', () => {
    const { ctx, stdin } = makeCtx();
    executeCommand('stdin "hello\\nworld"', ctx);
    expect(stdin()).toBe('hello\nworld');
    executeCommand('stdin --clear', ctx);
    expect(stdin()).toBe('');
  });

  it('without shell access, ls and cat read the project (read-only)', () => {
    const { ctx, out } = makeCtx();
    executeCommand('ls', ctx);
    executeCommand('cat main.py', ctx);
    executeCommand('cat nope.js', ctx);
    expect(out).toEqual(['src/index.js', 'main.py', 'print(1)', 'cat: nope.js: no such file']);
  });

  it('switches themes and lists options for unknown names', () => {
    const { ctx, out } = makeCtx();
    executeCommand('theme navy', ctx);
    executeCommand('theme pink', ctx);
    expect(out[0]).toBe('✔ Theme set to Midnight Navy.');
    expect(out[1]).toBe('Unknown theme "pink". Themes: dark, navy');
  });

  it('clear only touches the local terminal', () => {
    const { ctx } = makeCtx();
    executeCommand('clear', ctx);
    expect(ctx.clear).toHaveBeenCalledOnce();
  });
});

describe('ansi', () => {
  it('emits truecolor and strips control characters from labels', () => {
    expect(truecolor('#22D3EE', 'ada')).toBe('\x1b[38;2;34;211;238mada\x1b[0m');
    expect(truecolor('red', 'x')).toBe('x');
    expect(sanitizeLabel('ev\x1b[31mil')).toBe('ev[31mil');
  });
});
