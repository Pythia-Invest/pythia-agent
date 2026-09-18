import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

test("extended summary composes on the server with a native Next client boundary", () => {
  execFileSync(
    process.execPath,
    [
      "--conditions=react-server",
      fileURLToPath(
        new URL("./fixtures/market-presentation-rsc.cjs", import.meta.url),
      ),
    ],
    { timeout: 10_000, stdio: "pipe" },
  );
});
