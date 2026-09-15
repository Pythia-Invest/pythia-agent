import { defineConfig } from "vitest/config";

/** Explicit browser contract probes; ordinary unit/integration suites exclude these. */
export default defineConfig({
  resolve: { alias: { "@": new URL("../src", import.meta.url).pathname } },
  test: {
    environment: "node",
    include: ["qualification/*.browser.test.ts"],
    testTimeout: 60000,
  },
});
