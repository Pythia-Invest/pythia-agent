"use client";

import { cn, IconButton } from "@pythia/ui";
import { PanelLeft } from "lucide-react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useSessions } from "@/client/queries";
import { type ChatListState, DeskSidebar } from "./sidebar";
import {
  PINNED_STORAGE_KEY,
  parsePinnedIds,
  serializePinnedIds,
  togglePin,
} from "./sidebar-model";

function readPins() {
  try {
    return parsePinnedIds(localStorage.getItem(PINNED_STORAGE_KEY));
  } catch {
    return new Set<string>();
  }
}

function writePins(pinnedIds: ReadonlySet<string>) {
  try {
    localStorage.setItem(PINNED_STORAGE_KEY, serializePinnedIds(pinnedIds));
  } catch {
    // Pins are a browser-local convenience; losing them is acceptable.
  }
}

/** Application frame: sidebar beside the routed chat surface. */
export function DeskShell({ children }: { children: ReactNode }) {
  const params = useParams<{ sessionId?: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const sessions = useSessions();
  const [pinnedIds, setPinnedIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setPinnedIds(readPins());
  }, []);

  // Navigating closes the drawer on narrow screens.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  const handleTogglePin = useCallback((sessionId: string) => {
    setPinnedIds((current) => {
      const next = togglePin(current, sessionId);
      writePins(next);
      return next;
    });
  }, []);

  // A failed refetch keeps the last good list on screen and offers a retry.
  const state: ChatListState = sessions.isPending
    ? "loading"
    : sessions.isError
      ? "unavailable"
      : "ready";
  const refetchSessions = sessions.refetch;
  const handleRetry = useCallback(() => {
    void refetchSessions();
  }, [refetchSessions]);

  return (
    <div className="grid h-dvh grid-cols-[260px_minmax(0,1fr)] overflow-hidden max-md:grid-cols-[minmax(0,1fr)]">
      {drawerOpen ? (
        <button
          aria-label="Close navigation"
          className="fixed inset-0 z-15 border-0 bg-black/35 md:hidden"
          onClick={() => setDrawerOpen(false)}
          type="button"
        />
      ) : null}
      <DeskSidebar
        activeId={params.sessionId ?? null}
        // Below the md breakpoint the sidebar becomes an off-canvas drawer.
        className={cn(
          "max-md:motion-fast max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-20 max-md:-translate-x-full max-md:transition-transform",
          drawerOpen && "max-md:translate-x-0",
        )}
        id="desk-navigation"
        onNewChat={() => router.push("/")}
        onRetry={handleRetry}
        onTogglePin={handleTogglePin}
        pinnedIds={pinnedIds}
        sessions={sessions.data ?? []}
        state={state}
      />
      <main className="flex h-dvh min-w-0 flex-col bg-raised">
        <div className="flex min-h-13 items-center px-3 py-2 md:hidden">
          <IconButton
            aria-controls="desk-navigation"
            aria-expanded={drawerOpen}
            label="Open navigation"
            onClick={() => setDrawerOpen(true)}
            size="sm"
          >
            <PanelLeft />
          </IconButton>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </main>
    </div>
  );
}
