import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CitationPagesProvider, SourceList } from "@/components/chat/citations";
import type { DeskUIMessage } from "@/client/chat-message";

const COUNT = 100;
const sources = Array.from({ length: COUNT }, (_, index) => ({
  url: `https://site${index}.example.com/page`,
  label: `Example ${index}`,
}));
const search: DeskUIMessage["parts"] = [
  {
    type: "dynamic-tool",
    toolCallId: "call-1",
    toolName: "web_search",
    input: { query: "example" },
    state: "output-available",
    output: JSON.stringify({
      success: true,
      data: {
        web: sources.slice(0, 5).map((source, index) => ({
          url: source.url,
          title: `Headline ${index} - Example`,
          description: `Headline ${index} [More](https://x.example) about **it**.`,
        })),
      },
    }),
  },
];

describe("source list", () => {
  it("lists a deep dive's hundred sources, each once, with lazy icons", () => {
    const html = renderToStaticMarkup(
      <CitationPagesProvider parts={search}>
        <SourceList sources={sources} />
      </CitationPagesProvider>,
    );
    expect(html.match(/<li>/gu)).toHaveLength(COUNT);
    expect(html.match(/loading="lazy"/gu)).toHaveLength(COUNT);
    // A searched page reads as a result: its title and a clean snippet.
    expect(html).toContain("Headline 0 - Example");
    expect(html).toContain("More about it.");
    expect(html).not.toContain("https://x.example");
  });
});
