import { defineConfig } from "playwright/test"
const vite = `"${process.execPath}" node_modules/vite/bin/vite.js`
const group = process.env.BROWSER_CHECK_GROUP
const output = group ? `test-results/${group}` : "test-results"
const chromiumLaunch = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 60_000,
  globalTimeout: 300_000,
  outputDir: output,
  reporter: [["list"], ["html", { open: "never", outputFolder: group ? `playwright-report/${group}` : "playwright-report" }], ["json", { outputFile: `${output}/results.json` }]],
  use: {
    baseURL: "http://127.0.0.1:5185",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `${vite} build --config vite.e2e.config.ts && ${vite} preview --outDir dist-e2e --host 127.0.0.1 --port 5185 --strictPort`,
    url: "http://127.0.0.1:5185/e2e/harness.html",
    reuseExistingServer: false,
    env: { GITHUB_SHA: "e2e0000" },
    timeout: 90_000,
  },
  projects: [
    { name: "desktop", use: { browserName: "chromium", launchOptions: chromiumLaunch, viewport: { width: 1280, height: 900 } } },
    { name: "mobile", use: { browserName: "chromium", launchOptions: chromiumLaunch, viewport: { width: 390, height: 844 } } },
    { name: "webkit-desktop", use: { browserName: "webkit", viewport: { width: 1280, height: 900 } } },
    { name: "webkit-mobile", use: { browserName: "webkit", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } },
  ],
})
