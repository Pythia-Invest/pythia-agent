"use client";

import { Button, IconButton, Popover } from "@pythia/ui";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";

function sourcesIn(text: string) {
  const links = new Map<string, string>();
  for (const match of text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gu))
    if (match[1] && match[2]) links.set(match[2], match[1]);
  for (const match of text.matchAll(/https?:\/\/[^\s<>)\]]+/gu)) {
    const url = match[0].replace(/[.,;:]$/u, "");
    if (!links.has(url)) {
      try {
        links.set(url, new URL(url).hostname.replace(/^www\./u, ""));
      } catch {
        // Streamdown applies the same URL safety boundary to the rendered link.
      }
    }
  }
  return [...links].map(([url, label]) => ({ url, label }));
}

export function AnswerActions({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const sources = useMemo(() => sourcesIn(text), [text]);
  return (
    <div
      className="ms-1 flex flex-wrap items-center gap-0.5"
      data-slot="answer-actions"
    >
      <IconButton
        className="size-4.5 rounded-sm text-foreground-disabled hover:bg-transparent hover:text-foreground-secondary [&>span>svg]:size-2.5 [&>span]:size-2.5"
        label={copied ? "Answer copied" : "Copy answer"}
        onClick={() => {
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
        size="sm"
      >
        {copied ? (
          <Check aria-hidden="true" className="stroke-[1.5]" />
        ) : (
          <Copy aria-hidden="true" className="stroke-[1.5]" />
        )}
      </IconButton>
      {sources.length ? (
        <Popover.Root>
          <Popover.Trigger
            render={
              <Button
                aria-label={`${sources.length} ${sources.length === 1 ? "source" : "sources"}`}
                className="h-4.5 rounded-sm px-1 font-normal text-foreground-disabled text-xs hover:text-foreground-secondary"
                size="sm"
                variant="ghost"
              >
                {sources.length} {sources.length === 1 ? "source" : "sources"}
              </Button>
            }
          />
          <Popover.Portal>
            <Popover.Positioner align="start" side="top">
              <Popover.Popup className="w-[min(22rem,calc(100vw-2rem))] p-3">
                <Popover.Title>Sources</Popover.Title>
                <ol className="m-0 mt-2 grid list-none gap-1 p-0 text-body">
                  {sources.map((source, index) => (
                    <li key={source.url}>
                      <a
                        className="flex min-w-0 items-center gap-2 rounded-control px-2 py-1.5 text-foreground-secondary no-underline hover:bg-interaction-hover hover:text-foreground"
                        href={source.url}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <span className="numeric text-foreground-disabled text-xs">
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {source.label}
                        </span>
                        <ExternalLink
                          aria-hidden="true"
                          className="size-3.5 shrink-0"
                        />
                      </a>
                    </li>
                  ))}
                </ol>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      ) : null}
    </div>
  );
}
