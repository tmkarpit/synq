// Two-way binding between a Y.Text and a Monaco text model.
// Local edits become Yjs operations (origin = this binding, so the UndoManager tracks
// only them); remote Yjs deltas are applied with model.applyEdits, which keeps them
// out of Monaco's own undo stack. The editor's selections are carried through remote
// edits explicitly so a collaborator typing before your caret never moves it wrongly.

/**
 * Map an offset in the old text through a Yjs delta. Inserts exactly at the offset
 * leave it in place (the remote text appears after your caret).
 */
export function transformOffset(offset, delta) {
  let oldPos = 0;
  let shift = 0;
  for (const op of delta) {
    if (oldPos > offset) break;
    if (op.retain) oldPos += op.retain;
    else if (op.insert != null) {
      if (oldPos < offset) shift += typeof op.insert === 'string' ? op.insert.length : 1;
    } else if (op.delete) {
      if (oldPos < offset) shift -= Math.min(op.delete, offset - oldPos);
      oldPos += op.delete;
    }
  }
  return offset + shift;
}

export class YTextBinding {
  constructor({ ytext, model, doc }) {
    this.ytext = ytext;
    this.model = model;
    this.doc = doc;
    this.editor = null;
    this.applyingRemote = false;

    const content = ytext.toString();
    if (model.getValue() !== content) model.setValue(content);

    this.onYChange = (event, transaction) => {
      if (transaction.origin === this) return;
      this.applyRemote(event.delta);
    };
    ytext.observe(this.onYChange);

    this.modelSub = model.onDidChangeContent((e) => {
      if (this.applyingRemote) return;
      // Apply from the end so earlier offsets stay valid (multi-cursor edits).
      const changes = [...e.changes].sort((a, b) => b.rangeOffset - a.rangeOffset);
      doc.transact(() => {
        changes.forEach((c) => {
          if (c.rangeLength > 0) ytext.delete(c.rangeOffset, c.rangeLength);
          if (c.text) ytext.insert(c.rangeOffset, c.text);
        });
      }, this);
    });
  }

  applyRemote(delta) {
    const { model } = this;
    const editor = this.editor && this.editor.getModel() === model ? this.editor : null;
    const saved = editor
      ? editor.getSelections().map((sel) => ({
          anchor: model.getOffsetAt(sel.getSelectionStart()),
          head: model.getOffsetAt(sel.getPosition()),
          reversed: sel.getDirection() === 1, // SelectionDirection.RTL
          sel,
        }))
      : null;

    this.applyingRemote = true;
    try {
      let index = 0;
      for (const op of delta) {
        if (op.retain) {
          index += op.retain;
        } else if (op.insert != null) {
          const text = typeof op.insert === 'string' ? op.insert : '';
          const pos = model.getPositionAt(index);
          model.applyEdits([
            {
              range: {
                startLineNumber: pos.lineNumber,
                startColumn: pos.column,
                endLineNumber: pos.lineNumber,
                endColumn: pos.column,
              },
              text,
            },
          ]);
          index += text.length;
        } else if (op.delete) {
          const start = model.getPositionAt(index);
          const end = model.getPositionAt(index + op.delete);
          model.applyEdits([
            {
              range: {
                startLineNumber: start.lineNumber,
                startColumn: start.column,
                endLineNumber: end.lineNumber,
                endColumn: end.column,
              },
              text: '',
            },
          ]);
        }
      }

      if (editor && saved) {
        const selections = saved.map(({ anchor, head, sel }) => {
          const a = model.getPositionAt(transformOffset(anchor, delta));
          const h = model.getPositionAt(transformOffset(head, delta));
          return sel.constructor.fromPositions(a, h);
        });
        editor.setSelections(selections);
      }
    } finally {
      this.applyingRemote = false;
    }
  }

  destroy() {
    this.ytext.unobserve(this.onYChange);
    this.modelSub.dispose();
    this.editor = null;
  }
}
