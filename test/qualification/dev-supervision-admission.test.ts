import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { atomicWriteJson, readJson } from "../../scripts/dev/files.mjs";
import {
  assertPortsFree,
  processIdentity,
} from "../../scripts/dev/processes.mjs";
import { stopStack, supervise } from "../../scripts/dev/supervisor.mjs";
import {
  developmentPaths,
  ownChild,
  repositoryRoot,
  startFixture,
  temporaryRoot,
  waitUntil,
} from "../support/dev-stack";

async function runLifecycleCli(env: NodeJS.ProcessEnv, command: string) {
  const child = ownChild(
    spawn(
      process.execPath,
      [join(repositoryRoot, "scripts", "dev", "cli.mjs"), command],
      {
        cwd: repositoryRoot,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
  );
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const code = await new Promise<number | null>((resolve) => {
    child.once("close", resolve);
  });
  return { code, stderr, stdout };
}

describe("foreground supervision", () => {
  it("refuses duplicate live init and dev CLIs before any preparation mutation", async () => {
    const root = temporaryRoot();
    const fixture = startFixture(root);
    await waitUntil(() =>
      existsSync(join(fixture.paths.stateRoot, "fixture-ready")),
    );
    const fakeBin = join(root, "fake-bin");
    const commandLog = join(root, "preparation-commands.log");
    mkdirSync(fakeBin);
    for (const command of ["pnpm", "uv"]) {
      const executable = join(fakeBin, command);
      writeFileSync(
        executable,
        `#!/bin/sh\nprintf '%s\\n' '${command}' >> '${commandLog}'\nexit 75\n`,
      );
      chmodSync(executable, 0o700);
    }
    const copiedPlugin = join(
      fixture.paths.profileRoot,
      "plugins",
      "pythia",
      "plugin.yaml",
    );
    mkdirSync(dirname(copiedPlugin), { recursive: true, mode: 0o700 });
    writeFileSync(copiedPlugin, "user-visible-live-copy\n");
    const cliEnvironment = {
      ...fixture.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
    };

    for (const command of ["init", "dev"]) {
      const result = await runLifecycleCli(cliEnvironment, command);
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/live foreground owner/u);
      expect(existsSync(commandLog)).toBe(false);
      expect(readFileSync(copiedPlugin, "utf8")).toBe(
        "user-visible-live-copy\n",
      );
      expect(existsSync(fixture.paths.preparationAdmission)).toBe(false);
    }
    await stopStack(fixture.paths);
  });

  it("proves native Hermes port release before the initial launch", async () => {
    const root = temporaryRoot();
    const started = Date.now();
    const fixture = startFixture(root, {
      PYTHIA_TEST_INITIAL_HERMES_RELEASE_DELAY_MS: "300",
    });
    await waitUntil(() =>
      existsSync(join(fixture.paths.stateRoot, "fixture-ready")),
    );
    expect(Date.now() - started).toBeGreaterThanOrEqual(300);
    await stopStack(fixture.paths);
  }, 10_000);

  it("preserves ownership records when final port-release validation fails", async () => {
    const root = temporaryRoot();
    const fixture = startFixture(root, {
      PYTHIA_TEST_FINAL_RELEASE_FAILURE: "true",
    });
    const unrelated = ownChild(
      spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]),
    );
    const unrelatedPid = unrelated.pid;
    if (!unrelatedPid) throw new Error("Unrelated fixture did not start");
    await waitUntil(
      () =>
        existsSync(join(fixture.paths.stateRoot, "fixture-ready")) &&
        Boolean(processIdentity(unrelatedPid)),
    );
    const receipt = readJson(fixture.paths.receipt);
    atomicWriteJson(fixture.paths.hermesRestartRequest, {
      schema_version: 1,
      stack: fixture.paths.id,
      repository: fixture.paths.repositoryRoot,
      state_root: fixture.paths.stateRoot,
      supervisor: receipt.supervisor,
      operation: "restart-hermes",
      generation: receipt.hermes_generation,
    });

    fixture.child.kill("SIGTERM");
    await waitUntil(() => fixture.child.exitCode !== null);
    expect(fixture.child.exitCode).not.toBe(0);
    expect(existsSync(fixture.paths.receipt)).toBe(true);
    expect(existsSync(fixture.paths.hermesRestartRequest)).toBe(true);
    for (const child of receipt.children) {
      expect(processIdentity(child.pid)).toBeNull();
    }
    expect(processIdentity(unrelatedPid)).not.toBeNull();
  }, 10_000);

  it("preserves the primary failure when cleanup validation also fails", async () => {
    const paths = developmentPaths();
    mkdirSync(paths.processRoot, { recursive: true, mode: 0o700 });
    await expect(
      supervise(
        paths,
        [
          {
            name: "hermes",
            port: paths.ports.hermes,
            command: process.execPath,
            args: [
              join(
                repositoryRoot,
                "scripts",
                "dev",
                "test",
                "fixture-service.mjs",
              ),
              String(paths.ports.hermes),
              "serve",
            ],
            cwd: repositoryRoot,
            environment: process.env,
            async ready() {
              throw new Error("synthetic primary failure");
            },
          },
        ],
        {
          stdio: "ignore",
          hermesReleaseProof: async () => {},
          finalReleaseProof: async () => {
            throw new Error("synthetic cleanup proof failure");
          },
        },
      ),
    ).rejects.toThrow(
      /synthetic primary failure.*Cleanup also failed: synthetic cleanup proof failure/u,
    );
    expect(existsSync(paths.receipt)).toBe(true);
    await assertPortsFree(paths.ports);
  });
});
