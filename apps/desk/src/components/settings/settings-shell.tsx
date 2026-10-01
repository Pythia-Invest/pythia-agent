"use client";

import { cn, Dialog, IconButton } from "@pythia/ui";
import { ArrowLeft, ChevronLeft, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  useHermesConfig,
  useProviders,
} from "@/client/hermes-settings-queries";
import { useRepairs } from "@/client/repairs";
import { useReleaseStatus } from "@/client/settings-queries";
import { foundLabel, type SearchResult, searchSettings } from "./search";
import { resolvePage } from "./sections";
import { SettingsPageBody } from "./settings-page";
import { DesktopNav, PhoneNav } from "./settings-nav";

const resultId = (index: number) => `settings-result-${index}`;
const control =
  "motion-fast flex h-8 flex-none cursor-pointer items-center gap-2 rounded-control border-0 bg-transparent px-2.5 text-body text-foreground-secondary transition-colors hover:bg-interaction-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";

/** Sections with something to set up or act on. */
function useAttention() {
  const release = useReleaseStatus().data;
  const providers = useProviders().data;
  const repairs = useRepairs();
  const sections = new Set<string>();
  if (release?.updater === "failed" || release?.update_available === true)
    sections.add("about");
  if (
    providers &&
    !providers.accounts.some((account) => account.connected) &&
    !providers.keys.some((key) => key.set && key.secret)
  )
    sections.add("providers");
  // Issues Pythia could not settle on its own wait for the investor.
  if (repairs.open.length) sections.add("data");
  return sections;
}

