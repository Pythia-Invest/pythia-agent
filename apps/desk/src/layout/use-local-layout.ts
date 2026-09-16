"use client";

import { useSyncExternalStore } from "react";
import type { createLocalLayout, LayoutFields } from "./local-layout";

const subscribeHydration = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

/** SSR and the first hydration render share defaults. Root CSS already reflects
 * saved geometry; ready is only for handing control to client-only behavior. */
export function useLocalLayout<T extends LayoutFields>(
  store: ReturnType<typeof createLocalLayout<T>>,
) {
  const value = useSyncExternalStore(
    store.subscribe,
    store.read,
    store.serverSnapshot,
  );
  const ready = useSyncExternalStore(
    subscribeHydration,
    clientReady,
    serverReady,
  );
  return { value, ready, update: store.write };
}
