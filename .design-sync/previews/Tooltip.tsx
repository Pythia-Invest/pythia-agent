import { IconButton, Tooltip } from "@pythia/ui";
import { Bookmark, Download, RefreshCw, Share2 } from "lucide-react";

/**
 * Tooltips are hover/focus triggered, so every story renders with
 * `defaultOpen` — the static equivalent of the pointer resting on the trigger.
 * Base UI keeps a single tooltip open at a time, so each story shows one
 * placement rather than a side-by-side grid of sides. The open/close
 * transitions themselves are not capturable.
 */

export function FreshnessHint() {
  return (
    <div className="bg-canvas p-6 rounded-lg" style={{ paddingTop: 96 }}>
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-raised p-4 max-w-md">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-foreground text-sm">
            Northwind Grid Utilities
          </span>
          <Tooltip.Root defaultOpen>
            <Tooltip.Trigger className="ml-auto rounded-full border border-border bg-subtle px-2 py-1 font-medium text-foreground-secondary text-xs">
              Delayed 15 min
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Positioner side="top">
                <Tooltip.Popup>
                  Quote feed last stamped 09:42 CET. Fundamentals are as
                  reported in the FY 2028 annual filing.
                </Tooltip.Popup>
              </Tooltip.Positioner>
            </Tooltip.Portal>
          </Tooltip.Root>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="flex flex-col gap-1 min-w-0">
            <span className="text-foreground-secondary text-xs">Last</span>
            <span className="font-semibold tabular-nums">€ 24.60</span>
          </div>
          <div className="flex flex-col gap-1 min-w-0">
            <span className="text-foreground-secondary text-xs">Weight</span>
            <span className="font-semibold tabular-nums">3.8%</span>
          </div>
          <div className="flex flex-col gap-1 min-w-0">
            <span className="text-foreground-secondary text-xs">EV / EBIT</span>
            <span className="font-semibold tabular-nums">13.1×</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function OnIconActions() {
  return (
    <div className="bg-canvas p-6 rounded-lg" style={{ paddingBottom: 72 }}>
      <div className="flex items-center gap-3 rounded-lg border border-border bg-raised px-4 py-3 max-w-lg">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="font-semibold text-foreground text-sm">
            Quality screen — 42 issuers
          </span>
          <span className="text-foreground-secondary text-xs">
            Re-run 12 March 2029 · synthetic universe
          </span>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Tooltip.Root>
            <Tooltip.Trigger
              render={
                <IconButton label="Re-run screen" variant="ghost">
                  <RefreshCw aria-hidden="true" size={16} />
                </IconButton>
              }
            />
            <Tooltip.Portal>
              <Tooltip.Positioner>
                <Tooltip.Popup>Re-run screen</Tooltip.Popup>
              </Tooltip.Positioner>
            </Tooltip.Portal>
          </Tooltip.Root>
          <Tooltip.Root defaultOpen>
            <Tooltip.Trigger
              render={
                <IconButton label="Save to watchlist" variant="ghost">
                  <Bookmark aria-hidden="true" size={16} />
                </IconButton>
              }
            />
            <Tooltip.Portal>
              <Tooltip.Positioner side="bottom">
                <Tooltip.Popup>
                  Save this screen to the Watchlist candidates view
                </Tooltip.Popup>
              </Tooltip.Positioner>
            </Tooltip.Portal>
          </Tooltip.Root>
          <Tooltip.Root>
            <Tooltip.Trigger
              render={
                <IconButton label="Export CSV" variant="ghost">
                  <Download aria-hidden="true" size={16} />
                </IconButton>
              }
            />
            <Tooltip.Portal>
              <Tooltip.Positioner>
                <Tooltip.Popup>Export CSV</Tooltip.Popup>
              </Tooltip.Positioner>
            </Tooltip.Portal>
          </Tooltip.Root>
          <Tooltip.Root>
            <Tooltip.Trigger
              render={
                <IconButton disabled label="Share screen" variant="ghost">
                  <Share2 aria-hidden="true" size={16} />
                </IconButton>
              }
            />
            <Tooltip.Portal>
              <Tooltip.Positioner>
                <Tooltip.Popup>
                  Sharing is off for this workspace
                </Tooltip.Popup>
              </Tooltip.Positioner>
            </Tooltip.Portal>
          </Tooltip.Root>
        </div>
      </div>
    </div>
  );
}

export function AnchoredRight() {
  return (
    <div className="bg-canvas p-6 rounded-lg">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-raised p-4 max-w-xs">
        <span className="font-semibold text-foreground text-sm">
          Calder Metals — FY 2028
        </span>
        <div className="flex items-center gap-2">
          <span className="text-foreground-secondary text-xs">
            Free cash flow
          </span>
          <Tooltip.Root defaultOpen>
            <Tooltip.Trigger className="ml-auto rounded-full border border-border bg-subtle px-2 py-1 font-medium text-foreground-secondary text-xs">
              Estimate
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Positioner side="right">
                <Tooltip.Popup>
                  Derived from reported operating cash flow less capex; not a
                  figure the issuer discloses.
                </Tooltip.Popup>
              </Tooltip.Positioner>
            </Tooltip.Portal>
          </Tooltip.Root>
        </div>
        <span className="font-semibold tabular-nums">€ 412m</span>
      </div>
    </div>
  );
}
