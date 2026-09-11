"use client";

import { Drawer, IconButton } from "@pythia/ui";
import { useQueryClient } from "@tanstack/react-query";
import { PanelLeft } from "lucide-react";
import { useParams, usePathname, useRouter } from "next/navigation";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useDeskApi } from "@/client/providers";
import { deskKeys, useSessions } from "@/client/queries";
import { ShellDock, useWideShell } from "./shell-dock";
import { AgentDock } from "./agent-dock";
import { ChatHeader } from "./chat-header";
import {
  type ChatListState,
  ChatPanel,
  type ChatPanelProps,
} from "./chat-panel";
import { destinationTitle } from "./destinations";
import {
  defaultLayout,
  readLayout,
  type ShellLayout,
  writeLayout,
} from "./shell-layout";
import { useDockTabs } from "./use-dock-tabs";
import { NavRail } from "./nav-rail";
import { TopBar } from "./top-bar";
import {
  chatTitle,
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

/**
 * Application frame: navigation rail, the chat list, and the routed surface.
 *
 * The rail and the list are separate columns so the list can be hidden for a
 * wider conversation without losing navigation. Below 900px both collapse into
 * one off-canvas drawer, which is the only place they share state.
 */
export function DeskShell({ children }: { children: ReactNode }) {
  const params = useParams<{ sessionId?: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const sessions = useSessions();
  const api = useDeskApi();
  const queryClient = useQueryClient();
  const [pinnedIds, setPinnedIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [layout, setLayout] = useState<ShellLayout>(defaultLayout);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const wide = useWideShell();
  const [searchQuery, setSearchQuery] = useState("");
  const focusComposerOnHome = useRef(false);

  const focusNewChatComposer = useCallback(() => {
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLTextAreaElement>(
          '[data-slot="new-chat"] textarea[aria-label="Message Pythia"]',
        )
        ?.focus();
    });
  }, []);

  useEffect(() => {
    setPinnedIds(readPins());
    const stored = readLayout();
    setLayout(stored);
    dockWidth.current = stored.dockWidth;
  }, []);

  // Navigating closes the drawer on narrow screens.
  useEffect(() => {
    setDrawerOpen(false);
    if (pathname === "/" && focusComposerOnHome.current) {
      focusComposerOnHome.current = false;
      focusNewChatComposer();
    }
  }, [focusNewChatComposer, pathname]);

  /*
   * The docked panel's width lives in a ref, not in state.
   *
   * react-resizable-panels re-registers a panel whenever its `defaultSize`
   * prop changes, and re-registering resets the group's layout. Rendering on
   * every `onResize` therefore fought the drag: each pointer move handed the
   * panel a new default and snapped it back, so the separator looked stuck.
   * Nothing on screen needs the live width, so it is written straight to
   * storage and read back when the panel next mounts.
   */
  const dockWidth = useRef(defaultLayout.dockWidth);

  const updateLayout = useCallback((patch: Partial<ShellLayout>) => {
    setLayout((current) => {
      const next = { ...current, ...patch, dockWidth: dockWidth.current };
      writeLayout(next);
      return next;
    });
  }, []);

  const handleNewChat = useCallback(() => {
    setDrawerOpen(false);
    if (pathname === "/") {
      focusNewChatComposer();
      return;
    }
    focusComposerOnHome.current = true;
    router.push("/");
  }, [focusNewChatComposer, pathname, router]);

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

  const renameChat = useCallback(
    async (sessionId: string, title: string) => {
      await api.renameSession(sessionId, title);
      await queryClient.invalidateQueries({ queryKey: deskKeys.sessions });
    },
    [api, queryClient],
  );

  // The chat list belongs to the Chat destination, not to every surface.
  const chatSurface = pathname === "/" || pathname.startsWith("/c/");

  /*
   * The dock keeps the chats you are working on as tabs, so moving to Markets
   * carries them with you rather than starting something new. Opening a chat
   * on the chat route adds it to the strip, which is what makes the dock feel
   * like the same desk rather than a second place chats can live.
   */
  const routeSessionId = params.sessionId ?? null;
  const dock = useDockTabs(sessions.data ?? [], routeSessionId);

  /*
   * The chat list appears in three places — the wide column, the narrow
   * drawer, and inside the docked panel — and they are the same list. Its
   * wiring is built once here so a change reaches all three, and so no
   * placement can drift onto its own copy of the Hermes data.
   */
  const chatList: ChatPanelProps = useMemo(
    () => ({
      activeId: routeSessionId,
      globalQuery: searchQuery,
      onNewChat: handleNewChat,
      onRename: renameChat,
      onRetry: handleRetry,
      onTogglePin: handleTogglePin,
      pinnedIds,
      sessions: sessions.data ?? [],
      state,
    }),
    [
      handleNewChat,
      handleRetry,
      handleTogglePin,
      pinnedIds,
      renameChat,
      routeSessionId,
      searchQuery,
      sessions.data,
      state,
    ],
  );

  /*
   * The header belongs to the conversation, so it is absent on the new-chat
   * surface: there is no chat to name yet, and the opening carries its own
   * invitation. It is also absent below 900px, where the drawer's own controls
   * and the top bar already fill that line.
   */
  const routeSession = (sessions.data ?? []).find(
    (session) => session.id === routeSessionId,
  );
  const surface = (
    <main className="flex min-w-0 flex-1 flex-col bg-raised">
      {chatSurface && (routeSessionId || !layout.listOpen) ? (
        <div className="hidden min-[900px]:block">
          <ChatHeader
            chatTitle={routeSession ? chatTitle(routeSession) : null}
            listOpen={layout.listOpen}
            onNewChat={handleNewChat}
            onShowList={() => updateLayout({ listOpen: true })}
          />
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </main>
  );

  const navigation = (
    <NavRail
      className="hidden min-[900px]:flex"
      collapsed={layout.railCollapsed}
      id="desk-navigation"
      onNavigateHome={handleNewChat}
      onToggleCollapsed={() =>
        updateLayout({ railCollapsed: !layout.railCollapsed })
      }
      pathname={pathname}
    />
  );

  return (
    <Drawer.Root
      open={!wide && drawerOpen}
      onOpenChange={setDrawerOpen}
      swipeDirection="right"
    >
      <div className="flex h-dvh overflow-hidden">
        {navigation}
        {!wide ? (
          <Drawer.Portal>
            <Drawer.Backdrop />
            <Drawer.Viewport>
              <Drawer.Popup
                aria-label="Navigation"
                className="border-0 data-[swipe-direction=right]:w-[min(24rem,calc(100vw-3rem))]"
              >
                <Drawer.Content className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
                  <NavRail
                    className="h-auto max-h-[55dvh] w-full flex-none"
                    collapsed={false}
                    onNavigateHome={handleNewChat}
                    onToggleCollapsed={() => setDrawerOpen(false)}
                    pathname={pathname}
                  />
                  <ChatPanel
                    {...chatList}
                    className="h-auto min-h-0 w-full flex-1"
                  />
                </Drawer.Content>
              </Drawer.Popup>
            </Drawer.Viewport>
          </Drawer.Portal>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
            actions={
              <Drawer.Trigger
                render={
                  <IconButton
                    className="min-[900px]:hidden"
                    label="Open navigation"
                    size="sm"
                  >
                    <PanelLeft className="stroke-[1.6]" />
                  </IconButton>
                }
              />
            }
            onQueryChange={setSearchQuery}
            query={searchQuery}
            title={destinationTitle(pathname)}
          />
          <div className="flex min-h-0 flex-1">
            {layout.listOpen && chatSurface ? (
              <ChatPanel
                {...chatList}
                className="hidden min-[900px]:flex"
                onHide={() => updateLayout({ listOpen: false })}
              />
            ) : null}
            {chatSurface ? (
              surface
            ) : (
              <ShellDock
                open={layout.dockOpen}
                onOpenChange={(open) => updateLayout({ dockOpen: open })}
                width={dockWidth}
                dock={(onHide) => (
                  <AgentDock
                    onCloseChat={dock.close}
                    onHide={onHide}
                    onNewChat={dock.draft}
                    onSelectChat={dock.open}
                    onTogglePin={handleTogglePin}
                    pinnedIds={pinnedIds}
                    sessionId={dock.activeId}
                    sessions={sessions.data ?? []}
                    tabs={dock.tabs}
                  />
                )}
              >
                {surface}
              </ShellDock>
            )}
          </div>
        </div>
      </div>
    </Drawer.Root>
  );
}
