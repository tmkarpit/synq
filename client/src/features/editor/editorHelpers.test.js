import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { transformOffset } from './YTextBinding';
import { findSymbolAt } from './symbols';
import { textColorFor, userClassName, safeColor } from './remoteCursorStyles';
import {
  createNode,
  deleteNode,
  renameNode,
  findFileByPath,
  offsetToPosition,
  pathOf,
  getNodes,
} from '@/services/collab/workspaceDoc';
import { seedWorkspace } from '@/services/collab/seed.fixture';
import { decodeRelative, encodeRelative } from '@/services/collab/relativePosition';

const fakeModel = (text) => {
  const lines = text.split('\n');
  return { getLineContent: (n) => lines[n - 1] };
};

describe('transformOffset (local caret through a remote delta)', () => {
  it('shifts for inserts before the caret, not at or after it', () => {
    expect(transformOffset(10, [{ retain: 2 }, { insert: 'abc' }])).toBe(13);
    expect(transformOffset(10, [{ retain: 10 }, { insert: 'abc' }])).toBe(10);
    expect(transformOffset(10, [{ retain: 12 }, { insert: 'abc' }])).toBe(10);
  });
  it('handles deletes before and around the caret', () => {
    expect(transformOffset(10, [{ retain: 2 }, { delete: 3 }])).toBe(7);
    expect(transformOffset(10, [{ retain: 8 }, { delete: 5 }])).toBe(8);
  });
});

describe('relative positions', () => {
  it('stay attached to the same character across concurrent inserts', () => {
    const doc = new Y.Doc();
    const text = doc.getText('t');
    text.insert(0, 'hello world');
    const rel = encodeRelative(text, 6); // before "world"
    text.insert(0, '>>> ');
    expect(decodeRelative(doc, text, rel)).toBe(10);
    expect(decodeRelative(doc, doc.getText('other'), rel)).toBeNull();
  });
});

describe('findSymbolAt', () => {
  const src = [
    'import x from "y";',
    'export default function App({ room }) {',
    '  const online = users.filter((u) => u.online);',
    '  const handleJoin = (user) => {',
    '    setUsers(user);',
    '  };',
    '  return null;',
    '}',
  ].join('\n');
  it('finds the enclosing function or arrow', () => {
    const m = fakeModel(src);
    expect(findSymbolAt(m, 3)).toBe('App');
    expect(findSymbolAt(m, 5)).toBe('handleJoin');
    expect(findSymbolAt(m, 7)).toBe('App');
    expect(findSymbolAt(m, 1)).toBeNull();
  });
  it('understands python defs', () => {
    expect(findSymbolAt(fakeModel('def fib(n):\n    return n'), 2)).toBe('fib');
  });
});

describe('remote cursor styles', () => {
  it('picks readable flag text for each palette color', () => {
    for (const hex of ['#22D3EE', '#A78BFA', '#FB923C', '#4ADE80', '#F472B6', '#FACC15']) {
      expect(textColorFor(hex)).toBe('#0B0B0C');
    }
    expect(textColorFor('#1D3A6B')).toBe('#FFFFFF');
  });
  it('never lets ids or colors inject CSS', () => {
    expect(userClassName('u-1"]{}body{display:none')).toMatch(/^rc-u-[\w-]+$/);
    expect(safeColor('red;}body{display:none', 'u-1')).toMatch(/^#[0-9A-F]{6}$/i);
  });
});

describe('workspace doc', () => {
  it('resolves paths and positions', () => {
    const doc = new Y.Doc();
    seedWorkspace(doc);
    const nodes = getNodes(doc);
    expect(pathOf(nodes, 'f-format-js')).toBe('src/utils/format.js');
    expect(findFileByPath(nodes, './src/utils/format.js')?.id).toBe('f-format-js');
    expect(findFileByPath(nodes, 'nope.js')).toBeNull();
    expect(offsetToPosition('ab\ncd', 4)).toEqual({ lineNumber: 2, column: 2 });
  });

  it('deletes a file, or a folder with everything inside it', () => {
    const doc = new Y.Doc();
    const dir = createNode(doc, { name: 'src', type: 'folder' });
    const sub = createNode(doc, { name: 'lib', type: 'folder', parentId: dir });
    const a = createNode(doc, { name: 'a.js', type: 'file', parentId: sub, content: 'a' });
    const b = createNode(doc, { name: 'b.js', type: 'file', content: 'b' });
    expect(deleteNode(doc, dir).sort()).toEqual([dir, sub, a].sort());
    expect(Object.keys(getNodes(doc))).toEqual([b]);
    expect(doc.getMap('texts').has(a)).toBe(false);
    expect(deleteNode(doc, 'missing')).toEqual([]);
  });

  it('renames a file or folder in place, keeping its content and children', () => {
    const doc = new Y.Doc();
    const dir = createNode(doc, { name: 'src', type: 'folder' });
    const file = createNode(doc, { name: 'a.js', type: 'file', parentId: dir, content: 'x' });
    expect(renameNode(doc, file, 'b.ts')).toBe(true);
    expect(renameNode(doc, dir, 'lib')).toBe(true);
    expect(pathOf(getNodes(doc), file)).toBe('lib/b.ts');
    expect(doc.getMap('texts').get(file).toString()).toBe('x');
    expect(renameNode(doc, file, 'b.ts')).toBe(false); // same name: nothing to do
    expect(renameNode(doc, 'missing', 'z.js')).toBe(false);
  });
});
