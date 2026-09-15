import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DeskProviders } from "@/client/providers";
import {
  WorkspaceMarkdown,
  headingSlug,
  safeMarkdownUrl,
} from "@/components/workspace/workspace-markdown";
import { AssistantText } from "@/components/chat/message-parts";
import {
  ChatArtifactLink,
  nativePathLocator,
} from "@/components/workspace/workspace-link";

vi.mock("next/navigation", () => ({
  usePathname: () => "/c/synthetic-chat",
  useRouter: () => ({ push: vi.fn() }),
}));

const render = (text: string) =>
  renderToStaticMarkup(
    <WorkspaceMarkdown path="research/example.md" text={text} />,
  );

describe("workspace Markdown", () => {
  it("renders static ordinary research with headings, tables and document-relative links", () => {
    const output = render(
      "# Risk & return\n\n## Risks\n\n[Related](../shared/notes.md#evidence)\n\n| Item | Value |\n| --- | --- |\n| Exposure | 4 |\n\n```js\nconsole.log('display only')\n```\n",
    );
    expect(output).toContain('id="risk--return"');
    expect(output).toContain('id="risks"');
    expect(output).toContain('href="/workspace/shared/notes.md#evidence"');
    expect(output).toContain("<table");
    expect(output).toContain("display only");
  });
  it("disables raw HTML and unsafe URLs and never automatically loads remote images", () => {
    const output = render(
      '<script>alert(1)</script>\n\n<iframe src="https://bad.example"></iframe>\n\n[Bad](javascript:alert)\n\n![Remote](https://images.example/a.png)\n\n![Local](./chart.png)\n\n![SVG](./active.svg)',
    );
    expect(output).not.toContain("<script");
    expect(output).not.toContain("<iframe");
    expect(output).not.toContain('href="javascript:');
    expect(output).not.toContain('src="https://images.example');
    expect(output).toContain('href="https://images.example/a.png"');
    expect(output).toContain(
      'src="/api/workspace/content?path=research%2Fchart.png"',
    );
    expect(output).not.toContain(
      'src="/api/workspace/content?path=research%2Factive.svg"',
    );
  });
  it("keeps duplicate heading anchors and Unicode labels usable", () => {
    const output = render("# Café risks\n\n# Café risks\n");
    expect(output).toContain('id="café-risks"');
    expect(output).toContain('id="café-risks-1"');
    expect(headingSlug("Café risks")).toBe("café-risks");
    expect(safeMarkdownUrl("data:text/html,unsafe")).toBe("");
    expect(safeMarkdownUrl("//remote.example/img")).toBe("");
  });
  it("preserves the original relative path through the actual assistant renderer", () => {
    const output = renderToStaticMarkup(
      <AssistantText
        text="[Research](research/example.md#risks)"
        streaming={false}
      />,
    );
    expect(output).toContain('href="/workspace/research/example.md#risks"');
  });
  it("makes chat-relative artifact links ordinary routable Workspace links", () => {
    const output = renderToStaticMarkup(
      <ChatArtifactLink href="research/example.md#risks">
        Open research
      </ChatArtifactLink>,
    );
    expect(output).toContain('href="/workspace/research/example.md#risks"');
  });
});

it("preserves file links through streamed and historical assistant Markdown without browser file navigation", () => {
  for (const streaming of [false, true]) {
    const output = renderToStaticMarkup(
      <DeskProviders>
        <AssistantText
          streaming={streaming}
          text="Comparison: [example.md](file:///host/research/example.md#risks)\n\n[Unsafe](javascript:alert)\n\n![File image](file:///host/private.png)"
        />
      </DeskProviders>,
    );
    expect(output).toContain('data-slot="native-workspace-link"');
    expect(output).toContain('type="button"');
    expect(output).not.toContain('disabled=""');
    expect(output).not.toContain('href="file:');
    expect(output).not.toContain('href="javascript:');
    expect(output).not.toContain('src="file:');
  }
});

it("accepts local host file URIs and rejects remote or malformed locators", () => {
  for (const prefix of ["file://", "file://localhost", "FILE://"]) {
    expect(
      nativePathLocator(`${prefix}/host/caf%C3%A9%20notes.md#risk%20settings`),
    ).toEqual({
      hostPath: "/host/café notes.md",
      heading: "risk settings",
    });
  }
  expect(nativePathLocator("file:///host/literal%2520.md")).toEqual({
    hostPath: "/host/literal%20.md",
    heading: undefined,
  });
  for (const href of [
    "file://remote/host/file.md",
    "file:relative.md",
    "file:////remote/file.md",
    "file:///host/a%00.md",
    "file:///host/a%5Cb.md",
    "file:///host/bad%zz.md",
    "file:///host/a.md?query=1",
  ]) {
    expect(nativePathLocator(href)).toBeNull();
  }
});

it("decodes native absolute paths and heading independently exactly once", () => {
  expect(
    nativePathLocator("/host/research/caf%C3%A9%20notes.md#risk%20settings"),
  ).toEqual({
    hostPath: "/host/research/café notes.md",
    heading: "risk settings",
  });
  expect(nativePathLocator("/host/research/literal%2520name.md#notes")).toEqual(
    { hostPath: "/host/research/literal%20name.md", heading: "notes" },
  );
  expect(nativePathLocator("/host/research/a%23b.md#notes")).toEqual({
    hostPath: "/host/research/a#b.md",
    heading: "notes",
  });
  expect(nativePathLocator("/host/bad%zz.md")).toBeNull();
  expect(nativePathLocator("//outside.example/file")).toBeNull();
});

it("does not reinterpret escaping or malformed document links as Desk navigation", () => {
  const output = render(
    "[Outside](../../outside.md) and [Malformed](bad%zz.md)",
  );
  expect(output).not.toContain("href=");
});

it("keeps generated heading suffixes unique against literal heading names", () => {
  const output = render("# A\n\n# A-1\n\n# A\n");
  expect(output.match(/id="a-1"/g)).toHaveLength(1);
  expect(output).toContain('id="a-2"');
});
