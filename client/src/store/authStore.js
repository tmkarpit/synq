import { create } from 'zustand';
import { ENV } from '@/config/app';
import { useUserStore } from '@/store/userStore';

// The signed-in account (JWT).
//
// The access token (a 15-minute JWT) lives only in memory, never in localStorage, so a
// script injected into the page cannot read it later. The refresh token is an httpOnly
// cookie the page cannot read at all; POST /api/auth/refresh trades it for a new pair.
// A refresh is scheduled a minute before the access token expires, and every caller
// shares one refresh in flight.
//
// status: 'unknown' (checking) | 'authed' | 'guest' (signed out) | 'off' (the server has
// no accounts: offline mock mode, or a server running without a database).
//
// One browser holds one login (the refresh cookie is shared by every tab). When another
// tab logs in as someone else, this tab must not quietly become that person on its next
// refresh: `switchedTo` is set and the app asks what to do. Logging out in one tab logs
// out every tab.

const REFRESH_EARLY_MS = 60 * 1000;
const RETRY_MS = [1000, 2000, 4000, 8000];
let refreshTimer = null;
let inflight = null;
let configPromise = null;
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('synq-auth') : null;
const announce = (message) => channel?.postMessage(message);

/** Expiry time of a JWT in ms (read without verifying; the server verifies). */
const expiresAt = (token) => {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload)).exp * 1000;
  } catch {
    return 0;
  }
};

async function post(path, body = {}) {
  let res;
  try {
    res = await fetch(`${ENV.apiUrl}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw Object.assign(new Error("Can't reach the SYNQ server. Check that it is running."), {
      status: 0,
      unreachable: true,
    });
  }
  const data = await res.json().catch(() => ({}));
  // A 5xx without SYNQ's JSON comes from a proxy or gateway: the server did not answer
  // (restarting, or the connection dropped), so trying again can work.
  if (!res.ok && res.status >= 500 && !data.error)
    throw Object.assign(new Error("The SYNQ server didn't answer. Try again in a moment."), {
      status: res.status,
      unreachable: true,
    });
  if (!res.ok)
    throw Object.assign(new Error(data.error || 'Request failed.'), {
      status: res.status,
      retryIn: data.retryIn,
    });
  return data;
}

export const useAuthStore = create((set, get) => ({
  status: ENV.useMock ? 'off' : 'unknown',
  user: null,
  accessToken: null,
  switchedTo: null, // { name, email } when another tab logged in as someone else

  setSession: ({ user, accessToken }) => {
    const current = get().user;
    if (current && current.id !== user.id) {
      // The shared login now belongs to another account (logged in in another tab).
      clearTimeout(refreshTimer);
      set({ switchedTo: user, accessToken: null });
      return;
    }
    set({ status: 'authed', user, accessToken });
    useUserStore.getState().setUsername(user.name); // the name others see in rooms
    clearTimeout(refreshTimer);
    const wait = expiresAt(accessToken) - Date.now() - REFRESH_EARLY_MS;
    refreshTimer = setTimeout(
      () =>
        get()
          .refresh()
          .catch(() => {}),
      Math.max(wait, 5000),
    );
  },

  clearSession: () => {
    clearTimeout(refreshTimer);
    set({ status: 'guest', user: null, accessToken: null, switchedTo: null });
  },

  /**
   * Trades the refresh cookie for a new session. Resolves the new access token, or null
   * when there is no valid login (then you are signed out). Rejects when the server
   * cannot be reached.
   */
  refresh: () => {
    if (ENV.useMock) return Promise.resolve(null);
    inflight ??= post('/api/auth/refresh')
      .then((session) => {
        if (!session.user) {
          get().clearSession(); // not logged in
          return null;
        }
        get().setSession(session);
        return session.accessToken;
      })
      .catch((err) => {
        if (err.status === 404) set({ status: 'off', user: null, accessToken: null });
        else if (err.status === 401) get().clearSession();
        else throw err;
        return null;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  },

  /** On app start: restore the login from the refresh cookie, retrying while the server is unreachable. */
  init: async () => {
    if (get().status !== 'unknown') return;
    for (let attempt = 0; ; attempt += 1) {
      try {
        await get().refresh();
        return;
      } catch {
        await new Promise((r) => setTimeout(r, RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]));
      }
    }
  },

  login: async (email, password) =>
    get().signedIn(await post('/api/auth/login', { email, password })),

  /** Starts a sign-up. Resolves { verify }: the code was emailed; finish with verify(). */
  signup: (name, email, password, phone) =>
    post('/api/auth/signup', { name, email, password, phone }),

  /** Log in with a code: resolves { verify } (email or SMS, depending on the identifier). */
  requestCode: (identifier) => post('/api/auth/code', { identifier }),

  /** A new code for the same request. Resolves { verify }. */
  resend: (id) => post('/api/auth/resend', { id }),

  /**
   * Enters a code. Sign-up and login codes sign you in (resolves { next } when a phone
   * code was sent too); phone codes resolve { account }.
   */
  verify: async (id, code) => {
    const token = get().accessToken;
    const res = await fetch(`${ENV.apiUrl}/api/auth/verify`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ id, code }),
    }).catch(() => {
      throw Object.assign(new Error("Can't reach the SYNQ server. Check that it is running."), {
        status: 0,
      });
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok)
      throw Object.assign(new Error(data.error || 'Request failed.'), {
        status: res.status,
        retryIn: data.retryIn,
      });
    if (data.accessToken) get().signedIn(data);
    return data;
  },

  /** "Continue with Google": credential is the ID token from Google's button. */
  // The Google token can be checked more than once, so a dropped connection (server
  // restarting) is retried once instead of failing the sign-in.
  google: async (credential) => {
    try {
      return get().signedIn(await post('/api/auth/google', { credential }));
    } catch (err) {
      if (!err.unreachable) throw err;
      await new Promise((r) => setTimeout(r, 2000));
      return get().signedIn(await post('/api/auth/google', { credential }));
    }
  },

  /** What the server offers (Google client id, email/SMS codes). Cached. */
  config: () => {
    configPromise ??= fetch(`${ENV.apiUrl}/api/auth/config`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((c) => {
        if (!c) configPromise = null; // try again next time
        return c || { google: null, email: false, sms: false, devCodes: false };
      });
    return configPromise;
  },

  /** A fresh login in this tab: it becomes this browser's account, so other tabs are told. */
  signedIn: (session) => {
    set({ user: null, switchedTo: null });
    get().setSession(session);
    announce({ type: 'login', user: session.user });
  },
  logout: async () => {
    await post('/api/auth/logout').catch(() => {});
    get().clearSession();
    announce({ type: 'logout' });
  },
}));

export const getAccessToken = () => useAuthStore.getState().accessToken;

channel?.addEventListener('message', ({ data }) => {
  const { status, user } = useAuthStore.getState();
  if (data?.type === 'logout') {
    if (status === 'authed') useAuthStore.getState().clearSession();
  } else if (data?.type === 'login' && data.user) {
    if (status === 'authed' && user && user.id !== data.user.id)
      useAuthStore.setState({ switchedTo: data.user, accessToken: null });
    else if (status === 'guest')
      useAuthStore
        .getState()
        .refresh()
        .catch(() => {}); // pick up the new login
  }
});
