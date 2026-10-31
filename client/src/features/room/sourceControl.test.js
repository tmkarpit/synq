import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { contentHash as serverHash } from '../../../../server/src/projectFiles.js';
import { computeChanges, contentHash } from './sourceControl';

function docWith(files) {
  const doc = new Y.Doc();
  files.forEach(([id, name, content, parentId = null, type = 'file']) => {
    if (type === 'file') doc.getMap('texts').set(id, new Y.Text(content));
    doc.getMap('nodes').set(id, { id, name, type, parentId });
  });
  return doc;
}

describe('Source Control', () => {
  it('fingerprints files exactly like the server', () => {
    ['', 'console.log(1)', 'héllo ✓ 😀\n'.repeat(50)].forEach((text) =>
      expect(contentHash(text)).toBe(serverHash(text)),
    );
    expect(contentHash('a')).not.toBe(contentHash('b'));
  });

  it('lists modified, added and deleted files since the last push', () => {
    const baseline = [
      ['index.html', contentHash('<h1>Hi</h1>')],
      ['src/app.js', contentHash('old')],
      ['gone.css', contentHash('x')],
    ];
    const doc = docWith([
      ['f1', 'index.html', '<h1>Hi</h1>'],
      ['d1', 'src', '', null, 'folder'],
      ['f2', 'app.js', 'new', 'd1'],
      ['f3', 'new.txt', ''],
      ['d2', 'node_modules', '', null, 'folder'],
      ['f4', 'x.js', '', 'd2'],
    ]);
    expect(computeChanges(doc, baseline)).toEqual([
      { path: 'gone.css', id: null, status: 'D' },
      { path: 'new.txt', id: 'f3', status: 'A' },
      { path: 'src/app.js', id: 'f2', status: 'M' },
    ]);
    expect(computeChanges(doc, null)).toEqual([]);
  });
});
