import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { sourceManifest } from "../../tooling/source-snapshot.mjs";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0))
    rmSync(root, { force: true, recursive: true });
});

test("source snapshots represent tracked working-tree deletions", () => {
  const repository = mkdtempSync(join(tmpdir(), "pythia-source-snapshot-"));
  temporaryRoots.push(repository);
  execFileSync("git", ["init", "-q", repository]);
  writeFileSync(join(repository, "kept.txt"), "kept\n");
  writeFileSync(join(repository, "removed.txt"), "removed\n");
  execFileSync("git", ["add", "kept.txt", "removed.txt"], { cwd: repository });

  unlinkSync(join(repository, "removed.txt"));

  expect(sourceManifest(repository).entries.map(({ path }) => path)).toEqual([
    "kept.txt",
  ]);
});

test("source snapshots still reject dangling symlinks", () => {
  const repository = mkdtempSync(join(tmpdir(), "pythia-source-snapshot-"));
  temporaryRoots.push(repository);
  execFileSync("git", ["init", "-q", repository]);
  symlinkSync("missing-target", join(repository, "dangling"));

  expect(() => sourceManifest(repository)).toThrow(
    "Snapshots accept only regular files: dangling",
  );
});
