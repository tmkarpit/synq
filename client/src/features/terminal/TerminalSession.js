import { brightBlack, green, red, toCrlf, truecolor, yellow, sanitizeLabel } from './ansi';

// Imperative wrapper around one xterm.js instance: a line editor with history, plus
// printers for shared run output that never mangle the prompt you are typing in.

const HISTORY_LIMIT = 100;
const TONES = { warn: yellow, error: red, muted: brightBlack, success: green, info: (t) => t };

export class TerminalSession {
  constructor({
    Terminal,
    FitAddon,
    container,
    theme,
    fontFamily,
    fontSize,
    getPrompt,
    onCommand,
    onInterrupt = () => {},
    isSelf = () => false,
  }) {
    this.getPrompt = getPrompt;
    this.onCommand = onCommand;
    this.onInterrupt = onInterrupt; // Ctrl+C while a shell command runs
    this.shellRunning = null; // id of the room's running shell command
    this.isSelf = isSelf; // your own commands are already on screen as you typed them
    this.hiddenNoted = false; // the "node_modules stays on the server" note, once
    this.buffer = '';
    this.history = [];
    this.historyIndex = -1;
    this.promptShown = false;
    this.streaming = false;
    this.atLineStart = true;
    this.seenRuns = new Set();

    this.term = new Terminal({
      theme,
      fontFamily,
      fontSize,
      lineHeight: 1.25,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 5000,
      allowTransparency: false,
      macOptionIsMeta: true,
      screenReaderMode: false,
    });
    this.fitAddon = new FitAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.open(container);
    this.container = container;
    this.fit();
    this.dataSub = this.term.onData((data) => this.handleInput(data));
  }

  fit() {
    if (this.container.offsetWidth > 0 && this.container.offsetHeight > 0) {
      try {
        this.fitAddon.fit();
      } catch {
        // container mid-layout; the next resize retries
      }
    }
  }

  setAppearance({ theme, fontFamily, fontSize }) {
    this.term.options.theme = theme;
    this.term.options.fontFamily = fontFamily;
    this.term.options.fontSize = fontSize;
    this.fit();
  }

  focus() {
    this.term.focus();
  }

  /* ------------------------------------------------------------- prompt */

  // The prompt (plus whatever you are typing) is always the last line. Output is
  // written above it: hide prompt, write, show prompt again. While a run's output is
  // mid-line the prompt stays hidden and keystrokes are buffered without echo.

  showPrompt() {
    if (this.promptShown || !this.atLineStart) return;
    this.term.write(this.getPrompt() + this.buffer);
    this.promptShown = true;
  }

  hidePrompt() {
    if (!this.promptShown) return;
    this.term.write('\r\x1b[2K');
    this.promptShown = false;
  }

  refreshPrompt() {
    this.hidePrompt();
    this.showPrompt();
  }

  ensureLineStart() {
    if (!this.atLineStart) {
      this.term.write('\r\n');
      this.atLineStart = true;
    }
  }

  /** Print whole lines above the prompt. */
  print(text, tone = 'info') {
    this.hidePrompt();
    this.ensureLineStart();
    const paint = TONES[tone] || TONES.info;
    this.term.write(`${toCrlf(String(text).split('\n').map(paint).join('\n'))}\r\n`);
    this.showPrompt();
  }

  clear() {
    this.hidePrompt();
    this.term.clear();
    this.showPrompt();
  }

  /* ---------------------------------------------------------- run feed */

  handleFeed({ kind, data }, colorOf) {
    switch (kind) {
      case 'notice':
        this.print(data.text, data.tone);
        break;
      case 'run:started':
        this.runStart(data, colorOf);
        break;
      case 'run:output':
        if (!this.seenRuns.has(data.runId)) return;
        this.runChunk(data.stream, data.chunk);
        break;
      case 'shell:started':
        this.shellStart(data, colorOf);
        break;
      case 'shell:output':
        if (!this.seenRuns.has(data.id)) return;
        this.runChunk(data.stream, data.chunk);
        break;
      case 'shell:exit':
        if (this.seenRuns.has(data.id)) this.shellEnd(data);
        break;
      case 'run:result':
        if (!this.seenRuns.has(data.runId)) {
          // Backend that does not stream: everything arrives in run:result.
          this.runStart(data, colorOf);
          if (data.stdout) this.runChunk('stdout', data.stdout);
          if (data.stderr) this.runChunk('stderr', data.stderr);
        }
        this.runEnd(data);
        break;
      default:
        break;
    }
  }

  runStart(info, colorOf) {
    this.seenRuns.add(info.runId);
    if (this.seenRuns.size > 200) this.seenRuns.delete(this.seenRuns.values().next().value);
    const name = sanitizeLabel(info.username || 'someone');
    const path = sanitizeLabel(info.path || 'a file');
    this.print(truecolor(colorOf(info), `▶ ${name} ran ${path}`));
    this.streaming = true;
  }

