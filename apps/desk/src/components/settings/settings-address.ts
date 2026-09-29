"use client";

import { useSyncExternalStore } from "react";

/*
 * Settings fills the window over whatever page is open, so that page and its
 * running chats stay as they were. It is addressed by a `settings` search
 * parameter naming a page (`model/main`), so links such as the update
 * indicator can open a page. Opening adds a history entry, so Back closes
 * it; moving between pages replaces that entry.
 */

const PARAM = "settings";

/**
 * A link target that opens Settings over the current page: at `page`, or,
 * without one, where the device starts (the first page beside the list, or
 * the list itself on a phone).
 */
export const settingsHref = (page?: string) => `?${PARAM}=${page ?? ""}`;

function here(page: string | null) {
  const params = new URLSearchParams(window.location.search);
  if (page === null) params.delete(PARAM);
  else params.set(PARAM, page);
  const query = params.toString().replaceAll("%2F", "/");
  return `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
}

// The address lives in the URL. Desk changes it only through the functions
// below, which announce it; Back and Forward announce themselves.
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}
function announce() {
  for (const listener of listeners) listener();
}
function param() {
  return new URLSearchParams(window.location.search).get(PARAM);
}

// Whether this page opened Settings itself, so closing can step back instead
// of leaving a duplicate history entry behind.
let pushed = false;

/** Opens Settings at `page`, or at its start without one. */
export function openSettings(page?: string) {
  if (param() !== null) window.history.replaceState(null, "", here(page ?? ""));
  else {
    pushed = true;
    window.history.pushState(null, "", here(page ?? ""));
  }
  announce();
}

export function closeSettings() {
  if (pushed) {
    pushed = false;
    window.history.back();
  } else {
    window.history.replaceState(null, "", here(null));
    announce();
  }
}

/** The raw address: null when closed, "" when no page is chosen. */
export function useSettingsAddress() {
  return useSyncExternalStore(subscribe, param, () => null);
}
