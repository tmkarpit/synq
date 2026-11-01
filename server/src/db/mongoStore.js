import fs from 'node:fs';
import path from 'node:path';
import { Binary, MongoClient } from 'mongodb';
import * as Y from 'yjs';
import { allFileRows, fileRow } from '../projectFiles.js';

// MongoDB storage for rooms (and the database handle accounts.js uses).
//
//   rooms         { _id: roomId, snapshot, updateCount, meta, createdAt, updatedAt }
//                 snapshot: the whole Yjs document, compacted; meta: owner, members,
//                 requests, settings (permissions.js)
//   room_updates  { roomId, data, createdAt }: small Yjs updates since the snapshot, in
//                 _id order; folded into the snapshot every COMPACT_EVERY flushes
//   room_files    { _id: "roomId:fileId", roomId, fileId, path, content, updatedAt }:
//                 a plain-text copy of every file, to read in Compass or export
//   users, refresh_tokens, otp_codes: accounts.js and otp.js
//
// Writes are batched: everything edited in about a second becomes one room_updates
// document plus only the files that changed.

const COMPACT_EVERY = 200;
const ROOM_FILE = /^(synq-[a-z0-9]{4}-[a-z0-9]{4})\.ybin$/;
const bytes = (data) => (data instanceof Binary ? data.buffer : data);

