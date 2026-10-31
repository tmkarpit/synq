import { colorForId, hexToRgba } from '@/config/collaborators';

// Per-collaborator CSS lives in ONE injected <style> element. Class names are derived
// from sanitized user ids and selectors are CSS.escape()d; colors are validated, so a
// hostile name or color can never inject CSS. Names never go into CSS at all: the
// flag label is set with textContent.

const STYLE_ID = 'synq-remote-cursor-styles';
const HEX = /^#[0-9a-f]{6}$/i;

/** Dark or white text, whichever reads better on `hex` (WCAG relative luminance). */
export function textColorFor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  // Contrast vs black (L + 0.05) / 0.05 against white 1.05 / (L + 0.05).
  return (L + 0.05) / 0.05 >= 1.05 / (L + 0.05) ? '#0B0B0C' : '#FFFFFF';
}

export const safeColor = (color, userId) => (HEX.test(color || '') ? color : colorForId(userId));

export const userClassName = (userId) =>
  `rc-u-${String(userId)
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 64)}`;

const escapeClass = (cls) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(cls) : cls);

export class RemoteCursorStyles {
  constructor() {
    this.colors = new Map(); // className -> color
    this.el = null;
  }

  /** Returns the class for this user, (re)generating CSS when the color changed. */
  classFor(userId, color) {
    const cls = userClassName(userId);
    const hex = safeColor(color, userId);
    if (this.colors.get(cls) !== hex) {
      this.colors.set(cls, hex);
      this.render();
    }
    return { cls, hex };
  }

  remove(userId) {
    if (this.colors.delete(userClassName(userId))) this.render();
  }

  render() {
    if (typeof document === 'undefined') return;
    if (!this.el) {
      this.el = document.getElementById(STYLE_ID) || document.createElement('style');
      this.el.id = STYLE_ID;
      document.head.appendChild(this.el);
    }
    this.el.textContent = [...this.colors]
      .map(([cls, hex]) => {
        const s = `.${escapeClass(cls)}`;
        return [
          `${s}.rc-caret{border-color:${hex};}`,
          `${s}.rc-caret--typing{box-shadow:0 0 6px ${hexToRgba(hex, 0.8)};}`,
          `${s}.rc-sel{background-color:${hexToRgba(hex, 0.25)};outline:1px solid ${hexToRgba(hex, 0.55)};}`,
          `${s}.rc-flag{background-color:${hex};color:${textColorFor(hex)};}`,
        ].join('');
      })
      .join('\n');
  }

  dispose() {
    this.colors.clear();
    this.el?.remove();
    this.el = null;
  }
}
