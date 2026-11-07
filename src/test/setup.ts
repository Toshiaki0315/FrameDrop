import "@testing-library/jest-dom/vitest";

// Node 25 ships an experimental global `localStorage` that shadows jsdom's and lacks
// the Storage API; replace it with a plain in-memory implementation for tests.
const store = new Map<string, string>();
const memoryStorage: Storage = {
  get length() {
    return store.size;
  },
  clear: () => store.clear(),
  getItem: (k) => store.get(k) ?? null,
  key: (i) => [...store.keys()][i] ?? null,
  removeItem: (k) => void store.delete(k),
  setItem: (k, v) => void store.set(k, String(v)),
};
Object.defineProperty(globalThis, "localStorage", { value: memoryStorage, configurable: true });
Object.defineProperty(window, "localStorage", { value: memoryStorage, configurable: true });
