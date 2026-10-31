import * as Y from 'yjs';
import { nodesMap, textsMap } from './workspaceDoc';

// Sample project used by the tests. Rooms start empty; nothing in the app seeds this.
//
// The seed is written by a throwaway doc with a FIXED clientID, so every tab that seeds
// the same room produces byte-identical Yjs structs. Applying it twice (or in two tabs
// at once) is a no-op, which removes the "who seeds first" race entirely.
const SEED_CLIENT_ID = 1;

const SEED = [
  { id: 'd-src', name: 'src', type: 'folder', parentId: null },
  { id: 'd-components', name: 'components', type: 'folder', parentId: 'd-src' },
  { id: 'd-utils', name: 'utils', type: 'folder', parentId: 'd-src' },
  { id: 'd-public', name: 'public', type: 'folder', parentId: null },
  {
    id: 'f-index-js',
    name: 'index.js',
    type: 'file',
    parentId: 'd-src',
    content: `// Press Ctrl+Enter, the Run button, or type \`run\` in the terminal.
// Everyone in the room sees the same output.

const languages = ['JavaScript', 'Python', 'Java', 'C++'];

function greet(name) {
  return \`Hello, \${name}! Welcome to SYNQ.\`;
}

const fizzBuzz = (n) =>
  Array.from({ length: n }, (_, i) => {
    const k = i + 1;
    if (k % 15 === 0) return 'FizzBuzz';
    if (k % 3 === 0) return 'Fizz';
    if (k % 5 === 0) return 'Buzz';
    return k;
  });

console.log(greet('collaborator'));
console.log('FizzBuzz:', fizzBuzz(15).join(' '));
console.log(\`Supported: \${languages.length} languages\`);

// Set stdin from the terminal first:  stdin "hello from the terminal"
const input = readline();
if (input) console.log('stdin said:', input);

export default greet;
`,
  },
  {
    id: 'f-app-jsx',
    name: 'App.jsx',
    type: 'file',
    parentId: 'd-src',
    content: `import { useState } from 'react';
import Editor from './components/Editor';
import { formatName } from './utils/format';

export default function App({ room }) {
  const [users, setUsers] = useState([]);
  const online = users.filter((user) => user.online);

  const handleJoin = (user) => {
    setUsers((prev) => [...prev, { ...user, online: true }]);
  };

  return (
    <main className="app">
      <Editor roomId={room.id} readOnly={false} onJoin={handleJoin} />
      <p>{online.length} collaborators online</p>
      {online.map((user) => (
        <span key={user.id}>{formatName(user)}</span>
      ))}
    </main>
  );
}
`,
  },
  {
    id: 'f-editor-jsx',
    name: 'Editor.jsx',
    type: 'file',
    parentId: 'd-components',
    content: `import { useEffect, useRef } from 'react';

export default function Editor({ roomId, readOnly = false, onJoin }) {
  const container = useRef(null);

  useEffect(() => {
    const timeout = setTimeout(() => onJoin?.({ id: roomId, name: 'guest' }), 300);
    return () => clearTimeout(timeout);
  }, [roomId, onJoin]);

  return <div ref={container} data-room={roomId} aria-readonly={readOnly} />;
}
`,
  },
  {
    id: 'f-format-js',
    name: 'format.js',
    type: 'file',
    parentId: 'd-utils',
    content: `/** Capitalize a collaborator name for display. */
export function formatName(user) {
  const name = user?.name ?? 'anonymous';
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export const MAX_USERS = 20;
`,
  },
  {
    id: 'f-styles-css',
    name: 'styles.css',
    type: 'file',
    parentId: 'd-src',
    content: `.app {
  display: grid;
  gap: 12px;
  padding: 24px;
  color: #cccccc;
  background: #1f1f1f;
}
`,
  },
  {
    id: 'f-index-html',
    name: 'index.html',
    type: 'file',
    parentId: 'd-public',
    content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>SYNQ demo</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/App.jsx"></script>
  </body>
</html>
`,
  },
  {
    id: 'f-main-py',
    name: 'main.py',
    type: 'file',
    parentId: null,
    content: `def fib(n: int) -> list[int]:
    a, b = 0, 1
    out = []
    for _ in range(n):
        out.append(a)
        a, b = b, a + b
    return out


if __name__ == "__main__":
    print("fib:", fib(10))
`,
  },
  {
    id: 'f-main-java',
    name: 'Main.java',
    type: 'file',
    parentId: null,
    content: `public class Main {
    public static void main(String[] args) {
        System.out.println("Hello from Java in SYNQ");
    }
}
`,
  },
  {
    id: 'f-package-json',
    name: 'package.json',
    type: 'file',
    parentId: null,
    content: `{
  "name": "synq-demo",
  "version": "1.0.0",
  "type": "module",
  "main": "src/index.js"
}
`,
  },
  {
    id: 'f-readme-md',
    name: 'README.md',
    type: 'file',
    parentId: null,
    content: `# SYNQ demo project

Edit together, then run \`src/index.js\` from the terminal with \`run\`.
`,
  },
];

// Added later. Appended AFTER the original seed in the same transaction: the original
// structs stay byte-identical (rooms seeded before keep working) and these get new
// clocks. Never edit or reorder SEED or SEED_V2 entries; only append a SEED_V3.
const SEED_V2 = [
  {
    id: 'f-main-cpp',
    name: 'main.cpp',
    type: 'file',
    parentId: null,
    content: `#include <iostream>
#include <string>
#include <vector>

int main() {
    std::vector<int> scores{90, 72, 88};
    int total = 0;
    for (int s : scores) total += s;

    std::string name;
    if (!(std::cin >> name)) name = "collaborator"; // try: stdin "ada"
    std::cout << "Hello, " << name << "! Average score: " << total / scores.size() << std::endl;
    return 0;
}
`,
  },
  {
    id: 'f-main-c',
    name: 'main.c',
    type: 'file',
    parentId: null,
    content: `#include <stdio.h>

int main(void) {
    int n = 10;
    long long a = 0, b = 1;
    printf("First %d Fibonacci numbers:", n);
    for (int i = 0; i < n; i++) {
        printf(" %lld", a);
        long long next = a + b;
        a = b;
        b = next;
    }
    printf("\\n");
    return 0;
}
`,
  },
];

let seedUpdate = null;

export function buildSeedUpdate(entries = [...SEED, ...SEED_V2]) {
  const seed = new Y.Doc();
  seed.clientID = SEED_CLIENT_ID;
  seed.transact(() => {
    entries.forEach(({ content, ...node }) => {
      if (node.type === 'file') {
        const text = new Y.Text();
        text.insert(0, content);
        textsMap(seed).set(node.id, text);
      }
      nodesMap(seed).set(node.id, node);
    });
  });
  const update = Y.encodeStateAsUpdate(seed);
  seed.destroy();
  return update;
}

/** Idempotent: seeds an empty room, and is a no-op on a doc that already has the seed. */
export function seedWorkspace(doc, origin = 'seed') {
  seedUpdate ??= buildSeedUpdate();
  Y.applyUpdate(doc, seedUpdate, origin);
}
