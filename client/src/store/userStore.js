import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { STORAGE_KEYS } from '@/config/app';
import { COLLAB_HEX } from '@/config/collaborators';

const USERNAME_PATTERN = /^[\p{L}\p{N} _.-]{2,24}$/u;

export function validateUsername(name) {
  const trimmed = (name || '').trim();
  if (trimmed.length < 2) return 'Use at least 2 characters.';
  if (trimmed.length > 24) return 'Use 24 characters or fewer.';
  if (!USERNAME_PATTERN.test(trimmed))
    return 'Letters, numbers, spaces, dots, dashes and underscores only.';
  return null;
}

export const useUserStore = create(
  persist(
    (set) => ({
      username: '',
      color: COLLAB_HEX[0],
      recentRooms: [],
      setUsername: (username) => set({ username: username.trim().slice(0, 24) }),
      setColor: (color) => set({ color: COLLAB_HEX.includes(color) ? color : COLLAB_HEX[0] }),
      rememberRoom: (roomId, name = '') =>
        set((s) => ({
          recentRooms: [
            { roomId, name, at: Date.now() },
            ...s.recentRooms.filter((r) => r.roomId !== roomId),
          ].slice(0, 5),
        })),
    }),
    {
      name: STORAGE_KEYS.user,
      version: 1,
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
