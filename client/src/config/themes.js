// Workspace themes. All themes share the Dark Modern syntax colors (Shiki "dark-plus"
// token rules); only workbench colors change. The same objects feed CSS variables
// (chrome), the Monaco themes (monacoColors) and the terminal (terminalTheme), so the
// editor, the UI and the terminal never drift apart.

export const SYNTAX = Object.freeze({
  keyword: '#569CD6', // const, let, function, class, new
  control: '#C586C0', // import, export, from, return, if, else
  string: '#CE9178',
  func: '#DCDCAA',
  variable: '#9CDCFE', // variables and JSX props
  type: '#4EC9B0', // types and JSX components
  number: '#B5CEA8',
  comment: '#6A9955',
  tag: '#569CD6',
  punctuation: '#808080',
  regex: '#D16969',
});

// The id is kept for saved settings; the look is SYNQ's own "Studio" (floating panels
// on a darker canvas, violet accent) with VS Code Dark Modern syntax colors.
const darkModern = {
  id: 'synq-dark-modern',
  label: 'SYNQ Studio',
  colors: {
    canvas: '#0B0C10',
    editorBg: '#15161C',
    panel: '#111218',
    border: '#22242D',
    text: '#D4D6DD',
    muted: '#8A8E9B',
    accent: '#7C5CFF',
    selectedRow: '#211E36',
    hover: '#1B1C24',
    lineNumber: '#4D5161',
    lineNumberActive: '#C9CBD4',
    cursor: '#A78BFA',
    lineHighlight: '#FFFFFF07',
    selection: '#3A336B',
    inactiveSelection: '#28263F',
    indentGuide: '#272934',
    indentGuideActive: '#4B4F61',
    widget: '#191A21',
    minimap: '#15161C',
    brackets: ['#FFD700', '#DA70D6', '#179FFF'],
  },
};

const midnightNavy = {
  id: 'synq-midnight-navy',
  label: 'Midnight Navy',
  colors: {
    ...darkModern.colors,
    canvas: '#03060C',
    editorBg: '#060B14',
    panel: '#0A1220',
    border: '#16233A',
    accent: '#4C8DFF',
    selectedRow: '#14243F',
    hover: '#0F1B30',
    lineHighlight: '#4C8DFF0D',
    selection: '#1D3A6B',
    inactiveSelection: '#17284A',
    indentGuide: '#1C2C47',
    indentGuideActive: '#3A5583',
    widget: '#0B1424',
    minimap: '#060B14',
  },
};

const carbon = {
  id: 'synq-carbon',
  label: 'Carbon',
  colors: {
    ...darkModern.colors,
    canvas: '#16191F',
    editorBg: '#1E2229',
    panel: '#232830',
    border: '#313844',
    accent: '#22D3EE',
    selectedRow: '#333B47',
    hover: '#2B313B',
    lineHighlight: '#22D3EE0A',
    selection: '#24505C',
    inactiveSelection: '#353C48',
    indentGuide: '#363E4A',
    indentGuideActive: '#5A6575',
    widget: '#252B34',
    minimap: '#1E2229',
  },
};

const monoInk = {
  id: 'synq-mono-ink',
  label: 'Mono Ink',
  colors: {
    ...darkModern.colors,
    canvas: '#000000',
    editorBg: '#0A0A0A',
    panel: '#050505',
    border: '#262626',
    text: '#E5E5E5',
    muted: '#8A8A8A',
    accent: '#FF9F6B',
    selectedRow: '#262626',
    hover: '#171717',
    lineNumber: '#525252',
    lineNumberActive: '#E5E5E5',
    lineHighlight: '#FFFFFF08',
    selection: '#3F3F46',
    inactiveSelection: '#27272A',
    indentGuide: '#262626',
    indentGuideActive: '#525252',
    widget: '#111111',
    minimap: '#0A0A0A',
  },
};

export const THEMES = Object.freeze({
  [darkModern.id]: darkModern,
  [midnightNavy.id]: midnightNavy,
  [carbon.id]: carbon,
  [monoInk.id]: monoInk,
});

export const THEME_LIST = Object.values(THEMES);
export const DEFAULT_THEME_ID = darkModern.id;

