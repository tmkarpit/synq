// Per-connection rate limits for socket events (token buckets). Normal use never comes
// close: the client throttles cursors to 50 ms and nobody chats 5 messages a second.

export const SOCKET_LIMITS = {
  join: { burst: 10, perSecond: 10 / 60 },
  chat: { burst: 10, perSecond: 5 },
  run: { burst: 3, perSecond: 3 / 10 },
  shell: { burst: 5, perSecond: 5 / 10 },
  relay: { burst: 80, perSecond: 40 }, // cursor, selection, typing (all together)
  // Document edits are never dropped (that would block the sender's later edits); a
  // connection sending more than this is disconnected instead.
  updateBytes: { burst: 20 * 1024 * 1024, perSecond: 2 * 1024 * 1024 },
};

// Per person (across connections): opening a new room ID creates a room in the database.
export const NEW_ROOM_LIMIT = { newRoom: { burst: 20, perSecond: 20 / 3600 } };

export class Buckets {
  constructor(limits = SOCKET_LIMITS, now = () => Date.now()) {
    this.limits = limits;
    this.now = now;
    this.state = new Map();
  }

  /** Takes `cost` from the bucket; false when there is not enough left. */
  take(name, cost = 1) {
    const rule = this.limits[name];
    if (!rule) return true;
    const t = this.now();
    const b = this.state.get(name) ?? { tokens: rule.burst, at: t };
    b.tokens = Math.min(rule.burst, b.tokens + ((t - b.at) / 1000) * rule.perSecond);
    b.at = t;
    this.state.set(name, b);
    if (b.tokens < cost) return false;
    b.tokens -= cost;
    return true;
  }
}
