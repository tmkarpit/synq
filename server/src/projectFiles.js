// Read the project tree out of a room's Y.Doc (see client workspaceDoc.js):
//   getMap('nodes'): id -> { id, name, type: 'file' | 'folder', parentId }
//   getMap('texts'): fileId -> Y.Text

/** "src/utils/math.js" for a node id. */
export function pathOf(nodes, id) {
  const parts = [];
  let node = nodes.get(id);
  for (let guard = 0; node && guard < 64; guard += 1) {
    parts.unshift(node.name);
    node = node.parentId ? nodes.get(node.parentId) : null;
  }
  return parts.join('/');
}

/** One file as plain text, or null when the id is not a file (deleted, folder). */
export function fileRow(doc, fileId) {
  const nodes = doc.getMap('nodes');
  const node = nodes.get(fileId);
  const text = doc.getMap('texts').get(fileId);
  if (!node || node.type !== 'file' || !text) return null;
  return { fileId, path: pathOf(nodes, fileId), content: text.toString() };
}

/**
 * A short fingerprint of a file's text (cyrb53). Source Control compares the room's files
 * with the fingerprints saved at the last push; the client uses the same function.
 */
export function contentHash(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function allFileRows(doc) {
  return [...doc.getMap('texts').keys()].map((id) => fileRow(doc, id)).filter(Boolean);
}
