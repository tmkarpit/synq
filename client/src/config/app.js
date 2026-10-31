// Single source of truth for product identity and environment switches.

export const APP = Object.freeze({
  name: 'SYNQ',
  tagline: 'Code together. In sync.',
  description:
    'A real-time collaborative code editor. Create a room, share the ID, and edit a multi-file project together with live cursors, chat and a shared terminal.',
  // linkedin: put the profile address here (https://www.linkedin.com/in/...) to show its icon.
  author: { name: 'Arpit Tamrakar', github: 'https://github.com/tmkarpit', linkedin: 'https://www.linkedin.com/in/arpittamrakar' },
  license: 'MIT',
});

const socketUrl = (import.meta.env.VITE_SOCKET_URL || '').trim();
const useMockFlag = String(import.meta.env.VITE_USE_MOCK ?? 'true').toLowerCase() === 'true';

export const ENV = Object.freeze({
  // Empty = same origin (the Vite dev server proxies /socket.io and /api to the SYNQ server).
  socketUrl,
  apiUrl: (import.meta.env.VITE_API_URL || '').trim(),
  useMock: useMockFlag,
  isDev: import.meta.env.DEV,
});

export const LIMITS = Object.freeze({
  maxCollaborators: 20,
  maxFileNameLength: 100,
  maxChatLength: 2000,
  chatRenderCap: 200,
  desktopMinWidth: 768,
});

export const STORAGE_KEYS = Object.freeze({
  settings: 'synq:settings',
  user: 'synq:user',
  memberKey: 'synq:member-key', // proves to the server that this browser owns a room
  ui: 'synq:ui',
  preloaderSeen: 'synq:preloader-seen', // sessionStorage
  tabUserId: 'synq:tab-user-id', // sessionStorage
  tabsPrefix: 'synq:tabs:', // + roomId: open tabs and active file, restored on refresh
  mockPrefix: 'synq-mock:',
});
