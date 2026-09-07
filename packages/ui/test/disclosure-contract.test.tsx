import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Accordion } from "../src/disclosure/accordion";
import { Collapsible } from "../src/disclosure/collapsible";
import { Details } from "../src/disclosure/details";

describe("disclosure semantics", () => {
  it("preserves native accordion expanded state", () => {
    const markup = renderToStaticMarkup(
      <Accordion.Root defaultValue={["thesis"]}>
        <Accordion.Item value="thesis">
          <Accordion.Header>
            <Accordion.Trigger>Thesis</Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Panel>Supporting context</Accordion.Panel>
        </Accordion.Item>
      </Accordion.Root>,
    );
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("Supporting context");
  });

  it("preserves controlled collapsible state and linkage", () => {
    const markup = renderToStaticMarkup(
      <Collapsible.Root disabled open>
        <Collapsible.Trigger>Method</Collapsible.Trigger>
        <Collapsible.Panel>Method details</Collapsible.Panel>
      </Collapsible.Root>,
    );
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("disabled");
    expect(markup).toContain("Method details");
  });

  it("uses native details and summary elements", () => {
    const markup = renderToStaticMarkup(
      <Details.Root open>
        <Details.Summary>Assumptions</Details.Summary>
        <Details.Content>Stable synthetic context</Details.Content>
      </Details.Root>,
    );
    expect(markup).toContain("<details");
    expect(markup).toContain("<summary");
    expect(markup).toContain("Assumptions");
  });
});
