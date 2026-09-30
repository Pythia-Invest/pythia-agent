#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CONTEXT_PASS_TOOLSET,
  CONTEXT_TOOL,
  QUALIFICATION_PARENT,
} from "./assembled-cache.mjs";
import {
  instrumentContextProbe,
  prepareAssembledFixture,
  qualificationProcessEnvironment,
} from "./assembled-fixture.mjs";
import {
  observeAssembledStack,
  seedNativeSession,
} from "./assembled-observation.mjs";
import {
  cleanupAssembledFixture,
  runAssembledCommand,
  seedSyntheticState,
} from "./assembled-operations.mjs";
import { runHermesCapture } from "./hermes-capture.mjs";

const REPOSITORY_ROOT = resolve(
  fileURLToPath(new URL("../..", import.meta.url)),
);

const READY_TIMEOUT_MS = 4 * 60_000;
const STOP_TIMEOUT_MS = 20_000;
const REQUIRED_SKILLS = ["investment-memory"];
const BYTE_STABLE_PRIVATE_STATE = [
  "profile_config",
  "secrets",
  "workspace_context",
  "workspace_note",
  "knowledge_note",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForObservation(root, child) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let latestError = new Error("The assembled stack was not observed.");
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `The assembled stack exited before readiness (code ${child.exitCode}, signal ${child.signalCode}).`,
      );
    }
    try {
      return await observeAssembledStack(root, "one");
    } catch (error) {
      latestError = error;
      await delay(500);
    }
  }
  throw new Error(
    `The assembled stack did not become observable within ${READY_TIMEOUT_MS}ms: ${latestError.message}`,
  );
}

function verifyObservation(observation, seededState, seededSession) {
  assert(
    observation.provider_or_model_call === false,
    "A provider was called.",
  );
  assert(
    observation.context_probe_passed === true &&
      observation.context_probe_failed === false,
    `Hermes did not expose ${CONTEXT_PASS_TOOLSET}/${CONTEXT_TOOL}.`,
  );
  assert(
    observation.native_session.id === seededSession.id &&
      observation.native_session.selected.id === seededSession.id &&
      observation.native_session.sha256 === seededSession.sha256,
    "Hermes did not preserve the seeded native session.",
  );
  for (const name of REQUIRED_SKILLS) {
    assert(
      observation.native_skills.includes(name),
      `Hermes did not expose the managed skill ${name}.`,
    );
    const setting = observation.settings.skills.find(
      (skill) => skill.name === name,
    );
    assert(
      setting?.enabled === true,
      `Desk did not report the managed skill ${name} as enabled.`,
    );
  }
  for (const [name, digest] of Object.entries(seededState)) {
    assert(
      observation.private_state_sha256[name] === digest,
      `The seeded private-state file ${name} changed during startup.`,
    );
  }
  assert(
    observation.private_state_sha256.root_auth === null,
    "Assembled startup created unexpected root credential material.",
  );
}

// What an api_server turn delivers, asked of the stack's prepared pinned Hermes in a disposable profile.
function qualifyAgentTools(stack) {
  const result = spawnSync(
    join(stack.paths.hermesSource, ".venv", "bin", "python"),
    [
      join(stack.worktree, "tooling", "qualification", "agent_tools_native.py"),
      "--hermes-source",
      stack.paths.hermesSource,
      "--repository",
      stack.worktree,
    ],
    { encoding: "utf8", env: { PATH: process.env.PATH }, timeout: 180_000 },
  );
  assert(
    result.status === 0,
    `Agent tool qualification failed: ${(result.stderr || result.error?.message || "").slice(-2000)}`,
  );
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () =>
        reject(
          new Error("The assembled stack did not stop within its timeout."),
        ),
      timeoutMs,
    );
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function stopOwnedStack(root, stack, child) {
  if (existsSync(stack.paths.receipt)) {
    runAssembledCommand(root, "one", ["just", "stop"]);
  } else if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
  }
  await waitForExit(child, STOP_TIMEOUT_MS);
}

export async function runAssembledQualification() {
  mkdirSync(QUALIFICATION_PARENT, { recursive: true, mode: 0o700 });
  const root = join(QUALIFICATION_PARENT, `assembled-${randomUUID()}`);
  let assembled;
  let child;
  try {
    assembled = prepareAssembledFixture(root);
    const stack = assembled.stacks.one;
    instrumentContextProbe(root, "one");
    runAssembledCommand(root, "one", ["just", "dev-init"]);
    qualifyAgentTools(stack);
    // The fixture has just hydrated the pinned Hermes; compare the committed
    // goldens with a fresh provider-free capture from it (ADR 0020).
    if (
      runHermesCapture({
        hermesSource: stack.paths.hermesSource,
        repositoryRoot: REPOSITORY_ROOT,
        check: true,
      }) !== 0
    )
      throw new Error(
        "Committed Hermes goldens differ from the pinned capture.",
      );
    const seededState = seedSyntheticState(root, "one");
    const seededSession = seedNativeSession(root, "one");
    child = spawn("just", ["dev"], {
      cwd: stack.worktree,
      env: qualificationProcessEnvironment(stack),
      stdio: "inherit",
    });
    const observation = await waitForObservation(root, child);
    verifyObservation(
      observation,
      Object.fromEntries(
        BYTE_STABLE_PRIVATE_STATE.map((name) => [
          name,
          seededState.private_state_sha256[name],
        ]),
      ),
      seededSession.native_session,
    );
    return {
      agent_tools: "qualified",
      context_probe: CONTEXT_PASS_TOOLSET,
      native_skills: observation.native_skills,
      hermes_capture: "match",
      provider_or_model_call: false,
      stack: stack.id,
    };
  } finally {
    if (assembled && child) {
      await stopOwnedStack(root, assembled.stacks.one, child);
    }
    if (assembled) cleanupAssembledFixture(root);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runAssembledQualification()
    .then((result) =>
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`),
    )
    .catch((error) => {
      console.error(`Assembled qualification failed: ${error.message}`);
      process.exitCode = 1;
    });
}
