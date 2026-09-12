"use client";

import {
  Badge,
  Button,
  Dialog,
  Field,
  Input,
  Separator,
  Textarea,
} from "@pythia/ui";
import { Pencil } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The surface a dialog opens over. Every open story renders it so the backdrop
 * dims something real, the way it does in the product.
 */
function ResearchPage({ action }: { action: ReactNode }) {
  return (
    <div className="bg-canvas p-4 rounded-lg">
      <div className="flex items-center justify-between gap-4 pb-4">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="font-semibold text-base">
            Northwind Grid Utilities
          </span>
          <span className="text-foreground-secondary text-xs">
            Utilities · Amsterdam · reviewed 12 March 2029
          </span>
        </div>
        {action}
      </div>
      <Separator />
      <div className="flex flex-wrap items-baseline gap-4 pt-4 text-foreground-secondary text-xs">
        <span>
          Portfolio weight{" "}
          <span className="font-semibold tabular-nums text-foreground">
            3.6%
          </span>
        </span>
        <span>
          Cost basis{" "}
          <span className="font-semibold tabular-nums text-foreground">
            € 24.80
          </span>
        </span>
        <span>
          EV / EBIT{" "}
          <span className="font-semibold tabular-nums text-foreground">
            13.2×
          </span>
        </span>
      </div>
    </div>
  );
}

export function EditPositionNote() {
  return (
    <Dialog.Root defaultOpen>
      <ResearchPage
        action={
          <Dialog.Trigger
            render={
              <Button variant="secondary">
                <Pencil aria-hidden="true" size={16} />
                Edit note
              </Button>
            }
          />
        }
      />
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Viewport>
          <Dialog.Popup>
            <Dialog.Title>Edit position note</Dialog.Title>
            <Dialog.Description>
              Notes stay with the holding and are carried into the next research
              export.
            </Dialog.Description>
            <div className="flex flex-col gap-4 mt-6">
              <Field
                description="Shown above the holding on every screen."
                label="Headline"
                name="headline"
              >
                <Input defaultValue="Grid capex guidance raised for FY 2029" />
              </Field>
              <Field
                description="Synthetic issuer; no real company is described."
                label="Working note"
                name="note"
              >
                <Textarea
                  defaultValue="Regulated asset base grows 7% a year through 2031. The refinancing covenant is the open question — recheck after the January filing."
                  rows={3}
                />
              </Field>
            </div>
            <div className="flex items-center justify-end gap-3 mt-6">
              <Dialog.Close render={<Button variant="ghost">Cancel</Button>} />
              <Button>Save note</Button>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function FilingExtract() {
  return (
    <Dialog.Root defaultOpen>
      <ResearchPage
        action={
          <Dialog.Trigger
            render={<Button variant="secondary">Filing extract</Button>}
          />
        }
      />
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Viewport>
          <Dialog.Popup>
            <div className="flex items-start justify-between gap-4">
              <Dialog.Title>Annual report FY 2028 — extract</Dialog.Title>
              <Badge tone="neutral">Filed 14 Feb 2029</Badge>
            </div>
            <Dialog.Description>
              Calder Metals, pages 41 to 43. Retrieved from the local archive on
              02 March 2029.
            </Dialog.Description>
            <div className="flex flex-col gap-3 mt-6">
              <p className="m-0 leading-relaxed text-sm">
                “Smelter throughput recovered to 812 kt in the second half after
                the Hallanger furnace relining, against 704 kt in the comparable
                period. Unit conversion cost fell to € 288 per tonne.”
              </p>
              <p className="m-0 leading-relaxed text-sm">
                “The group expects the remaining relining programme to complete
                during the 2029 financial year, with capital expenditure of €
                140 million to € 165 million.”
              </p>
              <Separator />
              <span className="text-foreground-secondary text-xs leading-relaxed">
                Every issuer, figure and quotation on this card is synthetic.
              </span>
            </div>
            <div className="flex items-center justify-end gap-3 mt-6">
              <Dialog.Close render={<Button variant="ghost">Close</Button>} />
              <Button variant="secondary">Cite in note</Button>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ClosedTrigger() {
  return (
    <div className="bg-canvas p-4 rounded-lg">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="font-semibold text-sm">Kestrel Logistics</span>
          <span className="text-foreground-secondary text-xs">
            Position note last edited 06 February 2029
          </span>
        </div>
        <Dialog.Root>
          <Dialog.Trigger
            render={
              <Button size="sm" variant="secondary">
                <Pencil aria-hidden="true" size={16} />
                Edit note
              </Button>
            }
          />
          <Dialog.Portal>
            <Dialog.Backdrop />
            <Dialog.Viewport>
              <Dialog.Popup>
                <Dialog.Title>Edit position note</Dialog.Title>
                <Dialog.Description>
                  A closed dialog renders only its trigger; the popup stays in a
                  portal until it opens.
                </Dialog.Description>
              </Dialog.Popup>
            </Dialog.Viewport>
          </Dialog.Portal>
        </Dialog.Root>
      </div>
    </div>
  );
}
