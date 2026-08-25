import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "../test",
  testMatch: "physics-ui.spec.mjs",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: { baseURL: process.env.BASE_URL || "http://127.0.0.1:18116", trace: "retain-on-failure", screenshot: "only-on-failure" },
  outputDir: "../test-results/playwright",
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    { name: "mobile-chromium", use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 } }
  ]
});
