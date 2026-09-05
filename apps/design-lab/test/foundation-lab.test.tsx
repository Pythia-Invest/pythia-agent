import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FoundationLab } from "../src/app/foundation-lab";

describe("Foundation Lab consumer specimens", () => {
  it("uses shared lockups and separates signal from warning by structure", () => {
    const html = renderToStaticMarkup(<FoundationLab />);

    expect(html).toContain("pythia-lockup--full");
    expect(html).toContain("pythia-lockup--compact");
    expect(html).toContain("Color with a job");
    expect(html).toContain("Pythia signal");
    expect(html).toContain("pythia-signal__seam");
    expect(html).toContain("Working capital is absorbing more cash.");
    expect(html).toContain("Machine assessment · synthetic");
    expect(html).toContain("confidence not supplied");
    expect(html).toContain(
      "Synthetic issuer filing · S1 · 2032-03-28 · delayed",
    );
    expect(html).toContain("Interface warning");
    expect(html).toContain("Check the source date");
    expect(html).toContain("lucide-triangle-alert");
    expect(html).toContain("Semantic reference");
    expect(html).not.toContain("A · Marker and surface");
    for (const group of [
      "Interface status",
      "Market movement",
      "Analytical impact",
      "Freshness",
      "Epistemic source",
    ]) {
      expect(html).toContain(group);
    }
  });

  it("removes the decision surface and consumes approved shared selection roles", async () => {
    const html = renderToStaticMarkup(<FoundationLab />);
    const css = await readFile(
      new URL("../src/app/globals.css", import.meta.url),
      "utf8",
    );

    expect(html).toContain(
      "Hover and press stay quiet and neutral. Persistent selection",
    );
    expect(html).toContain(
      "interaction-active surfaces for subtle current states",
    );
    expect(html).toContain("the primary pair for compact committed controls");
    expect(html).toContain("primary-color markers where fill is unnecessary");
    expect(html).toContain("Signal Amber remains reserved");
    expect(html).not.toContain("lab-state-");
    expect(css).not.toContain("lab-state-");
    expect(css).not.toContain("--lab-state-");
    const currentCatalogRow = css.match(
      /\.catalog-nav-group a\[aria-current="page"\]\s*\{[^}]*\}/,
    )?.[0];
    expect(currentCatalogRow).toContain("--py-interaction-active");
    expect(currentCatalogRow).toContain("font-weight: 600");
    expect(currentCatalogRow).not.toContain("box-shadow");
    expect(css).toMatch(
      /\.catalog-search input:focus-visible\s*\{[^}]*border-color:\s*var\(--py-border-strong\);[^}]*outline:[^}]*var\(--py-focus-ring\)/,
    );
    expect(css).not.toMatch(/--py-selection-[\w-]+/);
  });
});
