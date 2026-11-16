import { defineConfig } from "vitest/config";

/**
 * The CPU budget file is its own project and finishes before the simulations
 * start, so search, smartPolicy and blitz are not on the core (and have not
 * filled the worker heap) while the budget is sampled.
 *
 * `fileParallelism: false` resolves to one worker. Vitest then parks a project
 * whose groupOrder is 0 in a bucket that runs last, so the budget project is
 * group 1 and the simulations are group 2.
 */
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "budget",
          include: ["__tests__/searchBudget.test.ts"],
          fileParallelism: false,
          maxWorkers: 1,
          sequence: { concurrent: false, groupOrder: 1 },
        },
      },
      {
        extends: true,
        test: {
          name: "bot",
          include: ["__tests__/**/*.test.ts"],
          exclude: ["__tests__/searchBudget.test.ts"],
          fileParallelism: false,
          maxWorkers: 1,
          sequence: { concurrent: false, groupOrder: 2 },
        },
      },
    ],
    globals: true,
    environment: "node",
  },
});
