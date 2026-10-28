import { defineConfig, devices } from "@playwright/test";

// The self-test: the production build, served statically, driven in Chromium against the mock
// Dynatrace. `npm run build` first.
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://localhost:4173", trace: "retain-on-failure", ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
  webServer: [
    { command: "node mock/server.mjs 8787", url: "http://localhost:8787/e/production/api/v2/metrics", ignoreHTTPSErrors: true, reuseExistingServer: !process.env.CI, stdout: "ignore" },
    { command: "npx vite preview --port 4173 --strictPort", url: "http://localhost:4173", reuseExistingServer: !process.env.CI },
  ],
});
