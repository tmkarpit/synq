import { useRoomStore } from '@/store/roomStore';
import { useUiStore } from '@/store/uiStore';
import { CLIENT_EVENTS, canEdit, canRun } from '@/services/collab';

// One entry point for every run trigger: the toolbar button, Ctrl/Cmd+Enter and the
// terminal's `run` command. Refusals are printed locally; the run itself (and its
// output) arrives through the shared run:* events, so every collaborator sees it.

const PENDING_TIMEOUT_MS = 15000;
let pendingTimer = null;

/** stdin set with `stdin "..."` in the terminal, consumed by the next run. */
let nextStdin = '';
export const getNextStdin = () => nextStdin;
export const setNextStdin = (text) => {
  nextStdin = String(text ?? '');
};

/** Called when leaving the room. */
export function resetRunActions() {
  clearTimeout(pendingTimer);
  pendingTimer = null;
  nextStdin = '';
}

/**
 * @returns {boolean} true when a run:request was sent.
 */
export function requestRun({ service, feed, fileId }) {
  const state = useRoomStore.getState();
  useUiStore.getState().setBottomTab('terminal');
  const notice = (text, tone = 'info') => feed.push('notice', { text, tone });

  if (!state.self || state.status !== 'connected') {
    notice('Not connected to the room yet.', 'warn');
    return false;
  }
  if (!canEdit(state.self)) {
    notice("Viewers can't run code. Ask the room owner for edit access.", 'warn');
    return false;
  }
  if (!canRun(state.self, state.settings)) {
    notice('Only the room owner can run code in this room.', 'warn');
    return false;
  }
  const { active, pending } = state.run;
  if (active || pending) {
    const who = active
      ? `${active.username} is running ${active.path || 'a file'}`
      : 'your run is starting';
    notice(`A run is already in progress (${who}). Please wait for it to finish.`, 'warn');
    return false;
  }
  const targetId = fileId ?? state.activeFileId;
  if (!targetId || state.nodes[targetId]?.type !== 'file') {
    notice('Open a file first, or use: run <path>', 'warn');
    return false;
  }

  state.setRunPending(true);
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    const { run, setRunPending } = useRoomStore.getState();
    if (run.pending && !run.active) {
      setRunPending(false);
      notice('The run did not start (no response from the server).', 'error');
    }
  }, PENDING_TIMEOUT_MS);

  const stdin = nextStdin;
  nextStdin = '';
  service.emit(CLIENT_EVENTS.runRequest, { fileId: targetId, stdin });
  if (stdin) notice(`Using stdin (${stdin.length} chars).`, 'muted');
  return true;
}
