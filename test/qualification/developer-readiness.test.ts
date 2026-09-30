import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareManagedRuntime } from "../../scripts/dev/runtime.mjs";
import { resolveStackPaths } from "../../scripts/dev/paths.mjs";
import {
  cleanupReleaseFixtures,
  repositoryRoot,
  run,
  temporaryQualificationRoot,
} from "../support/release-snapshot";

afterEach(cleanupReleaseFixtures);

describe("assembled developer readiness", () => {
  it("installs the changed locked dependency before Pythia's real candidate compiler", async () => {
    const root = temporaryQualificationRoot("dependency-order");
    const fixture = join(
      repositoryRoot,
      "test/fixtures/dependency-build-order",
    );
    cpSync(fixture, root, { recursive: true });
    mkdirSync(join(root, "src"), { recursive: true });
    copyFileSync(join(root, "package-a.json"), join(root, "package.json"));
    copyFileSync(join(root, "pnpm-lock-a.yaml"), join(root, "pnpm-lock.yaml"));
    copyFileSync(join(root, "source-a.ts"), join(root, "src/index.ts"));
    const environment = {
      ...process.env,
      CI: "1",
      PATH: `${join(repositoryRoot, "node_modules/.bin")}:${process.env.PATH ?? ""}`,
      npm_config_offline: "true",
      npm_config_store_dir: join(root, "pnpm-store"),
    };
    run(
      root,
      "pnpm",
      ["install", "--offline", "--frozen-lockfile", "--ignore-scripts"],
      environment,
    );
    run(root, "pnpm", ["run", "build:runtime"], environment);
    expect(run(root, "node", ["dist/index.js"], environment)).toBe("A");

    copyFileSync(join(root, "package-b.json"), join(root, "package.json"));
    copyFileSync(join(root, "pnpm-lock-b.yaml"), join(root, "pnpm-lock.yaml"));
    copyFileSync(join(root, "source-b.ts"), join(root, "src/index.ts"));
    expect(
      JSON.parse(
        readFileSync(
          join(
            root,
            "node_modules/@pythia/qualification-contract/package.json",
          ),
          "utf8",
        ),
      ).version,
    ).toBe("1.0.0");
    const premature = spawnSync("pnpm", ["run", "build:runtime"], {
      cwd: root,
      encoding: "utf8",
      env: environment,
    });
    expect(premature.status).not.toBe(0);
    expect(`${premature.stdout}\n${premature.stderr}`).toContain(
      "candidateContract",
    );

    const commands: string[] = [];
    const runCommand = (
      command: string,
      args: string[],
      options: { cwd?: string; env?: NodeJS.ProcessEnv },
    ) => {
      commands.push(`${command} ${args.join(" ")}`);
      if (command === "uv") return "separately-qualified-native-sync";
      return run(
        options.cwd ?? root,
        command,
        args,
        options.env ?? environment,
      );
    };
    const paths = resolveStackPaths({
      environment: {
        ...environment,
        PYTHIA_DEV_REPO_ROOT: root,
        PYTHIA_DEV_CONFIG_HOME: join(root, "owners/config"),
        PYTHIA_DEV_STATE_HOME: join(root, "owners/state"),
        PYTHIA_DEV_DATA_HOME: join(root, "owners/data"),
        PYTHIA_DEV_CACHE_HOME: join(root, "owners/cache"),
      },
    });
    await prepareManagedRuntime(
      {
        ...paths,
        hermesSource: join(root, "hermes-source"),
      },
      {
        ensureHermesSource: async () => undefined,
        environment,
        runCommand,
        sourceContract: {
          install: { command: ["uv", "sync", "--frozen"] },
        },
      },
    );
    expect(commands).toEqual([
      "uv sync --frozen",
      "pnpm install --frozen-lockfile",
      "pnpm run build:runtime",
    ]);
    expect(
      JSON.parse(
        readFileSync(
          join(
            root,
            "node_modules/@pythia/qualification-contract/package.json",
          ),
          "utf8",
        ),
      ).version,
    ).toBe("2.0.0");
    expect(run(root, "node", ["dist/index.js"], environment)).toBe("B");
  }, 30_000);
});
