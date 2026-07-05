import { defineConfig } from "vitest/config";

// Logic-only tests (the Zustand store) run in Node — they never import React
// Native, so no RN transform is needed.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
  },
});
