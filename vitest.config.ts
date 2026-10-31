import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@brightloop/shared": resolve(__dirname, "packages/shared/src/index.ts"),
      "@brightloop/db": resolve(__dirname, "packages/db/src/index.ts"),
      "@brightloop/billing": resolve(__dirname, "packages/billing/src/index.ts"),
      "@brightloop/metering": resolve(__dirname, "packages/metering/src/index.ts"),
      "@brightloop/integrations": resolve(__dirname, "packages/integrations/src/index.ts"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./apps/api/test/setup.ts"],
    include: [
      "apps/api/test/**/*.{test,spec}.ts",
      "packages/**/test/**/*.{test,spec}.ts",
    ],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "tests/e2e/**",
    ],
    testTimeout: 15_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: [
        "apps/api/src/**/*.ts",
        "packages/**/src/**/*.ts",
      ],
      exclude: [
        "**/*.d.ts",
        "**/node_modules/**",
        "**/dist/**",
      ],
    },
  },
});
