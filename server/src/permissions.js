import { createHash, randomUUID } from 'node:crypto';
import * as Y from 'yjs';

// Room access: who owns a room, who may enter, who is waiting, and what the owner allows.
//
// A member is identified by `acct:<user id>` when accounts are on (src/accounts.js), and
// otherwise by a hash of a random memberKey the browser keeps in localStorage. The first
// member to open a room becomes its owner. Everyone else asks to join and the owner
// accepts or declines (unless the owner turned approval off).

export const DEFAULT_SETTINGS = Object.freeze({
  approval: true, // the owner accepts or declines everyone who asks to join
  newMembers: 'editor', // role for people who join
  ownerOnlyFiles: false, // only the owner can create and delete files and folders
  ownerOnlyRun: false, // only the owner can run code
  shell: 'owner', // who may type real commands in the terminal: 'owner' | 'editors' | 'off'
});

const MEMBER_KEY = /^[A-Za-z0-9_-]{16,64}$/;
const ROOM_NAME_MAX = 60;

/** Hash of the member key from a join, or of a throwaway one when it is missing. */
export function memberHash(key) {
  const raw = MEMBER_KEY.test(String(key || '')) ? String(key) : randomUUID();
  return createHash('sha256').update(raw).digest('hex');
}

export const accountMember = (id) => `acct:${id}`;
export const isAccountMember = (member) => typeof member === 'string' && member.startsWith('acct:');

export function cleanRoomName(name) {
  const clean = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, ROOM_NAME_MAX);
  return clean || null;
}

const asRole = (role) => (role === 'viewer' ? 'viewer' : 'editor');

/** { owner, name, members, requests, settings } with defaults for anything missing. */
export function normalizeMeta(meta) {
  const members = {};
  Object.entries(meta?.members || {}).forEach(([member, m]) => {
    members[member] = { name: String(m?.name || ''), role: asRole(m?.role) };
  });
  // Rooms saved before members existed only kept explicit roles.
  Object.entries(meta?.roles || {}).forEach(([member, role]) => {
    members[member] ??= { name: '', role: asRole(role) };
  });
  const requests = {};
  Object.entries(meta?.requests || {}).forEach(([member, r]) => {
    requests[member] = { name: String(r?.name || ''), email: r?.email ? String(r.email) : null, role: asRole(r?.role), at: Number(r?.at) || 0 };
  });
  return {
    owner: typeof meta?.owner === 'string' ? meta.owner : null,
    name: cleanRoomName(meta?.name),
    members,
    requests,
    settings: applySettings(DEFAULT_SETTINGS, meta?.settings),
    // The last push to GitHub: where to, and each file's fingerprint (Source Control
    // shows what changed since).
    github: typeof meta?.github?.repo === 'string' ? normalizeGithub(meta.github) : null,
  };
}

function normalizeGithub(g) {
  return {
    repo: g.repo,
    branch: String(g.branch || ''),
    url: typeof g.url === 'string' ? g.url : null,
    commitUrl: typeof g.commitUrl === 'string' ? g.commitUrl : null,
    pushedAt: Number(g.pushedAt) || null,
    by: typeof g.by === 'string' ? g.by : null,
    // [path, fingerprint] pairs (an array: paths contain dots, which MongoDB keys avoid).
    files: Array.isArray(g.files) ? g.files.filter((f) => Array.isArray(f) && typeof f[0] === 'string' && typeof f[1] === 'string') : null,
  };
}

/** Only known keys with the right types are taken from the patch. */
export function applySettings(current, patch = {}) {
  const next = { ...current };
  if (typeof patch.approval === 'boolean') next.approval = patch.approval;
  if (patch.newMembers === 'editor' || patch.newMembers === 'viewer') next.newMembers = patch.newMembers;
  if (typeof patch.ownerOnlyFiles === 'boolean') next.ownerOnlyFiles = patch.ownerOnlyFiles;
  if (typeof patch.ownerOnlyRun === 'boolean') next.ownerOnlyRun = patch.ownerOnlyRun;
  if (['owner', 'editors', 'off'].includes(patch.shell)) next.shell = patch.shell;
  return next;
}

/** 'owner' | 'editor' | 'viewer', or null when the member has no access yet. */
export function roleFor(meta, member) {
  if (member === meta.owner) return 'owner';
  return meta.members[member]?.role ?? null;
}

/** What the owner sees: everyone with access and everyone waiting. */
export function accessList(meta, online = new Set()) {
  return {
    members: Object.entries(meta.members)
      .map(([member, m]) => ({ member, name: m.name, role: member === meta.owner ? 'owner' : m.role, online: online.has(member) }))
      .sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : a.name.localeCompare(b.name))),
    requests: Object.entries(meta.requests)
      .map(([member, r]) => ({ member, ...r }))
      .sort((a, b) => a.at - b.at),
  };
}

const structure = (doc) =>
  JSON.stringify([
    [...doc.getMap('nodes').entries()].sort(([a], [b]) => a.localeCompare(b)),
    [...doc.getMap('texts').keys()].sort(),
  ]);

/**
 * True when the update would create, delete, rename or move a file or folder. Applied
 * to a copy, so a refused update never touches the room.
 */
export function changesStructure(doc, update) {
  const copy = new Y.Doc();
  try {
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
    const before = structure(copy);
    Y.applyUpdate(copy, update);
    return structure(copy) !== before;
  } finally {
    copy.destroy();
  }
}
