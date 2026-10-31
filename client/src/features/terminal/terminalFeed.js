// Ordered log of everything the terminal prints that does not come from local typing:
// shared run:* events and local notices ("run already in progress"). It buffers while
// xterm.js is still loading and replays on (re)mount, so no run output is ever lost.
//
// Items: { kind: 'run:started' | 'run:output' | 'run:result' | 'notice', data }

export function createTerminalFeed(limit = 3000) {
  let items = [];
  const subscribers = new Set();
  return {
    push(kind, data) {
      const item = { kind, data };
      items.push(item);
      if (items.length > limit) items = items.slice(-limit);
      subscribers.forEach((fn) => fn(item));
    },
    /** Replays the backlog (after the last local clear), then streams live items. */
    subscribe(fn) {
      items.forEach(fn);
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    /** `clear` is local: forget the backlog so a remount does not replay it. */
    clear() {
      items = [];
    },
  };
}
