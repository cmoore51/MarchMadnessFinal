// Thin wrapper around localStorage that matches the window.storage API shape
// used in the Claude artifact environment. Falls back to localStorage in a
// real browser so the app works both locally and in production.

const PREFIX = 'march_madness_';

const localAdapter = {
  async get(key) {
    try {
      const value = localStorage.getItem(PREFIX + key);
      return value != null ? { key, value } : null;
    } catch { return null; }
  },
  async set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, value);
      return { key, value };
    } catch { return null; }
  },
  async delete(key) {
    try {
      localStorage.removeItem(PREFIX + key);
      return { key, deleted: true };
    } catch { return null; }
  },
  async list(prefix = '') {
    try {
      const keys = Object.keys(localStorage)
        .filter(k => k.startsWith(PREFIX + prefix))
        .map(k => k.slice(PREFIX.length));
      return { keys };
    } catch { return { keys: [] }; }
  },
};

export const storage = typeof window !== 'undefined' && window.storage
  ? window.storage   // Claude artifact environment
  : localAdapter;    // Local dev / production