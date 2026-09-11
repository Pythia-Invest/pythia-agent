import { Badge, Button, Card, Stack } from "@pythia/ui";
import type { ReactNode } from "react";

function Block({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-subtle px-3 py-2 text-foreground text-sm">
      {children}
    </div>
  );
}

export function VerticalRhythm() {
  return (
    <Stack className="max-w-lg" gap="4">
      <Card
        description="Regulated utilities · 12 holdings"
        title="Balanced income watchlist"
        variant="outlined"
      >
        <span className="text-foreground-secondary text-sm tabular-nums">
          Last reviewed 12 Mar 2028
        </span>
      </Card>
      <Card
        description="Northwind Grid Utilities · FY2028"
        title="Latest filing"
        variant="outlined"
      >
        <span className="text-foreground-secondary text-sm">
          Annual report added from the local archive.
        </span>
      </Card>
      <Card
        description="Two issuers await a freshness check"
        title="Open questions"
        variant="outlined"
      >
        <span className="text-foreground-secondary text-sm">
          Calder Metals and Arden Foods have no Q3 statement yet.
        </span>
      </Card>
    </Stack>
  );
}

export function GapScale() {
  return (
    <div className="flex flex-row gap-6">
      <div className="flex flex-1 flex-col gap-2">
        <span className="text-foreground-secondary text-xs">gap="1"</span>
        <Stack gap="1">
          <Block>Revenue</Block>
          <Block>Operating margin</Block>
          <Block>Payout ratio</Block>
        </Stack>
      </div>
      <div className="flex flex-1 flex-col gap-2">
        <span className="text-foreground-secondary text-xs">gap="4"</span>
        <Stack gap="4">
          <Block>Revenue</Block>
          <Block>Operating margin</Block>
          <Block>Payout ratio</Block>
        </Stack>
      </div>
      <div className="flex flex-1 flex-col gap-2">
        <span className="text-foreground-secondary text-xs">gap="8"</span>
        <Stack gap="8">
          <Block>Revenue</Block>
          <Block>Operating margin</Block>
          <Block>Payout ratio</Block>
        </Stack>
      </div>
    </div>
  );
}

export function Alignment() {
  return (
    <div className="flex flex-row gap-6">
      <div className="flex flex-1 flex-col gap-2">
        <span className="text-foreground-secondary text-xs">
          align="stretch"
        </span>
        <Stack align="stretch" gap="2">
          <Block>Q1 2028</Block>
          <Block>Q2 2028</Block>
          <Block>Q3 2028</Block>
        </Stack>
      </div>
      <div className="flex flex-1 flex-col gap-2">
        <span className="text-foreground-secondary text-xs">align="center"</span>
        <Stack align="center" gap="2">
          <Block>Q1 2028</Block>
          <Block>Q2 2028</Block>
          <Block>Q3 2028</Block>
        </Stack>
      </div>
      <div className="flex flex-1 flex-col gap-2">
        <span className="text-foreground-secondary text-xs">align="end"</span>
        <Stack align="end" gap="2">
          <Block>Q1 2028</Block>
          <Block>Q2 2028</Block>
          <Block>Q3 2028</Block>
        </Stack>
      </div>
    </div>
  );
}

export function SectionComposition() {
  return (
    <Stack className="max-w-lg" gap="6">
      <Stack gap="2">
        <span className="font-semibold text-foreground text-lg">
          Calder Metals — coverage review
        </span>
        <span className="text-foreground-secondary text-sm leading-relaxed">
          Three synthetic filings are indexed for this issuer. Nothing here is a
          recommendation.
        </span>
      </Stack>
      <Stack gap="2">
        <Block>FY2028 annual report · filed 12 Mar 2028</Block>
        <Block>Q3 2028 interim statement · filed 04 Nov 2028</Block>
        <Block>Sector note · industrial metals</Block>
      </Stack>
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone="success">Coverage complete</Badge>
        <Button className="ml-auto" size="sm" variant="secondary">
          Open issuer
        </Button>
      </div>
    </Stack>
  );
}
