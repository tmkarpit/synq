import { useEffect } from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import { applyThemeVariables } from '@/config/themes';

/** Keeps workspace CSS variables in sync with the persisted theme choice. */
export function useApplyTheme() {
  const themeId = useSettingsStore((s) => s.themeId);
  useEffect(() => {
    applyThemeVariables(themeId);
  }, [themeId]);
  return themeId;
}
