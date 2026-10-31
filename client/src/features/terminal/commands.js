import { bold, brightBlack, cyan, green, red, truecolor, yellow, sanitizeLabel } from './ansi';

// The SYNQ terminal: a few built-in commands, and everything else goes to the room's
// real shell on the server (npm install, node app.js, git, ...) when the owner allows
// you to use it. Without shell access, ls and cat fall back to read-only built-ins.

export const COMMANDS = Object.freeze([
  { name: 'help', usage: 'help', about: 'Show this list' },
  { name: 'run', usage: 'run [path]', about: 'Run the active file, or the file at path' },
  {
    name: 'stdin',
    usage: 'stdin "<text>"',
    about: 'Set stdin for the next run (\\n for new lines, --clear to reset)',
  },
  { name: 'users', usage: 'users', about: 'Who is in the room' },
  { name: 'whoami', usage: 'whoami', about: 'Your name, role and room' },
  { name: 'theme', usage: 'theme <name>', about: 'Switch the workspace theme' },
  { name: 'clear', usage: 'clear', about: 'Clear this terminal (only yours)' },
]);

const NAMES = new Set(COMMANDS.map((c) => c.name));
// Read-only stand-ins for people without shell access.
const FALLBACKS = Object.freeze([
  { name: 'ls', usage: 'ls', about: 'List project files' },
  { name: 'cat', usage: 'cat <path>', about: 'Print a file' },
]);
const MAX_LINE = 2000;

/**
 * Split a command line into tokens. Double quotes support \" \\ \n \t escapes,
 * single quotes are literal. Returns { tokens } or { error }.
 */
export function tokenize(line) {
  const tokens = [];
  let current = '';
  let quote = null;
  let hasToken = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      else current += ch;
    } else if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === '\\' && i + 1 < line.length) {
        const next = line[(i += 1)];
        current += next === 'n' ? '\n' : next === 't' ? '\t' : next;
      } else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true;
    } else if (/\s/.test(ch)) {
      if (hasToken || current) tokens.push(current);
      current = '';
      hasToken = false;
    } else {
      current += ch;
      hasToken = true;
    }
  }
  if (quote) return { error: `unterminated ${quote === '"' ? 'double' : 'single'} quote` };
  if (hasToken || current) tokens.push(current);
  return { tokens };
}

/**
 * Execute one line against the whitelist. All effects go through ctx:
 *   print(text)              write lines (ANSI allowed)
 *   clear()                  clear the local terminal
 *   run(path | null)         request a run (null = active file)
 *   files()                  [{ path }]
 *   readFile(path)           string | null
 *   users()                  [{ username, color, role, isSelf, isBot, file }]
 *   whoami()                 { username, color, role, roomId }
 *   setTheme(name)           { ok, label?, options? }
 *   getStdin() / setStdin(text)
 *   canShell()               may this user run real commands here?
 *   shell(line)              run a real command in the room's folder
 *   shellHint()              why not (when canShell() is false)
 */
export function executeCommand(rawLine, ctx) {
  const line = String(rawLine || '')
    .slice(0, MAX_LINE)
    .trim();
  if (!line) return;

  const { tokens, error } = tokenize(line);
  if (error) {
    ctx.print(red(`parse error: ${error}`));
    return;
  }
  const [name, ...args] = tokens;
  if (!NAMES.has(name)) {
    if (ctx.canShell()) ctx.shell(line);
    else if (!FALLBACKS.some((c) => c.name === name)) {
      ctx.print(
        `${sanitizeLabel(name)}: ${ctx.shellHint()} Type 'help' for the built-in commands.`,
      );
    } else runFallback(name, args, ctx);
    return;
  }

  switch (name) {
    case 'help': {
      const shell = ctx.canShell();
      const list = shell ? COMMANDS : [...COMMANDS, ...FALLBACKS];
      const width = Math.max(...list.map((c) => c.usage.length));
      ctx.print(bold('SYNQ terminal'));
      list.forEach((c) => ctx.print(`  ${cyan(c.usage.padEnd(width))}  ${c.about}`));
      ctx.print(
        shell
          ? `  ${green('Anything else runs in the room shell')}, e.g. ${cyan('npm install')}, ${cyan('node app.js')}, ${cyan('cd src')}.\n` +
              brightBlack(
                '  Files it creates or changes appear for everyone. node_modules stays on the server. Ctrl+C stops a command.',
              )
          : brightBlack(`  Real commands (npm, node, ...): ${ctx.shellHint()}`),
      );
      ctx.print(
        brightBlack(
          '  Shortcuts: Ctrl+Enter runs the active file, Ctrl+S saves the room now. Up/Down browse history.',
        ),
      );
      break;
    }
    case 'run':
      if (args.length > 1) ctx.print(red('usage: run [path]'));
      else ctx.run(args[0] ?? null);
      break;
    case 'stdin': {
      if (args.length === 0) {
        const current = ctx.getStdin();
        ctx.print(
          current
            ? `stdin for the next run: ${JSON.stringify(current)}`
            : brightBlack('stdin is empty.'),
        );
      } else if (args[0] === '--clear') {
        ctx.setStdin('');
        ctx.print(brightBlack('stdin cleared.'));
      } else {
        const text = args.join(' ').slice(0, 64 * 1024);
        ctx.setStdin(text);
        ctx.print(green('✔ ') + `stdin set for the next run (${text.length} chars).`);
      }
      break;
    }
    case 'users':
      ctx.users().forEach((u) => {
        const tags = [u.role, u.isBot && 'bot', u.isSelf && 'you'].filter(Boolean).join(', ');
        const where = u.file ? brightBlack(` in ${u.file}`) : '';
        ctx.print(
          `${truecolor(u.color, '●')} ${sanitizeLabel(u.username)} ${brightBlack(`(${tags})`)}${where}`,
        );
      });
      break;
    case 'whoami': {
      const me = ctx.whoami();
      ctx.print(`${truecolor(me.color, sanitizeLabel(me.username))} · ${me.role} · ${me.roomId}`);
      break;
    }
    case 'theme': {
      const res = ctx.setTheme(args[0] || '');
      if (res.ok) ctx.print(green('✔ ') + `Theme set to ${res.label}.`);
      else
        ctx.print(
          `${args[0] ? yellow(`Unknown theme "${sanitizeLabel(args[0])}". `) : ''}Themes: ${res.options.join(', ')}`,
        );
      break;
    }
    case 'clear':
      ctx.clear();
      break;
    default:
      break;
  }
}

function runFallback(name, args, ctx) {
  switch (name) {
    case 'ls': {
      const files = ctx.files();
      if (!files.length) ctx.print(brightBlack('(no files)'));
      files.forEach((f) => ctx.print(f.path));
      break;
    }
    case 'cat': {
      if (args.length !== 1) {
        ctx.print(red('usage: cat <path>'));
        break;
      }
      const content = ctx.readFile(args[0]);
      if (content == null) ctx.print(red(`cat: ${sanitizeLabel(args[0])}: no such file`));
      else ctx.print(content.replace(/\n$/, ''));
      break;
    }
    default:
      break;
  }
}
