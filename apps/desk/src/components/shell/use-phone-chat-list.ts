import { useEffect, useRef, useState } from "react";

/**
 * The chat list on a phone: collapsible as on desktop, but opened over the
 * conversation instead of beside it. Top-bar search filters the list, so a
 * search opens it to show what matched, and cancelling that search closes it
 * again if the search is what opened it.
 */
export function usePhoneChatList({
  wide,
  chatSurface,
  searchQuery,
}: {
  wide: boolean;
  chatSurface: boolean;
  searchQuery: string;
}) {
  const [open, setOpen] = useState(false);
  const openedBySearch = useRef(false);
  useEffect(() => {
    if (wide || !chatSurface) return;
    if (searchQuery.trim()) {
      setOpen((current) => {
        if (!current) openedBySearch.current = true;
        return true;
      });
    } else if (openedBySearch.current) {
      openedBySearch.current = false;
      setOpen(false);
    }
  }, [chatSurface, searchQuery, wide]);
  return [open, setOpen] as const;
}
