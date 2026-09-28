"use client";

import { cn, IconButton, Popover, Tooltip } from "@pythia/ui";
import { Check, Copy, Link2 } from "lucide-react";
import { type ReactElement, useEffect, useMemo, useState } from "react";
import { SourceList } from "./citations";

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

const DAY = 24 * 60 * 60 * 1000;

/** "just now", "5 minutes ago", "3 hours ago", "yesterday", then a short date. */
export function relativeTime(then: number, now: number, locale?: string) {
  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return "just now";
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (minutes < 60) return relative.format(-minutes, "minute");
  if (minutes < 24 * 60)
    return relative.format(-Math.floor(minutes / 60), "hour");
  const day = (time: number) => new Date(time).setHours(0, 0, 0, 0);
  if (Math.round((day(now) - day(then)) / DAY) === 1)
    return relative.format(-1, "day");
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    ...(new Date(then).getFullYear() === new Date(now).getFullYear()
      ? {}
      : { year: "numeric" }),
  }).format(then);
}

/** When the answer was completed, kept current while it is on screen. */
function AnsweredAt({ at }: { at: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <time
      className="motion-fast ms-1.5 text-foreground-secondary text-xs opacity-0 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100"
      data-slot="answer-time"
      dateTime={new Date(at).toISOString()}
      title={new Intl.DateTimeFormat(undefined, {
        dateStyle: "full",
        timeStyle: "short",
      }).format(at)}
    >
      {relativeTime(at, now)}
    </time>
  );
}

function Action({ tip, button }: { tip: string; button: ReactElement }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={button} />
      <Tooltip.Portal>
        <Tooltip.Positioner side="bottom">
          <Tooltip.Popup>{tip}</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

// Claude-sized: 14px glyphs on a 24px pitch, one step below the reading text.
const ACTION_CLASS =
  "size-6 rounded-control text-foreground-secondary hover:bg-interaction-hover hover:text-foreground [&_svg]:size-3.5! [&_svg]:stroke-[1.75]";

/**
 * The quiet row under an answer: copy, the sources it cites, and
 * when it was answered. On the latest answer the actions stay visible; on
 * earlier ones the row appears on hover or focus. The time always waits for it.
 */
export function AnswerActions({
  text,
  latest = true,
  completedAt,
}: {
  text: string;
  latest?: boolean;
  /** Epoch ms the answer was completed. */
  completedAt?: number | undefined;
}) {
  const [copied, setCopied] = useState(false);
  const sources = useMemo(() => sourcesIn(text), [text]);
  const sourceLabel = `${sources.length} ${sources.length === 1 ? "source" : "sources"}`;
  return (
    <Tooltip.Provider delay={400}>
      <div
        className={cn(
          "motion-fast -ms-[5px] flex flex-wrap items-center transition-opacity",
          !latest &&
            "opacity-0 focus-within:opacity-100 group-hover/message:opacity-100",
        )}
        data-slot="answer-actions"
      >
        <Action
          tip={copied ? "Copied" : "Copy"}
          button={
            <IconButton
              className={ACTION_CLASS}
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
                <Check aria-hidden="true" />
              ) : (
                <Copy aria-hidden="true" />
              )}
            </IconButton>
          }
        />
        {sources.length ? (
          <Popover.Root>
            <Popover.Trigger
              aria-label={sourceLabel}
              className="motion-fast inline-flex h-6 cursor-pointer items-center gap-1 rounded-control border-0 bg-transparent px-[5px] text-foreground-secondary text-xs transition-colors hover:bg-interaction-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring data-popup-open:bg-interaction-hover data-popup-open:text-foreground"
              title={sourceLabel}
            >
              <Link2 aria-hidden="true" className="size-3.5 stroke-[1.75]" />
              <span className="numeric">{sources.length}</span>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Positioner align="start" side="top">
                {/* A deep dive can cite a hundred pages: the heading stays put
                    and only the list scrolls. */}
                <Popover.Popup className="flex max-h-[min(28rem,60vh)] w-[min(24rem,calc(100vw-2rem))] flex-col p-1.5">
                  <Popover.Title className="flex-none px-2.5 pt-1.5 pb-1 font-normal text-foreground-secondary text-xs">
                    Sources · <span className="numeric">{sources.length}</span>
                  </Popover.Title>
                  <SourceList sources={sources} />
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
        ) : null}
        {completedAt ? <AnsweredAt at={completedAt} /> : null}
      </div>
    </Tooltip.Provider>
  );
}
