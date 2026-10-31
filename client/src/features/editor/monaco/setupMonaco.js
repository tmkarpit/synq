import '@fontsource/cascadia-code/latin-400.css';
import { EDITOR_LANGUAGES } from '@/config/languages';
import { THEME_LIST, monacoColors } from '@/config/themes';
import { LANGUAGE_CONFIG } from './languageConfig';
import { registerCompletions } from './completions';

// Lazily loads Monaco + Shiki together (this module is only reached from the room
// route, so neither touches the landing bundle).
//
// Syntax colors: Shiki TextMate grammars + the "dark-plus" theme give the same token
// scopes and colors as VS Code (import/return pink, const blue, JSX components teal...).
// Every SYNQ theme is dark-plus with only its workbench `colors` replaced.

const LANG_IMPORTS = {
  javascript: () => import('@shikijs/langs/javascript'),
  jsx: () => import('@shikijs/langs/jsx'),
  typescript: () => import('@shikijs/langs/typescript'),
  tsx: () => import('@shikijs/langs/tsx'),
  html: () => import('@shikijs/langs/html'),
  css: () => import('@shikijs/langs/css'),
  json: () => import('@shikijs/langs/json'),
  markdown: () => import('@shikijs/langs/markdown'),
  python: () => import('@shikijs/langs/python'),
  java: () => import('@shikijs/langs/java'),
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
};

const EDITOR_FONTS = ['14px "Fira Code"', '500 14px "Fira Code"', '14px "Cascadia Code"'];

let loading = null;

async function init() {
  const [
    monaco,
    { createHighlighterCore },
    { createJavaScriptRegexEngine },
    { shikiToMonaco },
    darkPlus,
  ] = await Promise.all([
    import('./monacoCore'),
    import('shiki/core'),
    import('shiki/engine/javascript'),
    import('@shikijs/monaco'),
    import('@shikijs/themes/dark-plus').then((m) => m.default),
  ]);

  const themes = THEME_LIST.map((theme) => ({
    ...darkPlus,
    name: theme.id,
    displayName: theme.label,
    colors: { ...darkPlus.colors, ...monacoColors(theme.id) },
  }));

  const highlighter = await createHighlighterCore({
    themes,
    langs: EDITOR_LANGUAGES.map((id) => LANG_IMPORTS[id]()),
    // Pure-JS regex engine: no 600KB Oniguruma WASM download.
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });

  const registered = new Set(monaco.languages.getLanguages().map((l) => l.id));
  [...EDITOR_LANGUAGES, 'plaintext'].forEach((id) => {
    if (!registered.has(id)) monaco.languages.register({ id });
    if (LANGUAGE_CONFIG[id]) monaco.languages.setLanguageConfiguration(id, LANGUAGE_CONFIG[id]);
  });

  // Defines one Monaco theme per Shiki theme and installs Shiki as the tokenizer.
  shikiToMonaco(highlighter, monaco);

  // Suggestions while typing. A room's files import each other, but the language service
  // only sees open files, so cross-file ("semantic") errors would be wrong: keep syntax
  // errors and completions, drop the semantic checks.
  const compilerOptions = {
    target: monaco.ScriptTarget.ESNext,
    module: monaco.ModuleKind.ESNext,
    moduleResolution: monaco.ModuleResolutionKind.NodeJs,
    jsx: monaco.JsxEmit.Preserve,
    allowJs: true,
    allowNonTsExtensions: true,
  };
  [monaco.javascriptDefaults, monaco.typescriptDefaults].forEach((defaults) => {
    defaults.setCompilerOptions(compilerOptions);
    defaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
    defaults.setEagerModelSync(true);
  });
  registerCompletions(monaco);

  // Monaco measures glyph widths once; measure with the real fonts, not the fallback.
  if (document.fonts?.load) {
    await Promise.allSettled(EDITOR_FONTS.map((f) => document.fonts.load(f)));
    monaco.editor.remeasureFonts();
  }
  return monaco;
}

/** Resolves to the configured monaco namespace (singleton; retried after a failure). */
export function loadMonaco() {
  loading ??= init().catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}
