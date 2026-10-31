import { toast } from 'sonner';
import { useRoomStore } from '@/store/roomStore';
import { CLIENT_EVENTS } from '@/services/collab';
import { pathOf } from '@/services/collab/workspaceDoc';

export const isHtml = (name = '') => /\.html?$/i.test(name);

/**
 * "Go Live": opens a file of the room in a new browser tab, served by the SYNQ server
 * at /live/<token>/<path> (relative CSS, JS and images load; the page reloads whenever
 * anyone edits the room).
 */
export async function openLive(service, fileId) {
  if (service.mode === 'mock') {
    toast('Go Live needs the SYNQ server', {
      description: 'The offline demo has no server to serve the page from.',
    });
    return;
  }
  const { nodes } = useRoomStore.getState();
  const path = pathOf(nodes, fileId);
  // Open the tab right away (inside the click), so the browser does not block it as a pop-up.
  const tab = window.open('about:blank', '_blank');
  const res = await service.request(CLIENT_EVENTS.liveOpen, { path });
  if (res.error) {
    tab?.close();
    toast.error('Could not go live', { description: res.error });
    return;
  }
  const url = new URL(res.url, window.location.origin).href;
  if (tab) tab.location.href = url;
  else window.open(url, '_blank');
}

/**
 * The page "Go Live" opens without a file chosen, like VS Code: the open HTML file, else
 * index.html at the top of the project, else any HTML file. Null when there is none.
 */
export function goLiveTarget() {
  const { nodes, activeFileId } = useRoomStore.getState();
  if (isHtml(nodes[activeFileId]?.name)) return activeFileId;
  const files = Object.values(nodes).filter((n) => n.type === 'file' && isHtml(n.name));
  const index = files.find((n) => !n.parentId && /^index\.html?$/i.test(n.name));
  return (
    (index || files.sort((a, b) => pathOf(nodes, a.id).localeCompare(pathOf(nodes, b.id)))[0])
      ?.id ?? null
  );
}

/** Stops the room's live server (its address stops working for everyone). */
export async function stopLive(service) {
  const res = await service.request(CLIENT_EVENTS.liveStop, {});
  if (res.error) toast.error('Could not stop the live server', { description: res.error });
  else toast('Live server stopped', { description: 'Click Go Live to start it again.' });
}
