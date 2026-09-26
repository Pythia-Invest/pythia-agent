import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  hermesPin,
  hermesPinDisagreements,
  isPinnedHermesHealth,
} from "../../scripts/dev/hermes-pin.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function copiedRecords() {
  const root = mkdtempSync(join(tmpdir(), "pythia-hermes-pin-"));
  roots.push(root);
  for (const path of [
    "runtime/versions.json",
    "runtime/hermes/hermes-source.json",
  ]) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    cpSync(join(repositoryRoot, path), join(root, path));
  }
  return root;
}

describe("Hermes pin record", () => {
  it("reports a half-applied bump of the install record", () => {
    const root = copiedRecords();
    const path = join(root, "runtime/hermes/hermes-source.json");
    expect(hermesPinDisagreements(root)).toEqual([]);
    const source = JSON.parse(readFileSync(path, "utf8"));
    writeFileSync(
      path,
      JSON.stringify({ ...source, archive_sha256: "0".repeat(64) }),
    );
    expect(hermesPinDisagreements(root)).toEqual([
      expect.stringContaining("hermes-source.json archive_sha256"),
    ]);
  });

  it("accepts only the pinned package version from /health", () => {
    const health = {
      status: "ok",
      platform: "hermes-agent",
      version: hermesPin().packageVersion,
    };
    expect(isPinnedHermesHealth(health)).toBe(true);
    expect(isPinnedHermesHealth({ ...health, version: "0.0.0-other" })).toBe(
      false,
    );
    expect(isPinnedHermesHealth({ status: "ok" })).toBe(false);
  });
});
