import { Button, Card, EmptyState } from "@pythia/ui";
import { FileSearch, Inbox, ListFilter } from "lucide-react";

export function NoScreenResults() {
  return (
    <EmptyState
      action={<Button variant="secondary">Widen the screen</Button>}
      description="No issuer in the European industrials universe met every threshold for FY 2028. Loosen a criterion or extend the reporting period."
      icon={<ListFilter aria-hidden="true" />}
      title="No issuers matched this screen"
    />
  );
}

export function TitleOnly() {
  return (
    <EmptyState title="No filings in this reporting period" />
  );
}

export function WithoutAction() {
  return (
    <EmptyState
      description="Coverage for Harbour Line Shipping starts with the FY 2028 annual report. Earlier periods were never archived locally."
      icon={<FileSearch aria-hidden="true" />}
      title="Nothing archived before 2028"
    />
  );
}

export function InsideCard() {
  return (
    <div className="bg-canvas p-4 rounded-lg max-w-md">
      <Card
        description="Issuers you follow but do not hold."
        title="Watchlist"
      >
        <EmptyState
          action={<Button size="sm">Add an issuer</Button>}
          description="Nothing is on this watchlist yet."
          icon={<Inbox aria-hidden="true" />}
          title="Empty watchlist"
        />
      </Card>
    </div>
  );
}
