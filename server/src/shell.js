import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as Y from 'yjs';
import { pathOf } from './projectFiles.js';

// The room terminal's real shell.
//
// Every room has a folder on the server (WORKSPACES_DIR/<roomId>). Before a command, the
// room's files are written there; the command runs in it (PowerShell on Windows, sh
// elsewhere); afterwards, files the command created, changed or deleted are copied back
// into the room's Y.Doc, so everyone sees them in the file tree.
//
// Folders such as node_modules stay on the server only: they hold thousands of files
// nobody edits. Commands still find them (node index.js after npm install works).
//
// NOT sandboxed: commands run with the server user's permissions. The room owner decides
// who may use it (settings.shell), and SHELL_ENABLED=false turns it off for the server.

export const SHELL_TIMEOUT_MS = 10 * 60 * 1000;
export const SHELL_OUTPUT_CAP = 1024 * 1024;
export const IGNORED_DIRS = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', '.next', '.cache', '.npm', 'target']);
const MAX_SYNC_BYTES = 512 * 1024; // bigger files stay on the server
const MAX_NEW_FILES = 500; // per command, so one command cannot flood the room
const IS_WIN = process.platform === 'win32';
const SECRET_ENV = /SECRET|TOKEN|PASSWORD|DATABASE_URL|MONGODB|_URI$|SMTP_PASS|COOKIE|_KEY$/i;

/**
 * The server's environment minus anything secret (database URL, JWT key, ...). git must
 * not look above the workspaces for a repository (it would find the server's own).
 */
function shellEnv(root) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !SECRET_ENV.test(k)));
  return {
    ...env,
    GIT_CEILING_DIRECTORIES: root,
    NO_UPDATE_NOTIFIER: '1',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
    FORCE_COLOR: '0',
  };
}

