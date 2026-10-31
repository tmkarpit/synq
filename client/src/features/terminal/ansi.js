// ANSI helpers for the xterm.js terminal. 24-bit "truecolor" for collaborator colors.

const CSI = '\x1b[';
export const RESET = `${CSI}0m`;

const wrap = (open) => (text) => `${CSI}${open}m${text}${RESET}`;
export const bold = wrap('1');
export const dim = wrap('2');
export const red = wrap('31');
export const green = wrap('32');
export const yellow = wrap('33');
export const blue = wrap('34');
export const cyan = wrap('36');
export const brightRed = wrap('91');
export const brightGreen = wrap('92');
export const brightBlack = wrap('90');

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Foreground in an exact #RRGGBB color (falls back to plain text for invalid input). */
export function truecolor(hex, text) {
  const rgb = hexToRgb(hex);
  return rgb ? `${CSI}38;2;${rgb.join(';')}m${text}${RESET}` : text;
}

/** Remove control characters (incl. ESC) from untrusted short strings such as names. */
export function sanitizeLabel(text = '') {
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  const controls = /[\u0000-\u001f\u007f-\u009f]/g;
  return String(text).replace(controls, '').slice(0, 120);
}

/** xterm needs CRLF; normalize any mix of \n and \r\n. */
export const toCrlf = (text) => String(text).replace(/\r?\n/g, '\r\n');
