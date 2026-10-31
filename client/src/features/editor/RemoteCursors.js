import { LIMITS } from '@/config/app';
import { RemoteCursorStyles } from './remoteCursorStyles';

// Renders remote collaborators inside one Monaco editor:
//   caret      2px bar (decoration, per-user CSS class, pulses while typing)
//   selection  25% tint + thin border (decoration)
//   flag       name label (content widget, so it can reposition and flip below line 1).
//              The name is ALWAYS readable: compact when idle, highlighted with
//              "typing..." while that person types or right after they move.
//   rulers     overview ruler + minimap marks on the caret line and selection
//
// Incoming updates are queued and applied once per animation frame. Each user owns one
// decorations collection per file, updated with .set(). Decorations move with edits
// automatically; the flag reads its position back from the caret decoration.

const FLAG_VISIBLE_MS = 2500;

export class RemoteCursors {
  /**
   * resolveOffset(fileId, rel) -> number | null   Yjs relative position -> offset
   * onFlushed(renderedUserIds)                     called after each batch
   */
  constructor({ monaco, editor, resolveOffset, onFlushed, maxUsers = LIMITS.maxCollaborators }) {
    this.monaco = monaco;
    this.editor = editor;
    this.resolveOffset = resolveOffset;
    this.onFlushed = onFlushed;
    this.maxUsers = maxUsers;
    this.styles = new RemoteCursorStyles();
    this.users = new Map();
    this.dirty = new Set();
    this.fileId = null;
    this.raf = 0;
    this.disposed = false;

    // Flags follow their caret decoration when text changes around them.
    this.contentSub = editor.onDidChangeModelContent(() => {
      this.users.forEach((u) => u.widget && editor.layoutContentWidget(u.widget));
    });

    // Coming back to this tab: highlight everyone's flag so you can spot who is where.
    this.onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      this.users.forEach((u) => u.flag && this.expand(u, false));
    };
    document.addEventListener('visibilitychange', this.onVisible);
  }

  /* -------------------------------------------------------------- input */

  setFile(fileId) {
    this.fileId = fileId;
    this.users.forEach((u) => this.dirty.add(u.userId));
    this.schedule();
  }

  /** Name / color / current file from presence. */
  setUserMeta({ userId, username, color, fileId }) {
    const u = this.ensure(userId);
    const changed =
      u.username !== username || u.color !== color || (fileId !== undefined && u.fileId !== fileId);
    u.username = username;
    u.color = color;
    if (fileId !== undefined && fileId !== u.fileId) {
      u.fileId = fileId;
      u.position = null;
      u.range = null;
    }
    if (changed) this.markDirty(userId);
  }

  cursor({ userId, fileId, position, rel }) {
    const u = this.ensure(userId);
    if (fileId !== u.fileId) u.range = null;
    Object.assign(u, { fileId, position, rel: rel || null, pendingResolve: true });
    this.activity(u);
  }

  selection({ userId, fileId, range, rel }) {
    const u = this.ensure(userId);
    Object.assign(u, { fileId, range: range || null, rangeRel: rel || null, pendingResolve: true });
    this.activity(u);
  }

  typing(userId, typing) {
    const u = this.ensure(userId);
    if (u.typing === typing) return;
    u.typing = typing;
    this.activity(u);
  }

  removeUser(userId) {
    const u = this.users.get(userId);
    if (!u) return;
    this.teardown(u);
    this.users.delete(userId);
    this.dirty.delete(userId);
    this.styles.remove(userId);
  }

  getCaretPosition(userId) {
    const u = this.users.get(userId);
    return u ? this.caretOf(u) : null;
  }

  /* ----------------------------------------------------------- internals */

  ensure(userId) {
    let u = this.users.get(userId);
    if (!u) {
      u = {
        userId,
        username: 'guest',
        color: null,
        fileId: null,
        position: null,
        range: null,
        typing: false,
        collection: null,
        collectionFile: null,
        widget: null,
        flagTimer: null,
        expanded: false,
      };
      this.users.set(userId, u);
    }
    return u;
  }

  activity(u) {
    u.expandRequested = true;
    this.markDirty(u.userId);
  }

  markDirty(userId) {
    this.dirty.add(userId);
    this.schedule();
  }

  schedule() {
    if (this.raf || this.disposed) return;
    this.raf = requestAnimationFrame(() => this.flush());
  }

  flush() {
    this.raf = 0;
    if (this.disposed) return;
    const allowed = new Set([...this.users.keys()].slice(0, this.maxUsers));
    const rendered = [];
    this.dirty.forEach((userId) => {
      const u = this.users.get(userId);
      if (u && this.render(u, allowed.has(userId))) rendered.push(userId);
    });
    this.dirty.clear();
    if (rendered.length) this.onFlushed?.(rendered);
  }

  toModelPosition(model, offsetRel, fallback) {
    const offset = offsetRel ? this.resolveOffset(this.fileId, offsetRel) : null;
    if (offset != null) return model.getPositionAt(offset);
    return fallback ? model.validatePosition(fallback) : null;
  }

  render(u, allowed) {
    const { monaco, editor } = this;
    const model = editor.getModel();
    if (!allowed || !model || !u.fileId || u.fileId !== this.fileId || !u.position) {
      this.teardown(u);
      return false;
    }

    // Resolve fresh coordinates only when a new event arrived; otherwise the existing
    // decorations already tracked every edit since.
    let caret = this.caretOf(u);
    let range = u.collection?.getRanges()[2] || null;
    if (u.pendingResolve || !caret) {
      caret = this.toModelPosition(model, u.rel, u.position);
      range = null;
      if (u.range) {
        const start = this.toModelPosition(model, u.rangeRel?.start, {
          lineNumber: u.range.startLineNumber,
          column: u.range.startColumn,
        });
        const end = this.toModelPosition(model, u.rangeRel?.end, {
          lineNumber: u.range.endLineNumber,
          column: u.range.endColumn,
        });
        if (start && end) range = monaco.Range.fromPositions(start, end);
      }
      u.pendingResolve = false;
    }
    if (!caret) return false;

    const { cls, hex } = this.styles.classFor(u.userId, u.color);
    const marks = {
      overviewRuler: { color: hex, position: monaco.editor.OverviewRulerLane.Full },
      minimap: { color: hex, position: monaco.editor.MinimapPosition.Inline },
    };
    const NEVER_GROWS = monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges;
    const caretRange = monaco.Range.fromPositions(caret, caret);
    const decorations = [
      {
        range: caretRange,
        options: {
          description: 'synq-remote-caret',
          beforeContentClassName: `rc-caret ${cls}${u.typing ? ' rc-caret--typing' : ''}`,
          stickiness: NEVER_GROWS,
          hoverMessage: { value: u.username },
        },
      },
      {
        range: caretRange,
        options: {
          description: 'synq-remote-line',
          isWholeLine: true,
          stickiness: NEVER_GROWS,
          ...marks,
        },
      },
    ];
    if (range && !range.isEmpty()) {
      decorations.push({
        range,
        options: {
          description: 'synq-remote-selection',
          className: `rc-sel ${cls}`,
          stickiness: NEVER_GROWS,
          ...marks,
        },
      });
    }

    if (u.collectionFile !== this.fileId) {
      u.collection?.clear();
      u.collection = editor.createDecorationsCollection();
      u.collectionFile = this.fileId;
    }
    u.collection.set(decorations);

    this.renderFlag(u, cls);
    return true;
  }

  caretOf(u) {
    const r = u.collection?.getRanges()[0];
    return r && u.collectionFile === this.fileId ? r.getStartPosition() : null;
  }

  renderFlag(u, cls) {
    const { monaco, editor } = this;
    if (!u.widget) {
      const node = document.createElement('div');
      node.className = 'rc-flag-wrap';
      const pill = document.createElement('div');
      pill.setAttribute('role', 'note');
      const name = document.createElement('span');
      name.className = 'rc-flag__name';
      const typing = document.createElement('span');
      typing.className = 'rc-flag__typing';
      typing.setAttribute('aria-hidden', 'true');
      typing.textContent = 'typing';
      const dots = document.createElement('span');
      dots.className = 'rc-flag__dots';
      dots.append(
        document.createElement('i'),
        document.createElement('i'),
        document.createElement('i'),
      );
      typing.appendChild(dots);
      pill.append(name, typing);
      node.appendChild(pill);
      pill.addEventListener('mouseenter', () => this.expand(u, true));
      pill.addEventListener('mouseleave', () => this.expand(u, false));

      const { ABOVE, BELOW } = monaco.editor.ContentWidgetPositionPreference;
      u.widget = {
        allowEditorOverflow: true,
        suppressMouseDown: true,
        getId: () => `synq.remote-flag.${u.userId}`,
        getDomNode: () => node,
        getPosition: () => {
          const position = this.caretOf(u);
          if (!position) return null;
          return { position, preference: position.lineNumber === 1 ? [BELOW] : [ABOVE, BELOW] };
        },
        afterRender: (pref) => node.classList.toggle('rc-flag-wrap--below', pref === BELOW),
      };
      u.flag = { node, pill, name };
      editor.addContentWidget(u.widget);
    }
    u.flag.name.textContent = u.username;
    u.flag.pill.className = `rc-flag ${cls}${u.typing ? ' rc-flag--typing' : ''}${u.expanded ? ' rc-flag--expanded' : ''}`;
    u.flag.pill.setAttribute('aria-label', `${u.username}${u.typing ? ' is typing' : ''}`);
    if (u.expandRequested) {
      u.expandRequested = false;
      this.expand(u, false);
    }
    editor.layoutContentWidget(u.widget);
  }

  /** Highlighted now; back to the compact (still named) label FLAG_VISIBLE_MS after the last activity. */
  expand(u, hovering) {
    if (!u.flag) return;
    clearTimeout(u.flagTimer);
    u.expanded = true;
    u.flag.pill.classList.add('rc-flag--expanded');
    if (hovering) return;
    u.flagTimer = setTimeout(() => {
      if (u.typing && u.flag) return this.expand(u, false);
      u.expanded = false;
      u.flag?.pill.classList.remove('rc-flag--expanded');
      return undefined;
    }, FLAG_VISIBLE_MS);
  }

  teardown(u) {
    clearTimeout(u.flagTimer);
    u.flagTimer = null;
    u.collection?.clear();
    u.collection = null;
    u.collectionFile = null;
    if (u.widget) {
      this.editor.removeContentWidget(u.widget);
      u.widget = null;
      u.flag = null;
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.users.forEach((u) => this.teardown(u));
    this.users.clear();
    this.dirty.clear();
    this.contentSub.dispose();
    document.removeEventListener('visibilitychange', this.onVisible);
    this.styles.dispose();
  }
}
