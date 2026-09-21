"use client";

import type { InvestmentSearchResult } from "@pythia/market-data/search";
import { Button, Dialog } from "@pythia/ui";
import { Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  type AdoptedInvestment,
  useAdoptInvestment,
  useInvestmentSearch,
} from "@/client/investment-search";
import { useDeskDrafts } from "@/client/providers";
import { useSessions } from "@/client/queries";

function ReferenceDetails({ result }: { result: InvestmentSearchResult }) {
  return (
    <details className="mt-1 text-foreground-secondary text-xs">
      <summary className="cursor-pointer py-1 focus-visible:outline-2 focus-visible:outline-ring">
        Sources and identity details
      </summary>
      <p className="py-1">
        {result.identity_status === "confirmed"
          ? "Identity confirmed."
          : result.identity_status === "conflicting"
            ? "Conflicting identity evidence; sources remain separate."
            : "Cross-provider identity not yet confirmed."}
      </p>
      {result.references.map((reference) => (
        <div
          className="my-2 break-words"
          key={JSON.stringify(reference.native_ref)}
        >
          <p>
            {reference.native_ref.provider} · {reference.native_ref.native_id}
            {!reference.available ? " · unavailable" : ""}
          </p>
          {Object.entries({
            ...reference.native_ref.qualifiers,
            ...reference.metadata,
          }).map(
            ([key, value]) =>
              value != null && (
                <p key={key}>
                  {key.replaceAll("_", " ")}: {String(value)}
                </p>
              ),
          )}
        </div>
      ))}
    </details>
  );
}

/** One investment-first search. Chat filtering retains its existing shell state;
 * workspace filename search remains owned by the workspace surface. */
