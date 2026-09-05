import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = async (path: string) =>
  readFile(new URL(path, import.meta.url), "utf8");

describe("overlay and disclosure styling contract", () => {
  it("uses semantic theme/profile tokens without a component palette", async () => {
    const css = await source("../src/overlays/overlays.css");
    const disclosureCss = await source("../src/disclosure/disclosure.css");

    expect(css).toContain("var(--py-surface-overlay)");
    expect(css).toContain("var(--py-profile-control-height)");
    expect(css).toContain("var(--py-interaction-hover)");
    expect(disclosureCss).toContain("var(--py-border-default)");
    expect(disclosureCss).toContain("var(--py-profile-body-size)");
    expect(`${css}\n${disclosureCss}`).not.toMatch(/#[\da-f]{3,8}\b/i);
  });

  it("styles exact Base UI 1.7.0 states and drawer movement variables", async () => {
    const css = await source("../src/overlays/overlays.css");
    const disclosureCss = await source("../src/disclosure/disclosure.css");

    expect(css).toContain('[data-swipe-direction="down"]');
    expect(css).toContain("--drawer-swipe-movement-x");
    expect(css).toContain("--drawer-swipe-movement-y");
    expect(css).toContain("--drawer-snap-point-offset");
    expect(css).toContain("[data-highlighted]");
    expect(css).toContain("[data-starting-style]");
    expect(disclosureCss).toContain("--accordion-panel-height");
    expect(disclosureCss).toContain("--collapsible-panel-height");
    expect(disclosureCss).toContain("[data-panel-open]");
  });

  it("limits shadows to genuinely elevated popup surfaces", async () => {
    const css = await source("../src/overlays/overlays.css");
    const disclosureCss = await source("../src/disclosure/disclosure.css");

    expect(css.match(/box-shadow:/g)).toHaveLength(1);
    expect(css).toMatch(
      /\.py-dialog-popup,\n\.py-drawer-popup,\n\.py-floating-popup[\s\S]*?box-shadow:/,
    );
    expect(disclosureCss).not.toContain("box-shadow");
  });
});
