import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createMockAdapter } from './mockAdapter';
import { getFileText } from '../workspaceDoc';
import { seedWorkspace } from '../seed.fixture';
import { runJavaScript } from './jsRunner';

// Two adapters in one process talk over Node's BroadcastChannel exactly like two tabs.

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let room = 0;
let open = [];

function fakeRunner({ onOutput }) {
  let cancel;
  const promise = new Promise((resolve) => {
    const t = setTimeout(() => {
      onOutput('stdout', 'hi\n');
      resolve({ exitCode: 0, durationMs: 80 });
    }, 80);
    cancel = () => {
      clearTimeout(t);
      resolve({ exitCode: 130, durationMs: 0 });
    };
  });
  return { promise, cancel };
}

function peer(roomId, userId, extra = {}) {
  const doc = new Y.Doc();
  seedWorkspace(doc);
  const events = [];
  const adapter = createMockAdapter({
    roomId,
    user: { userId, username: userId, color: '#22D3EE' },
    doc,
    dispatch: (event, payload) => events.push([event, payload]),
    simulateBots: false,
    persist: false,
    joinWindowMs: 100,
    runner: fakeRunner,
    ...extra,
  });
  const p = {
    doc,
    events,
    adapter,
    of: (name) => events.filter(([e]) => e === name).map(([, d]) => d),
  };
  open.push(p);
  return p;
}

async function pair(extraB) {
  room += 1;
  const roomId = `synq-test-${String(room).padStart(4, '0')}`;
  const a = peer(roomId, 'ada');
  a.adapter.connect();
  await wait(150);
  const b = peer(roomId, 'bob', extraB);
  b.adapter.connect();
  await wait(200);
  return { a, b };
}

afterEach(() => {
  open.forEach((p) => p.adapter.disconnect());
  open = [];
});

