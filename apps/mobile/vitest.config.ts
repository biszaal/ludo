import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Logic-only tests (the Zustand stores) run in Node — they never import React
// Native. AsyncStorage (a native module) is aliased to an in-memory mock so
// persisted stores stay testable.
export default defineConfig({
  resolve: {
    alias: {
      "@react-native-async-storage/async-storage": fileURLToPath(
        new URL("./__tests__/mocks/asyncStorage.ts", import.meta.url),
      ),
      // Native module — the wallet store imports lib/purchases transitively.
      "react-native-purchases": fileURLToPath(new URL("./__tests__/mocks/purchases.ts", import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
  },
});
