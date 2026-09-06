import { describe, expect, it, vi } from "vitest";
import {
  lifecycleFailureGuidance,
  nativeAuth,
} from "../../scripts/install/cli.mjs";

it("pins installed authentication and status to the root profile", () => {
  vi.stubEnv("PYTHIA_PYTHON_EXECUTABLE", "/fixture/python");
  const run = vi.fn(() => ({ status: 0, stdout: "" }));
  try {
    for (const status of [false, true]) {
      nativeAuth(
        {
          runtimeRoot: "/fixture/runtime",
          managedPython: "/fixture/managed-python",
          hermesSource: "/fixture/hermes-source",
          hermesRoot: "/fixture/hermes",
          checkout: "/fixture/source",
        },
        "openai-codex",
        status,
        run,
      );
      expect(run.mock.lastCall?.[1]).toEqual([
        "-p",
        "default",
        "auth",
        ...(status
          ? ["status", "openai-codex"]
          : ["add", "--type", "oauth", "openai-codex"]),
      ]);
    }
  } finally {
    vi.unstubAllEnvs();
  }
});

describe("installed lifecycle failure guidance", () => {
  it("routes each failed mutation to its owning recovery command", () => {
    const stopped = { services: "stopped" };
    const rebuild = lifecycleFailureGuidance("rebuild", stopped);
    expect(rebuild).toContain("pythia rebuild");
    expect(rebuild).not.toContain("pythia recover");

    for (const command of ["update", "recover"]) {
      expect(lifecycleFailureGuidance(command, stopped)).toContain(
        "pythia recover",
      );
    }

    const install = lifecycleFailureGuidance("install", stopped);
    expect(install).toContain("./install.sh");
    expect(install).not.toContain("pythia recover");
  });

  it("keeps pre-stop and unconfirmed-stop guidance operation-specific", () => {
    expect(lifecycleFailureGuidance("rebuild", null)).toContain("rebuild");
    expect(
      lifecycleFailureGuidance("rebuild", { services: "stop-unconfirmed" }),
    ).toContain("pythia rebuild");
    expect(lifecycleFailureGuidance("install", null)).toContain("./install.sh");
    expect(lifecycleFailureGuidance("doctor", null)).toBeNull();
  });
});
