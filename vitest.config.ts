import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 30000,
    // DB tests share kardata_test: run files sequentially so truncations stay safe.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
