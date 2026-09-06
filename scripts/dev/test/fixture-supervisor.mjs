#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveStackPaths } from "../paths.mjs";
import { assertPortsFree } from "../processes.mjs";
import { hermesReady, supervise } from "../supervisor.mjs";

const paths = resolveStackPaths();
const fixture = join(
  process.env.PYTHIA_TEST_FIXTURE_ROOT ?? paths.repositoryRoot,
  "scripts",
  "dev",
  "test",
  "fixture-service.mjs",
);
const failName = process.env.PYTHIA_TEST_FAIL_SERVICE;
const hermesReleaseQuietMs = Number(
  process.env.PYTHIA_TEST_HERMES_RELEASE_QUIET_MS ?? "100",
);

async function fixtureHermesReleaseProof({ phase }) {
  if (phase === "initial") {
    const delay = Number(
      process.env.PYTHIA_TEST_INITIAL_HERMES_RELEASE_DELAY_MS ?? "0",
    );
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    return;
  }
  const deadline = Date.now() + 5_000;
  let freeSince;
  while (Date.now() < deadline) {
    try {
      await assertPortsFree({ hermes: paths.ports.hermes });
      freeSince ??= Date.now();
      if (Date.now() - freeSince >= hermesReleaseQuietMs) return;
    } catch {
      freeSince = undefined;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    "Fixture Hermes listener did not remain free for the required quiet window.",
  );
}

function fixtureArguments(name, port) {
  if (failName === name) return [fixture, String(port), "fail"];
  if (name === "hermes") {
    if (process.env.PYTHIA_TEST_TRANSIENT_HERMES_RECLAIM) {
      return [
        fixture,
        String(port),
        "spawn-transient-descendant",
        process.env.PYTHIA_TEST_TRANSIENT_HERMES_RECLAIM,
      ];
    }
    if (process.env.PYTHIA_TEST_HERMES_DIE_AFTER_HEALTH_MS) {
      return [
        fixture,
        String(port),
        "die-second-after-health",
        join(paths.stateRoot, "hermes-launch-count"),
        process.env.PYTHIA_TEST_HERMES_DIE_AFTER_HEALTH_MS,
      ];
    }
    if (process.env.PYTHIA_TEST_DELAYED_HERMES_DESCENDANT_MS) {
      return [
        fixture,
        String(port),
        "spawn-delayed-descendant",
        process.env.PYTHIA_TEST_DELAYED_HERMES_DESCENDANT_MS,
      ];
    }
  }
  return [fixture, String(port), "serve"];
}

const services = Object.entries(paths.ports).map(([name, port]) => ({
  name,
  port,
  command: process.execPath,
  args: fixtureArguments(name, port),
  cwd: paths.repositoryRoot,
  environment: process.env,
  async ready(child) {
    if (name === "hermes" && process.env.PYTHIA_TEST_USE_HERMES_READINESS) {
      await hermesReady(paths, child);
      return;
    }
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(`${name} failed before ready`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}`, {
          signal: AbortSignal.timeout(250),
        });
        if (response.ok) {
          if (name === "hermes") {
            const delay = Number(
              process.env.PYTHIA_TEST_HERMES_READY_DELAY_MS ?? "0",
            );
            if (delay > 0) {
              await new Promise((resolve) => setTimeout(resolve, delay));
            }
          }
          return;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`${name} did not become ready`);
  },
}));

supervise(paths, services, {
  stdio: "ignore",
  hermesReleaseProof: fixtureHermesReleaseProof,
  finalReleaseProof: process.env.PYTHIA_TEST_FINAL_RELEASE_FAILURE
    ? async () => {
        throw new Error("synthetic final release proof failure");
      }
    : undefined,
  async refreshRuntime() {
    if (process.env.PYTHIA_TEST_REFRESH_FAILURE) {
      throw new Error("synthetic runtime refresh failure");
    }
    const delay = Number(process.env.PYTHIA_TEST_REFRESH_DELAY_MS ?? "0");
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    if (
      process.env.PYTHIA_TEST_REFRESH_SOURCE &&
      process.env.PYTHIA_TEST_REFRESH_OUTPUT
    ) {
      writeFileSync(
        process.env.PYTHIA_TEST_REFRESH_OUTPUT,
        readFileSync(process.env.PYTHIA_TEST_REFRESH_SOURCE),
      );
    }
  },
  onReady() {
    writeFileSync(join(paths.stateRoot, "fixture-ready"), "ready\n");
  },
  onHermesRestart(generation) {
    writeFileSync(
      join(paths.stateRoot, "fixture-hermes-generation"),
      `${generation}\n`,
    );
  },
  onRuntimeRefresh(generation) {
    writeFileSync(
      join(paths.stateRoot, "fixture-runtime-generation"),
      `${generation}\n`,
    );
  },
}).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
