import { customAlphabet } from 'nanoid';

// Lowercase alphabet without ambiguous characters (0/o, 1/l/i).
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
const part = customAlphabet(ALPHABET, 4);

export const ROOM_ID_PATTERN = /^synq-[a-z0-9]{4}-[a-z0-9]{4}$/;

/** e.g. "synq-7f3k-92ab" */
export function generateRoomId() {
  return `synq-${part()}-${part()}`;
}

/** Accepts a raw ID or a pasted invite link and returns a normalized ID or null. */
export function normalizeRoomId(input = '') {
  const value = input.trim().toLowerCase();
  const fromLink = value.match(/synq-[a-z0-9]{4}-[a-z0-9]{4}/);
  const id = fromLink ? fromLink[0] : value;
  return ROOM_ID_PATTERN.test(id) ? id : null;
}

export function isValidRoomId(id) {
  return ROOM_ID_PATTERN.test(id || '');
}

export function roomLink(roomId) {
  return `${window.location.origin}/room/${roomId}`;
}
