import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests run against a Desk named by PYTHIA_DESK_URL (ADR 0008).
 * `just test-e2e-hermetic` (e2e/hermetic.mjs) starts this checkout's
 * production Desk build with disposable state and no Hermes and runs every
 * spec outside e2e/live; CI requires those. Specs in e2e/live need a real
 * profile: point PYTHIA_DESK_URL at this worktree's running Desk (see
 * `just dev-paths`). Nothing here starts, stops, or reconfigures the
 * development stack.
 */
const baseURL = process.env.PYTHIA_DESK_URL;
if (!baseURL) {
  throw new Error(
    "Set PYTHIA_DESK_URL to a running Desk origin, for example http://127.0.0.1:<desk port> from `just dev-paths`.",
  );
}

export default defineConfig({
  testDir: "./e2e",
  testIgnore: process.env.PYTHIA_E2E_HERMETIC ? ["live/**"] : [],
  fullyParallel: true,
  // CI runners have four CPUs; Playwright's default would use two.
  ...(process.env.CI ? { workers: 4 } : {}),
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
