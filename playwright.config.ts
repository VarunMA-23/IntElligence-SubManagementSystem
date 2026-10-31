import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e/specs",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  workers: process.env["CI"] ? 1 : undefined,
  reporter: [["html", { open: "never" }], ["list"]],

  use: {
    baseURL: "http://localhost:8080",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: [
    {
      command: "pnpm --filter @brightloop/api dev",
      url: "http://localhost:8081/health",
      reuseExistingServer: !process.env["CI"],
      timeout: 60_000,
      env: {
        NODE_ENV: "test",
        USE_MEMORY_DB: "true",
        PORT: "8081",
        LOG_LEVEL: "error",
      },
    },
    {
      command: "pnpm --filter @brightloop/web dev",
      url: "http://localhost:8080",
      reuseExistingServer: !process.env["CI"],
      timeout: 60_000,
    },
  ],
});
