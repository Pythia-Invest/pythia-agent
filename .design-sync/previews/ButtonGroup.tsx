import { Button, ButtonGroup, IconButton } from "@pythia/ui";
import { ChartColumn, Columns2, Table2 } from "lucide-react";

export function RelatedActions() {
  return (
    <ButtonGroup label="Screen result actions">
      <Button size="sm" variant="secondary">
        Preview
      </Button>
      <Button size="sm" variant="secondary">
        Duplicate
      </Button>
      <Button size="sm" variant="secondary">
        Archive
      </Button>
    </ButtonGroup>
  );
}

export function VerticalOrientation() {
  return (
    <ButtonGroup label="Holding detail views" orientation="vertical">
      <Button variant="secondary">Summary</Button>
      <Button variant="secondary">Evidence</Button>
      <Button variant="secondary">Filings</Button>
    </ButtonGroup>
  );
}

export function IconOnlyGroup() {
  return (
    <ButtonGroup label="Result layout">
      <IconButton label="Table layout" variant="secondary">
        <Table2 aria-hidden="true" />
      </IconButton>
      <IconButton label="Split layout" variant="secondary">
        <Columns2 aria-hidden="true" />
      </IconButton>
      <IconButton label="Chart layout" variant="secondary">
        <ChartColumn aria-hidden="true" />
      </IconButton>
    </ButtonGroup>
  );
}

export function MemberStates() {
  return (
    <ButtonGroup label="Watchlist export actions">
      <Button size="sm" variant="secondary">
        Export CSV
      </Button>
      <Button loading size="sm" variant="secondary">
        Building PDF
      </Button>
      <Button disabled size="sm" variant="secondary">
        Share link
      </Button>
    </ButtonGroup>
  );
}

export function InToolbar() {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-raised px-4 py-3">
      <div className="flex flex-col gap-1">
        <span className="font-semibold text-foreground text-sm">
          Quality screen — 42 issuers
        </span>
        <span className="text-foreground-secondary text-xs">
          Last run 12 Mar 2028 · synthetic universe
        </span>
      </div>
      <div className="ml-auto">
        <ButtonGroup label="Screen actions">
          <Button size="sm" variant="secondary">
            Re-run
          </Button>
          <Button size="sm" variant="secondary">
            Save view
          </Button>
          <Button size="sm" variant="secondary">
            Export
          </Button>
        </ButtonGroup>
      </div>
    </div>
  );
}
