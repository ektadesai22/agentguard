import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["plugin/**", "node_modules/**", "dist/**"],
    testTimeout: 20000,
  },
});
