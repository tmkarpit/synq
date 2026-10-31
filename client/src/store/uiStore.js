import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { STORAGE_KEYS } from '@/config/app';

export const SIDEBAR_VIEWS = Object.freeze([
  'explorer',
  'search',
  'participants',
  'chat',
  'settings',
]);
export const BOTTOM_TABS = Object.freeze(['problems', 'output', 'terminal']);

// Layout state for the workspace. Only layout preferences persist; modal flags do not.
export const useUiStore = create(
  persist(
    (set) => ({
      sidebarView: 'explorer',
      sidebarOpen: true,
      bottomPanelOpen: true,
      bottomPanelSize: 28, // percent of editor column
      bottomTab: 'terminal',
      rightPanelOpen: false,

      paletteOpen: false,
      settingsOpen: false,
      shortcutsOpen: false,
      inviteOpen: false,

      setSidebarView: (view) =>
        set((s) =>
          s.sidebarView === view && s.sidebarOpen
            ? { sidebarOpen: false }
            : { sidebarView: view, sidebarOpen: true },
        ),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      setBottomPanelOpen: (bottomPanelOpen) => set({ bottomPanelOpen }),
      toggleBottomPanel: () => set((s) => ({ bottomPanelOpen: !s.bottomPanelOpen })),
      setBottomPanelSize: (bottomPanelSize) => set({ bottomPanelSize }),
      setBottomTab: (bottomTab) => set({ bottomTab, bottomPanelOpen: true }),
      setRightPanelOpen: (rightPanelOpen) => set({ rightPanelOpen }),
      toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),

      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
      setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
      setInviteOpen: (inviteOpen) => set({ inviteOpen }),
      closeAllOverlays: () =>
        set({ paletteOpen: false, settingsOpen: false, shortcutsOpen: false, inviteOpen: false }),
    }),
    {
      name: STORAGE_KEYS.ui,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        sidebarView: s.sidebarView,
        sidebarOpen: s.sidebarOpen,
        bottomPanelOpen: s.bottomPanelOpen,
        bottomPanelSize: s.bottomPanelSize,
        bottomTab: s.bottomTab,
        rightPanelOpen: s.rightPanelOpen,
      }),
    },
  ),
);
