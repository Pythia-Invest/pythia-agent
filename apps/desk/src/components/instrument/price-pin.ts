"use client";

import type { SubjectPage } from "@pythia/market-data/subject";
import { useState } from "react";
import type { CorrectFn } from "@/client/corrections";
import type { PageBlock } from "./blocks";

/** Blocks priced by one source, which the investor may pin. */
const PINNABLE = new Set<PageBlock["type"]>([
  "market",
  "quote",
  "chart",
  "live",
]);

/** The investor's pin of the price source on a card that one source prices
 * (quote, chart, live): "Always use" pins the source picked for this view to
 * the page's line (a company page, which has no price of its own, to the line
 * it is priced through), and an existing pin is undone by its ID. Core's pin
 * on a line beats one on its security, so either is the page's own. A refusal
 * is `error`, shown beside the sources. */
export function usePricePin(
  page: SubjectPage,
  correct: CorrectFn,
  block: PageBlock["type"],
  pinned: () => void,
) {
  const pinnable = PINNABLE.has(block);
  const [error, setError] = useState<string | null>(null);
  const pin = pinnable
    ? page.corrections.find(
        (item) => item.kind === "price_source" && item.state === "active",
      )
    : undefined;
  const target =
    page.subject.level === "issuer" ? page.subject.listing : page.subject.id;
  const run = (request: Parameters<CorrectFn>[0], done?: () => void) => {
    setError(null);
    correct(request).then(done, (failure: unknown) =>
      setError(failure instanceof Error ? failure.message : String(failure)),
    );
  };
  return {
    error,
    isPinned: Boolean(pin),
    onUnpin: pin ? () => run({ action: "undo", id: pin.id }) : undefined,
    onAlways:
      pinnable && target
        ? (plugin: string) =>
            run(
              { kind: "price_source", subjectId: target, value: plugin },
              pinned,
            )
        : undefined,
  };
}
