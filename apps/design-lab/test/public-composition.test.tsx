import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PublicProfileCompositionPage from "../src/app/demonstrations/public-profile/page";
import { PublicProfileComposition } from "../src/app/demonstrations/public-profile/public-composition";
import {
  COMPOSITION_DEMO_DISCLAIMER,
  CompositionDemoFrame,
} from "../src/app/demonstrations/demo-frame";
import { publicProfileCompositionDemo } from "../src/composition-demos";
import { syntheticCompositionFixture } from "../src/composition-fixture";

const routeDirectory = new URL(
  "../src/app/demonstrations/public-profile/",
  import.meta.url,
);

describe("Public-profile composition demonstration", () => {
  it("renders inside the shared non-product frame with synthetic fixture content", () => {
    const html = renderToStaticMarkup(<PublicProfileCompositionPage />);

    expect(html).toContain(COMPOSITION_DEMO_DISCLAIMER);
    expect(html).toContain('data-composition-demo="public-profile"');
    expect(html).toContain('data-public-composition="true"');
    expect(html).toContain("Concept preview · Synthetic");
    expect(html).toContain(syntheticCompositionFixture.entity.name);
    expect(html).toContain(
      syntheticCompositionFixture.financialValues[0].display,
    );
    expect(html).toContain(syntheticCompositionFixture.citations[0].locator);
    expect(html).toContain(syntheticCompositionFixture.signal.title);
    expect(html).toContain(
      "not a live site, product view, or investment conclusion",
    );
  });

  it("composes approved components only from the public package entry", async () => {
    const source = await readFile(
      new URL("public-composition.tsx", routeDirectory),
      "utf8",
    );
    const packageImport = source.match(
      /import \{([\s\S]*?)\} from "@pythia\/ui";/,
    );

    expect(packageImport?.[1]).toBeDefined();
    for (const component of [
      "Badge",
      "Card",
      "Citation",
      "Container",
      "FinancialValue",
      "Inline",
      "LinkButton",
      "Provenance",
      "PythiaLockup",
      "PythiaSignal",
      "Stack",
    ]) {
      expect(packageImport?.[1]).toContain(component);
    }
    expect(source).not.toMatch(/@pythia\/ui\//);
    expect(source).not.toMatch(/\.\.\/\.\.\/examples|catalog-/);
  });

  it("uses the stable Lab-local fixture and shared demonstration frame", async () => {
    const [pageSource, compositionSource] = await Promise.all([
      readFile(new URL("page.tsx", routeDirectory), "utf8"),
      readFile(new URL("public-composition.tsx", routeDirectory), "utf8"),
    ]);

    expect(pageSource).toContain("<CompositionDemoFrame");
    expect(pageSource).toContain("<PublicProfileComposition");
    expect(compositionSource).toContain(
      'import { syntheticCompositionFixture } from "../../../composition-fixture"',
    );

    const framedHtml = renderToStaticMarkup(
      <CompositionDemoFrame demo={publicProfileCompositionDemo}>
        <PublicProfileComposition />
      </CompositionDemoFrame>,
    );
    expect(framedHtml).toContain(syntheticCompositionFixture.notice);
  });

  it("keeps a semantic, responsive 320px-safe CSS contract for both themes", async () => {
    const css = await readFile(
      new URL("public-profile.module.css", routeDirectory),
      "utf8",
    );

    expect(css).toContain("var(--py-profile-atmosphere)");
    expect(css).toContain("var(--py-surface-canvas)");
    expect(css).toContain("var(--py-text-primary)");
    expect(css).toContain("min-inline-size: 0");
    expect(css).toContain("overflow-wrap: anywhere");
    expect(css).toContain("@media (max-width: 48rem)");
    expect(css).toContain("@media (max-width: 30rem)");
    expect(css).toContain("grid-template-columns: 1fr");
    expect(css).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(|hsla?\(/i);
    expect(css).not.toMatch(/\[data-theme=|data-pythia-profile/);
  });

  it("contains no homepage, conversion, or fabricated product claims", async () => {
    const source = await readFile(
      new URL("public-composition.tsx", routeDirectory),
      "utf8",
    );

    expect(source).not.toMatch(
      /homepage|sign up|book a demo|start free|join now|subscribe|trusted by|customers?|guaranteed|outperform|beat the market|shipped feature/i,
    );
    expect(source).not.toMatch(/<form|onSubmit|onClick|useState|useEffect/);
  });
});
