import { cn } from "@pythia/widget-sdk";
import { Plug } from "lucide-react";
import type { MouseEvent } from "react";
import type { SearchBinding } from "../search";
import { connectors } from "./connector-icons";
import { KIND_LABELS, type SearchOption } from "./search-model";

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
      className="size-3 flex-none rounded-xs object-contain"
    />
  ) : (
    <span title={title ?? plugin} className="flex-none">
      <Plug aria-hidden="true" className="size-3 text-foreground-secondary" />
    </span>
  );
}

function onePerPlugin(bindings: readonly SearchBinding[]) {
  return bindings.filter(
    (binding, index) =>
      bindings.findIndex((other) => other.plugin === binding.plugin) === index,
  );
}

function kindLabel({ group }: SearchOption) {
  const kind = KIND_LABELS[group.kind];
  return group.depositary_of ? `${kind} of ${group.depositary_of.name}` : kind;
}

function optionLabel(option: SearchOption, bindings: readonly SearchBinding[]) {
  const { row, group } = option;
  return [
    row.ticker,
    group.name,
    row.venue ?? row.mic,
    kindLabel(option),
    row.currency,
    bindings.length
      ? `via ${bindings.map((binding) => connectorName(binding.plugin)).join(", ")}`
      : null,
  ]
    .filter(Boolean)
    .join(", ");
}

const keepInputFocus = (event: MouseEvent) => event.preventDefault();

/** One minimal row. A group's lead row shows ticker and name on the left,
 * venue and type on the right; the security's other listings follow as
 * compact rows with ticker and venue. Logos appear only for connectors bound
 * to that row. No prices. */
export function SearchRowOption({
  option,
  id,
  active,
  onPoint,
  onChoose,
}: {
  option: SearchOption;
  id: string;
  active: boolean;
  onPoint(): void;
  onChoose(): void;
}) {
  const { row, group, lead } = option;
  const bindings = onePerPlugin(row.bindings);
  const venue = row.venue ?? row.mic;
  const detail = [lead ? KIND_LABELS[group.kind] : null, row.currency]
    .filter(Boolean)
    .join(" · ");
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the combobox field owns keyboard selection through aria-activedescendant.
    <div
      role="option"
      id={id}
      tabIndex={-1}
      aria-selected={active}
      aria-label={optionLabel(option, bindings)}
      data-slot="investment-search-row"
      data-kind={group.kind}
      data-lead={lead || undefined}
      onMouseDown={keepInputFocus}
      onMouseMove={active ? undefined : onPoint}
      onClick={onChoose}
      className={cn(
        "motion-fast flex cursor-pointer items-center gap-3 rounded-control px-2.5 transition-colors aria-selected:bg-interaction-hover motion-reduce:transition-none",
        lead ? "min-h-12 py-1.5" : "min-h-8 py-1 pl-6",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "truncate text-foreground",
              lead ? "font-semibold text-body" : "text-xs",
            )}
          >
            {row.ticker}
          </span>
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
        </div>
        {lead ? (
          <div className="truncate text-foreground-secondary text-xs">
            {group.name}
          </div>
        ) : null}
      </div>
      <div
        className={cn(
          "max-w-[45%] flex-none text-right text-xs",
          !lead && "flex gap-1.5",
        )}
      >
        {venue ? (
          <div
            className={cn(
              "truncate",
              lead ? "text-foreground" : "text-foreground-secondary",
            )}
          >
            {venue}
          </div>
        ) : null}
        {detail ? (
          <div
            title={lead ? kindLabel(option) : undefined}
            className="truncate text-foreground-secondary"
          >
            {lead || !venue ? detail : `· ${detail}`}
          </div>
        ) : null}
      </div>
    </div>
  );
}
