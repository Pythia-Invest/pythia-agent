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
    expect(markup).toContain('data-slot="accordion-trigger"');
    expect(markup).toContain('data-slot="accordion-icon"');
    expect(markup).toContain('data-slot="accordion-panel-content"');
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
      /<div data-open="" data-disabled="" [^>]*data-slot="collapsible"/,
    );
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("disabled");
    expect(markup).toContain('data-slot="collapsible-panel"');
    expect(markup).toContain('data-slot="collapsible-icon"');
    expect(markup).toContain('data-slot="collapsible-panel-content"');
    expect(markup).toContain("Method details");
  });

  it("keeps accordion and collapsible visual anatomy distinct", async () => {
    const [accordion, collapsible, details] = await Promise.all(
      ["accordion", "collapsible", "details"].map((file) =>
        readFile(
          new URL(`../src/disclosure/${file}.tsx`, import.meta.url),
          "utf8",
        ),
      ),
    );
    // The accordion root has no top border; items separate themselves.
    expect(accordion).not.toMatch(/cnState\("[^"]*border-t/);
    expect(accordion).toContain("border-border border-b");
    // The collapsible is one bordered, raised container that fades once when disabled.
    expect(collapsible).toContain(
      "rounded-container border border-border bg-raised text-foreground data-disabled:opacity-disabled",
    );
    expect(collapsible).toContain("px-4 hover:bg-interaction-hover");
    expect(collapsible).toContain("border-border border-t p-4");
    expect(collapsible).not.toContain(
      "disabled:opacity-disabled disabled:cursor",
    );
    // Native details shows its own plus marker.
    expect(details).toContain("after:content-['+']");
    expect(details).toContain("group-open/details:after:rotate-45");
  });

  it("uses native details and summary elements without a client state owner", () => {
    const markup = renderToStaticMarkup(
      <Details.Root open>
        <Details.Summary>Assumptions</Details.Summary>
        <Details.Content>Stable synthetic context</Details.Content>
      </Details.Root>,
    );

    expect(markup).toMatch(
      /<details class="[^"]*" data-slot="details" open="">/,
    );
    expect(markup).toMatch(
      /<summary class="[^"]*" data-slot="details-summary">Assumptions<\/summary>/,
    );
    expect(markup).toContain('data-slot="details-content"');
  });
});