  shellStart(info, colorOf) {
    this.seenRuns.add(info.id);
    this.shellRunning = info.id;
    if (!this.isSelf(info.userId)) {
      const name = sanitizeLabel(info.username || 'someone');
      const where = info.cwd ? brightBlack(` (in ${sanitizeLabel(info.cwd)})`) : '';
      this.print(
        `${truecolor(colorOf(info), name)} ${brightBlack('$')} ${sanitizeLabel(info.command)}${where}`,
      );
    }
    this.streaming = true;
  }

  shellEnd(result) {
    this.shellRunning = null;
    this.streaming = false;
    const secs = Number.isFinite(result.durationMs)
      ? `${(result.durationMs / 1000).toFixed(1)}s`
      : '?';
    const c = result.changes;
    const files = c
      ? [
          c.added?.length && `${c.added.length} new`,
          c.changed?.length && `${c.changed.length} changed`,
          c.removed?.length && `${c.removed.length} deleted`,
        ].filter(Boolean)
      : [];
    let line;
    if (result.cancelled) line = yellow('■ stopped');
    else if (result.timedOut) line = red('✖ stopped at the time limit');
    else if (result.exitCode === 0) line = green(result.durationMs ? `✔ done in ${secs}` : '✔');
    else
      line = red(`✖ exited with code ${result.exitCode}${result.durationMs ? ` in ${secs}` : ''}`);
    if (files.length) line += brightBlack(` · files: ${files.join(', ')}`);
    this.print(line);
    if (c?.hidden?.length && !this.hiddenNoted) {
      this.hiddenNoted = true;
      this.print(
        brightBlack(`  ${c.hidden.join(', ')} is in Files (read-only, kept on the server).`),
      );
    }
    if (c?.skipped?.length) {
      const some = c.skipped.slice(0, 5).join(', ');
      this.print(
        brightBlack(
          `  Not synced (binary or over 512KB): ${some}${c.skipped.length > 5 ? ', ...' : ''}`,
        ),
      );
    }
  }

  runChunk(stream, chunk) {
    const text = toCrlf(chunk);
    if (!text) return;
    this.hidePrompt();
    this.term.write(stream === 'stderr' ? red(text) : text);
    this.atLineStart = text.endsWith('\n');
    this.showPrompt();
  }

  runEnd(result) {
    const ms = Number.isFinite(result.durationMs) ? `${result.durationMs}ms` : '?';
    let line;
    if (result.aborted) line = red('✖ run aborted: the runner left the room');
    else if (result.skipped || result.exitCode == null) line = yellow('– not executed');
    else if (result.phase === 'compile')
      line = red(`✖ compilation failed (exit ${result.exitCode}) in ${ms}`);
    else if (result.exitCode === 0) line = green(`✔ exited with code 0 in ${ms}`);
    else line = red(`✖ exited with code ${result.exitCode} in ${ms}`);
    this.streaming = false;
    this.print(line);
  }

  /* -------------------------------------------------------------- input */

  echo(text) {
    if (this.promptShown) this.term.write(text);
  }

  handleInput(data) {
    // Escape sequences (arrows, function keys) arrive as one chunk.
    if (data.startsWith('\x1b')) {
      if (data === '\x1b[A') this.browseHistory(1);
      else if (data === '\x1b[B') this.browseHistory(-1);
      return;
    }
    for (const ch of data) {
      if (ch === '\r' || ch === '\n') this.submit();
      else if (ch === '\x7f' || ch === '\b') {
        if (this.buffer.length) {
          this.buffer = this.buffer.slice(0, -1);
          this.echo('\b \b');
        }
      } else if (ch === '\x03') {
        if (this.shellRunning && !this.buffer) {
          this.print(brightBlack('^C stopping...'));
          this.onInterrupt();
        } else if (this.streaming && !this.buffer) {
          this.print(
            brightBlack(
              '^C (a shared run cannot be interrupted from here; it stops at its time limit)',
            ),
          );
        } else {
          this.echo('^C');
          this.buffer = '';
          if (this.promptShown) this.term.write('\r\n');
          this.promptShown = false;
          this.showPrompt();
        }
      } else if (ch === '\x0c') {
        this.clear();
      } else if (ch >= ' ' && this.buffer.length < 2000) {
        this.buffer += ch;
        this.echo(ch);
      }
    }
  }

  browseHistory(direction) {
    if (!this.history.length) return;
    this.historyIndex = Math.max(
      -1,
      Math.min(this.history.length - 1, this.historyIndex + direction),
    );
    this.buffer =
      this.historyIndex === -1 ? '' : this.history[this.history.length - 1 - this.historyIndex];
    this.refreshPrompt();
  }

  submit() {
    const line = this.buffer;
    this.buffer = '';
    this.historyIndex = -1;
    if (this.promptShown) {
      this.term.write('\r\n'); // keep "prompt + command" in the scrollback
      this.promptShown = false;
    }
    if (line.trim()) {
      if (this.history[this.history.length - 1] !== line) this.history.push(line);
      if (this.history.length > HISTORY_LIMIT) this.history.shift();
      this.onCommand(line);
    }
    this.showPrompt();
  }

  dispose() {
    this.dataSub.dispose();
    this.term.dispose();
  }
}
