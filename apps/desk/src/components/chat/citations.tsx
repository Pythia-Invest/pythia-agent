"use client";

import { cn, IconButton, PreviewCard } from "@pythia/ui";
import { ArrowLeft, ArrowRight, ArrowUpRight, Globe } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from "react";
import type { DeskUIMessage } from "@/client/chat-message";
import { toolView } from "./tool-copy";
import { type ToolLink, toolDetail } from "./tool-detail";
import { host } from "./tool-text";

/*
 * Web citations are ordinary Markdown links. The Pythia prompt asks for them
 * right after the sentence they support, with the source's short name as text;
 * that position, not a special syntax, is what makes a link a citation. Any
 * other link stays a link in the prose.
 */

export type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

const CITATION_LABEL_MAX = 48;
/** A sentence has ended: terminal punctuation, then any closing quotes. */
const SENTENCE_END = /[.!?][)"'\]”’]*\s*$/u;

export function textOf(node: HastNode): string {
  return node.type === "text"
    ? (node.value ?? "")
    : (node.children ?? []).map(textOf).join("");
}

function isWebLink(node: HastNode) {
  return (
    node.type === "element" &&
    node.tagName === "a" &&
    /^https?:\/\//iu.test(String(node.properties?.href ?? ""))
  );
}

function isCitation(node: HastNode) {
  return node.properties?.dataCitation === true;
}

function markCitations(node: HastNode) {
  const children = node.children ?? [];
  children.forEach((child, index) => {
    if (isWebLink(child)) {
      const label = textOf(child).trim();
      const before = children
        .slice(0, index)
        .findLast((sibling) => isCitation(sibling) || textOf(sibling).trim());
      if (
        before &&
        label.length <= CITATION_LABEL_MAX &&
        (isCitation(before) || SENTENCE_END.test(textOf(before)))
      )
        child.properties = { ...child.properties, dataCitation: true };
    } else markCitations(child);
  });
}

export type CitedSource = { href: string; label: string };

/** Adjacent citations become one: the first carries them all as `data-sources`. */
function groupCitations(node: HastNode) {
  const children = node.children ?? [];
  for (let index = 0; index < children.length; index += 1) {
    const first = children[index] as HastNode;
    if (!isCitation(first)) {
      groupCitations(first);
      continue;
    }
    let end = index + 1;
    const run = [first];
    for (let next = end; next < children.length; next += 1) {
      const sibling = children[next] as HastNode;
      if (isCitation(sibling)) {
        run.push(sibling);
        end = next + 1;
      } else if (textOf(sibling).trim()) break;
    }
    if (run.length < 2) continue;
    const sources: CitedSource[] = run.map((link) => ({
      href: String(link.properties?.href),
      label: textOf(link).trim(),
    }));
    first.properties = {
      ...first.properties,
      dataSources: JSON.stringify(sources),
    };
    children.splice(index + 1, end - index - 1);
  }
}

/** Rehype step: marks web links in citation position with `data-citation`
 * and groups adjacent ones. */
export function rehypeCitations() {
  return (tree: HastNode) => {
    markCitations(tree);
    groupCitations(tree);
  };
}

/** The sources a grouped citation carries, or `null` for a single one. */
export function citedSources(value: unknown): CitedSource[] | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) &&
      parsed.every(
        (item) =>
          typeof item?.href === "string" &&
          /^https?:\/\//iu.test(item.href) &&
          typeof item.label === "string",
      )
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/** Pages the turn's web tools returned, by URL, for the citation preview. */
const CitationPages = createContext<ReadonlyMap<string, ToolLink>>(new Map());

function pageKey(url: string) {
  return url.replace(/#.*$/u, "").replace(/\/+$/u, "");
}

export function citationPages(parts: DeskUIMessage["parts"]) {
  const pages = new Map<string, ToolLink>();
  for (const part of parts) {
    if (part.type !== "dynamic-tool" || part.state !== "output-available")
      continue;
    const detail = toolDetail(toolView(part), part, false);
    if (detail.kind === "links")
      for (const link of detail.links) {
        // A page read after it was found keeps the search's snippet.
        const key = pageKey(link.url);
        pages.set(key, { ...pages.get(key), ...link });
      }
  }
  return pages;
}

export function CitationPagesProvider({
  parts,
  children,
}: {
  parts: DeskUIMessage["parts"];
  children: ReactNode;
}) {
  const pages = useMemo(() => citationPages(parts), [parts]);
  return <CitationPages value={pages}>{children}</CitationPages>;
}

/**
 * The site's own icon, requested without a referrer; a globe when it has
 * none. Only the cited site is contacted, never a third-party icon service.
 */
export function Favicon({
  href,
  className,
}: {
  href: string;
  className?: string;
}) {
  let src = "";
  try {
    src = `${new URL(href).origin}/favicon.ico`;
  } catch {
    // An unparsable URL keeps the generic mark.
  }
  // Failure belongs to one icon: a pill stepping to another source retries.
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src)
    return (
      <Globe
        aria-hidden="true"
        className={cn(
          "shrink-0 stroke-[1.75] text-foreground-secondary",
          className,
        )}
      />
    );
  return (
    <img
      alt=""
      className={cn("shrink-0 rounded-[3px] object-contain", className)}
      decoding="async"
      loading="lazy"
      onError={() => setFailed(src)}
      referrerPolicy="no-referrer"
      src={src}
    />
  );
}

