"use client";

import { Button, cn, Input } from "@pythia/ui";
import { ChevronDown, ExternalLink, Search } from "lucide-react";
import { useState } from "react";
import {
  useProviders,
  useSetProviderKey,
} from "@/client/hermes-settings-queries";
import type { ProviderKey } from "@/server/hermes-settings-contract";
import { SourceState } from "./config-page";
import { CredentialField } from "./credential-field";
import { ListRow } from "./primitives";

type Group = { provider: string; keys: ProviderKey[]; set: boolean };

function groups(keys: readonly ProviderKey[], search: string): Group[] {
  const query = search.trim().toLowerCase();
  const byProvider = new Map<string, ProviderKey[]>();
  for (const key of keys) {
    if (
      query &&
      !`${key.provider} ${key.label} ${key.key}`.toLowerCase().includes(query)
    )
      continue;
    byProvider.set(key.provider, [
      ...(byProvider.get(key.provider) ?? []),
      key,
    ]);
  }
  // A provider without a key of its own (only a base URL override, say)
  // belongs to another card or to config, not a card here.
  return [...byProvider]
    .filter(([, list]) => list.some((key) => key.secret))
    .map(([provider, list]) => ({
      provider,
      keys: list,
      set: list.some((key) => key.set && key.secret),
    }))
    .sort(
      (a, b) =>
        Number(b.set) - Number(a.set) ||
        Number(a.provider === "Other") - Number(b.provider === "Other") ||
        a.provider.localeCompare(b.provider),
    );
}

function KeyRow({ item }: { item: ProviderKey }) {
  const set = useSetProviderKey();
  return (
    <CredentialField
      label={item.label}
      secret={item.secret}
      state={{
        set: item.set,
        display: item.set
          ? item.secret
            ? `•••• ${item.hint ?? ""}`.trim()
            : "Set"
          : undefined,
      }}
      placeholder={item.secret ? `Paste ${item.label}` : "Not set"}
      pending={set.isPending}
      onSave={async (value) => {
        try {
          await set.mutateAsync({ key: item.key, value });
          return null;
        } catch (error) {
          return error instanceof Error ? error.message : "Not saved.";
        }
      }}
    />
  );
}

/** One provider: its main key inline, anything more behind a disclosure. */
function ProviderCard({ group }: { group: Group }) {
  const [open, setOpen] = useState(false);
  const primary =
    group.keys.find((key) => key.secret && !key.advanced) ?? group.keys[0];
  const rest = group.keys.filter((key) => key !== primary);
  const docs = group.keys.find((key) => key.docsUrl)?.docsUrl;
  if (!primary) return null;
  return (
    <div
      data-slot="provider-keys"
      className={cn(
        "rounded-control px-3",
        open && "bg-subtle ring-1 ring-border",
      )}
    >
      <ListRow
        title={
          <span className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cn(
                "size-2 flex-none rounded-pill",
                group.set ? "bg-current text-success" : "bg-border-strong",
              )}
            />
            {group.provider}
            <span className="sr-only">
              {group.set ? " (key set)" : " (no key)"}
            </span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {primary.label}
            {docs ? (
              <a
                href={docs}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-foreground-secondary underline-offset-2 hover:text-foreground hover:underline"
              >
                Get a key
                <ExternalLink aria-hidden="true" className="size-3" />
              </a>
            ) : null}
            {rest.length ? (
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
                className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-foreground-secondary hover:text-foreground"
              >
                {open ? "Fewer settings" : `${rest.length} more`}
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    "motion-fast size-3 transition-transform",
                    open && "rotate-180",
                  )}
                />
              </button>
            ) : null}
          </span>
        }
        action={<KeyRow item={primary} />}
      />
      {open
        ? rest.map((item) => (
            <ListRow
              key={item.key}
              title={item.label}
              hint={item.key}
              action={<KeyRow item={item} />}
            />
          ))
        : null}
    </div>
  );
}

/** Provider API keys Hermes keeps in its `.env`, as in Hermes Desktop. */
export function ApiKeysPage() {
  const providers = useProviders();
  const [search, setSearch] = useState("");
  const list = groups(providers.data?.keys ?? [], search);
  const [all, setAll] = useState(false);
  const shown = all || search ? list : list.slice(0, 12);
  return (
    <SourceState
      source={{
        status: providers.isPending
          ? "pending"
          : providers.isError
            ? "error"
            : "ready",
        error: providers.error,
        retry: () => void providers.refetch(),
      }}
    >
      <p className="m-0 mb-4 text-body text-foreground-secondary">
        Keys stay on this device. Once saved, only their last characters are
        shown.
      </p>
      <div className="mb-3 flex h-8 items-center gap-2 rounded-control border border-border bg-raised px-2.5 text-foreground-secondary focus-within:border-border-strong">
        <Search aria-hidden="true" className="size-3.5 flex-none" />
        <Input
          aria-label="Search providers"
          placeholder="Search providers…"
          type="search"
          size="sm"
          className="min-h-0 border-0 bg-transparent px-0 focus-visible:outline-none"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {shown.length ? (
        <div className="grid gap-1">
          {shown.map((group) => (
            <ProviderCard key={group.provider} group={group} />
          ))}
        </div>
      ) : (
        <p className="m-0 py-6 text-center text-body text-foreground-secondary">
          No provider matches “{search}”.
        </p>
      )}
      {!all && !search && list.length > shown.length ? (
        <Button
          size="sm"
          variant="ghost"
          className="mt-2"
          onClick={() => setAll(true)}
        >
          Show all {list.length} providers
        </Button>
      ) : null}
    </SourceState>
  );
}
