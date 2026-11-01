import * as Y from 'yjs';

// Server-side checks for the room's file tree (getMap('nodes'), see projectFiles.js).
// The client validates names too (client/src/config/languages.js), but a raw socket can
// send anything, and names become real paths on disk (shell.js) and in GitHub pushes.

export const NODE_NAME_MAX = 100;
const MAX_DEPTH = 32;
const ID = /^[\w-]{1,64}$/;

/** Why a file or folder name is not allowed, or null. Same rules as the client. */
export function nodeNameError(name) {
  if (typeof name !== 'string') return 'Name is required.';
  const trimmed = name.trim();
  if (!trimmed || trimmed !== name) return 'Name is required and cannot start or end with spaces.';
  if (trimmed.length > NODE_NAME_MAX) return `Name must be ${NODE_NAME_MAX} characters or fewer.`;
  if (/[\\/]/.test(trimmed)) return 'Name cannot contain slashes.';
  if (trimmed === '.' || trimmed === '..') return 'That name is reserved.';
  if ([...trimmed].some((ch) => ch.charCodeAt(0) < 32) || /[<>:"|?*]/.test(trimmed)) return 'Name contains invalid characters.';
  return null;
}

/**
 * Checks the file-tree entries an update adds or changes, without applying it (cheap on
 * every keystroke: text edits carry no tree entries). Returns a message, or null.
 */
export function treeUpdateError(doc, update) {
  let structs;
  try {
    ({ structs } = Y.decodeUpdate(update));
  } catch {
    return 'That change could not be read.';
  }
  const changed = new Map();
  for (const s of structs) {
    if (!(s instanceof Y.Item) || s.parent !== 'nodes') continue;
    const node = s.content?.getContent?.()[0];
    changed.set(s.parentSub, node);
  }
  if (!changed.size) return null;

  const nodes = doc.getMap('nodes');
  const lookup = (id) => (changed.has(id) ? changed.get(id) : nodes.get(id));
  for (const [key, node] of changed) {
    if (!ID.test(String(key))) return 'Invalid file id.';
    if (!node || typeof node !== 'object') return 'Invalid file entry.';
    if (node.id !== key) return 'Invalid file entry.';
    if (node.type !== 'file' && node.type !== 'folder') return 'Invalid file type.';
    const nameError = nodeNameError(node.name);
    if (nameError) return nameError;
    // The parent chain must end at the root, through folders, without loops.
    let parentId = node.parentId ?? null;
    for (let depth = 0; parentId !== null; depth += 1) {
      if (typeof parentId !== 'string' || depth > MAX_DEPTH || parentId === key) return 'Invalid folder.';
      const parent = lookup(parentId);
      if (!parent || parent.type !== 'folder') return 'Invalid folder.';
      parentId = parent.parentId ?? null;
    }
  }
  return null;
}

/**
 * The file tree as plain values (nodes, and the text of every file), to put back after
 * a refused change. Refused updates are applied and then undone instead of dropped:
 * Yjs numbers each client's changes, and a dropped one would block every later edit from
 * that client (the server would wait for it forever).
 */
export function snapshotTree(doc) {
  const texts = doc.getMap('texts');
  const nodes = new Map();
  doc.getMap('nodes').forEach((node, id) => nodes.set(id, { node, text: texts.get(id)?.toString() ?? null }));
  return nodes;
}

/** Puts the tree back to a snapshot. Text edits inside files that still exist stay. */
export function restoreTree(doc, snapshot) {
  const nodes = doc.getMap('nodes');
  const texts = doc.getMap('texts');
  doc.transact(() => {
    [...nodes.keys()].forEach((id) => {
      if (!snapshot.has(id)) {
        nodes.delete(id);
        texts.delete(id);
      }
    });
    [...texts.keys()].forEach((id) => !snapshot.has(id) && texts.delete(id));
    snapshot.forEach(({ node, text }, id) => {
      if (JSON.stringify(nodes.get(id)) !== JSON.stringify(node)) nodes.set(id, node);
      if (text !== null && !texts.get(id)) texts.set(id, new Y.Text(text));
    });
  }, 'server');
}
