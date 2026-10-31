import { strToU8, zipSync } from 'fflate';
import { getFileText, getNodes, listFiles } from '@/services/collab/workspaceDoc';

/** Zip the room's current (final) code and hand it to the browser as a download. */
export function downloadProject(doc, roomId) {
  const nodes = getNodes(doc);
  const entries = Object.fromEntries(
    listFiles(nodes).map((f) => [
      `${roomId}/${f.path}`,
      strToU8(getFileText(doc, f.id)?.toString() ?? ''),
    ]),
  );
  const blob = new Blob([zipSync(entries, { level: 6 })], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${roomId}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
