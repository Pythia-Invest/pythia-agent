import { readdir, readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { componentCatalog } from "../src/catalog";
import {
  catalogEntryFromSlug,
  catalogEntryFromPathname,
  catalogRouteFromSlug,
  searchCatalog,
} from "../src/catalog-routing";
import { CatalogShell } from "../src/app/catalog-shell";
import { ComponentPreview } from "../src/app/examples/component-preview";
import { applyDesignProfile } from "../src/app/lab-controls";
import { compositionDemoManifest } from "../src/composition-demos";

vi.mock("next/navigation", () => ({
  usePathname: () => "/components/button",
}));

describe("Design Lab interactive explorer", () => {
  it("maps every catalog entry to an intentional renderable live preview", () => {
    expect(componentCatalog).toHaveLength(62);

    for (const entry of componentCatalog) {
      expect(() =>
        renderToStaticMarkup(<ComponentPreview entry={entry} />),
      ).not.toThrow();
    }
  });

  it("uses native Lucide icons without hand-authored inline SVG source", async () => {
    const appRoot = new URL("../src/app/", import.meta.url);
    const sourcePaths = (await readdir(appRoot, { recursive: true })).filter(
      (path) => path.endsWith(".tsx"),
    );
    const source = (
      await Promise.all(
        sourcePaths.map((path) => readFile(new URL(path, appRoot), "utf8")),
      )
    ).join("\n");

    expect(source).toContain('from "lucide-react"');
    expect(source).not.toMatch(/<svg\b/);

    for (const [route, icons] of [
      ["/components/icon-button", ["plus", "bookmark", "trash-2"]],
      ["/components/empty-state", ["inbox"]],
    ] as const) {
      const entry = catalogEntryFromPathname(route);
      if (!entry) throw new Error(`Missing catalog entry: ${route}`);
      const html = renderToStaticMarkup(<ComponentPreview entry={entry} />);

      for (const icon of icons) {
        expect(html).toContain(`lucide-${icon}`);
      }
    }
  });

  it("shows one canonical Pythia signal and removes rejected decision directions", async () => {
    const signalEntry = componentCatalog.find(
      (entry) => entry.route === "/components/pythia-signal",
    );
    if (!signalEntry)
      throw new Error("Pythia signal entry unexpectedly missing");

    const [html, preview, css] = await Promise.all([
      Promise.resolve(
        renderToStaticMarkup(<ComponentPreview entry={signalEntry} />),
      ),
      readFile(
        new URL("../src/app/examples/previews-semantics.tsx", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../src/app/globals.css", import.meta.url), "utf8"),
    ]);

    expect(html.match(/data-slot="pythia-signal"/g)).toHaveLength(1);
    expect(html).toContain("Pythia signal");
    expect(html).toContain('data-slot="pythia-signal-seam"');
    expect(preview).toContain('Specimen label="Canonical Oracle seam"');
    expect(`${preview}\n${css}`).not.toMatch(
      /(?:Provisional Pythia Signal directions|A\/B\/C|Inference node|Lens field|catalog-signal-direction)/,
    );
  });

  it("looks up every known slug and leaves unknown routes unresolved", () => {
    for (const entry of componentCatalog) {
      const slug = entry.route.slice("/components/".length);
      expect(catalogRouteFromSlug(slug)).toBe(entry.route);
      expect(catalogEntryFromSlug(slug)).toBe(entry);
      expect(catalogEntryFromPathname(entry.route)).toBe(entry);
    }

    expect(catalogEntryFromSlug("not-a-component")).toBeUndefined();
    expect(catalogEntryFromSlug("button/nested")).toBeUndefined();
  });

  it("keeps every destination reachable with grouped navigation and metadata search", () => {
    const current = componentCatalog[0];
    if (!current) throw new Error("Catalog unexpectedly empty");
    const html = renderToStaticMarkup(
      <CatalogShell>
        <div>Synthetic preview</div>
      </CatalogShell>,
    );

    for (const entry of componentCatalog) {
      expect(html).toContain(`href="${entry.route}"`);
      expect(searchCatalog(entry.name)).toContain(entry);
      for (const keyword of entry.search) {
        expect(searchCatalog(keyword)).toContain(entry);
      }
    }
    for (const demo of compositionDemoManifest) {
      expect(html).toContain(`href="${demo.route}"`);
    }
    expect(html).toContain('aria-label="Composition demonstrations"');
    expect(html).toContain("Component compositions, never product screens.");
    expect(html).toContain("<details");
    expect(html).not.toContain('open=""');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("Foundation surface");
    expect(searchCatalog("one-time code").map((entry) => entry.name)).toEqual([
      "OTP field",
    ]);
    expect(
      searchCatalog("selection options").map((entry) => entry.name),
    ).toEqual(["Select"]);
    expect(searchCatalog("impossible synthetic query")).toEqual([]);
  });

  it("keeps catalog state in the persistent components layout", async () => {
    const appRoot = new URL("../src/app/", import.meta.url);
    const [layout, page, shell] = await Promise.all([
      readFile(new URL("components/layout.tsx", appRoot), "utf8"),
      readFile(new URL("components/[slug]/page.tsx", appRoot), "utf8"),
      readFile(new URL("catalog-shell.tsx", appRoot), "utf8"),
    ]);
    expect(layout).toContain("<CatalogShell>{children}</CatalogShell>");
    expect(page).not.toContain("CatalogShell");
    expect(shell).toContain("usePathname()");
    expect(shell).not.toMatch(/sessionStorage|scrollTo|scrollRestoration/);
  });

  it("contains intrinsically wide specimens without masking document overflow", async () => {
    const css = await readFile(
      new URL("../src/app/globals.css", import.meta.url),
      "utf8",
    );

    expect(css).toMatch(
      /\.catalog-specimen-stage\s*\{[^}]*min-inline-size:\s*0;[^}]*overflow-x:\s*auto;/,
    );
    expect(css).not.toMatch(/(?:html|body)\s*\{[^}]*overflow-x:\s*hidden/);
  });

  it("keeps focus rings and press motion inside every specimen scrollport", async () => {
    const appRoot = new URL("../src/app/", import.meta.url);
    const [css, forms, actions] = await Promise.all([
      readFile(new URL("globals.css", appRoot), "utf8"),
      readFile(new URL("examples/previews-forms.tsx", appRoot), "utf8"),
      readFile(new URL("examples/previews-actions.tsx", appRoot), "utf8"),
    ]);

    expect(css).toMatch(
      /\.catalog-specimen-stage\s*\{[^}]*padding:\s*calc\(var\(--py-focus-width\) \+ 2px\)/,
    );
    expect(css).not.toMatch(
      /\.catalog-field-list\s*\{[^}]*padding(?:-inline)?:/,
    );
    expect(forms.match(/className="catalog-field-list"/g)).toHaveLength(5);
    expect(forms).toContain("<OTPField");
    expect(actions).toContain("<ButtonGroup");
  });

  it("keeps the native Dialog close path while protecting primary interaction", async () => {
    const appRoot = new URL("../src/app/", import.meta.url);
    const [css, overlays] = await Promise.all([
      readFile(new URL("globals.css", appRoot), "utf8"),
      readFile(new URL("examples/previews-overlays.tsx", appRoot), "utf8"),
    ]);
    const primary = css.match(/\.catalog-trigger-primary\s*\{[^}]*\}/)?.[0];
    const hover = css.match(/\.catalog-trigger-primary:hover\s*\{[^}]*\}/)?.[0];
    const active = css.match(
      /\.catalog-trigger-primary:active\s*\{[^}]*\}/,
    )?.[0];

    expect(overlays).toContain("<Dialog.Close");
    expect(overlays).toContain(
      'className="catalog-trigger catalog-trigger-primary"',
    );
    expect(primary).toContain("opacity var(--py-motion-fast)");
    expect(primary).toContain("translate var(--py-motion-fast)");
    for (const state of [hover, active]) {
      expect(state).toContain(
        "background: var(--py-action-primary-background)",
      );
      expect(state).toContain("color: var(--py-action-primary-foreground)");
      expect(state).not.toContain("--py-interaction-hover");
      expect(state).not.toContain("--py-text-primary");
    }
    expect(hover).toContain("opacity: 0.85");
    expect(active).toContain("opacity: 0.75");
    expect(active).toContain("translate: 0 1px");
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.catalog-trigger-primary:active\s*\{[^}]*translate:\s*none/,
    );
  });

  it("keeps danger actions, anchored previews, and grouped context menus conventional", async () => {
    const appRoot = new URL("../src/app/", import.meta.url);
    const [css, overlays, selection] = await Promise.all([
      readFile(new URL("globals.css", appRoot), "utf8"),
      readFile(new URL("examples/previews-overlays.tsx", appRoot), "utf8"),
      readFile(new URL("examples/previews-selection.tsx", appRoot), "utf8"),
    ]);
    expect(
      overlays.match(/className="catalog-trigger catalog-trigger-danger"/g),
    ).toHaveLength(2);
    for (const state of ["hover", "active"] as const) {
      const rule = css.match(
        new RegExp(`\\.catalog-trigger-danger:${state}\\s*\\{[^}]*\\}`),
      )?.[0];
      expect(rule).toContain("background: var(--py-status-error-surface)");
      expect(rule).toContain("color: var(--py-status-error-foreground)");
      expect(rule).toContain("border-color: var(--py-status-error-border)");
    }
    expect(css).toMatch(
      /\.catalog-preview-link\s*\{[^}]*inline-size:\s*fit-content;[^}]*justify-self:\s*start/,
    );
    expect(overlays).toMatch(
      /<ContextMenu\.Group>[\s\S]*<ContextMenu\.GroupLabel>[\s\S]*<\/ContextMenu\.Group>/,
    );
    expect(selection).toMatch(
      /<div className="catalog-select-demo">\s*<Combobox defaultValue="Quality" items=\{choices\}>/,
    );
    expect(selection).toMatch(
      /<ComboboxList>\s*\{\(choice: \(typeof choices\)\[number\]\) => \(/,
    );
    expect(selection).not.toContain("choices.map");
    expect(css).toMatch(
      /\.catalog-menu-links\s*\{[^}]*min-inline-size:\s*10\.5rem/,
    );
  });

  it("uses a valid length for every Lab focus outline offset", async () => {
    const css = await readFile(
      new URL("../src/app/globals.css", import.meta.url),
      "utf8",
    );
    const outlineOffsets = [...css.matchAll(/outline-offset:\s*([^;]+);/g)].map(
      (match) => match[1],
    );

    expect(outlineOffsets).toEqual(["2px", "2px"]);
    expect(css).not.toContain("outline-offset: var(--py-focus-offset)");
  });

  it("pairs disabled standalone choices with equally faded Lab labels", async () => {
    const appRoot = new URL("../src/app/", import.meta.url);
    const [preview, css] = await Promise.all([
      readFile(new URL("examples/previews-selection.tsx", appRoot), "utf8"),
      readFile(new URL("globals.css", appRoot), "utf8"),
    ]);

    expect(
      preview.match(/className="catalog-choice-row" data-disabled=""/g),
    ).toHaveLength(3);
    expect(preview.match(/data-disabled-label=""/g)).toHaveLength(3);
    expect(css).toMatch(
      /\.catalog-choice-row\[data-disabled\] > \[data-disabled-label\]\s*\{[^}]*opacity:\s*var\(--py-disabled-opacity\)/,
    );
    expect(css).not.toContain(".catalog-choice-row[data-disabled] > span");
    expect(css).not.toMatch(/\.catalog-choice-row\[data-disabled\]\s*\{/);
  });

  it("translates only closed design-profile state onto the one document root", () => {
    const root = { dataset: { pythiaProfile: "public" } };

    expect(applyDesignProfile(root, "product")).toBe("product");
    expect(root.dataset.pythiaProfile).toBe("product");
    expect(applyDesignProfile(root, "amber-product")).toBeNull();
    expect(root.dataset.pythiaProfile).toBe("product");
    expect(applyDesignProfile(root, "public")).toBe("public");
    expect(root.dataset.pythiaProfile).toBe("public");
  });

  it("keeps the fixed composition area free of docs and registry machinery", async () => {
    const appRoot = new URL("../src/app/", import.meta.url);
    const topLevel = await readdir(appRoot);
    const sourceFiles = [
      "catalog-shell.tsx",
      "examples/component-preview.tsx",
      "examples/specimen.tsx",
      "examples/previews-navigation.tsx",
      "demonstrations/demo-frame.tsx",
      "globals.css",
    ];
    const source = (
      await Promise.all(
        sourceFiles.map((file) => readFile(new URL(file, appRoot), "utf8")),
      )
    ).join("\n");

    expect(topLevel).toContain("demonstrations");
    expect(topLevel).not.toContain("docs");
    expect(source).not.toMatch(
      /(?:API table|code viewer|copy code|anatomy editor|token editor|coming soon)/i,
    );
    expect(source).not.toMatch(
      /(?:previewRegistry|demoRegistry|componentSchema|generateRegistry)/,
    );
    expect(source).not.toMatch(
      /(?:Provisional selection directions|catalog-decision-grid|catalog-selection-direction)/,
    );
  });
});
