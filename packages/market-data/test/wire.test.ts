import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const examples = JSON.parse(
  readFileSync(resolve(root, "market-data/examples/valid.json"), "utf8"),
) as {
  name: string;
  kind: string;
  value: unknown;
}[];
const packageRoot = resolve(root, "market-data");

describe("market-data v1 wire", () => {
  it("round-trips the same JSON fixtures through Python without numerical loss", () => {
    const output = execFileSync(
      "python3",
      [resolve(packageRoot, "test/check_wire.py")],
      { encoding: "utf8" },
    );
    expect(JSON.parse(output)).toEqual(
      examples.map((example) => example.value),
    );
  });

  it("type-checks actual shared fixtures against portable TypeScript contracts", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "pythia-wire-types-"));
    try {
      const source = resolve(directory, "examples.mts");
      writeFileSync(
        source,
        `import type { WireTypes } from ${JSON.stringify(resolve(packageRoot, "src/index.ts"))};\n${examples.map((example, index) => `const fixture${index} = ${JSON.stringify(example.value)} satisfies WireTypes[${JSON.stringify(example.kind)}];`).join("\n")}`,
      );
      const program = ts.createProgram([source], {
        noEmit: true,
        strict: true,
        exactOptionalPropertyTypes: true,
        target: ts.ScriptTarget.ES2024,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        skipLibCheck: true,
        allowImportingTsExtensions: true,
      });
      const errors = ts
        .getPreEmitDiagnostics(program)
        .map((diagnostic) =>
          ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
        );
      expect(errors).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