function CitationPill({ sources }: { sources: CitedSource[] }) {
  const pages = useContext(CitationPages);
  const [index, setIndex] = useState(0);
  const first = sources[0] as CitedSource;
  const source = sources[index] ?? first;
  const site = host(source.href);
  const label = source.label || site;
  // The pill always names the first source; stepping happens in the preview.
  const firstLabel = first.label || host(first.href);
  const page = pages.get(pageKey(source.href));
  const more = sources.length - 1;
  const step = (by: number) =>
    setIndex((current) => (current + by + sources.length) % sources.length);
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        className="motion-fast mx-0.5 inline-flex h-[1.125rem] max-w-44 items-center gap-1 rounded-pill bg-subtle px-1.5 align-[0.1em] font-sans text-foreground-secondary text-xs leading-none no-underline transition-colors hover:bg-interaction-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring data-popup-open:bg-interaction-hover data-popup-open:text-foreground"
        aria-label={
          more ? `${firstLabel}, and ${more} more sources` : firstLabel
        }
        closeDelay={150}
        data-slot="citation"
        delay={100}
        href={first.href}
        rel="noreferrer"
        target="_blank"
      >
        <Favicon className="size-3" href={first.href} />
        <span className="min-w-0 truncate">{firstLabel}</span>
        {more ? (
          <span className="numeric shrink-0 text-foreground-disabled">
            +{more}
          </span>
        ) : null}
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner align="start" side="bottom">
          <PreviewCard.Popup className="grid w-80 max-w-[calc(100vw-2rem)] gap-2 p-3">
            {more ? (
              <div className="-ms-1.5 -mt-1 flex items-center gap-0.5 text-foreground-secondary">
                <IconButton
                  className="size-6 [&_svg]:size-3.5!"
                  label="Previous source"
                  onClick={() => step(-1)}
                  size="sm"
                >
                  <ArrowLeft />
                </IconButton>
                <IconButton
                  className="size-6 [&_svg]:size-3.5!"
                  label="Next source"
                  onClick={() => step(1)}
                  size="sm"
                >
                  <ArrowRight />
                </IconButton>
                <span className="numeric ms-auto text-xs" aria-live="polite">
                  {index + 1}/{sources.length}
                </span>
              </div>
            ) : null}
            <a
              className="grid gap-1.5 text-foreground no-underline"
              href={source.href}
              rel="noreferrer"
              target="_blank"
            >
              <span className="flex min-w-0 items-center gap-2 text-foreground-secondary text-xs">
                <Favicon className="size-4" href={source.href} />
                <span className="truncate">
                  {label === site ? site : `${label} · ${site}`}
                </span>
              </span>
              <span className="line-clamp-2 min-h-[2lh] text-body leading-ui">
                {page?.title && page.title !== page.site
                  ? page.title
                  : source.href}
              </span>
            </a>
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}

/** A web link: a pill when it cites, a plainly external link in the prose. */
export function WebLink({
  href,
  citation,
  sources,
  label,
  children,
}: {
  href: string;
  citation: boolean;
  /** Adjacent citations grouped into this one, in order. */
  sources?: CitedSource[] | null | undefined;
  /** The link's plain text; streaming wraps its words in spans. */
  label: string;
  children?: ReactNode;
}) {
  if (citation)
    return (
      <CitationPill
        sources={sources?.length ? sources : [{ href, label: label.trim() }]}
      />
    );
  return (
    <a
      className="text-foreground underline decoration-foreground/35 decoration-dotted underline-offset-[3px] transition-colors hover:decoration-foreground"
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      {children}
      <ArrowUpRight
        aria-hidden="true"
        className="ms-0.5 inline size-3 stroke-[1.75] align-[-0.05em] text-foreground-secondary"
      />
    </a>
  );
}

/**
 * Every link an answer cites, the way a search result reads: site, title and
 * the snippet the search returned, when the turn has one.
 */
export function SourceList({
  sources,
}: {
  sources: { url: string; label: string }[];
}) {
  const pages = useContext(CitationPages);
  return (
    <ul className="m-0 grid min-h-0 list-none gap-0.5 overflow-y-auto overscroll-contain p-0">
      {sources.map((source) => {
        const page = pages.get(pageKey(source.url));
        const site = host(source.url);
        const title =
          page?.title && page.title !== page.site ? page.title : source.label;
        return (
          <li key={source.url}>
            <a
              className="grid gap-0.5 rounded-control px-2.5 py-2 no-underline transition-colors hover:bg-interaction-hover focus-visible:outline-2 focus-visible:outline-ring"
              href={source.url}
              rel="noreferrer"
              target="_blank"
            >
              <span className="flex min-w-0 items-center gap-1.5 text-foreground-secondary text-xs">
                <Favicon className="size-3.5" href={source.url} />
                <span className="truncate">{site}</span>
              </span>
              <span className="line-clamp-2 font-medium text-body text-foreground leading-ui">
                {title}
              </span>
              {page?.snippet ? (
                <span className="line-clamp-2 text-foreground-secondary text-xs leading-ui">
                  {page.snippet}
                </span>
              ) : null}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
