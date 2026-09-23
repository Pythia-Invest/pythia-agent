import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AssistantText } from "@/components/chat/message-parts";
import {
  parseVisualArtifact,
  visualLinkPath,
  visualModule,
  VISUAL_ARTIFACT_BYTES,
} from "@/workspace/visual-artifact";

vi.mock("next/navigation", () => ({
  usePathname: () => "/c/synthetic",
  useRouter: () => ({ push: vi.fn() }),
}));

const artifact = {
  format: "pythia-visual",
  version: 1,
  title: "Synthetic figure",
  summary: "Invented data for host boundary tests.",
  presentation: {
    plugin: "example",
    widget: "chart",
    input_contract: "example.chart.v1",
  },
  data: { values: [1, 2] },
};

describe("declarative visual host", () => {
  it("admits the bounded envelope without executing or interpreting feature data", () => {
    expect(parseVisualArtifact(JSON.stringify(artifact))).toEqual(artifact);
    for (const value of [
      { ...artifact, version: 2 },
      { ...artifact, moduleUrl: "/arbitrary.js" },
      {
        ...artifact,
        presentation: { ...artifact.presentation, plugin: "../../other" },
      },
    ])
      expect(() => parseVisualArtifact(JSON.stringify(value))).toThrow();
    expect(() =>
      parseVisualArtifact(" ".repeat(VISUAL_ARTIFACT_BYTES + 1)),
    ).toThrow(/limit/);
  });

  it("requires a matching current native declaration and never uses a file-supplied module URL", () => {
    const parsed = parseVisualArtifact(JSON.stringify(artifact));
    const asset = {
      id: "renderer",
      sha256: "0".repeat(64),
      bytes: 123,
      moduleUrl: "/api/plugins/example/widgets/renderer?revision=sha",
    };
    const native = {
      version: 1 as const,
      widgets: [
        { id: "chart", asset: "renderer", input_contract: "example.chart.v1" },
      ],
      assets: [asset],
    };
    expect(visualModule(parsed, native)).toBe(asset.moduleUrl);
    expect(() => visualModule(parsed, { ...native, widgets: [] })).toThrow();
    expect(() =>
      visualModule(parsed, {
        ...native,
        widgets: [
          { id: "chart", asset: "renderer", input_contract: "other.v1" },
        ],
      }),
    ).toThrow();
  });

  it("embeds only standalone explicit workspace visual links through the actual Markdown renderer", () => {
    const href = "/workspace/working/example.vega-lite.json";
    const render = (text: string) =>
      renderToStaticMarkup(<AssistantText text={text} streaming={false} />);
    const preview = render(`[Explore](${href})`);
    expect(preview).toContain('data-slot="chat-visual"');
    // The whole card is one keyboard-accessible link; rendering belongs to the reader.
    expect(preview.match(/<a\b/g)).toHaveLength(1);
    expect(preview).toContain(`href="${href}"`);
    expect(preview).not.toContain("<canvas");
    expect(preview).toContain("Explore");
    expect(preview).toContain("Open beside chat");
    for (const text of [
      `See [Explore](${href}) for details.`,
      `\`[Explore](${href})\``,
      `\`\`\`md\n[Explore](${href})\n\`\`\``,
      "[External](https://example.test/example.vega-lite.json)",
      "[Ordinary JSON](/workspace/example.json)",
    ])
      expect(render(text)).not.toContain('data-slot="chat-visual"');
    expect(visualLinkPath(href)).toBe("working/example.vega-lite.json");
    expect(visualLinkPath("file:///example.vega-lite.json")).toBeNull();
  });
});
