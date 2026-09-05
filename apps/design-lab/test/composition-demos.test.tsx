import { readdir, readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CatalogShell } from "../src/app/catalog-shell";
import {
  COMPOSITION_DEMO_DISCLAIMER,
  CompositionDemoFrame,
} from "../src/app/demonstrations/demo-frame";
import {
  compositionDemoEntryFromPathname,
  compositionDemoManifest,
} from "../src/composition-demos";
import {
  SYNTHETIC_COMPOSITION_FIXTURE_NOTICE,
  syntheticCompositionFixture,
} from "../src/composition-fixture";

vi.mock("next/navigation", () => ({
  usePathname: () => "/demonstrations/public-profile",
}));

const expectedDestinations = [
  {
    name: "Public profile",
    route: "/demonstrations/public-profile",
  },
  {
    name: "Product shell / density",
    route: "/demonstrations/product-shell-density",
  },
  {
    name: "Research / evidence semantics",
    route: "/demonstrations/research-evidence-semantics",
  },
] as const;

describe("Design Lab composition contracts", () => {
  it("registers exactly the three fixed destinations outside the component catalog", () => {
    expect(
      compositionDemoManifest.map(({ name, route }) => ({ name, route })),
    ).toEqual(expectedDestinations);
    expect(
      new Set(compositionDemoManifest.map((entry) => entry.route)).size,
    ).toBe(3);

    for (const entry of compositionDemoManifest) {
      expect(compositionDemoEntryFromPathname(entry.route)).toBe(entry);
      expect(entry.route).toMatch(
        /^\/demonstrations\/[a-z0-9]+(?:-[a-z0-9]+)*$/,
      );
    }
    expect(
      compositionDemoEntryFromPathname("/demonstrations/not-a-demo"),
    ).toBeUndefined();
  });

  it("exposes a separate discoverable navigation area", () => {
    const html = renderToStaticMarkup(
      <CatalogShell>
        <p>Reserved composition body</p>
      </CatalogShell>,
    );

    expect(html).toContain('aria-label="Composition demonstrations"');
    expect(html).toContain("Component compositions, never product screens.");
    for (const destination of expectedDestinations) {
      expect(html).toContain(`href="${destination.route}"`);
    }
    expect(html).toContain('aria-current="page"');
    expect(html).toContain(
      "Component composition demonstration · Labelled synthetic fixture",
    );
  });

  it("uses one shared frame to label a composition as synthetic and not a product screen", () => {
    for (const demo of compositionDemoManifest) {
      const html = renderToStaticMarkup(
        <CompositionDemoFrame demo={demo}>
          <p>Reserved body</p>
        </CompositionDemoFrame>,
      );

      expect(html).toContain(COMPOSITION_DEMO_DISCLAIMER);
      expect(html).toContain(SYNTHETIC_COMPOSITION_FIXTURE_NOTICE);
      expect(html).toContain(`data-composition-demo="${demo.key}"`);
      expect(html).toContain(demo.name);
    }
  });

  it("provides stable labelled finance shapes without a real-world claim", () => {
    expect(syntheticCompositionFixture.fixtureKind).toBe("labelled-synthetic");
    expect(syntheticCompositionFixture.notice).toBe(
      SYNTHETIC_COMPOSITION_FIXTURE_NOTICE,
    );
    expect(syntheticCompositionFixture.entity.qualifier).toContain("Fictional");
    expect(Object.values(syntheticCompositionFixture.dates)).toEqual([
      "2032-04-12",
      "2031-12-31",
      "2032-04-13",
    ]);
    expect(
      syntheticCompositionFixture.financialValues.map((value) => value.unit),
    ).toEqual(["millions", "percent"]);
    expect(
      syntheticCompositionFixture.citations.map((citation) => citation.marker),
    ).toEqual(["S1", "S2"]);
    expect(
      syntheticCompositionFixture.provenance.map((item) => item.epistemic),
    ).toEqual(["fact", "machine"]);
    expect(
      syntheticCompositionFixture.epistemicStates.map((state) => state.kind),
    ).toEqual(["fact", "machine", "human"]);
    expect(
      syntheticCompositionFixture.knowledgeStates.map((state) => state.state),
    ).toEqual([
      "no-evidence",
      "insufficient-coverage",
      "stale",
      "unavailable",
      "failed",
    ]);
    expect(syntheticCompositionFixture.marketMovement.direction).toBe("up");
    expect(syntheticCompositionFixture.signal.label).toBe("Pythia signal");
    expect(
      syntheticCompositionFixture.semanticMessages.map(
        (message) => message.tone,
      ),
    ).toEqual(["info", "warning", "error"]);

    const fixtureText = JSON.stringify(syntheticCompositionFixture);
    expect(fixtureText).not.toMatch(/customer|\breturns?\b|\bperformance\b/i);
    expect(fixtureText).not.toMatch(
      /Apple|Microsoft|Nvidia|Tesla|Amazon|Alphabet|Meta|Pythia Invest/i,
    );
  });

  it("keeps fixture ownership Lab-local and every fixed route framed", async () => {
    const appRoot = new URL("../src/app/demonstrations/", import.meta.url);
    const routeDirectories = (await readdir(appRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(routeDirectories).toEqual([
      "product-shell-density",
      "public-profile",
      "research-evidence-semantics",
    ]);

    for (const demo of compositionDemoManifest) {
      const slug = demo.route.slice("/demonstrations/".length);
      const source = await readFile(
        new URL(`${slug}/page.tsx`, appRoot),
        "utf8",
      );
      expect(source).toContain("<CompositionDemoFrame");
      expect(source).not.toContain("syntheticCompositionFixture");
    }

    const packageFiles = await listSourceFiles(
      new URL("../../../packages/ui/src/", import.meta.url),
    );
    const packageSource = (
      await Promise.all(packageFiles.map((file) => readFile(file, "utf8")))
    ).join("\n");
    expect(packageSource).not.toMatch(
      /composition-fixture|@pythia\/design-lab|apps\/design-lab/,
    );
  });
});

async function listSourceFiles(directory: URL): Promise<URL[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: URL[] = [];

  for (const entry of entries) {
    const child = new URL(
      `${entry.name}${entry.isDirectory() ? "/" : ""}`,
      directory,
    );
    if (entry.isDirectory()) {
      files.push(...(await listSourceFiles(child)));
    } else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
      files.push(child);
    }
  }

  return files;
}
