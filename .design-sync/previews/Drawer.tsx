"use client";

import { Badge, Button, Drawer, Separator } from "@pythia/ui";
import { FileText } from "lucide-react";
import type { ReactNode } from "react";

/** The screen a drawer slides over, so the backdrop dims real content. */
function ScreenerPage({ action }: { action: ReactNode }) {
  const rows = [
    { name: "Northwind Grid Utilities", ratio: "13.2×", yield: "4.1%" },
    { name: "Calder Metals", ratio: "8.6×", yield: "2.7%" },
    { name: "Kestrel Logistics", ratio: "11.9×", yield: "1.8%" },
    { name: "Aldergrove Utilities", ratio: "15.4×", yield: "3.9%" },
  ];
  return (
    <div className="bg-canvas p-4 rounded-lg">
      <div className="flex items-center justify-between gap-4 pb-4">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="font-semibold text-base">
            Cash-generative mid caps
          </span>
          <span className="text-foreground-secondary text-xs">
            34 matches · run 09 March 2029
          </span>
        </div>
        {action}
      </div>
      <Separator />
      <ul className="flex flex-col gap-3 list-none m-0 p-0 pt-4">
        {rows.map((row) => (
          <li
            className="flex items-baseline justify-between gap-4"
            key={row.name}
          >
            <span className="text-sm">{row.name}</span>
            <span className="flex items-baseline gap-4 text-foreground-secondary text-xs tabular-nums">
              <span>EV / EBIT {row.ratio}</span>
              <span>Yield {row.yield}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function EvidenceDrawer() {
  return (
    <Drawer.Root defaultOpen>
      <ScreenerPage
        action={
          <Drawer.Trigger
            render={
              <Button variant="secondary">
                <FileText aria-hidden="true" size={16} />
                Show evidence
              </Button>
            }
          />
        }
      />
      <Drawer.Portal>
        <Drawer.Backdrop />
        <Drawer.Viewport>
          <Drawer.Popup>
            <Drawer.Content>
              <div className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-1 min-w-0">
                  <Drawer.Title>
                    Evidence behind the Northwind Grid Utilities match
                  </Drawer.Title>
                  <Drawer.Description>
                    Three sources, retrieved from the local archive between 02
                    and 09 March 2029.
                  </Drawer.Description>
                </div>
                <Badge tone="success">3 sources</Badge>
              </div>
              <div className="grid grid-cols-3 gap-4 mt-6">
                <div className="flex flex-col gap-1 min-w-0">
                  <span className="text-foreground-secondary text-xs">
                    Free cash flow FY 2028
                  </span>
                  <span className="font-semibold tabular-nums">€ 412m</span>
                  <span className="text-foreground-secondary text-xs">
                    Annual report, page 41
                  </span>
                </div>
                <div className="flex flex-col gap-1 min-w-0">
                  <span className="text-foreground-secondary text-xs">
                    Net debt / EBITDA
                  </span>
                  <span className="font-semibold tabular-nums">2.4×</span>
                  <span className="text-foreground-secondary text-xs">
                    Half-year statement, page 12
                  </span>
                </div>
                <div className="flex flex-col gap-1 min-w-0">
                  <span className="text-foreground-secondary text-xs">
                    Regulated asset base
                  </span>
                  <span className="font-semibold tabular-nums">€ 6.1bn</span>
                  <span className="text-foreground-secondary text-xs">
                    Regulator determination, 2028
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-end gap-3 mt-6">
                <Drawer.Close render={<Button variant="ghost">Close</Button>} />
                <Button variant="secondary">Cite in note</Button>
              </div>
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

export function MountedTop() {
  return (
    <Drawer.Root defaultOpen swipeDirection="up">
      <ScreenerPage
        action={<Drawer.Trigger render={<Button variant="secondary">Alerts</Button>} />}
      />
      <Drawer.Portal>
        <Drawer.Backdrop />
        <Drawer.Viewport>
          <Drawer.Popup>
            <Drawer.Content>
              <Drawer.Title>Overnight alerts</Drawer.Title>
              <Drawer.Description>
                Two watchlist issuers filed since the last screen run.
              </Drawer.Description>
              <div className="flex flex-col gap-2 mt-4">
                <span className="text-sm">
                  Calder Metals — half-year statement, 08 March 2029
                </span>
                <span className="text-sm">
                  Meridian Foods — trading update, 09 March 2029
                </span>
              </div>
              <span className="block mt-4 text-foreground-secondary text-xs">
                Root swipeDirection="up" mounts the drawer on the top edge.
              </span>
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

export function MountedLeft() {
  return (
    <Drawer.Root defaultOpen swipeDirection="right">
      <ScreenerPage
        action={
          <Drawer.Trigger
            render={<Button variant="secondary">Saved screens</Button>}
          />
        }
      />
      <Drawer.Portal>
        <Drawer.Backdrop />
        <Drawer.Viewport>
          <Drawer.Popup>
            <Drawer.Content>
              <Drawer.Title>Saved screens</Drawer.Title>
              <Drawer.Description>
                Pick a screen to run against tonight’s archive refresh.
              </Drawer.Description>
              <ul className="flex flex-col gap-3 list-none m-0 mt-6 p-0">
                <li className="flex flex-col gap-1">
                  <span className="text-sm">Cash-generative mid caps</span>
                  <span className="text-foreground-secondary text-xs">
                    34 matches · run 09 March 2029
                  </span>
                </li>
                <li className="flex flex-col gap-1">
                  <span className="text-sm">Regulated utilities, EU</span>
                  <span className="text-foreground-secondary text-xs">
                    11 matches · run 07 March 2029
                  </span>
                </li>
                <li className="flex flex-col gap-1">
                  <span className="text-sm">Net cash industrials</span>
                  <span className="text-foreground-secondary text-xs">
                    19 matches · run 28 February 2029
                  </span>
                </li>
              </ul>
              <span className="block mt-6 text-foreground-secondary text-xs leading-relaxed">
                Root swipeDirection="right" mounts the drawer on the left edge —
                the direction names the dismissal gesture, not the edge.
              </span>
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

export function MountedRight() {
  return (
    <Drawer.Root defaultOpen swipeDirection="left">
      <ScreenerPage
        action={
          <Drawer.Trigger
            render={<Button variant="secondary">Filing detail</Button>}
          />
        }
      />
      <Drawer.Portal>
        <Drawer.Backdrop />
        <Drawer.Viewport>
          <Drawer.Popup>
            <Drawer.Content>
              <Drawer.Title>Annual report FY 2028</Drawer.Title>
              <Drawer.Description>
                Calder Metals · filed 14 February 2029 · 186 pages.
              </Drawer.Description>
              <div className="flex flex-col gap-3 mt-6">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-foreground-secondary text-sm">
                    Revenue
                  </span>
                  <span className="font-semibold tabular-nums text-sm">
                    € 3.42bn
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-foreground-secondary text-sm">
                    Operating margin
                  </span>
                  <span className="font-semibold tabular-nums text-sm">
                    11.8%
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-foreground-secondary text-sm">
                    Capital expenditure
                  </span>
                  <span className="font-semibold tabular-nums text-sm">
                    € 152m
                  </span>
                </div>
              </div>
              <span className="block mt-6 text-foreground-secondary text-xs">
                Root swipeDirection="left" mounts the drawer on the right edge.
              </span>
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
