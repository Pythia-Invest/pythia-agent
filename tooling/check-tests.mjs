import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/*
 * Test hygiene a machine can check (.agents/testing.md). Judgment about what
 * a test protects belongs to the test-audit skill; this keeps the patterns
 * that silently weaken a suite out of it.
 */

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const isTest = (path) =>
  /\.(test|spec)\.[cm]?[jt]sx?$/u.test(path) ||
  /(^|\/)e2e\/.+\.[cm]?[jt]s$/u.test(path);
const isPythonTest = (path) => /(^|\/)test_[^/]+\.py$/u.test(path);
const isRunnerConfig = (path) =>
  /(^|\/)(vitest|playwright)[^/]*\.config\.[cm]?[jt]s$/u.test(path);

const failures = [];
const report = (path, line, message) =>
  failures.push(`${path}:${line}: ${message}`);

/** A comment on one of the two lines above, or a reason argument. */
const explained = (lines, index) =>
  lines
    .slice(Math.max(0, index - 2), index)
    .some((line) => /^\s*(\/\/|\*|#)/u.test(line));

for (const path of tracked) {
  if (!isTest(path) && !isPythonTest(path) && !isRunnerConfig(path)) continue;
  if (path.includes("/fixtures/")) continue;
  const lines = readFileSync(path, "utf8").split("\n");
  lines.forEach((line, index) => {
    const at = index + 1;
    if (isRunnerConfig(path)) {
      if (/\bretr(y|ies)\s*:\s*[1-9]/u.test(line))
        report(path, at, "fix flaky tests; don't retry them");
      if (/passWithNoTests/u.test(line))
        report(path, at, "an empty test selection must fail");
      return;
    }
    if (/\b(it|test|describe)\.only\s*\(/u.test(line))
      report(path, at, "remove .only");
    if (/\b(it|test|describe)\.(skip|todo)\s*\(\s*["'`]/u.test(line))
      report(path, at, "delete or fix the test instead of skipping it");
    if (
      /\b(it|test|describe)\.skipIf\s*\(/u.test(line) &&
      !explained(lines, index)
    )
      report(path, at, "give a conditional skip an adjacent reason comment");
    if (
      /\btest\.skip\s*\(/u.test(line) &&
      !/\btest\.skip\s*\(\s*["'`]/u.test(line) &&
      !/,\s*["'`]/u.test(lines.slice(index, index + 4).join(" "))
    )
      report(path, at, "give test.skip(condition, reason) a reason");
    if (/\bwaitForTimeout\s*\(/u.test(line))
      report(path, at, "wait on observable state, not time");
    if (/\btoMatch(Inline)?Snapshot\s*\(/u.test(line))
      report(path, at, "assert the contract, not a snapshot");
    if (/passWithNoTests/u.test(line))
      report(path, at, "an empty test selection must fail");
    if (
      /@unittest\.skip\b(?!If|Unless)|@pytest\.mark\.skip\b(?!if)/u.test(line)
    )
      report(path, at, "delete or fix the test instead of skipping it");
  });
}

for (const path of tracked.filter((file) => file.endsWith("package.json"))) {
  const scripts = JSON.parse(readFileSync(path, "utf8")).scripts ?? {};
  for (const [name, command] of Object.entries(scripts)) {
    if (/passWithNoTests/u.test(command))
      report(path, 1, `script ${name}: an empty test selection must fail`);
    if (/--retry\b/u.test(command))
      report(path, 1, `script ${name}: fix flaky tests; don't retry them`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
