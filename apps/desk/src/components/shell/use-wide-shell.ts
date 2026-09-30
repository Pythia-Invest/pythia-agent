import { useSyncExternalStore } from "react";

function subscribeWidth(listener: () => void) {
  const media = window.matchMedia("(min-width: 900px)");
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

/** Whether the shell has its desktop layout: 900px and wider. */
export function useWideShell() {
  return useSyncExternalStore(
    subscribeWidth,
    () => window.matchMedia("(min-width: 900px)").matches,
    () => false,
  );
}
