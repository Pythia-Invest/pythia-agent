#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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

const READY_TIMEOUT_MS = 4 * 60_000;
const STOP_TIMEOUT_MS = 20_000;
const REQUIRED_SKILLS = [
  "eodhd-market-data",
  "investment-memory",
  "sec-edgar-research",
];
const BYTE_STABLE_PRIVATE_STATE = [
  "profile_config",
  "secrets",
  "workspace_context",
  "workspace_note",
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
    observation.settings.basic_memory?.status === "ready",
    "Desk did not observe Basic Memory as ready.",
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
  // Basic Memory may add its own Markdown metadata while indexing. The file
  // must remain present, while the other device-owned inputs stay byte-stable.
  assert(
    observation.private_state_sha256.knowledge_note !== null,
    "Basic Memory removed the seeded knowledge note.",
  );
  assert(
    observation.private_state_sha256.root_auth === null,
    "Assembled startup created unexpected root credential material.",
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
      context_probe: CONTEXT_PASS_TOOLSET,
      native_skills: observation.native_skills,
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
