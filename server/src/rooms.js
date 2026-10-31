import * as Y from 'yjs';
import { normalizeMeta } from './permissions.js';

// In-memory rooms backed by a store (db/mongoStore.js or db/fileStore.js), so the code is
// still there when people come back (even after a server restart).
//
// Every Yjs update is queued on the room. At most once per FLUSH_MS (or right away on
// a manual save) the queue is handed to the store in one batch, together with the ids
// of the files that changed, so the database writes one small row instead of the
// whole room. Flushes of one room never overlap (they are chained on room.flushing).

export const ROOM_ID_PATTERN = /^synq-[a-z0-9]{4}-[a-z0-9]{4}$/;

const FLUSH_MS = 1000;
const UNLOAD_AFTER_MS = 10 * 60 * 1000;

export class RoomRegistry {
  /** onSaved(room, by) runs after every successful write; `by` is set for manual saves. */
  /** onChange(room) runs on every document change (the Live Server reloads previews). */
  constructor({ store, onSaved = () => {}, onChange = () => {} }) {
    this.store = store;
    this.onSaved = onSaved;
    this.onChange = onChange;
    this.rooms = new Map();
    this.loading = new Map(); // roomId -> Promise<room>, so two joins load once
  }

  async get(roomId) {
    if (!ROOM_ID_PATTERN.test(roomId)) return null;
    let room = this.rooms.get(roomId);
    if (!room) {
      if (!this.loading.has(roomId)) {
        this.loading.set(
          roomId,
          this.load(roomId).finally(() => this.loading.delete(roomId)),
        );
      }
      room = await this.loading.get(roomId);
    }
    clearTimeout(room.unloadTimer);
    room.unloadTimer = null;
    return room;
  }

  async load(roomId) {
    const doc = new Y.Doc();
    const [parts, meta] = await Promise.all([this.store.load(roomId), this.store.loadMeta(roomId)]);
    if (parts.length) Y.applyUpdate(doc, parts.length === 1 ? parts[0] : Y.mergeUpdates(parts));

    const room = {
      id: roomId,
      doc,
      meta: normalizeMeta(meta), // owner, roles and settings (permissions.js)
      users: new Map(),
      activeRun: null,
      job: null,
      shellJob: null, // the terminal command running now
      shellCwd: '', // the terminal's folder, relative to the room's workspace
      serverDirs: null, // server-only folders (node_modules, ...) shown read-only in Files
      unloadTimer: null,
      pending: [], // Yjs updates not written yet
      changedFiles: new Set(),
      allFiles: false, // a rename/move/delete changes paths: rewrite every file row
      flushTimer: null,
      flushing: Promise.resolve(true),
      lastSeq: null, // MongoStore: last update document written by this process
    };

    doc.on('update', (update) => {
      room.pending.push(update);
      this.scheduleFlush(room);
      this.onChange(room);
    });
    doc.getMap('texts').observeDeep((events) =>
      events.forEach((e) => {
        if (e.path.length) room.changedFiles.add(String(e.path[0]));
        else e.keysChanged.forEach((id) => room.changedFiles.add(id));
      }),
    );
    doc.getMap('nodes').observe(() => {
      room.allFiles = true;
    });

    this.rooms.set(roomId, room);
    return room;
  }

  scheduleFlush(room) {
    if (room.flushTimer) return;
    room.flushTimer = setTimeout(() => this.flush(room), FLUSH_MS);
  }

  /**
   * Write everything queued for the room. `by` marks a manual save (it is reported even
   * when nothing was pending). Resolves true when the store has the data.
   */
  flush(room, by = null) {
    room.flushing = room.flushing.then(() => this.writeQueued(room, by));
    return room.flushing;
  }

  async writeQueued(room, by) {
    clearTimeout(room.flushTimer);
    room.flushTimer = null;
    const updates = room.pending.splice(0);
    const changedFiles = [...room.changedFiles];
    const allFiles = room.allFiles;
    room.changedFiles.clear();
    room.allFiles = false;

    if (updates.length) {
      try {
        const { needsCompaction } = await this.store.flush(room, { updates, changedFiles, allFiles });
        if (needsCompaction) await this.store.compact(room);
      } catch (err) {
        // Keep everything for the next attempt.
        room.pending.unshift(...updates);
        changedFiles.forEach((id) => room.changedFiles.add(id));
        room.allFiles ||= allFiles;
        this.scheduleFlush(room);
        console.error(`[synq] could not save ${room.id}:`, err.message);
        return false;
      }
    } else if (!by) {
      return true;
    }
    this.onSaved(room, by);
    return true;
  }

  /** Persists the owner, roles and settings. Resolves false when the store failed. */
  async saveMeta(room) {
    try {
      await this.store.saveMeta(room.id, room.meta);
      return true;
    } catch (err) {
      console.error(`[synq] could not save the permissions of ${room.id}:`, err.message);
      return false;
    }
  }

  /** Manual save (room:save). */
  save(room, by) {
    return this.flush(room, by);
  }

  /** Called when the last user leaves: keep the doc warm for a while, then unload. */
  release(room) {
    if (room.users.size) return;
    clearTimeout(room.unloadTimer);
    room.unloadTimer = setTimeout(() => this.unload(room), UNLOAD_AFTER_MS);
    room.unloadTimer.unref?.();
  }

  async unload(room) {
    if (room.users.size) return;
    await this.flush(room);
    await this.store.compact(room).catch((err) => console.error(`[synq] could not compact ${room.id}:`, err.message));
    if (room.users.size || room.pending.length) return; // someone came back meanwhile
    room.doc.destroy();
    this.rooms.delete(room.id);
  }

  async flushAll() {
    await Promise.all([...this.rooms.values()].map((room) => this.flush(room)));
  }
}
