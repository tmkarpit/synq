/** Minimal event emitter. on() returns an unsubscribe function. */
export function createEmitter() {
  const handlers = new Map();
  return {
    on(event, fn) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(fn);
      return () => handlers.get(event)?.delete(fn);
    },
    emit(event, payload) {
      handlers.get(event)?.forEach((fn) => {
        try {
          fn(payload);
        } catch (err) {
          console.error(`[synq] "${event}" handler failed`, err);
        }
      });
    },
    clear() {
      handlers.clear();
    },
  };
}