describe('mock adapter (two tabs)', () => {
  it('assigns owner/editor roles and distinct colors', async () => {
    const { a, b } = await pair();
    const selfA = a.of('room:joined')[0].self;
    const selfB = b.of('room:joined')[0].self;
    expect(selfA.role).toBe('owner');
    expect(selfB.role).toBe('editor');
    expect(selfB.color).not.toBe(selfA.color);
    expect(b.of('room:joined')[0].users.map((u) => u.userId)).toEqual(['ada']);
    expect(a.of('user:joined').map((u) => u.userId)).toContain('bob');
  });

  it('syncs text edits both ways', async () => {
    const { a, b } = await pair();
    getFileText(a.doc, 'f-index-js').insert(0, '// from ada\n');
    await wait(30);
    expect(getFileText(b.doc, 'f-index-js').toString().startsWith('// from ada\n')).toBe(true);
    getFileText(b.doc, 'f-index-js').insert(0, '// from bob\n');
    await wait(30);
    expect(
      getFileText(a.doc, 'f-index-js').toString().startsWith('// from bob\n// from ada\n'),
    ).toBe(true);
  });

  it('seeding twice never duplicates content', async () => {
    const { a, b } = await pair();
    seedWorkspace(a.doc);
    await wait(30);
    const text = getFileText(b.doc, 'f-main-py').toString();
    expect(text.match(/def fib/g)).toHaveLength(1);
  });

  it('relays cursor, selection and typing events with the sender id', async () => {
    const { a, b } = await pair();
    b.adapter.send('cursor:move', { fileId: 'f-index-js', position: { lineNumber: 3, column: 2 } });
    b.adapter.send('typing:start', { fileId: 'f-index-js' });
    await wait(30);
    expect(a.of('cursor:move')).toEqual([
      { fileId: 'f-index-js', position: { lineNumber: 3, column: 2 }, userId: 'bob' },
    ]);
    expect(a.of('typing:start')).toEqual([{ fileId: 'f-index-js', userId: 'bob' }]);
    expect(b.of('cursor:move')).toEqual([]);
  });

  it('shares one run with everyone and politely refuses a second one', async () => {
    const { a, b } = await pair();
    a.adapter.send('run:request', { fileId: 'f-index-js' });
    await wait(20);
    b.adapter.send('run:request', { fileId: 'f-index-js' });
    await wait(150);

    for (const p of [a, b]) {
      expect(p.of('run:started')).toHaveLength(1);
      expect(p.of('run:started')[0]).toMatchObject({ userId: 'ada', path: 'src/index.js' });
      expect(p.of('run:output')).toEqual([
        expect.objectContaining({ stream: 'stdout', chunk: 'hi\n' }),
      ]);
      expect(p.of('run:result')).toEqual([expect.objectContaining({ exitCode: 0 })]);
    }
    expect(b.of('run:rejected')).toEqual([expect.objectContaining({ reason: 'busy' })]);
    expect(a.of('run:rejected')).toEqual([]);
  });

  it('refuses runs from viewers', async () => {
    const { a, b } = await pair({ role: 'viewer' });
    expect(b.of('room:joined')[0].self.role).toBe('viewer');
    b.adapter.send('run:request', { fileId: 'f-index-js' });
    await wait(30);
    expect(b.of('run:rejected')).toEqual([expect.objectContaining({ reason: 'forbidden' })]);
    expect(a.of('run:started')).toEqual([]);
  });

  it('prints a notice instead of running non-JS files', async () => {
    const { a } = await pair();
    a.adapter.send('run:request', { fileId: 'f-main-py' });
    await wait(30);
    expect(a.of('run:output')[0].chunk).toMatch(/runs once the SYNQ backend is connected/);
    expect(a.of('run:result')[0]).toMatchObject({ exitCode: null, skipped: true });
  });

  it('delivers chat to everyone and reports leaves', async () => {
    const { a, b } = await pair();
    b.adapter.send('chat:send', { text: '  hello  ' });
    await wait(30);
    expect(a.of('chat:message')[0]).toMatchObject({ userId: 'bob', text: 'hello' });
    expect(b.of('chat:message')[0]).toMatchObject({ userId: 'bob', text: 'hello' });
    b.adapter.disconnect();
    await wait(30);
    expect(a.of('user:left')).toEqual([{ userId: 'bob' }]);
  });

  it('hosts bots in exactly one tab', async () => {
    room += 1;
    const roomId = `synq-bots-${String(room).padStart(4, '0')}`;
    const a = peer(roomId, 'ada', { simulateBots: true });
    a.adapter.connect();
    await wait(150);
    const b = peer(roomId, 'bob', { simulateBots: true });
    b.adapter.connect();
    await wait(1800);
    const seenByB = [...b.of('room:joined')[0].users, ...b.of('user:joined')].filter(
      (u) => u.isBot,
    );
    const botsSeenByB = new Set(seenByB.map((u) => u.userId));
    const botsSeenByA = new Set(
      a
        .of('user:joined')
        .filter((u) => u.isBot)
        .map((u) => u.userId),
    );
    expect([...botsSeenByA].sort()).toEqual(['bot-grace', 'bot-linus']);
    expect([...botsSeenByB].sort()).toEqual(['bot-grace', 'bot-linus']);
    expect(seenByB.every((u) => u.hostId === 'ada')).toBe(true);
  });
});

describe('runJavaScript controller', () => {
  class FakeWorker {
    constructor(script) {
      this.script = script;
      this.terminated = false;
    }
    postMessage() {
      this.script(this);
    }
    emit(data) {
      if (!this.terminated) this.onmessage?.({ data });
    }
    terminate() {
      this.terminated = true;
    }
  }

  it('kills a run after the timeout', async () => {
    let worker;
    const out = [];
    const job = runJavaScript({
      code: 'while(true){}',
      timeoutMs: 50,
      onOutput: (s, c) => out.push([s, c]),
      createWorker: () => (worker = new FakeWorker(() => {})),
    });
    const res = await job.promise;
    expect(res).toMatchObject({ exitCode: 124, timedOut: true });
    expect(worker.terminated).toBe(true);
    expect(out.at(-1)[1]).toMatch(/Timed out after/);
  });

  it('caps output and stops the worker', async () => {
    let worker;
    const out = [];
    const job = runJavaScript({
      code: '',
      outputCap: 10,
      onOutput: (s, c) => out.push([s, c]),
      createWorker: () =>
        (worker = new FakeWorker((w) => {
          w.emit({ type: 'output', stream: 'stdout', chunk: '12345678\n' });
          w.emit({ type: 'output', stream: 'stdout', chunk: 'abcdefgh\n' });
          w.emit({ type: 'done', exitCode: 0 });
        })),
    });
    const res = await job.promise;
    expect(res).toMatchObject({ exitCode: 1, truncated: true });
    expect(worker.terminated).toBe(true);
    expect(out.map(([, c]) => c).join('')).toMatch(/^12345678\na\n?Output limit/);
  });
});
