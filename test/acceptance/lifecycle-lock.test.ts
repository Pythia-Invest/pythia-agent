import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupReleaseFixtures,
  repositoryRoot,
  temporaryQualificationRoot,
} from "../support/release-snapshot";

afterEach(cleanupReleaseFixtures);

const flockAvailable =
  spawnSync("flock", ["--version"], {
    stdio: "ignore",
  }).status === 0;

async function waitFor(path: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (existsSync(path)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${path}`);
}

function lockFixture() {
  const root = temporaryQualificationRoot("lifecycle-lock");
  const checkout = join(root, "checkout");
  const stateHome = join(root, "state");
  const dataHome = join(root, "data");
  const stateRoot = join(stateHome, "pythia");
  const fakeNode = join(
    dataHome,
    "pythia",
    "runtime",
    "node",
    "22.16.0",
    "bin",
    "node",
  );
  const marker = join(root, "first-command-started");
  mkdirSync(join(checkout, "scripts", "install"), {
    recursive: true,
    mode: 0o700,
  });
  mkdirSync(join(fakeNode, ".."), { recursive: true, mode: 0o700 });
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  writeFileSync(join(checkout, "scripts/install/cli.mjs"), "// fixture\n");
  writeFileSync(
    join(stateRoot, "installation.json"),
    '{"schema_version":1,"checkout":"read-by-fixture"}\n',
    { mode: 0o600 },
  );
  writeFileSync(
    fakeNode,
    [
      "#!/usr/bin/env node",
      'const fs = await import("node:fs");',
      'if (process.argv[2] === "-e") {',
      "  process.stdout.write(process.env.PYTHIA_TEST_CHECKOUT);",
      "  process.exit(0);",
      "}",
      "fs.writeFileSync(process.env.PYTHIA_TEST_LOCK_MARKER, 'started\\n');",
      "setInterval(() => {}, 1_000);",
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
  chmodSync(fakeNode, 0o700);
  return {
    environment: {
      ...process.env,
      HOME: join(root, "home"),
      XDG_DATA_HOME: dataHome,
      XDG_STATE_HOME: stateHome,
      PYTHIA_TEST_CHECKOUT: checkout,
      PYTHIA_TEST_LOCK_MARKER: marker,
    },
    marker,
  };
}

describe("installed lifecycle lock", () => {
  it("keeps read-only commands outside the mutation lock", () => {
    const source = readFileSync(join(repositoryRoot, "bin/pythia"), "utf8");
    const readOnlyDispatch = source.indexOf(
      "check-update|status|doctor|paths|auth-status|help",
    );
    const mutationLock = source.indexOf("flock -n 9");
    expect(readOnlyDispatch).toBeGreaterThan(-1);
    expect(mutationLock).toBeGreaterThan(readOnlyDispatch);
    expect(source.slice(readOnlyDispatch, mutationLock)).not.toContain(
      "rebuild",
    );
  });

  it.skipIf(!flockAvailable)(
    "refuses a second concurrent mutating command on Ubuntu",
    async () => {
      const fixture = lockFixture();
      const first = spawn(join(repositoryRoot, "bin/pythia"), ["update"], {
        env: fixture.environment,
        stdio: "ignore",
      });
      try {
        await waitFor(fixture.marker);
        const second = spawnSync(
          join(repositoryRoot, "bin/pythia"),
          ["update"],
          {
            encoding: "utf8",
            env: fixture.environment,
            timeout: 5_000,
          },
        );
        expect(second.status).toBe(1);
        expect(second.stderr).toContain(
          "Another Pythia install, update, rebuild, start, stop, or uninstall is running.",
        );
      } finally {
        first.kill("SIGTERM");
        await new Promise<void>((resolve) => {
          if (first.exitCode !== null) resolve();
          else first.once("exit", () => resolve());
        });
      }
    },
  );
});
