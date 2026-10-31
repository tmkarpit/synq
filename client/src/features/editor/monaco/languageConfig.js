// Monaco language configurations (comments, brackets, auto-closing, indentation).
// Monaco's own language packs are not bundled (Shiki tokenizes), so these replace
// the parts of them the editor needs: Ctrl+/ comments, bracket pair colorization,
// auto-closing pairs and on-enter indentation.

const C_LIKE_BRACKETS = [
  ['{', '}'],
  ['[', ']'],
  ['(', ')'],
];

const pairs = (extra = []) => [
  { open: '{', close: '}' },
  { open: '[', close: ']' },
  { open: '(', close: ')' },
  { open: '"', close: '"', notIn: ['string'] },
  { open: "'", close: "'", notIn: ['string', 'comment'] },
  ...extra,
];

const surround = [
  { open: '{', close: '}' },
  { open: '[', close: ']' },
  { open: '(', close: ')' },
  { open: '"', close: '"' },
  { open: "'", close: "'" },
  { open: '`', close: '`' },
];

const cLike = (extraPairs = []) => ({
  comments: { lineComment: '//', blockComment: ['/*', '*/'] },
  brackets: C_LIKE_BRACKETS,
  autoClosingPairs: pairs(extraPairs),
  surroundingPairs: surround,
  indentationRules: {
    increaseIndentPattern: /^((?!\/\/).)*(\{[^}"'`]*|\([^)"'`]*|\[[^\]"'`]*)$/,
    decreaseIndentPattern: /^((?!.*?\/\*).*\*\/)?\s*[}\])].*$/,
  },
  folding: { markers: { start: /^\s*\/\/\s*#?region\b/, end: /^\s*\/\/\s*#?endregion\b/ } },
});

const JS = cLike([
  { open: '`', close: '`', notIn: ['string', 'comment'] },
  { open: '/**', close: ' */', notIn: ['string'] },
]);

const markup = {
  comments: { blockComment: ['<!--', '-->'] },
  brackets: [
    ['<!--', '-->'],
    ['{', '}'],
    ['(', ')'],
    ['[', ']'],
  ],
  autoClosingPairs: pairs(),
  surroundingPairs: [...surround, { open: '<', close: '>' }],
};

export const LANGUAGE_CONFIG = {
  javascript: JS,
  jsx: JS,
  typescript: JS,
  tsx: JS,
  java: cLike(),
  c: cLike(),
  cpp: cLike(),
  css: {
    comments: { blockComment: ['/*', '*/'] },
    brackets: C_LIKE_BRACKETS,
    autoClosingPairs: pairs(),
    surroundingPairs: surround,
  },
  json: {
    brackets: [
      ['{', '}'],
      ['[', ']'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}', notIn: ['string'] },
      { open: '[', close: ']', notIn: ['string'] },
      { open: '"', close: '"', notIn: ['string'] },
    ],
  },
  html: markup,
  markdown: {
    comments: { blockComment: ['<!--', '-->'] },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '<', close: '>', notIn: ['string'] },
    ],
  },
  python: {
    comments: { lineComment: '#', blockComment: ['"""', '"""'] },
    brackets: C_LIKE_BRACKETS,
    autoClosingPairs: pairs(),
    surroundingPairs: surround,
    onEnterRules: [
      {
        beforeText:
          /^\s*(?:def|class|for|if|elif|else|while|try|with|finally|except|async).*?:\s*$/,
        action: { indentAction: 1 }, // IndentAction.Indent
      },
    ],
  },
  plaintext: { brackets: [], autoClosingPairs: pairs() },
};
