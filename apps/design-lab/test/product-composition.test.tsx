import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ProductShellDensityCompositionPage from "../src/app/demonstrations/product-shell-density/page";
import { ProductShellComposition } from "../src/app/demonstrations/product-shell-density/product-shell-composition";
import { syntheticCompositionFixture } from "../src/composition-fixture";

const routeDirectory = new URL(
  "../src/app/demonstrations/product-shell-density/",
  import.meta.url,
);

describe("Product shell-and-density composition", () => {
  it("renders inside the shared composition frame with stable synthetic fixture data", () => {
    const html = renderToStaticMarkup(<ProductShellDensityCompositionPage />);

    expect(html).toContain(
      "Component composition demonstration — not a product screen.",
    );
    expect(html).toContain('data-composition-demo="product-shell-density"');
    expect(html).toContain(syntheticCompositionFixture.notice);
    expect(html).toContain(syntheticCompositionFixture.entity.name);
    expect(html).toContain(
      syntheticCompositionFixture.financialValues[0].display,
    );
  });

  it("shows the compact shell, stable navigation, explicit boundaries, and one integrated composer", () => {
    const html = renderToStaticMarkup(<ProductShellComposition />);

    expect(html).toContain(
      'aria-label="Product shell-and-density component composition"',
    );
    expect(html).toContain('data-density="moderately-compact"');
    expect(html).toContain('data-responsive-minimum="320px"');
    expect(html).toContain('aria-label="Stable synthetic shell navigation"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("No synthetic notes");
    expect(html).toContain("lucide-notebook-text");
    expect(html).toContain("Insufficient coverage");
    expect(html).toContain('aria-label="Integrated conversational affordance"');
    expect(html).toContain("Conversation affordance");
    expect(html).toContain("no request is sent");
    expect(html).toContain("Send unavailable");
    expect(html.match(/<textarea/g)).toHaveLength(1);
    expect(html).not.toMatch(/<table|role="grid"|<canvas/i);
  });

  it("uses only the shared package and the local synthetic fixture", async () => {
    const pageSource = await readFile(
      new URL("page.tsx", routeDirectory),
      "utf8",
    );
    const compositionSource = await readFile(
      new URL("product-shell-composition.tsx", routeDirectory),
      "utf8",
    );

    expect(pageSource).toContain('from "../demo-frame"');
    expect(pageSource).toContain("<CompositionDemoFrame");
    expect(compositionSource).toContain('from "@pythia/ui"');
    expect(compositionSource).toContain('from "../../../composition-fixture"');
    expect(compositionSource).not.toMatch(
      /@pythia\/ui\/|apps\/web|(?:^|\/)web\/src|Desk|workup|workflow|transcript|screener|data[- ]?grid|chart/i,
    );
  });

  it("responds to its actual containers and keeps semantic-token styling route-local", async () => {
    const css = await readFile(
      new URL("product-shell-composition.module.css", routeDirectory),
      "utf8",
    );

    expect(css).toContain("container-name: product-demo");
    expect(css).toContain("container-name: product-workspace");
    expect(css).toContain("@container product-demo (max-width: 46rem)");
    expect(css).toContain("@container product-workspace (max-width: 34rem)");
    expect(css).toMatch(
      /@container product-workspace \(max-width: 34rem\)[\s\S]*?\.contextList > div \+ div\s*\{[^}]*border-block-start:/,
    );
    expect(css).toContain("min-inline-size: 0");
    expect(css).toContain("overflow-x: auto");
    expect(css).toMatch(
      /var\(--py-(?:surface|text|border|space|radius|font|line)/,
    );
    expect(css).not.toContain("--py-space-5");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });
});
