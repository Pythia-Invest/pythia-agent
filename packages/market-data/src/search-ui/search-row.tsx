import { ComboboxItem } from "@pythia/widget-sdk";
import { Plug } from "lucide-react";
import type { SearchBinding } from "../search";
import { connectors } from "./connector-icons";
import { ROW_LABELS, type SearchOption } from "./search-model";

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
    row.listings ? others(row.listings) : null,
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
}: {
  option: SearchOption;
  onChoose(): void;
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
      <span
        title={row.listings ? others(row.listings) : undefined}
        className="w-6 flex-none text-right text-foreground-secondary tabular-nums"
      >
        {row.listings ? `+${row.listings}` : null}
      </span>
    </ComboboxItem>
  );
}
