import { describe, expect, it, vi } from "vitest";
import { createReleaseStatusService } from "@/server/release-status";

describe("Desk release status", () => {
  it("invokes only the installed read-only check and returns bounded fields", async () => {
    const secret = "PRIVATE_BEARER";
    const command = vi.fn(async (..._arguments: unknown[]) => ({
      stdout: JSON.stringify({
        status: "ready",
        channel: "stable",
        current_version: "v0.1.0",
        target_version: "v0.2.0",
        update_available: true,
        current_revision: "a".repeat(40),
        private_extra: secret,
      }),
      stderr: "",
    }));
    const service = createReleaseStatusService(
      {
        API_SERVER_KEY: secret,
        HOME: "/home/test",
        NODE_ENV: "test",
        PATH: "/usr/bin",
        PYTHIA_LIFECYCLE_COMMAND: "/home/test/.local/bin/pythia",
      },
      command as never,
    );
    await expect(service.snapshot()).resolves.toEqual({
      status: "ready",
      channel: "stable",
      current_version: "v0.1.0",
      target_version: "v0.2.0",
      update_available: true,
    });
    const [executable, args, options] = command.mock.calls[0] ?? [];
    expect(executable).toBe("/home/test/.local/bin/pythia");
    expect(args).toEqual(["check-update", "--json"]);
    expect(JSON.stringify(options)).not.toContain(secret);
  });

  it("fails closed when no installed command exists or output is invalid", async () => {
    await expect(
      createReleaseStatusService({ NODE_ENV: "test" }).snapshot(),
    ).resolves.toMatchObject({
      status: "unavailable",
      code: "release_command_unavailable",
    });
    const invalid = createReleaseStatusService(
      { NODE_ENV: "test", PYTHIA_LIFECYCLE_COMMAND: "/bin/pythia" },
      vi.fn(async () => ({ stdout: "not-json", stderr: "" })) as never,
    );
    await expect(invalid.snapshot()).resolves.toMatchObject({
      status: "unavailable",
      code: "release_check_failed",
    });
  });
});
