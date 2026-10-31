// Stable collaborator palette. Colors are always applied through style attributes
// (never dynamic Tailwind class names) so the JIT compiler does not need to know them.

export const COLLAB_COLORS = Object.freeze([
  { id: 'cyan', name: 'Cyan', hex: '#22D3EE' },
  { id: 'violet', name: 'Violet', hex: '#A78BFA' },
  { id: 'orange', name: 'Orange', hex: '#FB923C' },
  { id: 'green', name: 'Green', hex: '#4ADE80' },
  { id: 'pink', name: 'Pink', hex: '#F472B6' },
  { id: 'yellow', name: 'Yellow', hex: '#FACC15' },
]);

export const COLLAB_HEX = COLLAB_COLORS.map((c) => c.hex);

/** Deterministic color for an id, used when the server/mock has not assigned one. */
export function colorForId(id = '') {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return COLLAB_HEX[hash % COLLAB_HEX.length];
}

/** Pick the first palette color not already used in the room, else a hashed one. */
export function pickFreeColor(usedColors = [], preferred, fallbackId = '') {
  const used = new Set(usedColors.map((c) => c?.toUpperCase()));
  if (preferred && !used.has(preferred.toUpperCase())) return preferred;
  const free = COLLAB_HEX.find((hex) => !used.has(hex.toUpperCase()));
  return free || colorForId(fallbackId);
}

/** Convert #RRGGBB to rgba() with the given alpha. */
export function hexToRgba(hex, alpha = 1) {
  const clean = hex.replace('#', '');
  const value = parseInt(clean.length === 3 ? clean.replace(/./g, '$&$&') : clean, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function initialsOf(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
