"use client";
// pythia-structure-ignore: One route/dock/workspace composition owns reference targeting and shell layout; visual panels and state stores are already separate components.

import { useReferenceActions } from "@/components/workspace/workspace-interactions";
import { useWorkspaceReader } from "@/components/workspace/reader-context";

import { cn, Drawer, IconButton } from "@pythia/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Menu } from "lucide-react";
import { useParams, usePathname, useRouter } from "next/navigation";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useDeskApi, useDeskView, useDeskDrafts } from "@/client/providers";
import { deskKeys, useSessions } from "@/client/queries";
import { useDailyUpdateCheck } from "@/client/update-flow";
import { useChatAttention } from "@/client/use-chat-attention";
import { WorkspaceCompanion } from "@/components/workspace/workspace-companion";
import { ShellDock, useWideShell } from "./shell-dock";
import { AgentDock } from "./agent-dock";
import { ChatHeader } from "./chat-header";
import {
  type ChatListState,
  ChatPanel,
  type ChatPanelProps,
} from "./chat-panel";
import { destinationTitle } from "./destinations";
import { shellLayout } from "./shell-layout";
import { useLocalLayout } from "@/layout/use-local-layout";
import { useDockTabs } from "./use-dock-tabs";
import { NavDrawer, NavRail } from "./nav-rail";
import { instrumentHref } from "@/components/instrument/instrument-href";
import { usePhoneChatList } from "./use-phone-chat-list";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import { ModuleTopBar } from "./module-top-bar";
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
 * wider conversation without losing navigation. Below 900px the rail becomes
 * an off-canvas drawer and the list opens over the conversation.
 */
