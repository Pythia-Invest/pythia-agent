import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyStableTag } from "../../scripts/update/release.mjs";
import {
  cleanupReleaseFixtures,
  createSnapshotFixture,
  git,
  predecessorSpecification,
  repositoryRoot,
  run,
  temporaryQualificationRoot,
} from "../support/release-snapshot";
import {
  copySourceSnapshot,
  derivePredecessor,
  directoryManifest,
} from "../../tooling/source-snapshot.mjs";

afterEach(cleanupReleaseFixtures);

function withoutTrustEntry(entries: Array<{ path: string }>) {
  return entries.filter((entry) => entry.path !== "release/allowed_signers");
}

function noPrivateHistory(repository: string) {
  const personalName = ["ra", "lph"].join("");
  const privateRepository = ["pythia", "-invest"].join("");
  const pattern = [
    `/Users/${personalName}`,
    `/home/${personalName}`,
    `${privateRepository}/(plans|docs/experiments)`,
    ["plans/main/", "grilling"].join(""),
    "BEGIN (OPENSSH |RSA |EC )?PRIVATE KEY",
  ].join("|");
  const revisions = git(repository, ["rev-list", "--all"])
    .split("\n")
    .filter(Boolean);
  const result = spawnSync(
    "git",
    ["grep", "-I", "-n", "-E", pattern, ...revisions],
    {
      cwd: repository,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      },
    },
  );
  expect(result.status, String(result.stdout || result.stderr)).toBe(1);
}

function expectTagFailure(
  repository: string,
  tag: string,
  allowedSigners: string,
  code: string,
) {
  try {
    verifyStableTag(repository, tag, allowedSigners);
    throw new Error(`${tag} unexpectedly verified`);
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

describe("first public release snapshots", () => {
  it("makes reviewed A an ancestor of byte-and-mode exact B", () => {
    const fixture = createSnapshotFixture();
    expect(fixture.snapshotB).toEqual(fixture.source);
    expect(fixture.snapshotA.digest).not.toBe(fixture.snapshotB.digest);
    expect(
      git(fixture.repository, [
        "diff",
        "--name-only",
        fixture.revisionA,
        fixture.revisionB,
      ]).split("\n"),
    ).toEqual([
      "packaging/systemd/pythia-agent-desk.service.in",
      "runtime/managed/skills/eodhd-market-data/SKILL.md",
    ]);
    expect(() =>
      git(fixture.repository, [
        "merge-base",
        "--is-ancestor",
        fixture.revisionA,
        fixture.revisionB,
      ]),
    ).not.toThrow();
    expect(directoryManifest(fixture.clone)).toEqual(fixture.source);
    expect(
      verifyStableTag(fixture.repository, "v0.0.1", fixture.allowedSigners),
    ).toBe(fixture.revisionA);
    expect(
      verifyStableTag(fixture.repository, "v0.1.0", fixture.allowedSigners),
    ).toBe(fixture.revisionB);
    expectTagFailure(
      fixture.repository,
      "v0.0.2",
      fixture.allowedSigners,
      "untrusted_tag",
    );
    expectTagFailure(
      fixture.repository,
      "v0.1.1",
      fixture.allowedSigners,
      "untrusted_tag",
    );
    expectTagFailure(
      fixture.repository,
      "v0.1.2",
      fixture.allowedSigners,
      "unsigned_tag",
    );
    expectTagFailure(
      fixture.repository,
      "release-b",
      fixture.allowedSigners,
      "invalid_tag",
    );
    noPrivateHistory(fixture.repository);
    writeFileSync(
      join(
        repositoryRoot,
        ".local",
        "qualification",
        "t10",
        "release-snapshot.json",
      ),
      `${JSON.stringify(
        {
          schema_version: 1,
          exact_b_matches_source: true,
          source: fixture.source,
          predecessor_a: {
            manifest: fixture.snapshotA,
            revision: fixture.revisionA,
            tree: fixture.treeA,
            trusted_tag: fixture.tagA,
            untrusted_tag: fixture.untrustedTagA,
          },
          release_b: {
            manifest: fixture.snapshotB,
            revision: fixture.revisionB,
            tree: fixture.treeB,
            trusted_tag: fixture.tagB,
            untrusted_tag: fixture.untrustedTagB,
          },
          differences: [
            "packaging/systemd/pythia-agent-desk.service.in",
            "runtime/managed/skills/eodhd-market-data/SKILL.md",
          ],
          target_index_mutated: false,
          publication_target: null,
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
  });

  it("exports an offline A/B bundle without changing the target index", () => {
    const fixture = createSnapshotFixture();
    const before = git(repositoryRoot, ["status", "--porcelain=v1"]);
    const bundle = join(fixture.root, "pythia-a-b.bundle");
    git(fixture.repository, [
      "bundle",
      "create",
      bundle,
      "refs/heads/main",
      "refs/tags/v0.0.1",
      "refs/tags/v0.1.0",
    ]);
    const offline = join(fixture.root, "offline-clone");
    git(fixture.root, ["clone", "--branch", "main", bundle, offline]);
    expect(directoryManifest(offline)).toEqual(fixture.source);
    expect(git(offline, ["fsck", "--full", "--no-dangling"])).toBe("");
    expect(git(repositoryRoot, ["status", "--porcelain=v1"])).toBe(before);
    noPrivateHistory(offline);
  });

  it("materializes exact A and B in two disposable Git worktrees", () => {
    const fixture = createSnapshotFixture();
    const worktreeA = join(fixture.root, "worktree-a");
    const worktreeB = join(fixture.root, "worktree-b");
    git(fixture.repository, [
      "worktree",
      "add",
      "--detach",
      worktreeA,
      "v0.0.1",
    ]);
    git(fixture.repository, [
      "worktree",
      "add",
      "--detach",
      worktreeB,
      "v0.1.0",
    ]);
    expect(directoryManifest(worktreeA)).toEqual(fixture.snapshotA);
    expect(directoryManifest(worktreeB)).toEqual(fixture.snapshotB);
    expect(git(worktreeA, ["rev-parse", "--git-dir"])).not.toBe(
      git(worktreeB, ["rev-parse", "--git-dir"]),
    );
  });

  it("builds the bounded predecessor from the hydrated lock without a registry", () => {
    const root = temporaryQualificationRoot("predecessor-build");
    const predecessor = join(root, "source");
    copySourceSnapshot(repositoryRoot, predecessor);
    derivePredecessor(predecessor, predecessorSpecification);
    const predecessorManifest = directoryManifest(predecessor);
    // A released source tree is a Git checkout. Keep Next's output tracing
    // bounded to this disposable snapshot instead of its parent checkout.
    git(predecessor, ["init", "-b", "main"]);
    const environment = {
      ...process.env,
      CI: "1",
      NEXT_TELEMETRY_DISABLED: "1",
    };
    run(
      predecessor,
      "pnpm",
      [
        "install",
        "--offline",
        "--frozen-lockfile",
        "--store-dir",
        join(repositoryRoot, ".pnpm-store"),
      ],
      environment,
    );
    run(predecessor, "pnpm", ["run", "build:runtime"], environment);
    run(
      predecessor,
      "pnpm",
      ["--filter", "@pythia/desk", "build"],
      environment,
    );
    expect(
      predecessorManifest.entries.some(
        (entry) =>
          entry.path === "runtime/managed/skills/sec-edgar-research/SKILL.md",
      ),
    ).toBe(true);
    expect(
      predecessorManifest.entries.some(
        (entry) =>
          entry.path === "runtime/managed/skills/investment-memory/SKILL.md",
      ),
    ).toBe(true);
  }, 120_000);

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
