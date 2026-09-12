"use client";

import { Badge, Button, Checkbox, Popover, Separator } from "@pythia/ui";
import { Info, SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";

/** One labelled filter row inside the popover. */
function FilterRow({ control, label }: { control: ReactNode; label: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm">{label}</span>
      <span className="shrink-0">{control}</span>
    </div>
  );
}

export function ColumnFilter() {
  return (
    <div className="bg-canvas p-4 rounded-lg">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="font-semibold text-sm">Cash-generative mid caps</span>
          <span className="text-foreground-secondary text-xs">
            34 matches · run 09 March 2029
          </span>
        </div>
        <Popover.Root defaultOpen>
          <Popover.Trigger
            render={
              <Button size="sm" variant="secondary">
                <SlidersHorizontal aria-hidden="true" size={16} />
                Columns
              </Button>
            }
          />
          <Popover.Portal>
            <Popover.Positioner align="end">
              <Popover.Popup>
                <Popover.Arrow />
                <Popover.Title>Visible columns</Popover.Title>
                <Popover.Description>
                  Applies to this screen only.
                </Popover.Description>
                <div className="flex flex-col gap-3 mt-4">
                  <FilterRow
                    control={<Checkbox defaultChecked />}
                    label="EV / EBIT"
                  />
                  <FilterRow
                    control={<Checkbox defaultChecked />}
                    label="Free cash flow yield"
                  />
                  <FilterRow control={<Checkbox />} label="Net debt / EBITDA" />
                  <FilterRow control={<Checkbox />} label="Dividend cover" />
                </div>
                <Separator className="mt-4" />
                <div className="flex items-center justify-end gap-2 mt-4">
                  <Popover.Close
                    render={
                      <Button size="sm" variant="ghost">
                        Done
                      </Button>
                    }
                  />
                </div>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </div>
  );
}

export function MetricExplainer() {
  return (
    <div className="bg-canvas p-4 rounded-lg">
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-foreground-secondary text-sm">Revenue</span>
          <span className="font-semibold tabular-nums text-sm">€ 3.42bn</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2 text-foreground-secondary text-sm">
            Owner earnings
            <Popover.Root defaultOpen>
              <Popover.Trigger
                render={
                  <Button size="sm" variant="ghost">
                    <Info aria-hidden="true" size={16} />
                    How this is derived
                  </Button>
                }
              />
              <Popover.Portal>
                <Popover.Positioner align="start">
                  <Popover.Popup>
                    <Popover.Arrow />
                    <Popover.Title>Owner earnings</Popover.Title>
                    <Popover.Description>
                      Reported operating cash flow less maintenance capital
                      expenditure, taken from the FY 2028 annual report of
                      Calder Metals.
                    </Popover.Description>
                    <div className="flex flex-col gap-2 mt-4">
                      <span className="text-foreground-secondary text-xs">
                        Operating cash flow · page 41 · € 604m
                      </span>
                      <span className="text-foreground-secondary text-xs">
                        Maintenance capex · page 44 · € 192m
                      </span>
                    </div>
                    <div className="flex items-center justify-end gap-2 mt-4">
                      <Popover.Close
                        render={
                          <Button size="sm" variant="ghost">
                            Close
                          </Button>
                        }
                      />
                    </div>
                  </Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            </Popover.Root>
          </span>
          <span className="font-semibold tabular-nums text-sm">€ 412m</span>
        </div>
      </div>
    </div>
  );
}

export function SidePlacement() {
  return (
    <div className="bg-canvas p-4 rounded-lg">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="font-semibold text-sm">Calder Metals</span>
          <span className="text-foreground-secondary text-xs">
            Basic materials · 2.1% of the portfolio
          </span>
        </div>
        <Popover.Root defaultOpen>
          <Popover.Trigger
            render={
              <Button size="sm" variant="secondary">
                Coverage
              </Button>
            }
          />
          <Popover.Portal>
            <Popover.Positioner align="center" side="left">
              <Popover.Popup>
                <Popover.Arrow />
                <Popover.Title>Coverage status</Popover.Title>
                <Popover.Description>
                  Positioner side="left" anchors the popup beside the trigger
                  instead of below it.
                </Popover.Description>
                <div className="flex items-center gap-2 mt-4">
                  <Badge tone="success">Filings current</Badge>
                  <Badge tone="warning">Model stale</Badge>
                </div>
                <div className="flex items-center justify-end gap-2 mt-4">
                  <Popover.Close
                    render={
                      <Button size="sm" variant="ghost">
                        Close
                      </Button>
                    }
                  />
                </div>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </div>
  );
}

export function ClosedTrigger() {
  return (
    <div className="bg-canvas p-4 rounded-lg">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="font-semibold text-sm">Regulated utilities, EU</span>
          <span className="text-foreground-secondary text-xs">
            11 matches · run 07 March 2029
          </span>
        </div>
        <Popover.Root>
          <Popover.Trigger
            render={
              <Button size="sm" variant="secondary">
                <SlidersHorizontal aria-hidden="true" size={16} />
                Columns
              </Button>
            }
          />
          <Popover.Portal>
            <Popover.Positioner align="end">
              <Popover.Popup>
                <Popover.Arrow />
                <Popover.Title>Visible columns</Popover.Title>
                <Popover.Description>
                  A closed popover renders only its trigger.
                </Popover.Description>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </div>
  );
}
