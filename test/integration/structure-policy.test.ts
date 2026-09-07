import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectStructureViolations } from "../../tooling/check-structure.mjs";

const roots: string[] = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pythia-structure-"));
  roots.push(root);
  return root;
}

function write(root: string, path: string, contents: string) {
  const destination = join(root, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, contents);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

describe("source structure policy", () => {
  it("accepts exact limits and rejects the next production and test line", () => {
    const root = fixture();
    write(root, "scripts/exact.mjs", "export const value = 1;\n".repeat(400));
    write(root, "test/exact.test.ts", "expect(true).toBe(true);\n".repeat(600));
    expect(collectStructureViolations(root)).toEqual([]);

    write(root, "scripts/over.mjs", "export const value = 1;\n".repeat(401));
    write(root, "test/over.test.ts", "expect(true).toBe(true);\n".repeat(601));
    const violations = collectStructureViolations(root).join("\n");
    expect(violations).toMatch(
      /over\.mjs: 401 lines exceeds the 400-line production/u,
    );
    expect(violations).toMatch(
      /over\.test\.ts: 601 lines exceeds the 600-line test/u,
    );
  });

  it("requires a meaningful early exception reason", () => {
    const root = fixture();
    write(
      root,
      "tooling/allowed.py",
      `# pythia-structure-ignore: cohesive generated protocol table\n${"value = 1\n".repeat(401)}`,
    );
    write(
      root,
      "tooling/rejected.py",
      `# pythia-structure-ignore: short\n${"value = 1\n".repeat(401)}`,
    );
    expect(collectStructureViolations(root)).toEqual([
      expect.stringMatching(/rejected\.py: 402 lines/u),
    ]);
  });

  it("skips tool-owned state such as virtual environments and caches", () => {
    const root = fixture();
    for (const directory of [
      "runtime/managed/python/.venv/lib/site-packages/pkg",
      "runtime/managed/python/venv/lib",
      "tooling/.ruff_cache",
      "tooling/.pytest_cache",
      "tooling/.mypy_cache",
      "apps/desk/node_modules/dep",
    ]) {
      write(root, `${directory}/large.py`, "value = 1\n".repeat(401));
    }
    expect(collectStructureViolations(root)).toEqual([]);
  });

  it("covers CSS and Python and keeps tests out of production source", () => {
    const root = fixture();
    write(root, "apps/desk/src/large.css", ".rule {}\n".repeat(401));
    write(root, "runtime/managed/large.py", "value = 1\n".repeat(401));
    write(root, "packages/ui/src/example.test.ts", "export {};\n");
    const violations = collectStructureViolations(root).join("\n");
    expect(violations).toMatch(/large\.css/u);
    expect(violations).toMatch(/large\.py/u);
    expect(violations).toMatch(/tests belong in a test\/ tree outside src/u);
  });

  it("rejects broad ownerless directories and unexplained suppressions", () => {
    const root = fixture();
    const ignored = ["@ts", "ignore"].join("-");
    const expectedError = ["@ts", "expect", "error"].join("-");
    const doubleCast = ["as", "unknown", "as"].join(" ");
    write(root, "apps/desk/src/utils/value.ts", `// ${ignored}\nexport {};\n`);
    write(
      root,
      "packages/ui/src/value.ts",
      `// ${expectedError}\nexport const value = external ${doubleCast} string;\n`,
    );
    const violations = collectStructureViolations(root).join("\n");
    expect(violations).toMatch(/broad utils\/ directories/u);
    expect(violations).toContain(`${ignored} is not allowed`);
    expect(violations).toContain(
      `${expectedError} needs a same-line explanation`,
    );
    expect(violations).toContain(`instead of using ${doubleCast}`);
  });
});
