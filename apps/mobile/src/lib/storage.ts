/**
 * The single place AsyncStorage is imported for persistence. Persisted zustand
 * stores build their storage from `kvStorage` so tests (Node, no native modules)
 * can alias this dependency away in vitest.config.ts.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

export const kvStorage = () => AsyncStorage;
