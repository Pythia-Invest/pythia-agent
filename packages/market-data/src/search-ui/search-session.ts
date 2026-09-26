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

function useSettled(value: string, delay: number) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), value ? delay : 0);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

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

/** State of one open search: settled query, type filter, highlighted row and
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
  const [pendingEnter, setPendingEnter] = useState(false);
  const [lookupState, setLookupState] = useState<LookupState>();

  const trimmed = query.trim();
  const settled = useSettled(trimmed, 100);
  const result = useDirectorySearch(search, settled, filter, open);
  const response = trimmed ? result.data : undefined;
  const fresh =
    Boolean(response) && settled === trimmed && !result.isPlaceholderData;
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
    open && Boolean(trimmed) && (trimmed !== settled || result.isFetching),
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

  // Enter pressed before the typed query settled acts on its own results.
  useEffect(() => {
    if (!pendingEnter || !fresh) return;
    setPendingEnter(false);
    const option = activeOption(options, activeKey);
    if (option) select(option.row.id);
  }, [pendingEnter, fresh, options, activeKey, select]);

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
      setPendingEnter(false);
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
        if (!fresh) {
          if (trimmed) setPendingEnter(true);
          return Boolean(trimmed);
        }
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
