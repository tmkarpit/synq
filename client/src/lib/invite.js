import { ENV } from '@/config/app';
import { roomLink } from '@/lib/roomId';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
let lanOrigin; // cached: undefined = not asked yet, null = none found

/**
 * Invite link for a room. "localhost" only works on your own machine, so in live mode
 * the server's LAN address is used instead (same port as this page).
 * `role` 'viewer' adds ?role=viewer (read-only).
 */
export async function inviteLink(roomId, role = 'editor') {
  const base = await baseLink(roomId);
  return role === 'viewer' ? `${base}?role=viewer` : base;
}

async function baseLink(roomId) {
  const { protocol, hostname, port } = window.location;
  if (ENV.useMock || !LOCAL_HOSTS.has(hostname)) return roomLink(roomId);
  if (lanOrigin === undefined) {
    try {
      const res = await fetch(`${ENV.apiUrl}/api/lan`);
      const { addresses = [] } = await res.json();
      lanOrigin = addresses[0] ? `${protocol}//${addresses[0]}${port ? `:${port}` : ''}` : null;
    } catch {
      lanOrigin = null;
    }
  }
  return lanOrigin ? `${lanOrigin}/room/${roomId}` : roomLink(roomId);
}
