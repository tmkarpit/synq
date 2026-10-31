import * as Y from 'yjs';
import { fontFamilyCss } from '@/store/settingsStore';
import { useRoomStore } from '@/store/roomStore';
import { languageForName } from '@/config/languages';
import { throttle } from '@/lib/throttle';
import { CLIENT_EVENTS, SERVER_EVENTS } from '@/services/collab';
import { getFileText } from '@/services/collab/workspaceDoc';
import { decodeRelative, encodeRelative } from '@/services/collab/relativePosition';
import { markDirty } from '@/features/room/saveActions';
import { YTextBinding } from './YTextBinding';
import { RemoteCursors } from './RemoteCursors';
import { findSymbolAt } from './symbols';

const CURSOR_THROTTLE_MS = 50;
const TYPING_IDLE_MS = 1500;
const FOLLOW_SCROLL_GRACE_MS = 600;

// VS Code Dark Modern editor options (fixed part).
export const BASE_OPTIONS = Object.freeze({
  fontSize: 14,
  lineHeight: 24,
  fontLigatures: true,
  minimap: { enabled: true, maxColumn: 80, renderCharacters: true, showSlider: 'mouseover' },
  bracketPairColorization: { enabled: true },
  guides: { bracketPairs: true, indentation: true },
  renderLineHighlight: 'all',
  cursorBlinking: 'smooth',
  cursorSmoothCaretAnimation: 'on',
  smoothScrolling: true,
  scrollBeyondLastLine: false,
  padding: { top: 8 },
  stickyScroll: { enabled: true },
  automaticLayout: true,
  fixedOverflowWidgets: true,
  overviewRulerBorder: false,
  scrollbar: { verticalScrollbarSize: 14, horizontalScrollbarSize: 12, useShadows: false },
  renderWhitespace: 'selection',
  tabSize: 2,
  insertSpaces: true,
  'semanticHighlighting.enabled': false,
  // Suggestions as you type (in code and in strings such as import paths and HTML
  // attributes), snippets mixed in, with a short delay so typing stays smooth.
  quickSuggestions: { other: true, comments: false, strings: true },
  quickSuggestionsDelay: 50,
  suggestOnTriggerCharacters: true,
  snippetSuggestions: 'inline',
  suggest: { showWords: true, preview: true, localityBonus: true },
  parameterHints: { enabled: true },
});

const CURSOR_STYLE = {
  line: 'line',
  block: 'block',
  underline: 'underline',
  'line-thin': 'line-thin',
};

export function settingsToOptions(s) {
  return {
    fontSize: s.fontSize,
    lineHeight: Math.round(s.fontSize * (24 / 14)),
    fontFamily: fontFamilyCss(s.fontFamily),
    fontLigatures: s.ligatures,
    wordWrap: s.wordWrap ? 'on' : 'off',
    minimap: { ...BASE_OPTIONS.minimap, enabled: s.minimap },
    cursorStyle: CURSOR_STYLE[s.cursorStyle] || 'line',
    tabSize: s.tabSize,
  };
}

/**
 * Imperative owner of the Monaco editor for one room. React only tells it which file
 * is active and which settings apply; everything high-frequency stays in here.
 */
export class EditorController {
  constructor({
    monaco,
    container,
    service,
    settings,
    readOnly,
    onRun,
    onSave,
    onOpenFile,
    onGoLive = () => {},
  }) {
    this.monaco = monaco;
    this.service = service;
    this.doc = service.doc;
    this.onRun = onRun;
    this.onSave = onSave;
    this.onGoLive = onGoLive;
    this.onOpenFile = onOpenFile;
    this.models = new Map(); // fileId -> { model, binding, undo, viewState }
    this.fileId = null;
    this.typing = false;
    this.typingTimer = null;
    this.followScrollUntil = 0;
    this.tabSize = settings.tabSize;
    this.cleanups = [];

    this.editor = monaco.editor.create(container, {
      ...BASE_OPTIONS,
      ...settingsToOptions(settings),
      theme: settings.themeId,
      readOnly,
      model: null,
    });
    const { editor } = this;

    this.remote = new RemoteCursors({
      monaco,
      editor,
      resolveOffset: (fileId, rel) => decodeRelative(this.doc, getFileText(this.doc, fileId), rel),
      onFlushed: (ids) => this.followTick(ids),
    });

    this.sendCursor = throttle(() => this.emitCursor(), CURSOR_THROTTLE_MS);
    this.sendSelection = throttle(() => this.emitSelection(), CURSOR_THROTTLE_MS);
    this.updateStatus = throttle(() => this.publishStatus(), CURSOR_THROTTLE_MS);

    const { KeyMod, KeyCode } = monaco;
    editor.addCommand(KeyMod.CtrlCmd | KeyCode.Enter, () => this.onRun());
    editor.addCommand(KeyMod.CtrlCmd | KeyCode.KeyS, () => this.onSave());
    // "Open with Live Server" in the editor's right-click menu for HTML files, with VS Code's
    // Live Server shortcut (Alt+L, Alt+O).
    this.isHtmlKey = editor.createContextKey('synqIsHtml', false);
    editor.addAction({
      id: 'synq.goLive',
      label: 'Open with Live Server',
      precondition: 'synqIsHtml',
      keybindings: [KeyMod.chord(KeyMod.Alt | KeyCode.KeyL, KeyMod.Alt | KeyCode.KeyO)],
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 0,
      run: () => this.fileId && this.onGoLive(this.fileId),
    });
    // Undo/redo reach the model as Yjs changes (like remote edits), so mark dirty here.
    const undoRedo = (op) => () => {
      if (this.current()?.undo[op]()) markDirty(this.fileId);
    };
    editor.addCommand(KeyMod.CtrlCmd | KeyCode.KeyZ, undoRedo('undo'));
    editor.addCommand(KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyZ, undoRedo('redo'));
    editor.addCommand(KeyMod.CtrlCmd | KeyCode.KeyY, undoRedo('redo'));

    this.track(
      editor.onDidChangeCursorPosition(() => {
        if (this.current()?.binding.applyingRemote) return;
        this.sendCursor();
        this.updateStatus();
      }),
      editor.onDidChangeCursorSelection(() => {
        if (this.current()?.binding.applyingRemote) return;
        this.sendSelection();
        this.updateStatus();
      }),
      editor.onDidChangeModelContent(() => {
        if (!this.current() || this.current().binding.applyingRemote) return;
        this.markTyping();
        markDirty(this.fileId);
      }),
      editor.onMouseWheel(() => useRoomStore.getState().stopFollowing()),
      editor.onDidScrollChange((e) => {
        if (e.scrollTopChanged && Date.now() > this.followScrollUntil)
          useRoomStore.getState().stopFollowing();
      }),
    );

    this.subscribeToService();
    this.subscribeToStore();
  }

