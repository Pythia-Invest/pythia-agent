import { ComboboxItem } from "@pythia/widget-sdk";
import { ChevronRight, Plug } from "lucide-react";
import type { SearchBinding } from "../search";
import { connectors } from "./connector-icons";
import { KIND_LABELS, ROW_LABELS, type SearchOption } from "./search-model";

export function connectorName(plugin: string): string {
  return connectors[plugin]?.name ?? plugin;
}

/** A tiny connector logo; a plugin without a bundled icon gets a neutral mark. */
export function ConnectorMark({
  plugin,
  title,
}: {
  plugin: string;
  title?: string;
}) {
  const known = connectors[plugin];
  return known ? (
    <img
      src={known.icon}
      alt=""
      title={title ?? known.name}
      width={12}
      height={12}
      className="size-3 flex-none object-contain"
    />
  ) : (
    <span title={title ?? plugin} className="flex-none">
      <Plug aria-hidden="true" className="size-3 text-foreground-secondary" />
    </span>
  );
}

/** The regional-indicator flag of an ISO 3166 country code. */
function countryFlag(country: string): string {
  return String.fromCodePoint(
    ...[...country.toUpperCase()].map(
      (letter) => 0x1f1a5 + letter.charCodeAt(0),
    ),
  );
}

function onePerPlugin(bindings: readonly SearchBinding[]) {
  return bindings.filter(
    (binding, index) =>
      bindings.findIndex((other) => other.plugin === binding.plugin) === index,
  );
}

function others(count: number) {
  return `${count} other listing${count === 1 ? "" : "s"}`;
}

function optionLabel(
  { row }: SearchOption,
  bindings: readonly SearchBinding[],
) {
  return [
    row.ticker,
    row.name,
    row.venue ?? row.mic,
    ROW_LABELS[row.kind],
    row.listings ? `${others(row.listings)} (Right arrow to show them)` : null,
    bindings.length
      ? `via ${bindings.map((binding) => connectorName(binding.plugin)).join(", ")}`
      : null,
  ]
    .filter(Boolean)
    .join(", ");
}

/** One instrument on one line: ticker, name, the representative listing's
 * venue with its country flag, a plain type and how many other listings it
 * has. Logos appear only for connectors bound to that listing. No prices. */
export function SearchRowOption({
  option,
  onChoose,
  onExpand,
}: {
  option: SearchOption;
  onChoose(): void;
  /** Shows the instrument's listings; absent when the host reads none. */
  onExpand?: (() => void) | undefined;
}) {
  const { row } = option;
  const bindings = onePerPlugin(row.bindings);
  const venue = row.venue ?? row.mic;
  return (
    <ComboboxItem
      value={option}
      aria-label={optionLabel(option, bindings)}
      // Base UI clicks the highlighted row on Enter, so this is the one path
      // for pointer and keyboard choices.
      onClick={onChoose}
      data-slot="investment-search-row"
      data-kind={row.kind}
      className="min-h-9 gap-3 px-2.5 py-1.5 text-xs"
    >
      <span className="w-18 flex-none truncate font-semibold text-body text-foreground">
        {row.ticker}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="truncate text-foreground">{row.name}</span>
        {bindings.length ? (
          <span
            aria-hidden="true"
            data-slot="investment-search-connectors"
            className="flex flex-none items-center gap-1"
          >
            {bindings.slice(0, 4).map((binding) => (
              <ConnectorMark
                key={binding.plugin}
                plugin={binding.plugin}
                title={`${connectorName(binding.plugin)} · ${binding.ref}`}
              />
            ))}
          </span>
        ) : null}
      </span>
      {venue ? (
        <span className="flex min-w-0 max-w-[32%] flex-none items-center gap-1.5 text-foreground-secondary">
          {row.country ? (
            <span aria-hidden="true" title={row.country} className="flex-none">
              {countryFlag(row.country)}
            </span>
          ) : null}
          {/* A narrow panel keeps the flag and drops the venue name. */}
          <span className="@max-sm:hidden truncate">{venue}</span>
        </span>
      ) : null}
      <span className="w-16 flex-none truncate text-right text-foreground-secondary">
        {ROW_LABELS[row.kind]}
      </span>
      {row.listings && onExpand ? (
        // Pointer path to the side list; keyboard users press → on the row,
        // which its label announces. Clicking here never opens the row.
        <span
          aria-hidden="true"
          title={`Show ${others(row.listings)}`}
          data-slot="investment-search-expand"
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation();
            event.preventDefault();
            onExpand();
          }}
          className="motion-fast -my-1 flex h-6 w-9 flex-none cursor-pointer items-center justify-end gap-0.5 rounded-control pr-0.5 text-foreground-secondary tabular-nums transition-colors hover:bg-interaction-active hover:text-foreground"
        >
          +{row.listings}
          <ChevronRight className="size-3 flex-none" />
        </span>
      ) : (
        <span
          title={row.listings ? others(row.listings) : undefined}
          className="w-9 flex-none pr-0.5 text-right text-foreground-secondary tabular-nums"
        >
          {row.listings ? `+${row.listings}` : null}
        </span>
      )}
    </ComboboxItem>
  );
}

/** One line of the expanded instrument: ticker, venue with its flag,
 * currency and type. The line the search row stood for (the preferred
 * listing) is marked. */
export function ListingRowOption({
  option,
  onChoose,
}: {
  option: SearchOption;
  onChoose(): void;
}) {
  const { row, listing } = option;
  if (!listing) return null;
  const venue = listing.venue ?? listing.mic;
  const type = listing.kind ? KIND_LABELS[listing.kind] : null;
  const shown = listing.id === row.id;
  return (
    <ComboboxItem
      value={option}
      aria-label={[
        listing.ticker ?? listing.mic,
        venue,
        listing.currency,
        type,
        shown ? "preferred listing" : null,
      ]
        .filter(Boolean)
        .join(", ")}
      onClick={onChoose}
      data-slot="investment-search-listing"
      className="min-h-9 gap-3 px-2.5 py-1.5 text-xs"
    >
      <span className="w-18 flex-none truncate font-semibold text-body text-foreground">
        {listing.ticker ?? listing.mic}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5 text-foreground-secondary">
        {listing.country ? (
          <span
            aria-hidden="true"
            title={listing.country}
            className="flex-none"
          >
            {countryFlag(listing.country)}
          </span>
        ) : null}
        <span className="truncate text-foreground">{venue}</span>
        {listing.currency ? (
          <span className="flex-none">{listing.currency}</span>
        ) : null}
      </span>
      {shown ? (
        <span className="flex-none text-[10px] text-foreground-secondary uppercase tracking-wide">
          Preferred
        </span>
      ) : null}
      <span className="w-28 flex-none truncate text-right text-foreground-secondary">
        {type}
      </span>
    </ComboboxItem>
  );
}
