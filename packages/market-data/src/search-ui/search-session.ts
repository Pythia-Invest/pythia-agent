"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LookupOffer, SearchGroup } from "../search";
import {
  type LookupRunner,
  type SearchBackend,
  useDirectorySearch,
} from "./controller";
import {
  activeOption,
  moveActive,
  type SearchOption,
  searchOptions,
  type TypeFilter,
} from "./search-model";
import { type LookupState, optionId, type PanelStatus } from "./search-panel";

const NO_GROUPS: SearchGroup[] = [];
const NO_OFFERS: LookupOffer[] = [];

/** Busy cues appear only when work is noticeably slow, so fast local reads
 * never flash a spinner. */
function useDelayedFlag(flag: boolean, delay: number) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    setShown(false);
    if (!flag) return;
    const timer = setTimeout(() => setShown(true), delay);
    return () => clearTimeout(timer);
  }, [flag, delay]);
  return flag && shown;
}

export type SessionKey = "ArrowDown" | "ArrowUp" | "Enter";

/** State of one open search: query, type filter, highlighted row and
 * the explicit lookup. The field and popup wiring stay in `InvestmentSearch`. */
export function useSearchSession({
  baseId,
  query,
  open,
  search,
  lookup,
  select,
}: {
  baseId: string;
  query: string;
  open: boolean;
  search: SearchBackend;
  lookup?: LookupRunner | undefined;
  select(subjectId: string): void;
}) {
  const lookupAbort = useRef<AbortController | null>(null);
  const scrollActive = useRef(false);
  const [filter, setFilter] = useState<TypeFilter>("all");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [lookupState, setLookupState] = useState<LookupState>();

  const trimmed = query.trim();
  // Every keystroke is its own local read; React Query cancels the superseded
  // one and keeps the previous rows on screen until the new ones arrive.
  const result = useDirectorySearch(search, trimmed, filter, open);
  const response = trimmed ? result.data : undefined;
  const fresh = Boolean(response) && !result.isPlaceholderData;
  const shownLookup = lookupState?.query === trimmed ? lookupState : undefined;
  const found = shownLookup?.status === "done" ? shownLookup.groups : NO_GROUPS;
  const options = useMemo(
    () => [
      ...searchOptions(response?.groups ?? NO_GROUPS, "directory"),
      ...searchOptions(found, "lookup"),
    ],
    [response, found],
  );
  const active = activeOption(options, activeKey);
  const activeIndex = active ? options.indexOf(active) : -1;
  const status: PanelStatus = !trimmed
    ? "prompt"
    : result.isError && !result.isFetching
      ? "error"
      : response
        ? "ready"
        : "loading";
  const busy = useDelayedFlag(
    open && Boolean(trimmed) && result.isFetching,
    250,
  );

  useEffect(() => () => lookupAbort.current?.abort(), []);

  // Keep the highlighted row visible by scrolling only the panel body;
  // scrollIntoView would also move the page behind the popup.
  useEffect(() => {
    if (!scrollActive.current || activeIndex < 0) return;
    scrollActive.current = false;
    const option = document.getElementById(optionId(baseId, activeIndex));
    const body = option?.closest<HTMLElement>(
      '[data-slot="investment-search-body"]',
    );
    if (!option || !body) return;
    const shown = body.getBoundingClientRect();
    const target = option.getBoundingClientRect();
    if (target.top < shown.top) body.scrollTop -= shown.top - target.top;
    else if (target.bottom > shown.bottom)
      body.scrollTop += target.bottom - shown.bottom;
  }, [activeIndex, baseId]);

  async function runLookup(offer: LookupOffer) {
    if (!lookup || !trimmed || lookupState?.status === "running") return;
    const controller = new AbortController();
    lookupAbort.current = controller;
    const base = { plugin: offer.plugin, label: offer.label, query: trimmed };
    setLookupState({ ...base, status: "running", groups: [] });
    try {
      const groups = await lookup(
        { plugin: offer.plugin, query: trimmed },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setLookupState({ ...base, status: "done", groups });
      const first = groups[0]?.rows[0];
      if (first) {
        setActiveKey(`lookup:${first.id}`);
        scrollActive.current = true;
      }
    } catch {
      if (!controller.signal.aborted)
        setLookupState({ ...base, status: "error", groups: [] });
    }
  }

  return {
    trimmed,
    filter,
    options,
    active,
    activeIndex,
    status,
    fresh,
    busy,
    response,
    offers: lookup && trimmed ? (response?.lookup ?? NO_OFFERS) : NO_OFFERS,
    lookup: shownLookup,
    retry: () => void result.refetch(),
    runLookup: (offer: LookupOffer) => void runLookup(offer),
    /** A different query starts over: no highlight and no lookup. */
    edit(value: string) {
      if (value.trim() === trimmed) return;
      lookupAbort.current?.abort();
      setLookupState(undefined);
      setActiveKey(null);
    },
    changeFilter(value: TypeFilter) {
      setFilter(value);
      setActiveKey(null);
    },
    point: setActiveKey,
    choose: (option: SearchOption) => select(option.row.id),
    /** Returns whether the key was consumed. */
    key(name: SessionKey): boolean {
      if (name === "Enter") {
        // Enter opens a row of the typed query only; previous rows still on
        // screen while it loads are not a choice.
        if (!fresh) return Boolean(trimmed);
        if (active) select(active.row.id);
        return Boolean(active);
      }
      const next = moveActive(
        options,
        activeKey,
        name === "ArrowDown" ? 1 : -1,
      );
      if (!next) return false;
      setActiveKey(next);
      scrollActive.current = true;
      return true;
    },
  };
}
