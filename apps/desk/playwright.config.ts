import { defineConfig, devices } from "@playwright/test";

/**
 * Browser smoke tests run against an already running Desk. Point
 * PYTHIA_DESK_URL at this worktree's loopback Desk (see `just dev-paths`) or
 * at its Tailscale Serve origin. Nothing here starts, stops, or reconfigures
 * the development stack.
 */
const baseURL = process.env.PYTHIA_DESK_URL;
if (!baseURL) {
  throw new Error(
    "Set PYTHIA_DESK_URL to a running Desk origin, for example http://127.0.0.1:<desk port> from `just dev-paths`.",
  );
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  outputDir: "../../.local/playwright/desk",
  use: {
    baseURL,
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
});
