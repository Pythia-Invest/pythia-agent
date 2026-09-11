import { Button, Container } from "@pythia/ui";
import type { ReactNode } from "react";

function Measure({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-subtle px-3 py-2 text-center text-foreground text-sm">
      {children}
    </div>
  );
}

export function Measures() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-canvas py-4">
      <Container size="reading" style={{ fontSize: "8px" }}>
        <Measure>reading — one column of prose</Measure>
      </Container>
      <Container size="content" style={{ fontSize: "8px" }}>
        <Measure>content — default working measure</Measure>
      </Container>
      <Container size="wide" style={{ fontSize: "8px" }}>
        <Measure>wide — dense evidence tables</Measure>
      </Container>
      <Container size="full" style={{ fontSize: "8px" }}>
        <Measure>full — edge to edge, gutters only</Measure>
      </Container>
      <p className="px-4 text-center text-foreground-secondary text-xs">
        Measures are character-based, so this specimen sets a reduced font size
        on each Container to fit all four caps in one card: reading, content and
        wide stand in a 1 : 1.5 : 2 ratio and full is uncapped.
      </p>
    </div>
  );
}

export function ReadingMeasure() {
  return (
    <div className="rounded-lg border border-border bg-canvas py-6">
      <Container size="reading">
        <div className="flex flex-col gap-3">
          <span className="font-semibold text-foreground text-lg">
            How coverage is assembled
          </span>
          <p className="text-foreground-secondary text-reading leading-relaxed">
            Every figure on an issuer page is carried from a filing the
            workspace already holds. Northwind Grid Utilities has four synthetic
            reporting periods indexed, each with its own freshness label, so a
            stale number is visible as stale rather than quietly reused.
          </p>
          <p className="text-foreground-secondary text-reading leading-relaxed">
            The reading measure keeps a single column near sixty characters,
            which is why long explanations sit here rather than in the wide
            evidence layout.
          </p>
        </div>
      </Container>
    </div>
  );
}

export function FullWidthToolbar() {
  return (
    <div className="rounded-lg border border-border bg-canvas py-4">
      <Container size="full">
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-raised px-4 py-3">
          <span className="font-semibold text-foreground text-sm">
            Quality screen — 42 issuers
          </span>
          <span className="text-foreground-secondary text-xs">
            Synthetic universe · run 12 Mar 2028
          </span>
          <Button className="ml-auto" size="sm" variant="secondary">
            Export
          </Button>
        </div>
      </Container>
    </div>
  );
}
