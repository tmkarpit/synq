import * as Y from 'yjs';

// Yjs relative positions survive concurrent edits: a remote cursor encoded as
// "after character X" resolves to the right index even if text was inserted before it
// between sending and receiving. Encoded as plain number arrays so they travel as JSON.

/** assoc >= 0 sticks to the character after `index`, assoc < 0 to the one before it. */
export function encodeRelative(ytext, index, assoc = 0) {
  if (!ytext) return null;
  const rel = Y.createRelativePositionFromTypeIndex(
    ytext,
    Math.max(0, Math.min(index, ytext.length)),
    assoc,
  );
  return Array.from(Y.encodeRelativePosition(rel));
}

/** Returns the absolute index inside `ytext`, or null when it cannot be resolved. */
export function decodeRelative(doc, ytext, encoded) {
  if (!doc || !ytext || !Array.isArray(encoded) || encoded.length === 0) return null;
  try {
    const rel = Y.decodeRelativePosition(Uint8Array.from(encoded));
    const abs = Y.createAbsolutePositionFromRelativePosition(rel, doc);
    return abs && abs.type === ytext ? abs.index : null;
  } catch {
    return null;
  }
}
