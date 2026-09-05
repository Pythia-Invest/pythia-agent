import { describe, expect, it } from "vitest";
import { lifecycleFailureGuidance } from "../../scripts/install/cli.mjs";

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