export function DeskShell({ children }: { children: ReactNode }) {
  const params = useParams<{ sessionId?: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const sessions = useSessions();
  const { workingIds, unreadIds } = useChatAttention();
  useDailyUpdateCheck();
  const api = useDeskApi();
  const viewPublisher = useDeskView();
  const drafts = useDeskDrafts();
  const publishedRoute = useRef(pathname);
  const reader = useWorkspaceReader();
  const referenceActions = useReferenceActions();
  const queryClient = useQueryClient();
  const [pinnedIds, setPinnedIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const {
    value: layout,
    ready: layoutReady,
    update: updateLayout,
  } = useLocalLayout(shellLayout);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // On phones the Pythia chat beside a destination opens as a sheet.
  const [dockSheetOpen, setDockSheetOpen] = useState(false);
  const wide = useWideShell();
  // Phone layers do not survive a trip into the desktop layout.
  useEffect(() => {
    if (!wide) return;
    setDrawerOpen(false);
    setDockSheetOpen(false);
  }, [wide]);
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
  }, []);

  // Top-bar modules announce a chosen investment; the shell owns routing.
  useEffect(() => {
    // `listing_id` (optional) names the listing whose price the page shows.
    const onOpenSubject = (event: Event) => {
      const detail = (
        event as CustomEvent<{ subject_id?: unknown; listing_id?: unknown }>
      ).detail;
      const id = detail?.subject_id;
      const listing = detail?.listing_id;
      if (typeof id === "string" && id && id.length <= 512)
        router.push(
          instrumentHref(
            id,
            typeof listing === "string" && listing.length <= 512
              ? listing
              : null,
          ),
        );
    };
    window.addEventListener("pythia:open-subject", onOpenSubject);
    return () =>
      window.removeEventListener("pythia:open-subject", onOpenSubject);
  }, [router]);

  // Navigating closes the drawer on narrow screens.
  useEffect(() => {
    setDrawerOpen(false);
    setDockSheetOpen(false);
    setPhoneListOpen(false);
    if (pathname === "/" && focusComposerOnHome.current) {
      focusComposerOnHome.current = false;
      focusNewChatComposer();
    }
  }, [focusNewChatComposer, pathname]);

  const handleNewChat = useCallback(() => {
    setDrawerOpen(false);
    setPhoneListOpen(false);
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
  const phoneList = useRef<HTMLElement>(null);
  const [phoneListOpen, setPhoneListOpen] = usePhoneChatList({
    wide,
    chatSurface,
    searchQuery,
    panel: phoneList,
  });

  /*
   * The dock keeps the chats you are working on as tabs, so moving to Markets
   * carries them with you rather than starting something new. Opening a chat
   * on the chat route adds it to the strip, which is what makes the dock feel
   * like the same desk rather than a second place chats can live.
   */
  const routeSessionId = params.sessionId ?? null;
  const dock = useDockTabs(sessions.data ?? [], routeSessionId);
  const activeDockTab = dock.tabs.find((tab) => tab.id === dock.activeId);
  const referenceTarget =
    activeDockTab?.sessionId ?? activeDockTab?.id ?? "new";
  useEffect(() => {
    referenceActions?.register(
      chatSurface
        ? (routeSessionId ?? "new")
        : wide && layout.dockOpen
          ? referenceTarget
          : null,
      (target) => {
        if (!wide)
          reader?.closeAndFocus(() =>
            document.querySelector<HTMLTextAreaElement>(
              `[data-draft-key="${CSS.escape(target)}"] textarea`,
            ),
          );
        if (chatSurface || !wide)
          router.push(
            target === "new" ? "/" : `/c/${encodeURIComponent(target)}`,
          );
        else {
          if (target === "new") {
            const id = dock.draft();
            drafts.update(id, drafts.get("new"));
            drafts.clear("new");
          } else if (
            dock.tabs.some((tab) => tab.id === target && !tab.sessionId)
          ) {
            dock.select(target);
          } else dock.open(target);
          updateLayout({ dockOpen: true });
        }
      },
    );
  }, [
    referenceActions,
    reader?.closeAndFocus,
    chatSurface,
    routeSessionId,
    wide,
    layout.dockOpen,
    referenceTarget,
    drafts,
    dock.tabs,
    dock.select,
    dock.draft,
    dock.open,
    router,
    updateLayout,
  ]);
  useEffect(() => {
    // Only structured app state is exposed; no form values or document DOM.
    const navigated = publishedRoute.current !== pathname;
    publishedRoute.current = pathname;
    viewPublisher.setView(
      !navigated && reader?.view
        ? reader.view
        : { route: pathname, title: destinationTitle(pathname) },
    );
  }, [viewPublisher, reader?.view, pathname]);

  /*
   * The chat list appears in three places — the wide column, the phone
   * overlay, and inside the docked panel — and they are the same list. Its
   * wiring is built once here so a change reaches all three, and so no
   * placement can drift onto its own copy of the Hermes data.
   */
  const chatList: Omit<ChatPanelProps, "onHide"> = useMemo(
    () => ({
      activeId: routeSessionId,
      globalQuery: searchQuery,
      onNewChat: handleNewChat,
      onRename: renameChat,
      onRetry: handleRetry,
      onTogglePin: handleTogglePin,
      pinnedIds,
      sessions: sessions.data ?? [],
      workingIds,
      unreadIds,
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
      workingIds,
      unreadIds,
    ],
  );

  /*
   * The header belongs to the conversation. It stays on the new-chat surface
   * too, so a first message does not shift when its chat route takes over.
   */
  const routeSession = (sessions.data ?? []).find(
    (session) => session.id === routeSessionId,
  );
  const surface = (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col">
      {chatSurface ? (
        <div>
          <ChatHeader
            key={routeSessionId}
            chatTitle={routeSession ? chatTitle(routeSession) : null}
            onRename={
              routeSessionId
                ? (title) => renameChat(routeSessionId, title)
                : undefined
            }
            onNewChat={handleNewChat}
            onShowList={() =>
              wide ? updateLayout({ listOpen: true }) : setPhoneListOpen(true)
            }
          />
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </main>
  );

  const navigation = (
    <NavRail
      className="hidden min-[900px]:flex"
      persistent
      id="desk-navigation"
      onNavigateHome={handleNewChat}
      onToggleCollapsed={() =>
        updateLayout({ railCollapsed: !layout.railCollapsed })
      }
      pathname={pathname}
    />
  );

  return (
    <>
      <Drawer.Root
        open={!wide && drawerOpen}
        onOpenChange={setDrawerOpen}
        swipeDirection="right"
      >
        {/* One canvas for every routed workspace. Pages and layout wrappers
          stay transparent; bounded cards and auxiliary panels own elevation. */}
        <div className="flex h-dvh overflow-hidden bg-canvas text-foreground">
          {navigation}
          {!wide ? (
            <NavDrawer
              onNavigateHome={handleNewChat}
              onClose={() => setDrawerOpen(false)}
              pathname={pathname}
            />
          ) : null}
          <div className="flex min-w-0 flex-1 flex-col">
            <ModuleTopBar
              chats={(sessions.data ?? []).map((session) => ({
                id: session.id,
                title: chatTitle(session),
              }))}
              openChat={(id) => {
                if ((sessions.data ?? []).some((session) => session.id === id))
                  router.push(`/c/${encodeURIComponent(id)}`);
              }}
              prepareChat={(text) => {
                const current = drafts.get("new").text;
                drafts.update("new", {
                  text: current ? `${current}\n\n${text}` : text,
                });
                handleNewChat();
              }}
              leading={
                <Drawer.Trigger
                  render={
                    <IconButton
                      className="min-[900px]:hidden"
                      label="Open navigation"
                      size="sm"
                    >
                      <Menu className="stroke-[1.6]" />
                    </IconButton>
                  }
                />
              }
              onQueryChange={setSearchQuery}
              query={searchQuery}
              title={destinationTitle(pathname)}
            />
            <div className="relative flex min-h-0 flex-1">
              {chatSurface ? (
                <ChatPanel
                  {...chatList}
                  panelRef={phoneList}
                  className={cn(
                    "hidden min-[900px]:flex min-[900px]:[[data-desk-list-open=false]_&]:hidden",
                    // On a phone the same collapsible list opens over the
                    // conversation rather than beside it.
                    phoneListOpen &&
                      "max-[899px]:absolute max-[899px]:inset-0 max-[899px]:z-20 max-[899px]:flex max-[899px]:w-full max-[899px]:border-r-0 max-[899px]:bg-canvas",
                  )}
                  onHide={() =>
                    wide
                      ? updateLayout({ listOpen: false })
                      : setPhoneListOpen(false)
                  }
                />
              ) : null}
              {chatSurface ? (
                // Under the phone list the conversation is out of reach.
                <div className="contents" inert={phoneListOpen && !wide}>
                  <WorkspaceCompanion>{surface}</WorkspaceCompanion>
                </div>
              ) : (
                <ShellDock
                  open={layout.dockOpen}
                  onOpenChange={(open) => updateLayout({ dockOpen: open })}
                  width={layout.dockWidth}
                  ready={layoutReady}
                  sheetOpen={dockSheetOpen}
                  onSheetOpenChange={setDockSheetOpen}
                  dock={(onHide) => (
                    <AgentDock
                      onCloseChat={dock.close}
                      onHide={onHide}
                      onNewChat={() => dock.draft({ reuse: !wide })}
                      onSelectChat={dock.open}
                      onTogglePin={handleTogglePin}
                      pinnedIds={pinnedIds}
                      activeId={dock.activeId}
                      onSelectTab={dock.select}
                      onDraftChange={dock.edit}
                      onStarted={dock.started}
                      sessions={sessions.data ?? []}
                      tabs={dock.tabs}
                      workingIds={workingIds}
                      unreadIds={unreadIds}
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
      {/* Outside the drawer, so it is not a nested dialog. */}
      <SettingsDialog />
    </>
  );
}
