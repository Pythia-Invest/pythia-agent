import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/**
 * The chat list on a phone: collapsible as on desktop, but opened over the
 * conversation instead of beside it, so while open it behaves as a modal
 * layer: focus moves into it, Escape closes it, and focus returns to what
 * opened it. Top-bar search filters the list, so a search opens it to show
 * what matched, and cancelling that search closes it again if the search is
 * what opened it.
 */
export function usePhoneChatList({
  wide,
  chatSurface,
  searchQuery,
  panel,
}: {
  wide: boolean;
  chatSurface: boolean;
  searchQuery: string;
  panel: RefObject<HTMLElement | null>;
}) {
  const [open, setOpenState] = useState(false);
  const openedBySearch = useRef(false);
  // Any close other than cancelling the search forgets who opened it.
  const setOpen = useCallback((next: boolean) => {
    if (!next) openedBySearch.current = false;
    setOpenState(next);
  }, []);
  useEffect(() => {
    if (wide || !chatSurface) return;
    if (searchQuery.trim()) {
      setOpenState((current) => {
        if (!current) openedBySearch.current = true;
        return true;
      });
    } else if (openedBySearch.current) {
      openedBySearch.current = false;
      setOpenState(false);
    }
  }, [chatSurface, searchQuery, wide]);
  // Crossing into the desktop layout leaves no phone layer behind.
  useEffect(() => {
    if (wide) setOpen(false);
  }, [wide, setOpen]);
  useEffect(() => {
    if (wide || !open) return;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    // A search keeps typing in its field; Show chats moves into the list.
    if (!openedBySearch.current)
      panel.current?.querySelector<HTMLElement>("a[href], button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const within = panel.current?.contains(document.activeElement);
      if (
        (within || document.activeElement === document.body) &&
        opener?.isConnected
      )
        opener.focus();
    };
  }, [open, wide, panel, setOpen]);
  return [open, setOpen] as const;
}
