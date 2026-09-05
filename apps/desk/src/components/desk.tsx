"use client";

import {
  ActivityIndicator,
  Button,
  IconButton,
  Input,
  PythiaLockup,
  SemanticMessage,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarItem,
  SidebarLink,
  SidebarList,
  SidebarNav,
  SidebarSection,
  SidebarSectionLabel,
  useThemePreference,
} from "@pythia/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DeskApi, DeskApiError } from "@/client/api";
import type { HermesSession } from "@/server/types";
import { NewConversation } from "./new-conversation";
import { Conversation } from "./conversation";
import { MenuIcon, MoonIcon, PlusIcon, SunIcon } from "./icons";
import { DeviceSettings } from "./settings";
import { ModelPickerProvider } from "./model-picker";

function title(session: HermesSession) {
  return session.title?.trim() || "Untitled conversation";
}

function date(session: HermesSession) {
  if (!session.last_active) return "";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
  }).format(new Date(session.last_active * 1000));
}

export function conversationSelection(
  sessionId: string | null,
  initialPrompt?: string,
) {
  return { activeId: sessionId, initialPrompt };
}

export function PythiaDesk() {
  const api = useMemo(() => new DeskApi(), []);
  const [sessions, setSessions] = useState<HermesSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [initialPrompt, setInitialPrompt] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<DeskApiError | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const refresh = useCallback(async () => {
    const next = await api.listSessions();
    setSessions(next);
  }, [api]);

  useEffect(() => {
    let live = true;
    const initialize = async () => {
      try {
        await api.initialize();
        const next = await api.listSessions();
        if (!live) return;
        setSessions(next);
        const requested = new URL(window.location.href).searchParams.get(
          "session",
        );
        if (requested && next.some((session) => session.id === requested))
          setActiveId(requested);
        setSettingsOpen(
          new URL(window.location.href).searchParams.get("view") === "settings",
        );
      } catch (caught) {
        if (live)
          setError(
            caught instanceof DeskApiError
              ? caught
              : new DeskApiError("Hermes is not ready.", 503),
          );
      } finally {
        if (live) setLoading(false);
      }
    };
    void initialize();
    return () => {
      live = false;
    };
  }, [api]);

  useEffect(() => {
    const popstate = () => {
      const parameters = new URL(window.location.href).searchParams;
      setActiveId(parameters.get("session"));
      setSettingsOpen(parameters.get("view") === "settings");
    };
    window.addEventListener("popstate", popstate);
    return () => window.removeEventListener("popstate", popstate);
  }, []);

  const select = (sessionId: string | null, prompt?: string) => {
    const selection = conversationSelection(sessionId, prompt);
    setActiveId(selection.activeId);
    setInitialPrompt(selection.initialPrompt);
    setRenaming(false);
    setSettingsOpen(false);
    setSidebarOpen(false);
    const url = new URL(window.location.href);
    if (sessionId) url.searchParams.set("session", sessionId);
    else url.searchParams.delete("session");
    url.searchParams.delete("view");
    window.history.pushState({}, "", url);
  };

  const showSettings = () => {
    setSettingsOpen(true);
    setRenaming(false);
    setSidebarOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.delete("session");
    url.searchParams.set("view", "settings");
    window.history.pushState({}, "", url);
  };

  const create = async (prompt: string) => {
    const session = await api.createSession(
      prompt.replace(/\s+/gu, " ").slice(0, 62),
    );
    setSessions((current) => [session, ...current]);
    select(session.id, prompt);
  };

  const active = sessions.find((session) => session.id === activeId);
  return (
    <ModelPickerProvider api={api} ready={!loading && !error}>
      <div className="desk-shell">
        {sidebarOpen ? (
          <button
            aria-label="Close navigation"
            className="sidebar-scrim"
            onClick={() => setSidebarOpen(false)}
            type="button"
          />
        ) : null}
        <Sidebar
          className={sidebarOpen ? "desk-sidebar is-open" : "desk-sidebar"}
        >
          <SidebarHeader className="desk-sidebar-header">
            <PythiaLockup label="Pythia" variant="full" />
          </SidebarHeader>
          <div className="new-chat">
            <Button onClick={() => select(null)} variant="secondary">
              <PlusIcon /> New conversation
            </Button>
          </div>
          <SidebarContent>
            <SidebarSection aria-labelledby="history-heading">
              <SidebarSectionLabel id="history-heading">
                Conversations
              </SidebarSectionLabel>
              <SidebarNav aria-label="Conversation history">
                <SidebarList>
                  {sessions.map((session) => (
                    <SidebarItem key={session.id}>
                      <SidebarLink
                        active={session.id === activeId}
                        href={`?session=${encodeURIComponent(session.id)}`}
                        onClick={(event) => {
                          event.preventDefault();
                          select(session.id);
                        }}
                      >
                        <span>{title(session)}</span>
                        <small>{date(session)}</small>
                      </SidebarLink>
                    </SidebarItem>
                  ))}
                </SidebarList>
              </SidebarNav>
              {!loading && !sessions.length ? (
                <p className="sidebar-empty">
                  Your Hermes conversations will appear here.
                </p>
              ) : null}
            </SidebarSection>
          </SidebarContent>
          <SidebarFooter>
            <Button onClick={showSettings} size="sm" variant="ghost">
              Device settings
            </Button>
            <span className="connection">
              <span aria-hidden="true" />
              {error
                ? "Hermes unavailable"
                : loading
                  ? "Connecting"
                  : "Hermes connected"}
            </span>
            <ThemeButton />
          </SidebarFooter>
        </Sidebar>
        <main className="desk-main">
          <header className="desk-header">
            <IconButton
              className="mobile-menu"
              label="Open navigation"
              onClick={() => setSidebarOpen(true)}
              size="sm"
            >
              <MenuIcon />
            </IconButton>
            <div>
              <strong>
                {settingsOpen
                  ? "Device settings"
                  : active
                    ? title(active)
                    : "Pythia"}
              </strong>
              <span>
                {settingsOpen
                  ? "Native Hermes controls"
                  : "Local investment agent"}
              </span>
            </div>
            {active && !settingsOpen ? (
              <Button
                onClick={() => setRenaming(true)}
                size="sm"
                variant="ghost"
              >
                Rename
              </Button>
            ) : (
              <span />
            )}
          </header>
          {renaming && active ? (
            <RenameForm
              api={api}
              onClose={() => setRenaming(false)}
              onRenamed={(session) => {
                setSessions((current) =>
                  current.map((item) =>
                    item.id === session.id ? session : item,
                  ),
                );
                setRenaming(false);
              }}
              session={active}
            />
          ) : null}
          {error ? (
            <div className="top-message">
              <SemanticMessage title="Pythia Desk is not ready" tone="error">
                {error.message} Check <code>just status</code>, then retry.
              </SemanticMessage>
            </div>
          ) : null}
          {loading ? (
            <div className="center-state">
              <ActivityIndicator label="Opening Pythia Desk" />
            </div>
          ) : settingsOpen ? (
            <DeviceSettings api={api} />
          ) : activeId ? (
            <Conversation
              api={api}
              initialPrompt={initialPrompt}
              key={activeId}
              onChanged={() => void refresh()}
              sessionId={activeId}
            />
          ) : (
            <NewConversation disabled={Boolean(error)} onSubmit={create} />
          )}
        </main>
      </div>
    </ModelPickerProvider>
  );
}

function RenameForm({
  api,
  session,
  onClose,
  onRenamed,
}: {
  api: DeskApi;
  session: HermesSession;
  onClose: () => void;
  onRenamed: (session: HermesSession) => void;
}) {
  const [value, setValue] = useState(title(session));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setSaving(true);
    try {
      onRenamed(await api.renameSession(session.id, value));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not rename the conversation.",
      );
      setSaving(false);
    }
  };
  return (
    <form
      className="rename-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label htmlFor="session-title">Conversation title</label>
      <Input
        id="session-title"
        maxLength={120}
        onChange={(event) => setValue(event.target.value)}
        value={value}
      />
      <Button disabled={!value.trim()} loading={saving} size="sm" type="submit">
        Save
      </Button>
      <Button onClick={onClose} size="sm" type="button" variant="ghost">
        Cancel
      </Button>
      {error ? <span role="alert">{error}</span> : null}
    </form>
  );
}

function ThemeButton() {
  const { resolvedTheme, setPreference } = useThemePreference();
  const dark = resolvedTheme === "dark";
  return (
    <IconButton
      label={dark ? "Use light theme" : "Use dark theme"}
      onClick={() => setPreference(dark ? "light" : "dark")}
      size="sm"
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </IconButton>
  );
}
