// File extension -> Monaco/Shiki language id. Also the allow-list for new file names.

export const EXTENSION_LANGUAGES = Object.freeze({
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  html: 'html',
  htm: 'html',
  css: 'css',
  json: 'json',
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  txt: 'plaintext',
});

export const LANGUAGE_LABELS = Object.freeze({
  javascript: 'JavaScript',
  jsx: 'JavaScript JSX',
  typescript: 'TypeScript',
  tsx: 'TypeScript JSX',
  html: 'HTML',
  css: 'CSS',
  json: 'JSON',
  markdown: 'Markdown',
  python: 'Python',
  java: 'Java',
  c: 'C',
  cpp: 'C++',
  plaintext: 'Plain Text',
});

/**
 * Languages runnable in the browser Worker in mock mode. JSX needs a build step, so
 * it runs (like every other language) only once the backend is connected.
 */
export const MOCK_RUNNABLE = new Set(['javascript']);

/** Languages Shiki loads for the editor (TextMate grammars, VS Code token scopes). */
export const EDITOR_LANGUAGES = Object.freeze([
  'javascript',
  'jsx',
  'typescript',
  'tsx',
  'html',
  'css',
  'json',
  'markdown',
  'python',
  'java',
  'c',
  'cpp',
]);

export function extensionOf(name = '') {
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(idx + 1).toLowerCase() : '';
}

export function languageForName(name) {
  return EXTENSION_LANGUAGES[extensionOf(name)] || 'plaintext';
}

/**
 * Validate a file or folder name. Returns null when valid, else a message.
 * siblings: names already present in the same folder.
 */
export function validateNodeName(name, { type = 'file', siblings = [] } = {}) {
  const trimmed = (name || '').trim();
  if (!trimmed) return 'Name is required.';
  if (trimmed.length > 100) return 'Name must be 100 characters or fewer.';
  if (/[\\/]/.test(trimmed)) return 'Name cannot contain slashes.';
  if (trimmed === '.' || trimmed === '..') return 'That name is reserved.';
  const hasControlChar = [...trimmed].some((ch) => ch.charCodeAt(0) < 32);
  if (hasControlChar || /[<>:"|?*]/.test(trimmed)) return 'Name contains invalid characters.';
  if (siblings.some((s) => s.toLowerCase() === trimmed.toLowerCase())) {
    return 'A file or folder with that name already exists here.';
  }
  if (type === 'file') {
    const ext = extensionOf(trimmed);
    if (!ext || !EXTENSION_LANGUAGES[ext]) {
      return `Unsupported extension. Allowed: ${Object.keys(EXTENSION_LANGUAGES).join(', ')}`;
    }
  }
  return null;
}
