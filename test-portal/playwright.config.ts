import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: process.env.PORTAL_BASE_URL ?? "http://127.0.0.1:3100",
    trace: "on-first-retry",
  },
});