function SettingsSearch({
  onChoose,
  onSearching,
}: {
  onChoose: (result: SearchResult) => void;
  onSearching: (searching: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const hermes = useHermesConfig().data;
  const results = searchSettings(query, Object.keys(hermes?.schema ?? {}));
  const searching = query.trim().length > 0;
  useEffect(() => onSearching(searching), [searching, onSearching]);
  useEffect(() => {
    if (searching)
      document
        .getElementById(resultId(cursor))
        ?.scrollIntoView({ block: "nearest" });
  }, [cursor, searching]);
  const choose = (result: SearchResult | undefined) => {
    if (!result) return;
    setQuery("");
    onChoose(result);
  };
  return (
    <>
      <search aria-label="Settings" className="mb-3">
        <label className="motion-fast flex h-9 cursor-text items-center gap-2 rounded-control border border-border bg-raised px-2.5 text-foreground-secondary transition-colors focus-within:border-border-strong focus-within:outline-2 focus-within:outline-ring focus-within:outline-offset-2">
          <Search
            aria-hidden="true"
            className="size-4 flex-none stroke-[1.6]"
          />
          <input
            ref={input}
            aria-label="Search settings"
            aria-controls={searching ? "settings-results" : undefined}
            aria-activedescendant={
              searching && results.length ? resultId(cursor) : undefined
            }
            className="min-w-0 flex-1 border-0 bg-transparent text-body text-foreground outline-none placeholder:text-foreground-secondary [&::-webkit-search-cancel-button]:hidden"
            placeholder="Search"
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCursor(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                // Clearing the search is not closing Settings.
                event.preventDefault();
                event.stopPropagation();
                setQuery("");
              } else if (event.key === "Enter" && searching) {
                event.preventDefault();
                choose(results[cursor]);
              } else if (
                (event.key === "ArrowDown" || event.key === "ArrowUp") &&
                results.length
              ) {
                event.preventDefault();
                const step = event.key === "ArrowDown" ? 1 : -1;
                setCursor((cursor + step + results.length) % results.length);
              }
            }}
          />
          {query ? (
            <IconButton
              className="-me-1.5 size-6 [&_svg]:size-3.5!"
              label="Clear settings search"
              size="sm"
              onClick={() => {
                setQuery("");
                input.current?.focus();
              }}
            >
              <X />
            </IconButton>
          ) : null}
        </label>
        <span role="status" className="sr-only">
          {searching ? foundLabel(results.length) : ""}
        </span>
      </search>
      {searching ? (
        results.length ? (
          <div
            id="settings-results"
            role="listbox"
            aria-label="Settings search results"
            className="flex flex-col gap-px"
          >
            {results.map((result, index) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the search field owns the keyboard through aria-activedescendant.
              <div
                key={`${result.kind}:${result.page}:${result.kind === "setting" ? result.key : ""}`}
                id={resultId(index)}
                role="option"
                aria-selected={index === cursor}
                tabIndex={-1}
                onClick={() => choose(result)}
                onMouseMove={() => index !== cursor && setCursor(index)}
                className="flex min-h-8 cursor-default flex-col justify-center rounded-control px-2.5 py-1 text-body text-foreground-secondary aria-selected:bg-interaction-active aria-selected:text-foreground"
              >
                <span className="truncate text-foreground">{result.title}</span>
                <span className="truncate text-xs">{result.context}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="m-0 px-2.5 py-1.5 text-body text-foreground-secondary">
            No results
          </p>
        )
      ) : null}
    </>
  );
}

/**
 * Settings: a searchable sidebar beside one page, after Hermes Desktop's
 * settings overlay; on a phone, the list, then one page on its own.
 */
export function SettingsShell({
  address,
  onPage,
}: {
  /** The page shown, or null on a phone before one is chosen. */
  address: string | null;
  onPage: (page: string | null) => void;
}) {
  const page = resolvePage(address) ?? resolvePage("model/main");
  const chosen = address !== null;
  const [searching, setSearching] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const attention = useAttention();

  useEffect(() => {
    if (page) scroller.current?.scrollTo({ top: 0 });
  }, [page]);
  // A setting chosen from search is brought into view and marked briefly.
  useEffect(() => {
    if (!focus) return;
    const row = document.getElementById(`setting-${focus}`);
    row?.scrollIntoView({ block: "center" });
    row?.setAttribute("data-highlight", "true");
    const timer = setTimeout(() => {
      row?.removeAttribute("data-highlight");
      setFocus(null);
    }, 1600);
    return () => clearTimeout(timer);
  }, [focus]);

  if (!page) return null;
  const section = page.section;
  const crumbs = [
    section.title,
    ...(section.pages.length > 1 ? [page.title] : []),
  ];

  return (
    <div
      className="@container flex min-h-0 min-w-0 flex-1"
      data-slot="settings-view"
    >
      <div className="flex min-h-0 min-w-0 flex-1 @2xl:flex-row flex-col">
        <Dialog.Title className="sr-only">Settings</Dialog.Title>
        <div
          className={cn(
            "flex min-h-0 @2xl:w-60 @2xl:flex-none flex-col overflow-y-auto @2xl:border-border @2xl:border-r bg-canvas p-3",
            chosen ? "@max-2xl:hidden" : "@max-2xl:flex-1",
          )}
        >
          <div className="mb-2 flex items-center">
            <Dialog.Close
              render={
                <button
                  type="button"
                  className={cn(control, "@max-2xl:hidden w-fit")}
                />
              }
            >
              <ArrowLeft aria-hidden="true" className="size-4 stroke-[1.6]" />
              Back
            </Dialog.Close>
            <Dialog.Close
              render={
                <button
                  type="button"
                  aria-label="Close settings"
                  className={cn(
                    control,
                    "@2xl:hidden size-9 justify-center px-0",
                  )}
                />
              }
            >
              <X aria-hidden="true" className="size-5 stroke-[1.6]" />
            </Dialog.Close>
            <span
              aria-hidden="true"
              className="@2xl:hidden flex-1 pe-9 text-center font-semibold text-body text-foreground"
            >
              Settings
            </span>
          </div>
          <SettingsSearch
            onSearching={setSearching}
            onChoose={(result) => {
              onPage(result.page);
              if (result.kind === "setting") setFocus(result.key);
            }}
          />
          {searching ? null : (
            <>
              <div className="@max-2xl:hidden">
                <DesktopNav
                  page={page.id}
                  attention={attention}
                  onPage={onPage}
                />
              </div>
              <div className="@2xl:hidden">
                <PhoneNav attention={attention} onPage={onPage} />
              </div>
            </>
          )}
        </div>
        <div
          ref={scroller}
          className={cn(
            "min-h-0 min-w-0 flex-1 overflow-y-auto bg-raised",
            !chosen && "@max-2xl:hidden",
          )}
          data-slot="settings-content"
        >
          <div className="sticky top-0 z-10 grid @2xl:hidden h-12 grid-cols-[1fr_auto_1fr] items-center border-border border-b bg-raised px-2">
            <button
              type="button"
              onClick={() => onPage(null)}
              className={cn(control, "justify-self-start")}
            >
              <ChevronLeft
                aria-hidden="true"
                className="size-4 stroke-[1.75]"
              />
              Settings
            </button>
            <span className="truncate font-semibold text-body text-foreground">
              {page.title === section.title || section.pages.length === 1
                ? section.title
                : page.title}
            </span>
          </div>
          <div className="mx-auto max-w-4xl @2xl:px-[clamp(1.25rem,4vw,3.5rem)] px-4 @2xl:pt-8 pt-5 pb-20">
            <nav aria-label="Breadcrumb" className="mb-5 @max-2xl:hidden">
              <ol className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0 text-foreground-secondary text-xs">
                <li>Settings</li>
                {crumbs.map((crumb, index) => (
                  <li key={crumb} className="flex items-center gap-1.5">
                    <span aria-hidden="true">›</span>
                    {index === crumbs.length - 1 ? (
                      <span aria-current="page" className="text-foreground">
                        {crumb}
                      </span>
                    ) : (
                      <a
                        href={`?settings=${section.pages[0]?.id ?? ""}`}
                        onClick={(event) => {
                          event.preventDefault();
                          onPage(section.pages[0]?.id ?? null);
                        }}
                        className="text-foreground-secondary no-underline hover:text-foreground"
                      >
                        {crumb}
                      </a>
                    )}
                  </li>
                ))}
              </ol>
            </nav>
            <h2 className="sr-only">{page.title}</h2>
            <div key={page.id} data-slot="settings-page" data-page={page.id}>
              <SettingsPageBody page={page} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
