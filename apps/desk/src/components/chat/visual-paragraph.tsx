"use client";

import { ChartNoAxesCombined, ChevronRight } from "lucide-react";
import type { ComponentProps } from "react";
import type { ExtraProps } from "streamdown";
import { visualLinkPath } from "@/workspace/visual-artifact";
import { WorkspaceLink } from "@/components/workspace/workspace-link";

function ChatVisual({ path, label }: { path: string; label: string }) {
  return (
    <div
      data-slot="chat-visual"
      className="my-3 min-w-0 font-sans text-body [&>a:focus-visible]:outline-2 [&>a:hover]:bg-interaction-hover [&>a]:flex [&>a]:items-center [&>a]:gap-3 [&>a]:rounded-container [&>a]:border [&>a]:border-border [&>a]:p-3 [&>a]:text-foreground [&>a]:no-underline [&>a]:outline-ring"
    >
      <WorkspaceLink location={{ path }}>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-subtle text-foreground-secondary">
          <ChartNoAxesCombined aria-hidden="true" className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-sm">{label}</span>
          <span className="block text-foreground-secondary text-xs">
            Interactive chart
          </span>
        </span>
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 text-foreground-secondary"
        />
        <span className="sr-only">Open beside chat</span>
      </WorkspaceLink>
    </div>
  );
}

/** Use the installed Markdown AST, not another Markdown parser. Only a
 * standalone link becomes a block; links in prose/code keep normal semantics. */
export function VisualParagraph({
  node,
  children,
  ...props
}: ComponentProps<"p"> & ExtraProps) {
  const content = node?.children.filter(
    (child) => child.type !== "text" || child.value.trim() !== "",
  );
  const child = content?.length === 1 ? content[0] : undefined;
  const href =
    child?.type === "element" && child.tagName === "a"
      ? child.properties.href
      : undefined;
  const path = typeof href === "string" ? visualLinkPath(href) : null;
  const label =
    child?.type === "element"
      ? child.children
          .filter((part) => part.type === "text")
          .map((part) => part.value)
          .join("")
          .trim()
      : "";
  return path ? (
    <ChatVisual path={path} label={label || "research visual"} />
  ) : (
    <p {...props}>{children}</p>
  );
}
