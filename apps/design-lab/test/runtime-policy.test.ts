import { describe, expect, it } from "vitest";
import { shouldHideDesignLab } from "../src/app/runtime-policy";

describe("Design Lab runtime policy", () => {
  it("hides the development-only application only in production", () => {
    expect(shouldHideDesignLab("production")).toBe(true);
    expect(shouldHideDesignLab("development")).toBe(false);
    expect(shouldHideDesignLab("test")).toBe(false);
    expect(shouldHideDesignLab(undefined)).toBe(false);
  });
});
