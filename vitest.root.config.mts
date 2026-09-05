import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**"],
    include: [
      "runtime/test/**/*.test.{ts,tsx,js,mjs}",
      "test/**/*.test.{ts,tsx,js,mjs}",
    ],
    passWithNoTests: true,
  },
});
