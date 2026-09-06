import { existsSync, readFileSync } from "node:fs";

const workflows = {
  deterministic: ".github/workflows/deterministic.yml",
  qualification: ".github/workflows/qualification.yml",
};
const actionPins = [
  "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
  "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
  "actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830",
  "extractions/setup-just@53165ef7e734c5c07cb06b3c8e7b647c5aa16db3",
];
const forbidden = [
  "secrets.",
  "aws",
  "ssm",
  "postgres",
  "pg-boss",
  "terraform",
  "docker",
  "systemctl",
];

function workflow(path) {
  if (!existsSync(path)) throw new Error(`${path} is required`);
  const source = readFileSync(path, "utf8");
  if (!source.includes("permissions:\n  contents: read")) {
    throw new Error(`${path} must use read-only repository permissions`);
  }
  if (!source.includes("cancel-in-progress: true")) {
    throw new Error(`${path} must cancel superseded runs`);
  }
  if (!source.includes("timeout-minutes:")) {
    throw new Error(`${path} must bound every job`);
  }
  for (const value of forbidden) {
    if (source.toLowerCase().includes(value)) {
      throw new Error(`${path} must not contain ${JSON.stringify(value)}`);
    }
  }
  for (const match of source.matchAll(/uses:\s*([^\s#]+)/gu)) {
    const action = match[1];
    if (!action || !/@[0-9a-f]{40}$/u.test(action)) {
      throw new Error(`${path} action must use an immutable commit: ${action}`);
    }
  }
  return source;
}

const deterministic = workflow(workflows.deterministic);
for (const value of [
  ...actionPins,
  "astral-sh/setup-uv@fac544c07dec837d0ccb6301d7b5580bf5edae39",
  "macos-14",
  "ubuntu-24.04",
  "just check",
  "just test-fast",
  "just test-system",
  "just audit",
]) {
  if (!deterministic.includes(value)) {
    throw new Error(
      `${workflows.deterministic} must contain ${JSON.stringify(value)}`,
    );
  }
}
if (deterministic.includes("just qualify")) {
  throw new Error("Broad qualification must not run in pull-request CI");
}

const qualification = workflow(workflows.qualification);
for (const value of [
  ...actionPins,
  "astral-sh/setup-uv@fac544c07dec837d0ccb6301d7b5580bf5edae39",
  "workflow_dispatch:",
  "branches: [main]",
  "just qualify",
]) {
  if (!qualification.includes(value)) {
    throw new Error(
      `${workflows.qualification} must contain ${JSON.stringify(value)}`,
    );
  }
}
