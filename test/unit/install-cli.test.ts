import { describe, expect, it, vi } from "vitest";
import {
  lifecycleFailureGuidance,
  nativeAuth,
} from "../../scripts/install/cli.mjs";

it("pins installed authentication and status to the root profile", () => {
  vi.stubEnv("PYTHIA_PYTHON_EXECUTABLE", "/fixture/python");
  const run = vi.fn((_command: string, _args: string[], _options: object) => ({
    status: 0,
    stdout: "",
  }));
  try {
    for (const status of [false, true]) {
      nativeAuth(
        {
          runtimeRoot: "/fixture/runtime",
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
  const stopped = { services: "stopped" };
  const unconfirmed = { services: "stop-unconfirmed" };
  it.each([
    ["rebuild", stopped, "pythia rebuild", "pythia recover"],
    ["rebuild", unconfirmed, "pythia rebuild", "pythia recover"],
    ["rebuild", null, "rebuild was refused", "pythia recover"],
    ["update", stopped, "pythia recover", null],
    ["recover", stopped, "pythia recover", null],
    ["install", stopped, "./install.sh", "pythia recover"],
    ["install", null, "./install.sh", "pythia recover"],
  ] as const)(
    "routes a failed %s (%j) to its owning recovery command",
    (command, services, expected, notExpected) => {
      const guidance = lifecycleFailureGuidance(command, services);
      expect(guidance).toContain(expected);
      if (notExpected) expect(guidance).not.toContain(notExpected);
    },
  );

  it("offers no recovery guidance for a read-only command", () => {
    expect(lifecycleFailureGuidance("doctor", null)).toBeNull();
  });
});