function shellCommand(command) {
  if (IS_WIN) {
    // UTF-8 output; no progress bars (they redraw lines a plain stream cannot show).
    // The last lines pass on the real exit code (npm, node, git report it in $LASTEXITCODE).
    const script = [
      "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'; $LASTEXITCODE=0",
      command,
      '$synqOk = $?; if ($LASTEXITCODE) { exit $LASTEXITCODE } elseif (-not $synqOk) { exit 1 }',
    ].join('\n');
    return ['powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script]];
  }
  return ['/bin/sh', ['-c', command]];
}

function killTree(child) {
  if (child.exitCode !== null) return;
  if (IS_WIN) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

const toPosix = (p) => p.split(path.sep).join('/');

/** The absolute path of `rel` inside `root`, or null when it would land outside it. */
function inside(root, rel) {
  const full = path.resolve(root, rel);
  const back = path.relative(root, full);
  return back && !back.startsWith('..') && !path.isAbsolute(back) ? full : null;
}
// npm keeps bookkeeping dot-files (.package-lock.json) even in an empty node_modules.
const hasContent = async (dir) => (await fs.promises.readdir(dir).catch(() => [])).some((n) => !n.startsWith('.'));
const isText = (buf) => !buf.subarray(0, 8000).includes(0);

/* -------------------------------------------------------------- doc <-> disk */

/** path -> content for every file in the doc, and the folder paths. */
function docFiles(doc) {
  const nodes = doc.getMap('nodes');
  const texts = doc.getMap('texts');
  const files = new Map();
  const folders = new Set();
  nodes.forEach((node, id) => {
    const p = pathOf(nodes, id);
    if (node.type === 'folder') folders.add(p);
    else if (texts.get(id)) files.set(p, texts.get(id).toString());
  });
  return { files, folders };
}

/** path -> content of synced files on disk, plus folders and the ignored folders found. */
async function scanDisk(root) {
  const files = new Map();
  const folders = new Set();
  const hidden = new Set();
  const skipped = [];
  const walk = async (dir, depth) => {
    if (depth > 20) return;
    let entries = [];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = toPosix(path.relative(root, full));
      if (e.isDirectory()) {
        if (IGNORED_DIRS.has(e.name)) {
          if (await hasContent(full)) hidden.add(rel);
          continue;
        }
        folders.add(rel);
        await walk(full, depth + 1);
      } else if (e.isFile()) {
        const stat = await fs.promises.stat(full);
        if (stat.size > MAX_SYNC_BYTES) {
          skipped.push(rel);
          continue;
        }
        const buf = await fs.promises.readFile(full);
        if (!isText(buf)) {
          skipped.push(rel);
          continue;
        }
        files.set(rel, buf.toString('utf8'));
      }
    }
  };
  await walk(root, 0);
  return { files, folders, hidden: [...hidden], skipped };
}

/** Replaces a Y.Text's content by changing only the part that differs. */
function setText(ytext, next) {
  const current = ytext.toString();
  if (current === next) return;
  let start = 0;
  while (start < current.length && start < next.length && current[start] === next[start]) start += 1;
  let endA = current.length;
  let endB = next.length;
  while (endA > start && endB > start && current[endA - 1] === next[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  if (endA > start) ytext.delete(start, endA - start);
  if (endB > start) ytext.insert(start, next.slice(start, endB));
}

/**
 * Removes empty folders the doc no longer has (renamed or deleted in the explorer), so
 * the next command does not bring them back. Server-only folders are left alone.
 */
async function pruneEmptyDirs(root, dir, keep) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
  let empty = true;
  for (const e of entries) {
    if (e.isDirectory() && !IGNORED_DIRS.has(e.name)) {
      if (!(await pruneEmptyDirs(root, path.join(dir, e.name), keep))) empty = false;
    } else {
      empty = false;
    }
  }
  const rel = toPosix(path.relative(root, dir));
  if (dir === root || !empty || keep.has(rel)) return false;
  await fs.promises.rmdir(dir).catch(() => {});
  return true;
}

export class Shell {
  /** root: folder holding one workspace folder per room. */
  constructor({ root }) {
    this.root = root;
  }

  dir(roomId) {
    return path.join(this.root, roomId); // roomId is validated by ROOM_ID_PATTERN
  }

  manifestFile(roomId) {
    return path.join(this.root, `${roomId}.manifest.json`);
  }

  async loadManifest(roomId) {
    try {
      return new Map(Object.entries(JSON.parse(await fs.promises.readFile(this.manifestFile(roomId), 'utf8'))));
    } catch {
      return new Map();
    }
  }

  async saveManifest(roomId, files) {
    await fs.promises.writeFile(this.manifestFile(roomId), JSON.stringify(Object.fromEntries(files)));
  }

  /**
   * Writes the doc's files to the workspace folder. Files the doc deleted since the last
   * command are deleted on disk too. Returns what is on disk now (the manifest).
   */
  async materialize(roomId, doc) {
    const dir = this.dir(roomId);
    // npm uses the nearest folder above that has a package.json OR a node_modules folder.
    // Without this one it would climb out of the room and install into the SYNQ server.
    await fs.promises.mkdir(path.join(dir, 'node_modules'), { recursive: true });
    const previous = await this.loadManifest(roomId);
    const { files, folders } = docFiles(doc);
    // Names are checked when they enter the room (tree.js); rooms saved before that check
    // could still hold a name like "../x", so every path is contained here as well.
    for (const rel of [...files.keys()]) if (!inside(dir, rel)) files.delete(rel);
    for (const folder of folders) {
      const full = inside(dir, folder);
      if (full) await fs.promises.mkdir(full, { recursive: true });
    }
    for (const [rel, content] of files) {
      const full = inside(dir, rel);
      const onDisk = await fs.promises.readFile(full, 'utf8').catch(() => null);
      if (onDisk !== content) {
        await fs.promises.mkdir(path.dirname(full), { recursive: true });
        await fs.promises.writeFile(full, content);
      }
    }
    for (const rel of previous.keys()) {
      const full = inside(dir, rel);
      if (full && !files.has(rel)) await fs.promises.rm(full, { force: true });
    }
    await pruneEmptyDirs(dir, dir, folders);
    await this.saveManifest(roomId, files);
    return files;
  }

  /**
   * Copies what the command changed on disk into the doc (one transaction, origin
   * 'shell'). Returns { added, changed, removed, hidden, skipped } (paths).
   */
  async importChanges(roomId, doc, before) {
    const dir = this.dir(roomId);
    const after = await scanDisk(dir);
    const nodes = doc.getMap('nodes');
    const texts = doc.getMap('texts');
    const result = { added: [], changed: [], removed: [], hidden: after.hidden, skipped: after.skipped };

    const byPath = new Map();
    nodes.forEach((node, id) => byPath.set(pathOf(nodes, id), { id, node }));
    const folderId = (rel) => {
      if (!rel || rel === '.') return null;
      const existing = byPath.get(rel);
      if (existing?.node.type === 'folder') return existing.id;
      const id = `d-${randomUUID().slice(0, 10)}`;
      const node = { id, name: path.posix.basename(rel), type: 'folder', parentId: folderId(path.posix.dirname(rel)) };
      nodes.set(id, node);
      byPath.set(rel, { id, node });
      return id;
    };

    doc.transact(() => {
      for (const [rel, content] of after.files) {
        const known = byPath.get(rel);
        if (known && known.node.type === 'file') {
          // Only what the command changed; edits made in the editor meanwhile stay.
          if (before.get(rel) !== content && texts.get(known.id)) {
            setText(texts.get(known.id), content);
            result.changed.push(rel);
          }
        } else if (!known && result.added.length < MAX_NEW_FILES) {
          const id = `f-${randomUUID().slice(0, 10)}`;
          const text = new Y.Text();
          text.insert(0, content);
          texts.set(id, text);
          const node = { id, name: path.posix.basename(rel), type: 'file', parentId: folderId(path.posix.dirname(rel)) };
          nodes.set(id, node);
          byPath.set(rel, { id, node });
          result.added.push(rel);
        }
      }
      for (const folder of after.folders) folderId(folder);
      for (const rel of before.keys()) {
        const known = byPath.get(rel);
        if (!after.files.has(rel) && !after.skipped.includes(rel) && known?.node.type === 'file') {
          nodes.delete(known.id);
          texts.delete(known.id);
          result.removed.push(rel);
        }
      }
    }, 'shell');

    await this.saveManifest(roomId, docFiles(doc).files);
    return result;
  }

  /**
   * Server-only folders (node_modules, .git, ...) anywhere in the workspace, as paths. They
   * are shown in the file tree read-only and listed on demand, never copied into the doc.
   */
  async serverDirs(roomId) {
    const root = this.dir(roomId);
    const found = [];
    const walk = async (dir, depth) => {
      if (depth > 8) return;
      const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const full = path.join(dir, e.name);
        if (IGNORED_DIRS.has(e.name)) {
          // The empty node_modules every room has (it keeps npm in the room) is not shown.
          if (await hasContent(full)) found.push(toPosix(path.relative(root, full)));
        } else await walk(full, depth + 1);
      }
    };
    await walk(root, 0);
    return found.sort();
  }

  /**
   * One level of a server-only folder, for the file tree: { entries: [{ name, type }],
   * truncated }. Only paths inside such a folder, and inside the workspace, are allowed.
   */
  async listServerDir(roomId, rel) {
    const root = this.dir(roomId);
    const clean = String(rel || '').replace(/\\/g, '/');
    if (!clean.split('/').some((part) => IGNORED_DIRS.has(part))) return { error: 'Not a server folder.' };
    const full = path.resolve(root, clean);
    const back = path.relative(root, full);
    if (!back || back.startsWith('..') || path.isAbsolute(back)) return { error: 'Not a server folder.' };
    const entries = await fs.promises.readdir(full, { withFileTypes: true }).catch(() => null);
    if (!entries) return { error: 'That folder is gone.' };
    const list = entries
      .map((e) => ({ name: e.name, type: e.isDirectory() ? 'folder' : 'file' }))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1));
    return { entries: list.slice(0, 1000), truncated: list.length > 1000 };
  }

  hasFile(roomId, cwd, name) {
    const full = inside(this.dir(roomId), path.join(cwd || '', name));
    return !!full && fs.existsSync(full);
  }

  removeFile(roomId, cwd, name) {
    const full = inside(this.dir(roomId), path.join(cwd || '', name));
    if (full) fs.rmSync(full, { force: true });
  }

  /** Resolves `cd <target>` from cwd (both relative to the workspace). Null when outside it. */
  resolveCd(roomId, cwd, target) {
    const root = this.dir(roomId);
    const next = path.resolve(root, cwd, target || '.');
    const rel = path.relative(root, next);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
    if (!fs.existsSync(next) || !fs.statSync(next).isDirectory()) return undefined;
    return toPosix(rel);
  }

  /**
   * Runs one command in the room's folder.
   * @returns {{ promise: Promise<{ exitCode, durationMs, timedOut, cancelled }>, cancel(): void }}
   */
  exec({ roomId, cwd = '', command, onOutput, timeoutMs = SHELL_TIMEOUT_MS }) {
    const [cmd, args] = shellCommand(command);
    const startedAt = Date.now();
    let bytes = 0;
    let timedOut = false;
    let cancelled = false;
    const child = spawn(cmd, args, {
      cwd: path.join(this.dir(roomId), cwd),
      env: shellEnv(this.root),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: !IS_WIN,
    });
    const onData = (stream) => (buf) => {
      if (bytes >= SHELL_OUTPUT_CAP) return;
      bytes += buf.length;
      onOutput(stream, buf.toString('utf8'));
      if (bytes >= SHELL_OUTPUT_CAP) onOutput('stderr', `\n(output over ${SHELL_OUTPUT_CAP / 1024}KB is not shown)\n`);
    };
    child.stdout.on('data', onData('stdout'));
    child.stderr.on('data', onData('stderr'));
    const timer = setTimeout(() => {
      timedOut = true;
      onOutput('stderr', `\nStopped after ${timeoutMs / 60000} minutes.\n`);
      killTree(child);
    }, timeoutMs);

    const promise = new Promise((resolve) => {
      let settled = false;
      const done = (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // Windows reports some failures as huge numbers (npm's -4058 as 4294963238): show 1.
        const normal = code == null || code < 0 || code > 255 ? 1 : code;
        resolve({ exitCode: timedOut ? 124 : cancelled ? 130 : normal, durationMs: Date.now() - startedAt, timedOut, cancelled });
      };
      child.on('close', done);
      child.on('error', (err) => {
        onOutput('stderr', `Could not start the shell: ${err.message}\n`);
        done(127);
      });
    });
    return {
      promise,
      cancel: () => {
        cancelled = true;
        killTree(child);
      },
    };
  }
}
