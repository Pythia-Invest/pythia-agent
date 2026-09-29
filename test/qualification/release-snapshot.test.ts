import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupReleaseFixtures,
  createSnapshotFixture,
  git,
  repositoryRoot,
} from "../support/release-snapshot";

afterEach(cleanupReleaseFixtures);

function withoutTrustEntry(entries: Array<{ path: string }>) {
  return entries.filter((entry) => entry.path !== "release/allowed_signers");
}

describe("first public release snapshots", () => {
  it("keeps production trust empty while exercising an explicit ephemeral overlay", () => {
    const exact = createSnapshotFixture();
    expect(() =>
      execFileSync(
        join(repositoryRoot, "scripts/install/preflight.sh"),
        [exact.clone, "stable"],
        { encoding: "utf8" },
      ),
    ).toThrow();
    expect(
      execFileSync(
        join(repositoryRoot, "scripts/install/preflight.sh"),
        [exact.clone, "preview"],
        { encoding: "utf8" },
      ).toString(),
    ).toContain("Selected current source");

    const signed = createSnapshotFixture({ signedOverlay: true });
    expect(withoutTrustEntry(signed.snapshotB.entries)).toEqual(
      withoutTrustEntry(signed.source.entries),
    );
    expect(
      signed.snapshotB.entries.find(
        (entry) => entry.path === "release/allowed_signers",
      )?.sha256,
    ).not.toBe(
      signed.source.entries.find(
        (entry) => entry.path === "release/allowed_signers",
      )?.sha256,
    );
    expect(
      execFileSync(
        join(repositoryRoot, "scripts/install/preflight.sh"),
        [signed.clone, "stable"],
        { encoding: "utf8" },
      ).toString(),
    ).toContain("Selected stable release v0.1.0");
    expect(git(signed.clone, ["remote", "get-url", "origin"])).toBe(
      signed.remote,
    );
  });
});