  track(...disposables) {
    disposables.forEach((d) => this.cleanups.push(() => d.dispose()));
  }

  current() {
    return this.fileId ? this.models.get(this.fileId) : null;
  }

  /* ------------------------------------------------------------ models */

  ensureModel(fileId) {
    if (this.models.has(fileId)) return this.models.get(fileId);
    const ytext = getFileText(this.doc, fileId);
    const node = useRoomStore.getState().nodes[fileId];
    if (!ytext || !node) return null;
    const { monaco } = this;
    const model = monaco.editor.createModel(
      '',
      languageForName(node.name),
      monaco.Uri.from({ scheme: 'synq', path: `/${fileId}/${node.name}` }),
    );
    model.setEOL(monaco.editor.EndOfLineSequence.LF);
    model.updateOptions({ tabSize: this.tabSize, insertSpaces: true });
    const binding = new YTextBinding({ ytext, model, doc: this.doc });
    const undo = new Y.UndoManager(ytext, {
      trackedOrigins: new Set([binding]),
      captureTimeout: 500,
    });
    const entry = { model, binding, undo, viewState: null };
    this.models.set(fileId, entry);
    return entry;
  }

  /** A renamed file can change language (app.js -> app.ts): update open models. */
  syncLanguages(nodes) {
    this.models.forEach(({ model }, fileId) => {
      const node = nodes[fileId];
      const lang = node && languageForName(node.name);
      if (lang && model.getLanguageId() !== lang) this.monaco.editor.setModelLanguage(model, lang);
    });
  }

  setFile(fileId) {
    if (fileId === this.fileId && (!fileId || this.editor.getModel())) return;
    this.stopTyping();
    const prev = this.current();
    if (prev) {
      prev.viewState = this.editor.saveViewState();
      prev.binding.editor = null;
    }
    const entry = fileId ? this.ensureModel(fileId) : null;
    this.fileId = entry ? fileId : null;
    this.editor.setModel(entry ? entry.model : null);
    if (entry) {
      entry.binding.editor = this.editor;
      if (entry.viewState) this.editor.restoreViewState(entry.viewState);
    }
    this.remote.setFile(this.fileId);
    this.isHtmlKey?.set(/\.html?$/i.test(useRoomStore.getState().nodes[this.fileId]?.name || ''));
    this.publishStatus();
    if (this.fileId) {
      this.emitCursor();
      this.emitSelection();
    }
  }

  /* ---------------------------------------------------------- outgoing */

  emitCursor() {
    const model = this.editor.getModel();
    const position = this.editor.getPosition();
    if (!model || !position || !this.fileId) return;
    this.service.emit(CLIENT_EVENTS.cursorMove, {
      fileId: this.fileId,
      position: { lineNumber: position.lineNumber, column: position.column },
      rel: encodeRelative(getFileText(this.doc, this.fileId), model.getOffsetAt(position)),
    });
  }

  emitSelection() {
    const model = this.editor.getModel();
    const sel = this.editor.getSelection();
    if (!model || !sel || !this.fileId) return;
    if (sel.isEmpty()) {
      this.service.emit(CLIENT_EVENTS.selectionChange, { fileId: this.fileId, range: null });
      return;
    }
    const ytext = getFileText(this.doc, this.fileId);
    const { startLineNumber, startColumn, endLineNumber, endColumn } = sel;
    this.service.emit(CLIENT_EVENTS.selectionChange, {
      fileId: this.fileId,
      range: { startLineNumber, startColumn, endLineNumber, endColumn },
      rel: {
        start: encodeRelative(ytext, model.getOffsetAt(sel.getStartPosition())),
        end: encodeRelative(ytext, model.getOffsetAt(sel.getEndPosition())),
      },
    });
  }

