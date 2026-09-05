import { Accordion as BaseAccordion } from "@base-ui/react/accordion";
import { Collapsible as BaseCollapsible } from "@base-ui/react/collapsible";
import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Accordion } from "../src/disclosure/accordion";
import { Collapsible } from "../src/disclosure/collapsible";
import { Details } from "../src/disclosure/details";

describe("disclosure contracts", () => {
  it("wraps Base UI accordion anatomy and preserves native expanded semantics", () => {
    const markup = renderToStaticMarkup(
      <Accordion.Root defaultValue={["thesis"]}>
        <Accordion.Item value="thesis">
          <Accordion.Header>
            <Accordion.Trigger>Thesis</Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Panel>
            <div>Supporting context</div>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion.Root>,
    );

    expect(BaseAccordion.Root).toBeDefined();
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("py-accordion-trigger");
    expect(markup).toContain("py-accordion-icon");
    expect(markup).toContain("py-accordion-panel-content");
    expect(markup).toContain("Supporting context");
  });

  it("wraps Base UI collapsible controlled state and linkage", () => {
    const markup = renderToStaticMarkup(
      <Collapsible.Root disabled open>
        <Collapsible.Trigger>Method</Collapsible.Trigger>
        <Collapsible.Panel>
          <div>Method details</div>
        </Collapsible.Panel>
      </Collapsible.Root>,
    );

    expect(typeof BaseCollapsible.Root).toBe("object");
    expect(markup).toMatch(
      /<div data-open="" data-disabled="" class="py-collapsible">/,
    );
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("disabled");
    expect(markup).toContain("py-collapsible-panel");
    expect(markup).toContain("py-collapsible-icon");
    expect(markup).toContain("py-collapsible-panel-content");
    expect(markup).toContain("Method details");
  });

  it("keeps accordion and collapsible visual anatomy distinct", async () => {
    const css = await readFile(
      new URL("../src/disclosure/disclosure.css", import.meta.url),
      "utf8",
    );
    expect(css).not.toMatch(/\.py-accordion\s*\{[^}]*border-block-start:/);
    expect(css).toMatch(
      /\.py-collapsible\s*\{[^}]*border:[^}]*border-radius:[^}]*background:\s*var\(--py-surface-raised\)/,
    );
    expect(css).toMatch(
      /\.py-collapsible\[data-disabled\]\s*\{[^}]*opacity:\s*var\(--py-disabled-opacity\)/,
    );
    expect(css).toMatch(
      /\.py-collapsible-trigger:hover\s*\{[^}]*background:\s*var\(--py-interaction-hover\)/,
    );
    expect(css).toMatch(
      /\.py-collapsible-trigger\s*\{[^}]*padding-inline:\s*var\(--py-space-4\)/,
    );
    expect(css).toMatch(
      /\.py-collapsible-panel-content\s*\{[^}]*padding:\s*var\(--py-space-4\)/,
    );
    expect(css).not.toMatch(
      /\.py-collapsible-trigger:disabled\s*\{[^}]*opacity:/,
    );
    expect(css).toContain(".py-details-summary::after");
  });

  it("uses native details and summary elements without a client state owner", () => {
    const markup = renderToStaticMarkup(
      <Details.Root open>
        <Details.Summary>Assumptions</Details.Summary>
        <Details.Content>Stable synthetic context</Details.Content>
      </Details.Root>,
    );

    expect(markup).toContain('<details class="py-details" open="">');
    expect(markup).toContain(
      '<summary class="py-details-summary">Assumptions</summary>',
    );
    expect(markup).toContain("py-details-content");
  });
});
