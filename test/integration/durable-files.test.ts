import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture(name: string) {
  const root = mkdtempSync(join(tmpdir(), `pythia-${name}-`));
  roots.push(root);
  return root;
}

// Records every fsync while one exported writer runs, then prints them.
const flushProbe = `
  import fs from "node:fs";
  import { syncBuiltinESMExports } from "node:module";
  import { pathToFileURL } from "node:url";
  const calls = [];
  const original = fs.fsyncSync;
  fs.fsyncSync = (descriptor) => {
    calls.push(fs.fstatSync(descriptor).isDirectory() ? "directory" : "file");
    return original(descriptor);
  };
  syncBuiltinESMExports();
  const implementation = await import(pathToFileURL(process.argv[1]).href);
  implementation[process.argv[2]](...JSON.parse(process.argv[3]));
  process.stdout.write(JSON.stringify(calls));
`;

describe("durable private file writes", () => {
  it.each([
    ["scripts/install/files.mjs", "atomicWrite"],
    ["scripts/dev/files.mjs", "atomicWrite"],
    ["scripts/install/files.mjs", "copyPrivateFile"],
    ["scripts/dev/files.mjs", "createJsonExclusive"],
  ])(
    "%s %s flushes the file and its parent directory before publishing",
    (relativeModule, writer) => {
      const root = fixture("durable-write");
      const destination = join(root, "private", "record.json");
      const source = join(root, "source");
      writeFileSync(source, "private\n", { mode: 0o600 });
      const args = {
        atomicWrite: [destination, "private\n"],
        copyPrivateFile: [source, destination],
        createJsonExclusive: [destination, { owner: "test" }],
      }[writer];
      const calls = JSON.parse(
        execFileSync(
          process.execPath,
          [
            "--input-type=module",
            "--eval",
            flushProbe,
            join(repositoryRoot, relativeModule),
            writer,
            JSON.stringify(args),
          ],
          { encoding: "utf8", timeout: 5_000 },
        ),
      );
      expect(calls).toEqual(["file", "directory"]);
      const written = readFileSync(destination, "utf8");
      if (writer === "createJsonExclusive")
        expect(JSON.parse(written)).toEqual({ owner: "test" });
      else expect(written).toBe("private\n");
      if (process.platform !== "win32") {
        expect(statSync(destination).mode & 0o777).toBe(0o600);
      }
    },
  );

  it("cleans its private staging directory when the file flush fails", () => {
    const root = fixture("durable-failure");
    const parent = join(root, "private");
    const destination = join(parent, "record.json");
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    const probe = String.raw`
      import fs from "node:fs";
      import { syncBuiltinESMExports } from "node:module";
      import { pathToFileURL } from "node:url";
      fs.fsyncSync = () => { throw new Error("synthetic fsync failure"); };
      syncBuiltinESMExports();
      const implementation = await import(pathToFileURL(process.argv[1]).href);
      try {
        implementation.atomicWrite(process.argv[2], "private\n");
      } catch (error) {
        process.stdout.write(error.message);
      }
    `;
    expect(
      execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          probe,
          join(repositoryRoot, "scripts/install/files.mjs"),
          destination,
        ],
        { encoding: "utf8", timeout: 5_000 },
      ),
    ).toBe("synthetic fsync failure");
    expect(readdirSync(parent)).toEqual([]);
  });
});