  markTyping() {
    if (!this.typing) {
      this.typing = true;
      this.service.emit(CLIENT_EVENTS.typingStart, { fileId: this.fileId });
    }
    clearTimeout(this.typingTimer);
    this.typingTimer = setTimeout(() => this.stopTyping(), TYPING_IDLE_MS);
  }

  stopTyping() {
    clearTimeout(this.typingTimer);
    this.typingTimer = null;
    if (!this.typing) return;
    this.typing = false;
    this.service.emit(CLIENT_EVENTS.typingStop, { fileId: this.fileId });
  }

  publishStatus() {
    const model = this.editor.getModel();
    const pos = this.editor.getPosition();
    const sel = this.editor.getSelection();
    if (!model || !pos) {
      useRoomStore.getState().setCursor({ lineNumber: 1, column: 1, selected: 0 }, null);
      return;
    }
    useRoomStore.getState().setCursor(
      {
        lineNumber: pos.lineNumber,
        column: pos.column,
        selected: sel && !sel.isEmpty() ? model.getValueInRange(sel).length : 0,
      },
      findSymbolAt(model, pos.lineNumber),
    );
  }

  /* ---------------------------------------------------------- incoming */

  subscribeToService() {
    const { service, remote } = this;
    const selfId = () => useRoomStore.getState().self?.userId;
    const fromOther = (fn) => (data) => data?.userId && data.userId !== selfId() && fn(data);
    const offs = [
      service.on(
        SERVER_EVENTS.cursorMove,
        fromOther((d) => {
          remote.cursor(d);
          const { followUserId } = useRoomStore.getState();
          if (followUserId === d.userId && d.fileId && d.fileId !== this.fileId)
            this.onOpenFile(d.fileId);
        }),
      ),
      service.on(
        SERVER_EVENTS.selectionChange,
        fromOther((d) => remote.selection(d)),
      ),
      service.on(
        SERVER_EVENTS.typingStart,
        fromOther((d) => remote.typing(d.userId, true)),
      ),
      service.on(
        SERVER_EVENTS.typingStop,
        fromOther((d) => remote.typing(d.userId, false)),
      ),
      service.on(SERVER_EVENTS.userLeft, ({ userId }) => remote.removeUser(userId)),
    ];
    this.cleanups.push(() => offs.forEach((off) => off()));
  }

  subscribeToStore() {
    const syncUsers = (users, prevUsers = {}) => {
      Object.values(users).forEach((u) => this.remote.setUserMeta(u));
      Object.keys(prevUsers).forEach((id) => !users[id] && this.remote.removeUser(id));
    };
    syncUsers(useRoomStore.getState().users);
    const unsub = useRoomStore.subscribe((state, prev) => {
      if (state.users !== prev.users) syncUsers(state.users, prev.users);
      if (state.followUserId && state.followUserId !== prev.followUserId)
        this.startFollowing(state.followUserId);
    });
    this.cleanups.push(unsub);
  }

  /* ------------------------------------------------------------ follow */

  startFollowing(userId) {
    const user = useRoomStore.getState().users[userId];
    if (!user) return;
    if (user.fileId && user.fileId !== this.fileId) {
      this.onOpenFile(user.fileId); // React calls setFile; the next flush reveals.
      return;
    }
    const pos = this.remote.getCaretPosition(userId);
    if (pos) this.reveal(pos);
  }

  followTick(renderedIds) {
    const { followUserId } = useRoomStore.getState();
    if (!followUserId || !renderedIds.includes(followUserId)) return;
    const pos = this.remote.getCaretPosition(followUserId);
    if (pos) this.reveal(pos);
  }

  reveal(position) {
    this.followScrollUntil = Date.now() + FOLLOW_SCROLL_GRACE_MS;
    this.editor.revealPositionInCenterIfOutsideViewport(
      position,
      this.monaco.editor.ScrollType.Smooth,
    );
  }

  /* ---------------------------------------------------------- settings */

  updateSettings(settings) {
    this.editor.updateOptions(settingsToOptions(settings));
    this.tabSize = settings.tabSize;
    this.models.forEach(({ model }) => model.updateOptions({ tabSize: settings.tabSize }));
    this.monaco.editor.setTheme(settings.themeId);
  }

  setReadOnly(readOnly) {
    this.editor.updateOptions({
      readOnly,
      readOnlyMessage: { value: "Viewers can't edit this room." },
    });
  }

  focus() {
    this.editor.focus();
  }

  dispose() {
    this.stopTyping();
    this.sendCursor.cancel();
    this.sendSelection.cancel();
    this.updateStatus.cancel();
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
    this.remote.dispose();
    this.editor.setModel(null);
    this.models.forEach(({ model, binding, undo }) => {
      binding.destroy();
      undo.destroy();
      model.dispose();
    });
    this.models.clear();
    this.editor.dispose();
  }
}
