import { Badge, Button, Inline } from "@pythia/ui";
import type { ReactNode } from "react";

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md border border-border bg-subtle px-3 py-2 text-foreground text-sm">
      {children}
    </span>
  );
}

export function WrappingMetadata() {
  return (
    <Inline gap="3" wrap>
      <Badge>FY2028</Badge>
      <Badge tone="neutral">Reported</Badge>
      <Badge tone="info">Filed 12 Mar 2028</Badge>
      <Badge tone="warning">Freshness unknown</Badge>
      <Badge tone="neutral">Northwind Grid Utilities</Badge>
      <Badge tone="neutral">Regulated utilities</Badge>
      <Badge tone="success">Coverage complete</Badge>
      <Badge tone="neutral">Calder Metals</Badge>
      <Badge tone="neutral">Industrial metals</Badge>
      <Badge tone="info">Q3 2028 interim statement</Badge>
      <Badge tone="neutral">Filed 04 Nov 2028</Badge>
      <Badge tone="error">Missing prior period</Badge>
    </Inline>
  );
}

export function GapScale() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-foreground-secondary text-xs">gap="1"</span>
        <Inline gap="1">
          <Chip>Revenue</Chip>
          <Chip>Margin</Chip>
          <Chip>Payout</Chip>
        </Inline>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-foreground-secondary text-xs">gap="3"</span>
        <Inline gap="3">
          <Chip>Revenue</Chip>
          <Chip>Margin</Chip>
          <Chip>Payout</Chip>
        </Inline>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-foreground-secondary text-xs">gap="8"</span>
        <Inline gap="8">
          <Chip>Revenue</Chip>
          <Chip>Margin</Chip>
          <Chip>Payout</Chip>
        </Inline>
      </div>
    </div>
  );
}

export function Alignment() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-foreground-secondary text-xs">align="start"</span>
        <Inline align="start" gap="3">
          <Chip>Q3 2028</Chip>
          <span className="rounded-md border border-border bg-subtle px-3 py-6 text-foreground text-sm">
            Interim statement
          </span>
          <Chip>Synthetic</Chip>
        </Inline>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-foreground-secondary text-xs">
          align="center"
        </span>
        <Inline align="center" gap="3">
          <Chip>Q3 2028</Chip>
          <span className="rounded-md border border-border bg-subtle px-3 py-6 text-foreground text-sm">
            Interim statement
          </span>
          <Chip>Synthetic</Chip>
        </Inline>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-foreground-secondary text-xs">align="end"</span>
        <Inline align="end" gap="3">
          <Chip>Q3 2028</Chip>
          <span className="rounded-md border border-border bg-subtle px-3 py-6 text-foreground text-sm">
            Interim statement
          </span>
          <Chip>Synthetic</Chip>
        </Inline>
      </div>
    </div>
  );
}

export function ControlRow() {
  return (
    <div className="rounded-lg border border-border bg-raised px-4 py-3">
      <Inline gap="3">
        <span className="font-semibold text-foreground text-sm">
          Regulated utilities watchlist
        </span>
        <Badge tone="neutral">12 holdings</Badge>
        <Button className="ml-auto" size="sm" variant="ghost">
          Refresh
        </Button>
        <Button size="sm" variant="secondary">
          Export
        </Button>
      </Inline>
    </div>
  );
}
