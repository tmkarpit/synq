import * as Y from 'yjs';
import { nanoid } from 'nanoid';

// Shared project model inside one Y.Doc:
//   doc.getMap('nodes'): id -> { id, name, type: 'file' | 'folder', parentId: string | null }
//   doc.getMap('texts'): fileId -> Y.Text
// Node values are plain objects replaced as a whole, so concurrent renames resolve
// last-writer-wins while file contents merge character by character.

export const nodesMap = (doc) => doc.getMap('nodes');
export const textsMap = (doc) => doc.getMap('texts');

export function getFileText(doc, fileId) {
  return fileId ? textsMap(doc).get(fileId) || null : null;
}

export function getNodes(doc) {
  return Object.fromEntries(nodesMap(doc).entries());
}

export function pathOf(nodes, id) {
  const parts = [];
  let node = nodes[id];
  let guard = 0;
  while (node && guard < 64) {
    parts.unshift(node.name);
    node = node.parentId ? nodes[node.parentId] : null;
    guard += 1;
  }
  return parts.join('/');
}

/** Files sorted by path: [{ id, name, path }]. */
export function listFiles(nodes) {
  return Object.values(nodes)
    .filter((n) => n.type === 'file')
    .map((n) => ({ id: n.id, name: n.name, path: pathOf(nodes, n.id) }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** Accepts "src/index.js", "./src/index.js" or "/src/index.js". */
export function findFileByPath(nodes, path = '') {
  const clean = path
    .trim()
    .replace(/^\.?\//, '')
    .replace(/\/+$/, '');
  if (!clean) return null;
  return (
    listFiles(nodes).find(
      (f) => f.path === clean || f.path.toLowerCase() === clean.toLowerCase(),
    ) || null
  );
}

/** Folder-first, case-insensitive tree: [{ ...node, children? }]. */
export function buildTree(nodes) {
  const byParent = new Map();
  Object.values(nodes).forEach((n) => {
    const key = n.parentId || null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(n);
  });
  const sortNodes = (list) =>
    list.sort((a, b) =>
      a.type === b.type
        ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        : a.type === 'folder'
          ? -1
          : 1,
    );
  const walk = (parentId, depth) => {
    if (depth > 32) return [];
    return sortNodes(byParent.get(parentId) || []).map((n) =>
      n.type === 'folder' ? { ...n, children: walk(n.id, depth + 1) } : { ...n },
    );
  };
  return walk(null, 0);
}

export function createNode(doc, { name, type, parentId = null, content = '' }) {
  const id = `${type === 'folder' ? 'd' : 'f'}-${nanoid(10)}`;
  doc.transact(() => {
    if (type === 'file') {
      const text = new Y.Text();
      if (content) text.insert(0, content);
      textsMap(doc).set(id, text);
    }
    nodesMap(doc).set(id, { id, name, type, parentId });
  });
  return id;
}

/** Renames a file or folder (everyone sees it; open tabs keep their content). */
export function renameNode(doc, id, name) {
  const node = nodesMap(doc).get(id);
  if (!node || node.name === name) return false;
  nodesMap(doc).set(id, { ...node, name });
  return true;
}

/** Deletes a file, or a folder with everything inside it. Returns the removed ids. */
export function deleteNode(doc, id) {
  const nodes = getNodes(doc);
  if (!nodes[id]) return [];
  const ids = [id];
  for (let i = 0; i < ids.length; i += 1) {
    Object.values(nodes).forEach((n) => n.parentId === ids[i] && ids.push(n.id));
  }
  doc.transact(() => {
    ids.forEach((nid) => {
      nodesMap(doc).delete(nid);
      textsMap(doc).delete(nid);
    });
  });
  return ids;
}

/* ----------------------------------------------------- text <-> position */

/** 0-based string offset -> Monaco-style 1-based { lineNumber, column }. */
export function offsetToPosition(text, offset) {
  const clamped = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < clamped; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { lineNumber: line, column: clamped - lineStart + 1 };
}
