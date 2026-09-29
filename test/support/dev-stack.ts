import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach } from "vitest";
import { resolveStackPaths } from "../../scripts/dev/paths.mjs";
import { copySourceSnapshot } from "../../tooling/source-snapshot.mjs";

export const repositoryRoot = resolve(import.meta.dirname, "../..");

const roots: string[] = [];
const children: ChildProcess[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  for (const server of servers.splice(0)) {
    await new Promise<void>((done) => server.close(() => done()));
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

export function temporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), "pythia-dev-test-"));
  roots.push(root);
  return root;
}

/** Kill a fixture process after the test if it is still running. */
export function ownChild<T extends ChildProcess>(child: T) {
  children.push(child);
  return child;
}

/** Close a fixture listener after the test. */
export function ownServer<T extends Server>(server: T) {
  servers.push(server);
  return server;
}

/**
 * Development stack environment rooted in a temporary directory.
 *
 * Port identity follows the checkout path, so every fixture gets its own
 * checkout and never claims a running developer stack. Most tests only need
 * that distinct path; `snapshot` copies the tracked source for tests that
 * read or build managed files from the checkout.
 */
export function developmentEnvironment(
  root: string,
  source: "empty" | "snapshot" = "empty",
) {
  const checkout = join(root, "checkout");
  if (!existsSync(checkout)) {
    if (source === "snapshot") copySourceSnapshot(repositoryRoot, checkout);
    else mkdirSync(checkout, { recursive: true });
  }
  return {
    ...process.env,
    PYTHIA_DEV_REPO_ROOT: checkout,
    PYTHIA_DEV_CONFIG_HOME: join(root, "config"),
    PYTHIA_DEV_STATE_HOME: join(root, "state"),
    PYTHIA_DEV_DATA_HOME: join(root, "data"),
    PYTHIA_DEV_CACHE_HOME: join(root, "cache"),
  };
}

export function developmentPaths(
  root = temporaryRoot(),
  source: "empty" | "snapshot" = "empty",
) {
  return resolveStackPaths({
    environment: developmentEnvironment(root, source),
  });
}

export async function waitUntil(check: () => boolean, timeout = 8_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((done) => setTimeout(done, 40));
  }
  throw new Error("Timed out waiting for fixture state");
}

/** Start the fixture supervisor, which runs fake services on the stack ports. */
export function startFixture(root: string, extra: Record<string, string> = {}) {
  const env = {
    ...developmentEnvironment(root),
    PYTHIA_TEST_FIXTURE_ROOT: repositoryRoot,
    ...extra,
  };
  const paths = resolveStackPaths({ environment: env });
  mkdirSync(paths.processRoot, { recursive: true, mode: 0o700 });
  mkdirSync(paths.stateRoot, { recursive: true, mode: 0o700 });
  const child = ownChild(
    spawn(
      process.execPath,
      [join(repositoryRoot, "scripts/dev/test/fixture-supervisor.mjs")],
      { cwd: repositoryRoot, env, stdio: "ignore" },
    ),
  );
  return { child, env, paths };
}
