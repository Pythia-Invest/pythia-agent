/** Minimum readable tab width and the fixed overflow control, in pixels. */
const MIN_TAB = 96;
const OVERFLOW_CHIP = 44;

export interface TabLayout {
  /** Tab ids in strip order, active always among them. */
  visibleIds: readonly string[];
  /** Open chats the strip had no room for. */
  hiddenIds: readonly string[];
}

/**
 * CSS shares the strip equally between tabs, up to their preferred width.
 * Only overflow membership needs measurement. Reserve space for the overflow
 * control only when needed, and count the draft exactly like any other tab.
 * Width 0 is the unmeasured first render: leave sizing to CSS until measured.
 */
export function layOutTabs(
  ids: readonly string[],
  activeId: string | null,
  width: number,
  draft: boolean,
): TabLayout {
  const draftCount = draft ? 1 : 0;
  if (width <= 0 || (ids.length + draftCount) * MIN_TAB <= width)
    return { visibleIds: ids, hiddenIds: [] };

  const fits = Math.max(
    draft ? 0 : 1,
    Math.floor((width - OVERFLOW_CHIP) / MIN_TAB) - draftCount,
  );
  // Window the strip around the active tab so it stays reachable. The draft
  // is appended after the saved tabs, so show the last saved tabs beside it.
  const active = draft
    ? ids.length
    : Math.max(0, activeId ? ids.indexOf(activeId) : -1);
  const start = Math.max(
    0,
    Math.min(active - Math.floor((fits - 1) / 2), ids.length - fits),
  );
  const visibleIds = ids.slice(start, start + fits);
  return {
    visibleIds,
    hiddenIds: ids.filter((id) => !visibleIds.includes(id)),
  };
}

/**
 * Closing a tab hands the dock the next one to show.
 *
 * Neighbour, not "most recent": a tab strip is a spatial list, so the eye
 * expects what was beside the tab that went away. Null means nothing is left
 * and the dock falls back to a fresh composer.
 */
export function closeTab(
  ids: readonly string[],
  activeId: string | null,
  closingId: string,
): { activeId: string | null; openIds: readonly string[] } {
  const index = ids.indexOf(closingId);
  const openIds = ids.filter((id) => id !== closingId);
  if (activeId !== closingId) return { activeId, openIds };
  if (openIds.length === 0) return { activeId: null, openIds };
  return {
    activeId: openIds[Math.min(Math.max(index, 0), openIds.length - 1)] ?? null,
    openIds,
  };
}

/** Opens a chat in the strip, appending it only when it is not already there. */
export function openTab(
  ids: readonly string[],
  openingId: string,
): readonly string[] {
  return ids.includes(openingId) ? ids : [...ids, openingId];
}
