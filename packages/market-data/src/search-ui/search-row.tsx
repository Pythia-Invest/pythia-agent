import { ComboboxItem } from "@pythia/widget-sdk";
import { ChevronDown, ChevronUp, Plug } from "lucide-react";
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

/** What a listing is beyond its company: a share class or registry shares
 * named after the company ("Class C"), else nothing. */
function ownDetail({ group, row }: SearchOption) {
  if (!row || row.name === group.name) return null;
  return row.name.startsWith(group.name)
    ? row.name.slice(group.name.length).replace(/^[\s,.-]+/u, "") || null
    : row.name;
}

function optionLabel(option: SearchOption) {
  const { group, row } = option;
  if (!row) return group.name;
  return [
    row.ticker,
    group.name,
    ownDetail(option),
    row.venue ?? row.mic,
    row.currency,
    KIND_LABELS[row.kind],
  ]
    .filter(Boolean)
    .join(", ");
}

/** A company, fund or crypto asset above its listings; not an option. */
export function GroupHeading({ option }: { option: SearchOption }) {
  const { group } = option;
  return (
    <div
      aria-hidden="true"
      data-slot="investment-search-group"
      className="flex items-baseline gap-2 px-2.5 pt-2.5 pb-0.5 text-xs"
    >
      <span className="min-w-0 truncate font-semibold text-foreground">
        {group.name}
      </span>
      <span className="flex-none text-foreground-secondary">
        {ROW_LABELS[group.kind]}
      </span>
    </div>
  );
}

/** One listing of a group on one line: ticker, the venue with its country
 * flag, what the listing is when it is not the plain share (a class, registry
 * shares), currency and type. No prices and no provider logos: search shows
 * what exists; sources belong on the instrument page. */
export function SearchRowOption({
  option,
  onChoose,
}: {
  option: SearchOption;
  onChoose(): void;
}) {
  const { row } = option;
  if (!row) return null;
  const venue = row.venue ?? row.mic;
  const detail = ownDetail(option);
  return (
    <ComboboxItem
      value={option}
      aria-label={optionLabel(option)}
      // Base UI clicks the highlighted row on Enter, so this is the one path
      // for pointer and keyboard choices.
      onClick={onChoose}
      data-slot="investment-search-row"
      data-kind={row.kind}
      className="min-h-8 gap-3 py-1 pr-2.5 pl-4 text-xs"
    >
      <span className="w-16 flex-none truncate font-semibold text-body text-foreground">
        {row.ticker}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5 text-foreground-secondary">
        {row.country ? (
          <span aria-hidden="true" title={row.country} className="flex-none">
            {countryFlag(row.country)}
          </span>
        ) : null}
        {venue ? (
          <span className="flex-none text-foreground">{venue}</span>
        ) : null}
        {detail ? <span className="min-w-0 truncate">· {detail}</span> : null}
      </span>
      <span className="w-9 flex-none text-foreground-secondary">
        {row.currency}
      </span>
      <span className="@max-sm:hidden w-28 flex-none truncate text-right text-foreground-secondary">
        {KIND_LABELS[row.kind]}
      </span>
    </ComboboxItem>
  );
}

/** The group's toggle between its relevant listings and all of them. It is
 * an ordinary option, so the arrow keys reach it and Enter toggles it. */
export function ToggleOption({
  option,
  expanded,
  onToggle,
}: {
  option: SearchOption;
  expanded: boolean;
  onToggle(): void;
}) {
  const { group } = option;
  const hidden = group.rows.length - group.shown;
  const label = expanded
    ? "Fewer listings"
    : `All ${group.rows.length} listings`;
  return (
    <ComboboxItem
      value={option}
      aria-label={
        expanded
          ? `Show fewer listings of ${group.name}`
          : `Show all ${group.rows.length} listings of ${group.name} (${hidden} more)`
      }
      onClick={onToggle}
      data-slot="investment-search-toggle"
      className="min-h-7 gap-1.5 py-0.5 pr-2.5 pl-4 text-foreground-secondary text-xs"
    >
      {expanded ? (
        <ChevronUp aria-hidden="true" className="size-3.5 flex-none" />
      ) : (
        <ChevronDown aria-hidden="true" className="size-3.5 flex-none" />
      )}
      {label}
    </ComboboxItem>
  );
}
