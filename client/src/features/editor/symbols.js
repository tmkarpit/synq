// Cheap "current symbol" lookup for the breadcrumbs (src > App.jsx > App). Scans up
// from the caret; only the caret's own line or a strictly shallower line can enclose it.

const PATTERNS = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)?|[A-Za-z_$][\w$]*)\s*(?:=>|$)/,
  /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/,
  /^\s*(?:public|private|protected|static|final|\s)+[\w<>[\],\s]+\s+([A-Za-z_]\w*)\s*\([^;]*$/,
  /^\s*[\w:<>*&\s]+\s+\**([A-Za-z_]\w*)\s*\([^;]*\)\s*\{?\s*$/,
];

const MAX_SCAN = 400;
const indentOf = (line) => line.length - line.trimStart().length;

export function findSymbolAt(model, lineNumber) {
  const current = model.getLineContent(lineNumber);
  let indent = current.trim() ? indentOf(current) : Infinity;
  const stop = Math.max(1, lineNumber - MAX_SCAN);
  for (let ln = lineNumber; ln >= stop; ln -= 1) {
    const text = model.getLineContent(ln);
    if (!text.trim()) continue;
    const lineIndent = indentOf(text);
    if (ln !== lineNumber && lineIndent >= indent) continue;
    for (const re of PATTERNS) {
      const m = re.exec(text);
      if (m && !/^(if|for|while|switch|return|catch|else)$/.test(m[1])) return m[1];
    }
    indent = Math.min(indent, lineIndent);
  }
  return null;
}
