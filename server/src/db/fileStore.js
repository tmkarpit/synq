import fs from 'node:fs';
import path from 'node:path';
import * as Y from 'yjs';

// Fallback storage when MONGODB_URI is not set: one Yjs file per room in dataDir
// (the original behavior). Same interface as MongoStore.

export class FileStore {
  constructor({ dataDir }) {
    this.dataDir = dataDir;
    this.label = `files in ${dataDir}`;
    this.ping = async () => {}; // files are always "reachable" (readiness check)
  }

  async init() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    return 0;
  }

  file(roomId) {
    // roomId is validated by ROOM_ID_PATTERN, so it is safe as a file name.
    return path.join(this.dataDir, `${roomId}.ybin`);
  }

  async load(roomId) {
    try {
      return [fs.readFileSync(this.file(roomId))];
    } catch {
      return []; // new room
    }
  }

  async loadMeta(roomId) {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.dataDir, `${roomId}.json`), 'utf8'));
    } catch {
      return null;
    }
  }

  async saveMeta(roomId, meta) {
    const target = path.join(this.dataDir, `${roomId}.json`);
    fs.writeFileSync(`${target}.tmp`, JSON.stringify(meta));
    fs.renameSync(`${target}.tmp`, target);
  }

  /** Rewrites the whole room atomically; the update list is not needed. */
  async flush(room) {
    const target = this.file(room.id);
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, Y.encodeStateAsUpdate(room.doc));
    fs.renameSync(tmp, target);
    return { needsCompaction: false };
  }

  async compact() {}

  async close() {}
}
