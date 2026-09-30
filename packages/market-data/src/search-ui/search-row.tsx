import { ComboboxItem } from "@pythia/widget-sdk";
import { ChevronDown, ChevronUp, LoaderCircle, Plug } from "lucide-react";
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

/** A small outlined note on a row: what is unusual about the line. */
function Mark({ slot, children }: { slot: string; children: string }) {
  return (
    <span
      data-slot={`investment-search-${slot}-mark`}
      className="flex-none rounded-control border border-border px-1.5 text-foreground-secondary"
    >
      {children}
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

/** What a listing is beyond its company: another share class or preferred
 * named after the company ("Class C"), else nothing. Core names the lead
 * instrument's lines, receipts included, after the company. */
function ownDetail({ group, row }: SearchOption) {
  // A row named like the group or a shorter form of it ("ASML Holding" under
  // "ASML Holding N.V.") adds nothing.
  if (!row || group.name.startsWith(row.name)) return null;
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
    row.source ? `from ${row.source}` : null,
    row.no_ticker ? "no ticker" : null,
    row.delisted ? "delisted" : null,
    row.currency,
    KIND_LABELS[row.kind],
  ]
    .filter(Boolean)
    .join(", ");
}

/** A company, fund or crypto asset: its name and type, above its listings. */
function GroupHeading({ option }: { option: SearchOption }) {
  const { group } = option;
  return (
    <span
      data-slot="investment-search-group"
      className="flex min-w-0 items-baseline gap-2 pt-2.5 pr-2.5 pl-2.5 text-xs"
    >
      <span className="min-w-0 truncate font-semibold text-foreground">
        {group.name}
      </span>
      <span className="flex-none text-foreground-secondary">
        {ROW_LABELS[group.kind]}
      </span>
    </span>
  );
}

/** One listing of a group on one line: ticker, the venue with its country
 * flag, what the listing is when it is not the plain share (a class, registry
 * shares), the plugin that introduced a subject the reference lacks, a
 * "No ticker" mark for a security whose lines have none, a "Delisted" mark for a line that no longer trades,
 * currency and type. No prices and no provider logos: search shows what exists; data
 * sources belong on the instrument page.
 *
 * A group's first listing carries the group's heading inside the same option,
 * so the heading is hoverable and choosable (it opens that first listing's
 * instrument) and highlights exactly under the pointer; the keyboard stops on
 * heading and first listing once. */
export function SearchRowOption({
  option,
  heading = false,
  onChoose,
}: {
  option: SearchOption;
  /** Render the group's heading above this row, as part of the option. */
  heading?: boolean;
  onChoose(): void;
}) {
  const { row } = option;
  if (!row) return null;
  const venue = row.venue ?? row.mic;
  const detail = ownDetail(option);
  const cells = (
    <>
      <span className="w-16 flex-none truncate font-semibold text-body text-foreground">
        {row.ticker}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5 text-foreground-secondary">
        {row.country ? (
          <span aria-hidden="true" title={row.country} className="flex-none">
            {countryFlag(row.country)}
          </span>
        ) : null}
        {/* Both shrink, the detail far sooner, so a long venue truncates
            before it pushes the currency aside. */}
        {venue ? (
          <span className="min-w-0 truncate text-foreground">{venue}</span>
        ) : null}
        {detail ? (
          <span className="min-w-0 shrink-1000 truncate">· {detail}</span>
        ) : null}
        {row.source ? (
          <span
            data-slot="investment-search-source"
            className="min-w-0 truncate"
          >
            {venue || detail ? "· " : ""}from {row.source}
          </span>
        ) : null}
        {row.no_ticker ? <Mark slot="no-ticker">No ticker</Mark> : null}
        {row.delisted ? <Mark slot="delisted">Delisted</Mark> : null}
      </span>
      <span className="w-9 flex-none text-foreground-secondary">
        {row.currency}
      </span>
      <span className="@max-sm:hidden w-28 flex-none truncate text-right text-foreground-secondary">
        {KIND_LABELS[row.kind]}
      </span>
    </>
  );
  return (
    <ComboboxItem
      value={option}
      aria-label={optionLabel(option)}
      // Base UI clicks the highlighted row on Enter, so this is the one path
      // for pointer and keyboard choices.
      onClick={onChoose}
      data-slot="investment-search-row"
      data-kind={row.kind}
      data-heading={heading || undefined}
      className={
        heading
          ? // No margin: space between options would be a gap where the
            // pointer leaves every option and the highlight snaps back to
            // the first row.
            "flex-col items-stretch gap-0 px-0 py-0 text-xs"
          : "min-h-8 gap-3 py-1 pr-2.5 pl-4 text-xs"
      }
    >
      {heading ? (
        <>
          <GroupHeading option={option} />
          <span className="flex min-h-8 items-center gap-3 py-1 pr-2.5 pl-4">
            {cells}
          </span>
        </>
      ) : (
        cells
      )}
    </ComboboxItem>
  );
}

/** Where a group's "all listings" stands: collapsed, being read, shown, or
 * failed to load (the toggle then collapses; opening it again retries). */
export type ToggleState = "collapsed" | "loading" | "expanded" | "error";

/** The group's toggle between its relevant listings and all of them, read on
 * demand. It is an ordinary option, so the arrow keys reach it and Enter
 * toggles it. */
export function ToggleOption({
  option,
  state,
  onToggle,
}: {
  option: SearchOption;
  state: ToggleState;
  onToggle(): void;
}) {
  const { group } = option;
  const all = `All ${group.listings} listings`;
  const label = {
    collapsed: all,
    loading: `Loading ${all.toLowerCase()}…`,
    expanded: "Fewer listings",
    error: `${all} could not be loaded`,
  }[state];
  return (
    <ComboboxItem
      value={option}
      aria-label={
        state === "collapsed"
          ? `Show all ${group.listings} listings of ${group.name} (${group.listings - group.rows.length} more)`
          : state === "expanded"
            ? `Show fewer listings of ${group.name}`
            : `${label}. Show fewer listings of ${group.name}`
      }
      onClick={onToggle}
      data-slot="investment-search-toggle"
      data-state={state}
      className="min-h-7 gap-1.5 py-0.5 pr-2.5 pl-4 text-foreground-secondary text-xs"
    >
      {state === "loading" ? (
        <LoaderCircle
          aria-hidden="true"
          className="size-3.5 flex-none animate-spin motion-reduce:animate-none"
        />
      ) : state === "collapsed" ? (
        <ChevronDown aria-hidden="true" className="size-3.5 flex-none" />
      ) : (
        <ChevronUp aria-hidden="true" className="size-3.5 flex-none" />
      )}
      {label}
    </ComboboxItem>
  );
}
