import { useEffect } from 'react';
import { useRoomStore } from '@/store/roomStore';
import { getNodes, pathOf } from '@/services/collab/workspaceDoc';

/** Same fingerprint as the server's contentHash (cyrb53) in server/src/projectFiles.js. */
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

/**
 * The room's files compared with the last push: [{ path, id, status }] where status is
 * 'M' (modified), 'A' (added) or 'D' (deleted; no id). Sorted by path.
 */
export function computeChanges(doc, baseline) {
  if (!baseline) return [];
  const nodes = getNodes(doc);
  const texts = doc.getMap('texts');
  const pushed = new Map(baseline);
  const changes = [];
  const seen = new Set();
  texts.forEach((text, id) => {
    const node = nodes[id];
    if (!node || node.type !== 'file') return;
    const path = pathOf(nodes, id);
    if (path.split('/').includes('node_modules')) return;
    seen.add(path);
    const before = pushed.get(path);
    if (before === undefined) changes.push({ path, id, status: 'A' });
    else if (before !== contentHash(text.toString())) changes.push({ path, id, status: 'M' });
  });
  pushed.forEach((_hash, path) => !seen.has(path) && changes.push({ path, id: null, status: 'D' }));
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

/** Keeps roomStore.scmChanges up to date as the room's files change (debounced). */
export function useSourceControlTracker(service) {
  const baseline = useRoomStore((s) => s.github?.files ?? null);
  useEffect(() => {
    const { doc } = service;
    const update = () => useRoomStore.getState().setScmChanges(computeChanges(doc, baseline));
    update();
    let timer = null;
    const onUpdate = () => {
      clearTimeout(timer);
      timer = setTimeout(update, 300);
    };
    doc.on('update', onUpdate);
    return () => {
      clearTimeout(timer);
      doc.off('update', onUpdate);
    };
  }, [service, baseline]);
}
