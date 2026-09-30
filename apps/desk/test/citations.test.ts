import { describe, expect, it } from "vitest";
import {
  citationPages,
  citedSources,
  type HastNode,
  rehypeCitations,
} from "@/components/chat/citations";

const text = (value: string): HastNode => ({ type: "text", value });
const link = (
  label: string,
  href = "https://news.example.com/a",
): HastNode => ({
  type: "element",
  tagName: "a",
  properties: { href },
  children: [text(label)],
});
const paragraph = (...children: HastNode[]): HastNode => ({
  type: "element",
  tagName: "p",
  properties: {},
  children,
});

function cited(tree: HastNode) {
  rehypeCitations()(tree);
  const labels: string[] = [];
  const walk = (node: HastNode) => {
    if (node.tagName === "a" && node.properties?.dataCitation === true)
      labels.push(String(node.children?.[0]?.value));
    node.children?.forEach(walk);
  };
  walk(tree);
  return labels;
}

describe("web citations", () => {
  it("cites a link placed right after a sentence", () => {
    expect(
      cited(paragraph(text("Revenue rose 12%. "), link("Example News"))),
    ).toEqual(["Example News"]);
  });

  it("groups adjacent citations into the first, in order", () => {
    const tree = paragraph(
      text("Revenue rose 12%. "),
      link("Example News", "https://news.example.com/a"),
      text(" "),
      link("Example Wire", "https://wire.example.org/b"),
      text(" More text follows. "),
      link("Example Daily", "https://daily.example.net/c"),
    );
    expect(cited(tree)).toEqual(["Example News", "Example Daily"]);
    const first = tree.children?.[1] as HastNode;
    expect(citedSources(first.properties?.dataSources)).toEqual([
      { href: "https://news.example.com/a", label: "Example News" },
      { href: "https://wire.example.org/b", label: "Example Wire" },
    ]);
    const last = tree.children?.at(-1) as HastNode;
    expect(last.properties?.dataSources).toBeUndefined();
  });

  it("rejects grouped sources that are not web links", () => {
    expect(
      citedSources(
        JSON.stringify([{ href: "javascript:alert(1)", label: "x" }]),
      ),
    ).toBeNull();
  });

  it("finds citations inside lists and after closing quotes", () => {
    const item: HastNode = {
      type: "element",
      tagName: "li",
      children: [
        paragraph(text("It said “demand is strong.” "), link("Example News")),
      ],
    };
    expect(cited({ type: "root", children: [item] })).toEqual(["Example News"]);
  });

  it("keeps links in running text, on their own, after a colon, or long", () => {
    expect(
      cited(
        paragraph(
          text("According to "),
          link("this filing"),
          text(" margins fell."),
        ),
      ),
    ).toEqual([]);
    expect(cited(paragraph(link("Price/Earnings Ratio — Example")))).toEqual(
      [],
    );
    expect(
      cited(paragraph(text("Here is the page: "), link("Example"))),
    ).toEqual([]);
    expect(
      cited(
        paragraph(
          text("Done. "),
          link("A very long descriptive title of a page that is not a name"),
        ),
      ),
    ).toEqual([]);
  });

  it("ignores links that are not on the web", () => {
    expect(
      cited(paragraph(text("Saved. "), link("notes", "/workspace/notes.md"))),
    ).toEqual([]);
  });
});

describe("citation pages", () => {
  it("collects the titles and clean snippets the turn's web search returned", () => {
    const pages = citationPages([
      {
        type: "dynamic-tool",
        toolCallId: "call-1",
        toolName: "web_search",
        input: { query: "example" },
        state: "output-available",
        output: JSON.stringify({
          success: true,
          data: {
            web: [
              {
                url: "https://news.example.com/a/",
                title: "Example headline - News",
                description:
                  "Example headline [More](https://x.example) about **it**.",
              },
            ],
          },
        }),
      },
    ]);
    const page = pages.get("https://news.example.com/a");
    expect(page?.title).toBe("Example headline - News");
    // No Markdown, URLs or the repeated title: a snippet reads as a result.
    expect(page?.snippet).toBe("More about it.");
  });
});