export class MongoStore {
  /** family: 4 or 6 to reach the database over one IP version only (MONGODB_IP_FAMILY). */
  constructor({ uri, dataDir = null, compactEvery = COMPACT_EVERY, family = undefined }) {
    this.client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000, ...(family ? { family } : {}) });
    this.db = this.client.db(); // the database named in the URI (default "test")
    this.dataDir = dataDir;
    this.compactEvery = compactEvery;
    this.label = `MongoDB (${this.db.databaseName})`;
  }

  /** Connects, creates the indexes, and imports old .ybin rooms. Returns how many. */
  async init() {
    await this.client.connect();
    const { db } = this;
    await Promise.all([
      db.collection('room_updates').createIndex({ roomId: 1, _id: 1 }),
      db.collection('room_files').createIndex({ roomId: 1, path: 1 }),
      db.collection('rooms').createIndex({ 'meta.owner': 1 }),
      db.collection('users').createIndex({ emailLower: 1 }, { unique: true }),
      db.collection('users').createIndex({ phone: 1 }, { unique: true, partialFilterExpression: { phoneVerifiedAt: { $type: 'date' } } }),
      db.collection('users').createIndex({ googleSub: 1 }, { unique: true, partialFilterExpression: { googleSub: { $type: 'string' } } }),
      db.collection('refresh_tokens').createIndex({ tokenHash: 1 }, { unique: true }),
      db.collection('refresh_tokens').createIndex({ family: 1 }),
      // MongoDB deletes expired documents by itself.
      db.collection('refresh_tokens').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 86400 }),
      db.collection('otp_codes').createIndex({ target: 1, createdAt: -1 }),
      db.collection('otp_codes').createIndex({ createdAt: 1 }, { expireAfterSeconds: 86400 }),
      // Every signup, login, failed login and logout; MongoDB deletes entries after a year.
      db.collection('login_history').createIndex({ at: 1 }, { expireAfterSeconds: 365 * 86400 }),
      db.collection('login_history').createIndex({ userId: 1, at: -1 }),
      db.collection('login_history').createIndex({ email: 1, at: -1 }),
    ]);
    return this.importFiles();
  }

  async importFiles() {
    if (!this.dataDir || !fs.existsSync(this.dataDir)) return 0;
    let imported = 0;
    for (const name of fs.readdirSync(this.dataDir)) {
      const roomId = name.match(ROOM_FILE)?.[1];
      if (!roomId) continue;
      const data = fs.readFileSync(path.join(this.dataDir, name));
      const doc = new Y.Doc();
      try {
        Y.applyUpdate(doc, data);
      } catch {
        continue; // unreadable file: leave it alone
      }
      const res = await this.db.collection('rooms').updateOne(
        { _id: roomId },
        { $setOnInsert: { snapshot: data, updateCount: 0, meta: null, createdAt: new Date(), updatedAt: new Date() } },
        { upsert: true },
      );
      if (res.upsertedCount) {
        await this.writeFiles(roomId, doc, { all: true });
        imported += 1;
      }
      doc.destroy();
    }
    return imported;
  }

  /** Snapshot plus updates, in apply order. */
  async load(roomId) {
    const [room, updates] = await Promise.all([
      this.db.collection('rooms').findOne({ _id: roomId }, { projection: { snapshot: 1 } }),
      this.db.collection('room_updates').find({ roomId }).sort({ _id: 1 }).toArray(),
    ]);
    const parts = [];
    if (room?.snapshot) parts.push(bytes(room.snapshot));
    updates.forEach((u) => parts.push(bytes(u.data)));
    return parts;
  }

  async loadMeta(roomId) {
    return (await this.db.collection('rooms').findOne({ _id: roomId }, { projection: { meta: 1 } }))?.meta ?? null;
  }

  async saveMeta(roomId, meta) {
    await this.db.collection('rooms').updateOne(
      { _id: roomId },
      { $set: { meta }, $setOnInsert: { snapshot: null, updateCount: 0, createdAt: new Date(), updatedAt: new Date() } },
      { upsert: true },
    );
  }

  /** Persist the updates since the last flush. Resolves { needsCompaction }. */
  async flush(room, { updates, changedFiles, allFiles }) {
    const merged = Buffer.from(Y.mergeUpdates(updates));
    const { insertedId } = await this.db.collection('room_updates').insertOne({ roomId: room.id, data: merged, createdAt: new Date() });
    room.lastSeq = insertedId;
    const counted = await this.db.collection('rooms').findOneAndUpdate(
      { _id: room.id },
      { $inc: { updateCount: 1 }, $set: { updatedAt: new Date() }, $setOnInsert: { snapshot: null, meta: null, createdAt: new Date() } },
      { upsert: true, returnDocument: 'after' },
    );
    await this.writeFiles(room.id, room.doc, { all: allFiles, ids: changedFiles });
    return { needsCompaction: (counted?.updateCount ?? 0) >= this.compactEvery };
  }

  async writeFiles(roomId, doc, { all = false, ids = [] }) {
    const files = this.db.collection('room_files');
    const upsert = (r) =>
      files.updateOne(
        { _id: `${roomId}:${r.fileId}` },
        { $set: { roomId, fileId: r.fileId, path: r.path, content: r.content, updatedAt: new Date() } },
        { upsert: true },
      );
    if (all) {
      const rows = allFileRows(doc);
      for (const r of rows) await upsert(r);
      await files.deleteMany({ roomId, fileId: { $nin: rows.map((r) => r.fileId) } });
      return;
    }
    for (const id of ids) {
      const r = fileRow(doc, id);
      if (r) await upsert(r);
      else await files.deleteOne({ _id: `${roomId}:${id}` });
    }
  }

  /** Fold every flushed update into the snapshot and drop them. */
  async compact(room) {
    if (!room.lastSeq) return;
    const upTo = room.lastSeq;
    const snapshot = Buffer.from(Y.encodeStateAsUpdate(room.doc));
    await this.db.collection('rooms').updateOne({ _id: room.id }, { $set: { snapshot, updatedAt: new Date() } });
    await this.db.collection('room_updates').deleteMany({ roomId: room.id, _id: { $lte: upTo } });
    const left = await this.db.collection('room_updates').countDocuments({ roomId: room.id });
    await this.db.collection('rooms').updateOne({ _id: room.id }, { $set: { updateCount: left } });
  }

  async close() {
    await this.client.close();
  }
}