export function InvestmentSearch({
  query,
  onQueryChange,
}: {
  query: string;
  onQueryChange: (query: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [settled, setSettled] = useState("");
  const [selected, setSelected] = useState<AdoptedInvestment | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const attempt = useRef(0);
  const drafts = useDeskDrafts();
  const router = useRouter();
  const sessions = useSessions();
  const search = useInvestmentSearch(settled, open && query.trim() === settled);
  const selection = useAdoptInvestment((value) => {
    if (value.revision === attempt.current) setSelected(value);
  });
  useEffect(() => {
    const timer = setTimeout(() => setSettled(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
        input.current?.select();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  const waiting = query.trim() !== settled || search.fetchStatus !== "idle";
  // Retained query data cannot publish while native access is being rechecked.
  const response =
    !waiting && !search.isError && open ? search.data : undefined;
  const chats = (sessions.data ?? [])
    .filter((chat) =>
      (chat.title ?? "Untitled chat")
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    )
    .slice(0, 5);
  function research() {
    if (!selected) return;
    const current = drafts.get("new");
    const context = `Research ${selected.result.name ?? selected.result.symbol ?? "this investment"}. Pythia subject: ${JSON.stringify(selected.data.subject)}. Data binding: ${JSON.stringify(selected.data.binding)}.`;
    drafts.update("new", {
      text: current.text ? `${current.text}\n\n${context}` : context,
    });
    changeOpen(false);
    router.push("/");
  }
  function changeOpen(next: boolean) {
    if (!next) {
      attempt.current += 1;
      setSelected(null);
      selection.reset();
    }
    setOpen(next);
  }
  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Trigger
        className="flex h-8 w-104 max-w-[45%] items-center gap-2 rounded-control border border-border bg-raised px-2.5 text-body text-foreground-secondary hover:border-border-strong focus-visible:outline-2 focus-visible:outline-ring"
        aria-label="Search"
      >
        <Search className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">
          {query || "Search investments and chats"}
        </span>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Viewport>
          <Dialog.Popup initialFocus={input} className="p-4">
            <div className="flex items-center justify-between gap-2">
              <Dialog.Title>Search</Dialog.Title>
              <Dialog.Close aria-label="Close search">
                <X aria-hidden="true" className="size-4" />
              </Dialog.Close>
            </div>
            <Dialog.Description>
              Find investments across your connected sources, or return to a
              chat.
            </Dialog.Description>
            <input
              ref={input}
              aria-label="Search investments and chats"
              type="search"
              maxLength={512}
              value={query}
              onChange={(event) => {
                attempt.current += 1;
                onQueryChange(event.target.value);
                setSelected(null);
                selection.reset();
              }}
              className="mt-3 h-10 w-full rounded-control border border-border bg-raised px-3 text-body text-foreground outline-none focus-visible:outline-2 focus-visible:outline-ring"
            />
            {selected ? (
              <section
                aria-label="Selected investment"
                className="mt-4 rounded-control border border-border p-3"
              >
                <h3 className="font-semibold">
                  {selected.result.name ??
                    selected.result.symbol ??
                    "Selected investment"}
                </h3>
                <p className="text-foreground-secondary text-xs">
                  {[
                    selected.result.symbol,
                    selected.result.venue,
                    selected.result.currency,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <p className="my-2 text-body">
                  {selected.data.identity_status === "confirmed"
                    ? "Saved to your investment catalogue."
                    : "Saved with a source-specific data binding. Cross-provider identity remains unresolved."}
                </p>
                <details className="mb-3 text-xs">
                  <summary className="cursor-pointer">Stable reference</summary>
                  {selected.issues.map((issue, index) => (
                    <p key={`${issue.code}-${index}`}>{issue.message}</p>
                  ))}
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all">
                    {JSON.stringify(
                      {
                        subject: selected.data.subject,
                        binding: selected.data.binding,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </details>
                <Button onClick={research}>Continue research in chat</Button>
              </section>
            ) : null}
            {selection.isError ? (
              <p role="alert" className="mt-3 text-body text-error">
                {selection.error.message}
              </p>
            ) : null}
            {query.trim() ? (
              <section aria-label="Investments" className="mt-4">
                <h3 className="mb-2 font-semibold text-body">Investments</h3>
                <div
                  role="status"
                  className="text-body text-foreground-secondary"
                >
                  {waiting || search.isPending
                    ? "Searching investments…"
                    : null}
                </div>
                {search.isError && !waiting ? (
                  <div role="alert">
                    <p>
                      Investment search is unavailable. Your chats are still
                      searchable.
                    </p>
                    <Button onClick={() => void search.refetch()}>
                      Retry search
                    </Button>
                  </div>
                ) : null}
                {response?.outcome === "error" ? (
                  <p role="alert">Investment search could not be completed.</p>
                ) : null}
                {response?.outcome === "partial" ? (
                  <p
                    role="status"
                    className="mb-2 text-body text-foreground-secondary"
                  >
                    Some sources could not be fully searched.
                  </p>
                ) : null}
                {response?.data.results.length === 0 &&
                response.outcome !== "error" ? (
                  <p className="text-body text-foreground-secondary">
                    No investments found.
                  </p>
                ) : null}
                <ul className="divide-y divide-border">
                  {response?.data.results.map((result) => (
                    <li key={result.id} className="py-2">
                      <button
                        type="button"
                        disabled={
                          selection.isPending ||
                          !result.kind ||
                          !result.references.some((ref) => ref.available)
                        }
                        onClick={() =>
                          selection.mutate({
                            result,
                            revision: ++attempt.current,
                          })
                        }
                        className="w-full rounded-control px-2 py-2 text-left hover:bg-raised focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
                      >
                        <span className="block font-semibold text-body">
                          {result.name ??
                            result.symbol ??
                            result.references[0]?.native_ref.native_id}
                        </span>
                        <span className="block text-foreground-secondary text-xs">
                          {[
                            result.symbol,
                            result.venue,
                            result.currency,
                            result.kind,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </button>
                      <ReferenceDetails result={result} />
                    </li>
                  ))}
                </ul>
                {selection.isPending ? (
                  <p role="status">Saving investment reference…</p>
                ) : null}
                {response?.data.truncated ? (
                  <p className="text-body text-foreground-secondary">
                    More results are available. Refine your search.
                  </p>
                ) : null}
                {response &&
                (response.issues.length > 0 ||
                  response.data.coverage.some(
                    (source) => source.issues.length > 0,
                  )) ? (
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer">
                      Search coverage
                    </summary>
                    {response.issues.map((issue, index) => (
                      <p key={`${issue.code}-${index}`}>{issue.message}</p>
                    ))}
                    {response.data.coverage.map((source) => (
                      <p key={source.provider}>
                        {source.provider}: {source.status}
                        {source.issues
                          .map((issue) => ` · ${issue.message}`)
                          .join("")}
                      </p>
                    ))}
                  </details>
                ) : null}
              </section>
            ) : (
              <p className="mt-4 text-body text-foreground-secondary">
                Search by company name, ticker or identifier.
              </p>
            )}
            {query.trim() ? (
              <section aria-label="Chats" className="mt-4">
                <h3 className="font-semibold text-body">Chats</h3>
                {chats.map((chat) => (
                  <Link
                    key={chat.id}
                    href={`/c/${encodeURIComponent(chat.id)}`}
                    onClick={() => changeOpen(false)}
                    className="block rounded-control px-2 py-2 text-body hover:bg-raised focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {chat.title ?? "Untitled chat"}
                  </Link>
                ))}
                {chats.length === 0 ? (
                  <p className="text-body text-foreground-secondary">
                    {sessions.isError
                      ? "Chats are unavailable."
                      : "No matching chats in the loaded history."}
                  </p>
                ) : null}
              </section>
            ) : null}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
