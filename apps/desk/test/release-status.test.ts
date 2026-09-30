import { describe, expect, it, vi } from "vitest";
import { createReleaseStatusService } from "@/server/release-status";

const current = "a".repeat(40);
const target = "b".repeat(40);
const environment = {
  HOME: "/home/test",
  NODE_ENV: "test" as const,
  PATH: "/usr/bin",
  PYTHIA_LIFECYCLE_COMMAND: "/home/test/.local/bin/pythia",
};
const local = {
  status: "ready",
  channel: "preview",
  current_version: "main",
  current_revision: current,
  updater: "idle",
  apply_supported: true,
};

describe("Desk release status", () => {
  it("reads local inventory only and preserves activation identity across explicit remote checks", async () => {
    const secret = "PRIVATE_BEARER";
    let checkout = { revision: current, version: "main" };
    const command = vi.fn(async (_executable: string, args: string[]) => ({
      stdout: JSON.stringify(
        args[0] === "update-status"
          ? { ...local, private_extra: secret }
          : {
              status: "ready",
              current_revision: checkout.revision,
              target_revision: target,
              current_version: checkout.version,
              target_version: "main",
              checkout_clean: true,
              update_available: true,
            },
      ),
      stderr: "",
    }));
    const service = createReleaseStatusService(
      { ...environment, API_SERVER_KEY: secret },
      command as never,
    );
    await expect(service.snapshot()).resolves.toEqual(local);
    expect(command).toHaveBeenCalledTimes(1);
    expect(command.mock.calls[0]?.[1]).toEqual(["update-status", "--json"]);
    await expect(service.snapshot(true)).resolves.toMatchObject({
      ...local,
      target_revision: target,
      update_available: true,
    });
    expect(command.mock.calls[2]?.[1]).toEqual(["check-update", "--json"]);
    // A checkout that moved since activation: the running build's identity
    // wins, and applying is refused.
    checkout = { revision: "c".repeat(40), version: "next" };
    await expect(service.snapshot(true)).resolves.toMatchObject({
      current_revision: current,
      current_version: "main",
      target_revision: target,
      apply_supported: false,
    });
    expect(JSON.stringify(command.mock.calls)).not.toContain(secret);
  });

  it("retains the installed build when a remote check is unavailable", async () => {
    const command = vi.fn(async (_executable: string, args: string[]) => ({
      stdout: JSON.stringify(
        args[0] === "update-status"
          ? local
          : {
              status: "unavailable",
              code: "release_discovery_failed",
              message: "Offline",
            },
      ),
      stderr: "",
    }));
    await expect(
      createReleaseStatusService(environment, command as never).snapshot(true),
    ).resolves.toMatchObject({
      status: "unavailable",
      current_revision: current,
      current_version: "main",
      message: "Offline",
      apply_supported: false,
    });
  });

  it("starts only the fixed lifecycle command with validated selected revisions", async () => {
    const command = vi.fn(async () => ({
      stdout: JSON.stringify({ started: true, target_revision: target }),
      stderr: "",
    }));
    const service = createReleaseStatusService(environment, command as never);
    await expect(
      service.start({ current: "--anything", target }),
    ).rejects.toMatchObject({ status: 400 });
    expect(command).not.toHaveBeenCalled();
    await expect(service.start({ current, target })).resolves.toEqual({
      started: true,
      target_revision: target,
    });
    expect(command.mock.calls[0]).toEqual([
      environment.PYTHIA_LIFECYCLE_COMMAND,
      ["start-update", "--expect-current", current, "--expect-target", target],
      expect.anything(),
    ]);
  });

  it("reports a native rejection and never guesses that an ambiguous handoff succeeded", async () => {
    const command = vi.fn(async () => ({
      stdout: JSON.stringify({
        started: false,
        code: "dirty_checkout",
        message: "Keep local changes",
      }),
      stderr: "",
    }));
    const service = createReleaseStatusService(environment, command as never);
    await expect(service.start({ current, target })).rejects.toMatchObject({
      status: 409,
      code: "dirty_checkout",
    });
    command.mockRejectedValueOnce(new Error("transport lost"));
    await expect(service.start({ current, target })).rejects.toMatchObject({
      status: 503,
      code: "update_start_unconfirmed",
    });
  });

  it("fails closed without an installed command or valid output", async () => {
    const absent = createReleaseStatusService({ NODE_ENV: "test" });
    await expect(absent.snapshot()).resolves.toMatchObject({
      status: "unavailable",
      code: "release_command_unavailable",
      apply_supported: false,
    });
    await expect(absent.start({ current, target })).rejects.toMatchObject({
      status: 409,
    });
    const invalid = createReleaseStatusService(
      environment,
      vi.fn(async () => ({ stdout: "not-json", stderr: "" })) as never,
    );
    await expect(invalid.snapshot()).resolves.toMatchObject({
      status: "unavailable",
      code: "release_check_failed",
    });
  });
});
