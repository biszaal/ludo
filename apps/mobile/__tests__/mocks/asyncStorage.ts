/**
 * In-memory stand-in for @react-native-async-storage/async-storage, aliased in
 * vitest.config.ts so persisted zustand stores can run in Node tests.
 */

const kv = new Map<string, string>();

export default {
  getItem: async (key: string): Promise<string | null> => kv.get(key) ?? null,
  setItem: async (key: string, value: string): Promise<void> => {
    kv.set(key, value);
  },
  removeItem: async (key: string): Promise<void> => {
    kv.delete(key);
  },
};
