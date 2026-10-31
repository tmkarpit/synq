import { ENV } from '@/config/app';
import { useAuthStore } from '@/store/authStore';

/**
 * JSON request to the SYNQ API with the JWT access token. On a 401 it refreshes the token
 * once and retries. Throws an Error with { status } and the server's message on failure.
 */
export async function api(path, { method = 'GET', body } = {}) {
  const send = (token) =>
    fetch(`${ENV.apiUrl}${path}`, {
      method,
      credentials: 'include',
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  const auth = useAuthStore.getState();
  let res = await send(auth.accessToken);
  if (res.status === 401) {
    const token = await auth.refresh().catch(() => null);
    if (token) res = await send(token);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw Object.assign(new Error(data.error || 'Request failed.'), { status: res.status });
  return data;
}
