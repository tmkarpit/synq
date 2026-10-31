import { toast } from 'sonner';
import { useRoomStore } from '@/store/roomStore';

// Save, like VS Code's Ctrl/Cmd+S, but for the shared room on the server. The server
// also autosaves about a second after the last edit; Save just does it right away and
// confirms it.
//
// A tab is dirty when you edited it and the server has not written that edit to disk
// yet. Every room:saved (autosave or anyone's manual save) clears all marks.

/** Called after a local edit. */
export function markDirty(fileId) {
  if (fileId && !useRoomStore.getState().dirty[fileId])
    useRoomStore.getState().setDirty(fileId, true);
}

/** Called on room:saved. */
export function markAllSaved() {
  useRoomStore.getState().clearDirty();
}

/**
 * Save the room on the server now.
 * @returns {Promise<boolean>} true when the server confirmed the write.
 */
export async function saveRoom({ service }) {
  const res = await service.save();
  if (res?.error) {
    toast.error('Could not save', {
      description: `${res.error} Your edits are kept and will be saved when the connection is back.`,
    });
    return false;
  }
  markAllSaved();
  toast.success('All changes saved', { duration: 1500 });
  return true;
}
