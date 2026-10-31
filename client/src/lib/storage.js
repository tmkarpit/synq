// Safe wrappers: storage can throw in private mode or when blocked.

function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export const local = {
  get(key, fallback = null) {
    return safe(() => {
      const raw = window.localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    }, fallback);
  },
  set(key, value) {
    safe(() => window.localStorage.setItem(key, JSON.stringify(value)));
  },
  remove(key) {
    safe(() => window.localStorage.removeItem(key));
  },
  keys(prefix = '') {
    return safe(() => {
      const list = [];
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(prefix)) list.push(k);
      }
      return list;
    }, []);
  },
};

export const session = {
  get(key, fallback = null) {
    return safe(() => {
      const raw = window.sessionStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    }, fallback);
  },
  set(key, value) {
    safe(() => window.sessionStorage.setItem(key, JSON.stringify(value)));
  },
};
