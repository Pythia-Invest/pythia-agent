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

const atomicProbe = String.raw`
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
  implementation.atomicWrite(process.argv[2], "private\n");
  process.stdout.write(JSON.stringify(calls));
`;

function atomicFsyncCalls(modulePath: string, destination: string) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      ["--input-type=module", "--eval", atomicProbe, modulePath, destination],
      { encoding: "utf8", timeout: 5_000 },
    ),
  );
}

describe("durable private file writes", () => {
  it.each(["scripts/install/files.mjs", "scripts/dev/files.mjs"])(
    "%s flushes the replacement and parent directory",
    (relativeModule) => {
      const root = fixture("durable-write");
      const destination = join(root, "private", "record.json");
      expect(
        atomicFsyncCalls(join(repositoryRoot, relativeModule), destination),
      ).toEqual(["file", "directory"]);
      expect(readFileSync(destination, "utf8")).toBe("private\n");
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

  it("flushes a copied trust file before publishing it", () => {
    const root = fixture("durable-copy");
    const source = join(root, "allowed_signers.source");
    const destination = join(root, "trust", "allowed_signers");
    writeFileSync(source, "release signer\n", { mode: 0o600 });
    const probe = `
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
      implementation.copyPrivateFile(process.argv[2], process.argv[3]);
      process.stdout.write(JSON.stringify(calls));
    `;
    expect(
      JSON.parse(
        execFileSync(
          process.execPath,
          [
            "--input-type=module",
            "--eval",
            probe,
            join(repositoryRoot, "scripts/install/files.mjs"),
            source,
            destination,
          ],
          { encoding: "utf8", timeout: 5_000 },
        ),
      ),
    ).toEqual(["file", "directory"]);
    expect(readFileSync(destination, "utf8")).toBe("release signer\n");
  });

  it("flushes an exclusive lifecycle record before publishing it", () => {
    const root = fixture("durable-exclusive");
    const destination = join(root, "state", "lifecycle.json");
    const probe = `
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
      const created = implementation.createJsonExclusive(process.argv[2], { owner: "test" });
      process.stdout.write(JSON.stringify({ calls, created }));
    `;
    expect(
      JSON.parse(
        execFileSync(
          process.execPath,
          [
            "--input-type=module",
            "--eval",
            probe,
            join(repositoryRoot, "scripts/dev/files.mjs"),
            destination,
          ],
          { encoding: "utf8", timeout: 5_000 },
        ),
      ),
    ).toEqual({ calls: ["file", "directory"], created: true });
    expect(JSON.parse(readFileSync(destination, "utf8"))).toEqual({
      owner: "test",
    });
  });
});
