import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { resolveInstallPaths } from "../../scripts/install/paths.mjs";
import { renderUnits } from "../../scripts/install/systemd.mjs";

// Ubuntu CI owns the real parser check; macOS has no systemd parser.
it.skipIf(process.platform !== "linux")(
  "accepts rendered units in systemd, including spaces and literal specifiers",
  () => {
    const root = mkdtempSync(join(tmpdir(), "pythia systemd %s-"));
    try {
      const paths = resolveInstallPaths({
        HOME: root,
        PYTHIA_CHECKOUT: resolve(import.meta.dirname, "../.."),
      });
      const executable = join(root, "test executable");
      writeFileSync(executable, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
      const units = renderUnits(paths, {
        node: executable,
        python: executable,
        managedPython: executable,
        uv: executable,
        hermes: executable,
        basicMemory: executable,
        next: executable,
      });
      const files = Object.entries(units).map(([name, content]) => {
        const path = join(root, name);
        writeFileSync(path, content);
        return path;
      });
      expect(() =>
        execFileSync("systemd-analyze", ["verify", "--man=no", ...files], {
          encoding: "utf8",
          timeout: 15_000,
        }),
      ).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
