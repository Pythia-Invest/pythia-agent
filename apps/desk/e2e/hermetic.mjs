import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Runs the hermetic browser suite against this checkout's production Desk
 * build (ADR 0008). Desk starts on an ephemeral loopback port with disposable
 * state and no Hermes: every spec supplies its API responses through route
 * fixtures, and a request that reaches Hermes fails. Specs under e2e/live need
 * a real profile and run only against a running Desk (`just test-e2e`).
 */
const require = createRequire(import.meta.url);
const desk = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (!existsSync(join(desk, ".next", "BUILD_ID")))
  throw new Error("Build Desk first: pnpm --filter @pythia/desk run build");

const state = await mkdtemp(join(tmpdir(), "pythia-desk-e2e-"));
const base = Object.fromEntries(
  ["PATH", "HOME", "TMPDIR", "LANG", "CI"].flatMap((key) =>
    process.env[key] ? [[key, process.env[key]]] : [],
  ),
);
let server;
let code = 1;
try {
  for (const name of ["workspace", "state", "hermes"])
    await mkdir(join(state, name));
  server = spawn(
    process.execPath,
    [join(desk, "qualification/server.mjs"), desk],
    {
      cwd: desk,
      env: {
        ...base,
        NODE_ENV: "production",
        NEXT_TELEMETRY_DISABLED: "1",
        // Port 9 (discard) is closed on loopback: nothing answers as Hermes.
        PYTHIA_HERMES_API_URL: "http://127.0.0.1:9",
        API_SERVER_KEY: "hermetic-e2e",
        PYTHIA_HERMES_PROFILE: "hermetic-e2e",
        HERMES_HOME: join(state, "hermes"),
        PYTHIA_WORKSPACE: join(state, "workspace"),
        PYTHIA_STATE_ROOT: join(state, "state"),
        PYTHIA_DESK_VIEW_STATE: join(state, "desk-view"),
      },
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    },
  );
  const [{ port }] = await Promise.race([
    once(server, "message"),
    once(server, "exit").then(([exit]) => {
      throw new Error(`Desk exited before listening: ${exit}`);
    }),
  ]);
  const playwright = spawn(
    process.execPath,
    [
      require.resolve("@playwright/test/cli"),
      "test",
      ...process.argv.slice(2),
    ],
    {
      cwd: desk,
      env: {
        ...process.env,
        PYTHIA_DESK_URL: `http://127.0.0.1:${port}`,
        PYTHIA_E2E_HERMETIC: "1",
      },
      stdio: "inherit",
    },
  );
  [code] = await once(playwright, "exit");
} finally {
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await once(server, "exit");
  }
  await rm(state, { recursive: true, force: true });
}
process.exit(code ?? 1);
