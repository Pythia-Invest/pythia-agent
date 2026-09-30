import { describe, expect, it } from "vitest";
import { updateComplete } from "@/client/update-progress";
import type { DeskReleaseStatus } from "@/server/release-status";

const target = "b".repeat(40);
const complete: DeskReleaseStatus = {
  status: "ready",
  current_revision: target,
  updater: "idle",
  last_update: { phase: "complete", target_revision: target },
};

describe("update completion evidence", () => {
  it("requires matching activation and completed transaction with an idle updater", () => {
    expect(updateComplete(complete, target)).toBe(true);
    for (const changed of [
      { current_revision: "a".repeat(40) },
      { updater: "failed" as const },
      { updater: "running" as const },
      { updater: "unavailable" as const },
      { last_update: { phase: "complete", target_revision: "a".repeat(40) } },
      { last_update: { phase: "failed-stopped", target_revision: target } },
    ]) {
      expect(updateComplete({ ...complete, ...changed }, target)).toBe(false);
    }
    const withoutReceipt = { ...complete };
    delete withoutReceipt.last_update;
    expect(updateComplete(withoutReceipt, target)).toBe(false);
    expect(updateComplete(undefined, target)).toBe(false);
  });
});
