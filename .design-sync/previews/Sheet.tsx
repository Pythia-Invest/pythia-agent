"use client";

import { Badge, Button, Checkbox, Separator, Sheet, Switch } from "@pythia/ui";
import { Download } from "lucide-react";
import type { ReactNode } from "react";

/** The report a sheet slides over, so the backdrop dims real content. */
function ReportPage({ action }: { action: ReactNode }) {
  return (
    <div className="bg-canvas p-4 rounded-lg">
      <div className="flex items-center justify-between gap-4 pb-4">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="font-semibold text-base">
            Northwind Grid Utilities — FY 2028 review
          </span>
          <span className="text-foreground-secondary text-xs">
            Draft · 9 sections · last edited 12 March 2029
          </span>
        </div>
        {action}
      </div>
      <Separator />
      <p className="m-0 pt-4 leading-relaxed text-sm">
        The regulated asset base grows about 7% a year through 2031, and the
        2028 determination leaves allowed returns unchanged. The open question
        is the 2030 refinancing, which the working note tracks separately.
      </p>
    </div>
  );
}

/** One labelled option row; the control is passed in so the axis stays visible. */
function OptionRow({
  control,
  description,
  label,
}: {
  control: ReactNode;
  description: string;
  label: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1 min-w-0">
        <span className="font-medium text-sm">{label}</span>
        <span className="text-foreground-secondary text-xs leading-relaxed">
          {description}
        </span>
      </div>
      <span className="shrink-0 pt-1">{control}</span>
    </div>
  );
}

export function ExportOptions() {
  return (
    <Sheet.Root defaultOpen swipeDirection="left">
      <ReportPage
        action={
          <Sheet.Trigger
            render={
              <Button variant="secondary">
                <Download aria-hidden="true" size={16} />
                Export
              </Button>
            }
          />
        }
      />
      <Sheet.Portal>
        <Sheet.Backdrop />
        <Sheet.Viewport>
          <Sheet.Popup>
            <Sheet.Content>
              <Sheet.Title>Export options</Sheet.Title>
              <Sheet.Description>
                Choose what travels with the FY 2028 review. Nothing leaves this
                device until you confirm.
              </Sheet.Description>
              <div className="flex flex-col gap-4 mt-6">
                <OptionRow
                  control={<Switch defaultChecked />}
                  description="Every figure keeps the filing and page it came from."
                  label="Include source citations"
                />
                <OptionRow
                  control={<Switch />}
                  description="Adds the working notes you have not published yet."
                  label="Include private notes"
                />
                <Separator />
                <OptionRow
                  control={<Checkbox defaultChecked />}
                  description="Portable document, one section per page."
                  label="PDF"
                />
                <OptionRow
                  control={<Checkbox />}
                  description="One row per holding, for a spreadsheet."
                  label="CSV of the holdings table"
                />
              </div>
              <div className="flex items-center justify-end gap-3 mt-6">
                <Sheet.Close render={<Button variant="ghost">Cancel</Button>} />
                <Button>Export review</Button>
              </div>
            </Sheet.Content>
          </Sheet.Popup>
        </Sheet.Viewport>
      </Sheet.Portal>
    </Sheet.Root>
  );
}

export function FilingDetail() {
  return (
    <Sheet.Root defaultOpen swipeDirection="left">
      <ReportPage
        action={
          <Sheet.Trigger
            render={<Button variant="secondary">Open filing</Button>}
          />
        }
      />
      <Sheet.Portal>
        <Sheet.Backdrop />
        <Sheet.Viewport>
          <Sheet.Popup>
            <Sheet.Content>
              <div className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-1 min-w-0">
                  <Sheet.Title>Regulator determination 2028</Sheet.Title>
                  <Sheet.Description>
                    Northwind Grid Utilities · published 21 November 2028
                  </Sheet.Description>
                </div>
                <Badge tone="info">Archived</Badge>
              </div>
              <div className="flex flex-col gap-3 mt-6">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-foreground-secondary text-sm">
                    Allowed return
                  </span>
                  <span className="font-semibold tabular-nums text-sm">
                    5.2%
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-foreground-secondary text-sm">
                    Price control period
                  </span>
                  <span className="font-semibold tabular-nums text-sm">
                    2029 – 2033
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-foreground-secondary text-sm">
                    Retrieved
                  </span>
                  <span className="font-semibold tabular-nums text-sm">
                    02 March 2029
                  </span>
                </div>
              </div>
              <Separator className="mt-6" />
              <p className="m-0 mt-6 leading-relaxed text-sm">
                “The determination confirms the allowed return on the regulated
                asset base and sets the incentive framework for network
                reliability over the 2029 to 2033 period.”
              </p>
              <span className="block mt-4 text-foreground-secondary text-xs leading-relaxed">
                Synthetic issuer and synthetic quotation.
              </span>
            </Sheet.Content>
          </Sheet.Popup>
        </Sheet.Viewport>
      </Sheet.Portal>
    </Sheet.Root>
  );
}

export function MountedLeft() {
  return (
    <Sheet.Root defaultOpen swipeDirection="right">
      <ReportPage
        action={
          <Sheet.Trigger
            render={<Button variant="secondary">Sections</Button>}
          />
        }
      />
      <Sheet.Portal>
        <Sheet.Backdrop />
        <Sheet.Viewport>
          <Sheet.Popup>
            <Sheet.Content>
              <Sheet.Title>Review sections</Sheet.Title>
              <Sheet.Description>
                Nine sections in the FY 2028 review.
              </Sheet.Description>
              <ul className="flex flex-col gap-3 list-none m-0 mt-6 p-0">
                <li className="flex items-baseline justify-between gap-4">
                  <span className="text-sm">Thesis</span>
                  <span className="text-foreground-secondary text-xs">
                    Complete
                  </span>
                </li>
                <li className="flex items-baseline justify-between gap-4">
                  <span className="text-sm">Regulated asset base</span>
                  <span className="text-foreground-secondary text-xs">
                    Complete
                  </span>
                </li>
                <li className="flex items-baseline justify-between gap-4">
                  <span className="text-sm">Refinancing 2030</span>
                  <span className="text-warning text-xs">Open question</span>
                </li>
                <li className="flex items-baseline justify-between gap-4">
                  <span className="text-sm">Valuation</span>
                  <span className="text-foreground-secondary text-xs">
                    Draft
                  </span>
                </li>
              </ul>
              <span className="block mt-6 text-foreground-secondary text-xs leading-relaxed">
                A sheet mounted on the left edge uses Root swipeDirection="right"
                — the direction names the dismissal gesture, not the edge.
              </span>
            </Sheet.Content>
          </Sheet.Popup>
        </Sheet.Viewport>
      </Sheet.Portal>
    </Sheet.Root>
  );
}