/** VS Code Dark Modern workbench color keys for Monaco, derived from a SYNQ theme. */
export function monacoColors(themeId) {
  const c = getTheme(themeId).colors;
  return {
    'editor.background': c.editorBg,
    'editor.foreground': c.text,
    'editor.lineHighlightBackground': c.lineHighlight,
    'editor.lineHighlightBorder': '#00000000',
    'editorLineNumber.foreground': c.lineNumber,
    'editorLineNumber.activeForeground': c.lineNumberActive,
    'editorCursor.foreground': c.cursor,
    'editor.selectionBackground': c.selection,
    'editor.inactiveSelectionBackground': c.inactiveSelection,
    'editorIndentGuide.background1': c.indentGuide,
    'editorIndentGuide.activeBackground1': c.indentGuideActive,
    'editorBracketHighlight.foreground1': c.brackets[0],
    'editorBracketHighlight.foreground2': c.brackets[1],
    'editorBracketHighlight.foreground3': c.brackets[2],
    'editorBracketHighlight.unexpectedBracket.foreground': '#FF1212CC',
    'editorGutter.background': c.editorBg,
    'editorWidget.background': c.widget,
    'editorWidget.border': c.border,
    'editorSuggestWidget.background': c.widget,
    'editorSuggestWidget.border': c.border,
    'editorHoverWidget.background': c.widget,
    'editorHoverWidget.border': c.border,
    'editorStickyScroll.background': c.editorBg,
    'editorStickyScrollHover.background': c.hover,
    'editorOverviewRuler.border': '#00000000',
    'minimap.background': c.minimap,
    'scrollbarSlider.background': '#79797966',
    'scrollbarSlider.hoverBackground': '#646464B3',
    'scrollbarSlider.activeBackground': '#BFBFBF66',
    // The editor's right-click menu (Open with Live Server, Cut, Copy, ...).
    'menu.background': c.widget,
    'menu.foreground': c.text,
    'menu.border': c.border,
    'menu.selectionBackground': c.accent,
    'menu.selectionForeground': '#FFFFFF',
    'menu.separatorBackground': c.border,
    'widget.shadow': '#00000080',
    focusBorder: c.accent,
    'input.background': c.panel,
    'input.border': c.border,
  };
}

/** VS Code terminal ANSI palette (shared by every theme). */
export const TERMINAL_ANSI = Object.freeze({
  black: '#000000',
  red: '#CD3131',
  green: '#0DBC79',
  yellow: '#E5E510',
  blue: '#2472C8',
  magenta: '#BC3FBC',
  cyan: '#11A8CD',
  white: '#E5E5E5',
  brightBlack: '#666666',
  brightRed: '#F14C4C',
  brightGreen: '#23D18B',
  brightYellow: '#F5F543',
  brightBlue: '#3B8EEA',
  brightMagenta: '#D670D6',
  brightCyan: '#29B8DB',
  brightWhite: '#E5E5E5',
});

/** xterm.js theme: panel background, workbench text, VS Code ANSI colors. */
export function terminalTheme(themeId) {
  const c = getTheme(themeId).colors;
  return {
    ...TERMINAL_ANSI,
    background: c.panel,
    foreground: c.text,
    cursor: c.text,
    cursorAccent: c.panel,
    selectionBackground: c.selection,
  };
}

/** Short aliases accepted by the terminal "theme <name>" command (Phase 5). */
export const THEME_ALIASES = Object.freeze({
  dark: darkModern.id,
  studio: darkModern.id,
  'dark-modern': darkModern.id,
  navy: midnightNavy.id,
  midnight: midnightNavy.id,
  carbon: carbon.id,
  mono: monoInk.id,
  ink: monoInk.id,
});

export function getTheme(id) {
  return THEMES[id] || THEMES[DEFAULT_THEME_ID];
}

/** Write the workbench colors of a theme as CSS variables on :root. */
export function applyThemeVariables(themeId, root = document.documentElement) {
  const { colors } = getTheme(themeId);
  const vars = {
    '--ws-canvas': colors.canvas,
    '--ws-editor-bg': colors.editorBg,
    '--ws-panel': colors.panel,
    '--ws-border': colors.border,
    '--ws-text': colors.text,
    '--ws-muted': colors.muted,
    '--ws-accent': colors.accent,
    '--ws-selected': colors.selectedRow,
    '--ws-hover': colors.hover,
    '--ws-widget': colors.widget,
  };
  Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
  root.dataset.wsTheme = themeId;
}
