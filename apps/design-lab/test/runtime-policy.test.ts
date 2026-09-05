import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { componentCatalog } from "../src/catalog";
import { shouldHideDesignLab } from "../src/app/runtime-policy";
import { compositionDemoManifest } from "../src/composition-demos";

describe("Design Lab route policy", () => {
  it("passes every route guard in development and test", () => {
    for (const environment of ["development", "test", undefined]) {
      expect(shouldHideDesignLab(environment)).toBe(false);
    }
  });

  it("hides the whole route tree in production through the root layout", async () => {
    const routeMatrix = [
      "/",
      "/foundation",
      "/unknown",
      "/unknown/nested",
      ...componentCatalog.map((entry) => entry.route),
      ...compositionDemoManifest.map((entry) => entry.route),
    ];

    expect(shouldHideDesignLab("production")).toBe(true);
    expect(routeMatrix).toHaveLength(
      componentCatalog.length + compositionDemoManifest.length + 4,
    );

    const rootLayout = await readFile(
      new URL("../src/app/layout.tsx", import.meta.url),
      "utf8",
    );
    expect(rootLayout).toContain(
      "if (shouldHideDesignLab(process.env.NODE_ENV)) notFound();",
    );
    expect(
      rootLayout.indexOf("shouldHideDesignLab(process.env.NODE_ENV)"),
    ).toBeLessThan(rootLayout.indexOf("<html"));
  });

  it("has no production startup or executable package entrypoint", async () => {
    const manifest = await readFile(
      new URL("../package.json", import.meta.url),
      "utf8",
    );

    expect(manifest).not.toMatch(/"start"\s*:/);
    expect(manifest).not.toMatch(/"bin"\s*:/);
  });
});
