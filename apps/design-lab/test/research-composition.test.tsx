import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ResearchEvidenceSemanticsCompositionPage from "../src/app/demonstrations/research-evidence-semantics/page";
import { COMPOSITION_DEMO_DISCLAIMER } from "../src/app/demonstrations/demo-frame";
import { SYNTHETIC_COMPOSITION_FIXTURE_NOTICE } from "../src/composition-fixture";

const routeRoot = new URL(
  "../src/app/demonstrations/research-evidence-semantics/",
  import.meta.url,
);

describe("research and evidence composition", () => {
  it("renders every required supplied semantic in the shared synthetic frame", () => {
    const html = renderToStaticMarkup(
      <ResearchEvidenceSemanticsCompositionPage />,
    );

    expect(html).toContain(COMPOSITION_DEMO_DISCLAIMER);
    expect(html).toContain(SYNTHETIC_COMPOSITION_FIXTURE_NOTICE);
    expect(html).toContain(
      'data-composition-demo="research-evidence-semantics"',
    );
    expect(html).toContain('data-research-evidence-composition="true"');
    expect(html).toContain('data-responsive-minimum="320px"');
    expect(html).toContain(
      "This presentation neither verifies nor infers their meaning.",
    );

    for (const label of [
      "Sourced fact",
      "Machine assessment",
      "Human judgment",
      "Period",
      "Basis",
      "Current",
      "Delayed",
      "Up",
      "+1.8%",
      "Pythia signal",
      "No evidence found",
      "Insufficient coverage",
      "Stale source",
      "Calculation unavailable",
      "Operation failed",
    ]) {
      expect(html).toContain(label);
    }

    for (const citation of [
      {
        marker: "S1",
        locator: "Invented filing · page 42",
        published: "2032-03-28",
        retrieved: "2032-04-13",
        source: "Synthetic issuer filing",
      },
      {
        marker: "S2",
        locator: "Invented notice · paragraph 7",
        published: "2032-04-12",
        retrieved: "2032-04-13",
        source: "Synthetic market notice",
      },
    ]) {
      expect(html).toContain(`aria-label="Citation ${citation.marker}"`);
      expect(html).toContain(citation.source);
      expect(html).toContain(citation.published);
      expect(html).toContain(citation.retrieved);
      expect(html).toContain(citation.locator);
    }
  });

  it("keeps evidence beside the conclusion and market observation it supports", () => {
    const html = renderToStaticMarkup(
      <ResearchEvidenceSemanticsCompositionPage />,
    );
    const conclusionSection = sectionMarkup(
      html,
      'data-composition-section="conclusion-and-evidence"',
    );
    const marketSection = sectionMarkup(
      html,
      'data-composition-section="finance-and-market"',
    );

    expect(conclusionSection).toContain('data-evidence-pair="fact"');
    expect(conclusionSection).toContain("Supplied synthetic fact");
    expect(conclusionSection).toContain("€486m");
    expect(conclusionSection).toContain('aria-label="Citation S1"');
    expect(marketSection).toContain('data-evidence-pair="market"');
    expect(marketSection).toContain("+1.8%");
    expect(marketSection).toContain('aria-label="Citation S2"');
    expect(html).not.toMatch(/bibliography|all sources|sources at the bottom/i);
  });

  it("uses only the public package barrel and the established route-local contracts", async () => {
    const [pageSource, compositionSource, css] = await Promise.all([
      readFile(new URL("page.tsx", routeRoot), "utf8"),
      readFile(new URL("research-composition.tsx", routeRoot), "utf8"),
      readFile(new URL("research-composition.module.css", routeRoot), "utf8"),
    ]);

    expect(pageSource).toContain("<CompositionDemoFrame");
    expect(pageSource).toContain("<ResearchEvidenceComposition");
    expect(pageSource).not.toContain("syntheticCompositionFixture");
    expect(compositionSource).toContain(
      'import { syntheticCompositionFixture } from "../../../composition-fixture";',
    );
    expect(compositionSource).toMatch(/from "@pythia\/ui";/);
    expect(compositionSource).not.toMatch(
      /@pythia\/ui\/|packages\/ui|from "next\//,
    );

    for (const component of [
      "Citation",
      "EpistemicLabel",
      "FinancialValue",
      "KnowledgeState",
      "MarketDirection",
      "Provenance",
      "PythiaSignal",
    ]) {
      expect(compositionSource).toContain(`<${component}`);
    }

    expect(css).not.toMatch(/#[\da-f]{3,8}|rgba?\(|hsla?\(/i);
    expect(css).toContain("@media (max-width: 44rem)");
    expect(css).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(css).toContain("min-inline-size: 0");
  });

  it("stays a component demonstration without real research or product claims", () => {
    const html = renderToStaticMarkup(
      <ResearchEvidenceSemanticsCompositionPage />,
    );

    expect(html).toContain("Component composition demonstration");
    expect(html).toContain("Labelled synthetic fixture");
    expect(html).not.toMatch(
      /\b(buy|sell|hold|target price|recommendation|portfolio|customer|performance|returns?)\b/i,
    );
    expect(html).not.toMatch(
      /\b(?:Apple|Microsoft|Nvidia|Tesla|Amazon|Alphabet|Meta)\b/i,
    );
  });
});

function sectionMarkup(html: string, marker: string): string {
  const start = html.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = html.indexOf("</section>", start);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}
