import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/*
 * CI invariants (ADR 0046). Checks the properties a workflow must keep, not
 * its exact text, so jobs and pins can change without editing this file.
 */

const ci = ".github/workflows/ci.yml";
// Jobs that report without blocking a merge; every other CI job must be a
// need of the gate. Adding a job forces the choice.
const advisory = new Set(["audit"]);
const forbidden = [
  /secrets\./u,
  /\baws\b/iu,
  /\bssm\b/iu,
  /\bterraform\b/iu,
  /\bdocker\b/iu,
  /\bsystemctl\b/iu,
  /\bpg-boss\b/iu,
  /\bpostgres\b/iu,
];
const failures = [];
const fail = (path, message) => failures.push(`${path}: ${message}`);

function files(directory, match) {
  return readdirSync(directory, { recursive: true, encoding: "utf8" })
    .filter((name) => match.test(name))
    .map((name) => join(directory, name));
}

/** Top-level job ids and each job's body, by two-space indentation. */
function jobs(source) {
  const body = source.split(/^jobs:\n/mu)[1] ?? "";
  const result = new Map();
  let current;
  for (const line of body.split("\n")) {
    const id = /^ {2}([A-Za-z0-9_-]+):\s*$/u.exec(line)?.[1];
    if (id) {
      current = id;
      result.set(id, "");
    } else if (/^\S/u.test(line)) break;
    else if (current) result.set(current, `${result.get(current)}${line}\n`);
  }
  return result;
}

function checkSteps(path, source) {
  for (const match of source.matchAll(/uses:\s*(\S+)(.*)$/gmu)) {
    const [, action, rest] = match;
    if (action.startsWith("./.github/actions/")) continue;
    if (!/@[0-9a-f]{40}$/u.test(action) || !/#\s*v\d/u.test(rest))
      fail(path, `pin ${action} to a full commit with a # vX comment`);
  }
  const checkouts = source.match(/uses:\s*actions\/checkout@/gu)?.length ?? 0;
  const persisted = source.match(/persist-credentials:\s*false/gu)?.length;
  if (checkouts > (persisted ?? 0))
    fail(path, "every checkout sets persist-credentials: false");
  if (/continue-on-error/u.test(source))
    fail(path, "use an advisory job, not continue-on-error");
  for (const pattern of forbidden)
    if (pattern.test(source)) fail(path, `must not match ${pattern}`);
}

for (const path of files(".github/actions", /action\.ya?ml$/u))
  checkSteps(path, readFileSync(path, "utf8"));

for (const path of files(".github/workflows", /\.ya?ml$/u)) {
  const source = readFileSync(path, "utf8");
  checkSteps(path, source);
  if (!/^permissions:\n {2}contents: read\n/mu.test(source))
    fail(path, "use top-level read-only permissions");
  for (const [id, body] of jobs(source))
    if (!/^ {4}timeout-minutes:/mu.test(body))
      fail(path, `job ${id} needs timeout-minutes`);
}

const source = readFileSync(ci, "utf8");
const ciJobs = jobs(source);
const gate = ciJobs.get("gate") ?? "";
const needs = new Set(
  (/^ {4}needs:\s*\[([^\]]*)\]/mu.exec(gate)?.[1] ?? "")
    .split(",")
    .map((need) => need.trim())
    .filter(Boolean),
);
if (!/^ {4}name: CI gate$/mu.test(gate) || !/^ {4}if: always\(\)$/mu.test(gate))
  fail(ci, 'the "gate" job is named "CI gate" and runs if: always()');
for (const id of ciJobs.keys())
  if (id !== "gate" && !advisory.has(id) && !needs.has(id))
    fail(ci, `blocking job ${id} must be a need of the gate`);
for (const need of needs)
  if (advisory.has(need) || !ciJobs.has(need))
    fail(ci, `gate need ${need} is not a blocking job`);
if (/^\s+(paths|paths-ignore|branches-ignore):/mu.test(source))
  fail(ci, "a required workflow must not filter paths or branches");
if (
  !/cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/u.test(
    source,
  )
)
  fail(ci, "cancel superseded runs for pull requests only");
if (/just qualify/u.test(source))
  fail(ci, "broad qualification belongs to the nightly workflow");

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
