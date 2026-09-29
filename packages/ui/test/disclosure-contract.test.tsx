import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Details } from "../src/disclosure/details";

describe("disclosure semantics", () => {
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
