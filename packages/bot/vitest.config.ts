import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // Bot simulations and CPU benchmarks should not compete for runner cores.
    fileParallelism: false,
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
  },
});
