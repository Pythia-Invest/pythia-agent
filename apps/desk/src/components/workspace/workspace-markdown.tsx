"use client";

import { useCodeHighlight } from "@/components/workspace/previews/code";

import { MARKDOWN_SANITIZER } from "@/components/workspace/markdown-policy";

import { useMemo } from "react";
import { Streamdown, type Components } from "streamdown";
import { resolveWorkspaceLink, workspaceContentUrl } from "@/workspace/paths";
import type { WorkspaceLocation } from "./reader-context";
import { WorkspaceLink } from "./workspace-link";

export function safeMarkdownUrl(url: string) {
  return /^https?:\/\//i.test(url) ||
    /^mailto:/i.test(url) ||
    (!/^[a-z][a-z\d+.-]*:/i.test(url) &&
      !url.startsWith("//") &&
      !url.includes("\\") &&
      !Array.from(url).some((character) => character.charCodeAt(0) < 32))
    ? url
    : "";
}
function nodeText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const value = node as { value?: string; children?: unknown[] };
  return value.value ?? value.children?.map(nodeText).join("") ?? "";
}
export function headingSlug(text: string) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

function addHeadingIds() {
  return (tree: unknown) => {
    const slugs = new Map<string, number>();
    const used = new Set<string>();
    function visit(value: unknown) {
      if (!value || typeof value !== "object") return;
      const node = value as {
        tagName?: string;
        properties?: Record<string, unknown>;
        children?: unknown[];
      };
      if (/^h[1-6]$/.test(node.tagName ?? "")) {
        const base = headingSlug(nodeText(node));
        let count = slugs.get(base) ?? 0;
        let id = count ? `${base}-${count}` : base;
        while (used.has(id)) {
          count += 1;
          id = `${base}-${count}`;
        }
        slugs.set(base, count + 1);
        used.add(id);
        node.properties = { ...node.properties, id };
      }
      node.children?.forEach(visit);
    }
    visit(tree);
  };
}
// Keep the installed sanitizer. Omit raw HTML parsing and the default hardener:
// its URL normalization erases document-relative paths before our link resolver.
// Our URL transform and image component enforce the narrower workspace policy.
const REHYPE_PLUGINS = [MARKDOWN_SANITIZER, addHeadingIds];

export function WorkspaceMarkdown({
  text,
  path,
  onOpen,
}: {
  text: string;
  path: string;
  onOpen?: ((location: WorkspaceLocation) => void) | undefined;
}) {
  const components = useMemo(() => {
    const result: Components = {
      a: ({ href, children }) => {
        if (!href) return <span>{children}</span>;
        const location = resolveWorkspaceLink(href, path);
        return location ? (
          <WorkspaceLink location={location} onOpen={onOpen}>
            {children}
          </WorkspaceLink>
        ) : /^https?:\/\//i.test(href) || /^mailto:/i.test(href) ? (
          <a href={safeMarkdownUrl(href)} target="_blank" rel="noreferrer">
            {children}
          </a>
        ) : (
          <span>{children}</span>
        );
      },
      img: ({ src, alt }) => {
        const url = typeof src === "string" ? src : "";
        const location = resolveWorkspaceLink(url, path);
        if (location && /\.(png|jpe?g|gif|webp)$/i.test(location.path))
          return (
            <img
              src={workspaceContentUrl(location.path)}
              alt={alt ?? ""}
              loading="lazy"
            />
          );
        return /^https?:\/\//i.test(url) ? (
          <a href={url} target="_blank" rel="noreferrer">
            Open external image{alt ? `: ${alt}` : ""}
          </a>
        ) : (
          <span>{alt || "Image preview unavailable"}</span>
        );
      },
    };
    return result;
  }, [path, text, onOpen]);
  const code = useCodeHighlight(/```|~~~/.test(text) && text.length <= 100_000);
  return (
    <div
      data-slot="workspace-markdown"
      className="min-w-0 text-base text-foreground leading-relaxed"
    >
      <Streamdown
        plugins={code ? { code } : {}}
        mode="static"
        rehypePlugins={REHYPE_PLUGINS}
        skipHtml
        parseIncompleteMarkdown={false}
        controls={false}
        tableMaxHeight={0}
        urlTransform={safeMarkdownUrl}
        components={components}
        className="min-w-0 [&_[data-streamdown=table-wrapper]]:border-0 [&_[data-streamdown=table-wrapper]]:bg-transparent [&_[data-streamdown=table-wrapper]]:p-0 [&_a]:text-primary [&_a]:underline [&_h1]:text-2xl [&_h2]:text-xl [&_h3]:text-lg [&_img]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:overflow-x-auto"
      >
        {text}
      </Streamdown>
    </div>
  );
}
