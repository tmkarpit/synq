import * as Y from 'yjs';
import { ENV } from '@/config/app';
import { createEmitter } from '@/lib/emitter';

export * from './events';

/**
 * Collab service: the only thing the UI talks to. Picks the mock adapter (BroadcastChannel,
 * offline) or the Socket.IO adapter (real backend) from ENV and exposes one API:
 *
 *   service.doc               Y.Doc with the project (see workspaceDoc.js)
 *   service.on(event, fn)     subscribe to SERVER_EVENTS, returns unsubscribe
 *   service.emit(event, data) send CLIENT_EVENTS
 *   service.save()            save the room now, resolves { ok } or { error }
 *   service.request(e, data)  send CLIENT_EVENTS that answer, resolves { ok } or { error }
 *   service.connect() / disconnect()
 */
export function createCollabService({
  roomId,
  user,
  role = null,
  roomName = null,
  simulateBots = true,
}) {
  const doc = new Y.Doc();
  const events = createEmitter();
  let adapter = null;
  let disposed = false;

  const dispatch = (event, payload) => {
    if (!disposed) events.emit(event, payload);
  };

  return {
    roomId,
    doc,
    mode: ENV.useMock ? 'mock' : 'live',
    on: events.on,

    emit(event, payload) {
      adapter?.send(event, payload);
    },

    request(event, payload) {
      return adapter?.request
        ? adapter.request(event, payload)
        : Promise.resolve({ error: 'Not connected yet.' });
    },

    save() {
      return adapter ? adapter.save() : Promise.resolve({ error: 'Not connected yet.' });
    },

    async connect() {
      if (ENV.useMock) {
        const { createMockAdapter, loadPersistedDoc } = await import('./mock/mockAdapter');
        if (disposed) return;
        loadPersistedDoc(roomId, doc);
        adapter = createMockAdapter({ roomId, user, doc, dispatch, role, simulateBots });
      } else {
        const { createSocketAdapter } = await import('./socketAdapter');
        if (disposed) return;
        adapter = createSocketAdapter({
          roomId,
          user,
          doc,
          dispatch,
          role,
          roomName,
          socketUrl: ENV.socketUrl,
        });
      }
      adapter.connect();
    },

    setBotsEnabled(enabled) {
      adapter?.setBotsEnabled?.(enabled);
    },

    disconnect() {
      if (disposed) return;
      adapter?.disconnect();
      disposed = true;
      events.clear();
      doc.destroy();
    },
  };
}
