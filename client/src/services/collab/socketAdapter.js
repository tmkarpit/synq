import * as Y from 'yjs';
import { io } from 'socket.io-client';
import { CLIENT_EVENTS, SERVER_EVENTS } from './events';
import { getAccessToken, useAuthStore } from '@/store/authStore';

// Real-mode adapter: Socket.IO transport, Yjs updates relayed by the server, and code
// execution in the backend's external sandbox. The client never evaluates user code
// in this mode; it only sends run:request and renders the broadcast run:* events.

const REMOTE = Symbol('socket-remote');
const FORWARDED = Object.values(SERVER_EVENTS).filter((e) => e !== SERVER_EVENTS.connection);

export function createSocketAdapter({ roomId, user, doc, dispatch, role, roomName, socketUrl }) {
  let socket = null;
  let stopped = false; // declined, removed or logged out: stay on that screen

  /** Ends the connection for good and says why. */
  const stop = (error, code) => {
    stopped = true;
    dispatch(SERVER_EVENTS.connection, { status: 'denied', error, code });
    socket?.disconnect();
  };

  const onDocUpdate = (update, origin) => {
    if (origin !== REMOTE && socket?.connected) socket.emit('yjs:update', { update });
  };

  return {
    connect() {
      dispatch(SERVER_EVENTS.connection, { status: 'connecting' });
      // An empty URL connects to the page's own origin (proxied to the server in dev).
      socket = io(socketUrl || undefined, {
        transports: ['websocket'],
        reconnectionDelayMax: 5000,
        // The JWT access token, read on every (re)connect so a refreshed one is used.
        auth: (cb) => cb({ token: getAccessToken() }),
      });

      const join = () =>
        socket.emit(
          'room:join',
          {
            roomId,
            username: user.username,
            color: user.color,
            memberKey: user.memberKey,
            role: role || undefined,
            roomName: roomName || undefined,
          },
          (res = {}) => {
            if (res.error) {
              dispatch(SERVER_EVENTS.connection, { status: 'disconnected', error: res.error });
              return;
            }
            if (res.pending) {
              // Waiting for the owner; room:admitted arrives when they accept.
              dispatch(SERVER_EVENTS.connection, { status: 'pending', room: res.room });
              return;
            }
            // Sync step: apply the server state, then send what the server is missing.
            if (res.state) Y.applyUpdate(doc, new Uint8Array(res.state), REMOTE);
            const missing = Y.encodeStateAsUpdate(
              doc,
              res.stateVector ? new Uint8Array(res.stateVector) : undefined,
            );
            if (missing.length > 2) socket.emit('yjs:update', { update: missing });
            dispatch(SERVER_EVENTS.roomJoined, {
              self: res.self,
              users: res.users || [],
              settings: res.settings,
              room: res.room,
              shell: res.shell,
              live: res.live,
              github: res.github,
            });
            dispatch(SERVER_EVENTS.connection, { status: 'connected' });
            if (res.activeRun) dispatch(SERVER_EVENTS.runStarted, res.activeRun);
          },
        );

      socket.on('connect', join);
      socket.on('room:admitted', join);
      socket.on('room:declined', ({ message } = {}) => stop(message, 'declined'));
      socket.on('room:removed', ({ message } = {}) => stop(message, 'removed'));
      socket.on(
        'disconnect',
        () => !stopped && dispatch(SERVER_EVENTS.connection, { status: 'disconnected' }),
      );
      let refreshed = false;
      socket.on('connect', () => {
        refreshed = false;
      });
      socket.on('connect_error', async (err) => {
        if (err?.message !== 'unauthorized') {
          dispatch(SERVER_EVENTS.connection, { status: 'disconnected', error: 'unreachable' });
          return;
        }
        // Access token expired or missing: refresh it once, then connect again with it.
        const token = refreshed
          ? null
          : await useAuthStore
              .getState()
              .refresh()
              .catch(() => null);
        refreshed = true;
        if (token && socket) socket.connect();
        else stop('Your login has expired. Log in again to continue.', 'unauthorized');
      });
      socket.on('yjs:update', ({ update } = {}) => {
        if (update) Y.applyUpdate(doc, new Uint8Array(update), REMOTE);
      });
      FORWARDED.forEach((event) => socket.on(event, (payload) => dispatch(event, payload)));
      doc.on('update', onDocUpdate);
    },

    send(event, payload) {
      if (!socket?.connected) {
        if (event === CLIENT_EVENTS.runRequest) {
          dispatch(SERVER_EVENTS.runRejected, {
            reason: 'offline',
            message: 'Not connected to the server.',
          });
        }
        return;
      }
      socket.emit(event, payload);
    },

    request(event, payload) {
      if (!socket?.connected) return Promise.resolve({ error: 'Not connected to the server.' });
      return new Promise((resolve) => {
        socket
          .timeout(10000)
          .emit(event, payload, (err, res = {}) =>
            resolve(err ? { error: 'The server did not answer.' } : res),
          );
      });
    },

    save() {
      return this.request('room:save', {});
    },

    setBotsEnabled() {},

    disconnect() {
      doc.off('update', onDocUpdate);
      socket?.removeAllListeners();
      socket?.disconnect();
      socket = null;
      dispatch(SERVER_EVENTS.connection, { status: 'disconnected' });
    },
  };
}
