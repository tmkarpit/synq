import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { STORAGE_KEYS } from '@/config/app';
import { DEFAULT_THEME_ID, THEMES } from '@/config/themes';

export const FONT_FAMILIES = Object.freeze([
  { id: 'fira', label: 'Fira Code', css: '"Fira Code", "JetBrains Mono", monospace' },
  { id: 'jetbrains', label: 'JetBrains Mono', css: '"JetBrains Mono", "Fira Code", monospace' },
  { id: 'cascadia', label: 'Cascadia Code', css: '"Cascadia Code", "Fira Code", monospace' },
]);

export const CURSOR_STYLES = Object.freeze(['line', 'block', 'underline', 'line-thin']);

export const DEFAULT_SETTINGS = Object.freeze({
  themeId: DEFAULT_THEME_ID,
  fontSize: 14,
  fontFamily: 'fira',
  tabSize: 2,
  wordWrap: false,
  minimap: true,
  ligatures: true,
  cursorStyle: 'line',
  simulateCollaborators: true,
});

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

function sanitize(key, value) {
  switch (key) {
    case 'themeId':
      return THEMES[value] ? value : DEFAULT_THEME_ID;
    case 'fontSize':
      return clamp(Number(value) || DEFAULT_SETTINGS.fontSize, 10, 28);
    case 'tabSize':
      return [2, 4, 8].includes(Number(value)) ? Number(value) : 2;
    case 'fontFamily':
      return FONT_FAMILIES.some((f) => f.id === value) ? value : 'fira';
    case 'cursorStyle':
      return CURSOR_STYLES.includes(value) ? value : 'line';
    default:
      return typeof DEFAULT_SETTINGS[key] === 'boolean' ? Boolean(value) : value;
  }
}

export const useSettingsStore = create(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      setSetting: (key, value) => {
        if (!(key in DEFAULT_SETTINGS)) return;
        set({ [key]: sanitize(key, value) });
      },
      toggle: (key) =>
        set((s) => (typeof DEFAULT_SETTINGS[key] === 'boolean' ? { [key]: !s[key] } : {})),
      resetSettings: () => set({ ...DEFAULT_SETTINGS }),
    }),
    {
      name: STORAGE_KEYS.settings,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map((k) => [k, s[k]])),
    },
  ),
);

export function fontFamilyCss(id) {
  return (FONT_FAMILIES.find((f) => f.id === id) || FONT_FAMILIES[0]).css;
}
