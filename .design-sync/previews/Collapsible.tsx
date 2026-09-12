"use client";

import { Collapsible } from "@pythia/ui";

export function OpenAssumptions() {
  return (
    <Collapsible.Root defaultOpen>
      <Collapsible.Trigger>Valuation assumptions</Collapsible.Trigger>
      <Collapsible.Panel>
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-foreground-secondary text-sm">
              Discount rate
            </span>
            <span className="font-semibold tabular-nums text-sm">9.0%</span>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-foreground-secondary text-sm">
              Terminal growth
            </span>
            <span className="font-semibold tabular-nums text-sm">1.5%</span>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-foreground-secondary text-sm">
              Reporting period
            </span>
            <span className="font-semibold tabular-nums text-sm">FY 2028</span>
          </div>
          <span className="text-foreground-secondary text-xs leading-relaxed">
            Every figure here is synthetic and is supplied by the caller, not
            derived by the component.
          </span>
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

export function Closed() {
  return (
    <Collapsible.Root>
      <Collapsible.Trigger>Source notes for Kestrel Logistics</Collapsible.Trigger>
      <Collapsible.Panel>
        Fleet impairment note of 12 December 2028, pages 3 to 5.
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

export function DisabledOpen() {
  return (
    <Collapsible.Root disabled open>
      <Collapsible.Trigger>Locked audit trail</Collapsible.Trigger>
      <Collapsible.Panel>
        This region stays visible while the workspace is read only, and cannot
        be collapsed.
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

export function StackedRegions() {
  return (
    <div className="flex flex-col gap-3 max-w-md">
      <Collapsible.Root defaultOpen>
        <Collapsible.Trigger>Northstar Materials</Collapsible.Trigger>
        <Collapsible.Panel>
          Annual report FY 2028 filed 14 February 2029. Two open questions
          remain on the refinancing covenant.
        </Collapsible.Panel>
      </Collapsible.Root>
      <Collapsible.Root>
        <Collapsible.Trigger>Aldergrove Utilities</Collapsible.Trigger>
        <Collapsible.Panel>
          Annual report FY 2028 filed 19 January 2029.
        </Collapsible.Panel>
      </Collapsible.Root>
      <Collapsible.Root>
        <Collapsible.Trigger>Meridian Foods</Collapsible.Trigger>
        <Collapsible.Panel>
          Annual report FY 2028 filed 05 February 2029.
        </Collapsible.Panel>
      </Collapsible.Root>
    </div>
  );
}
