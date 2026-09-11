import { Button } from "@pythia/ui";
import { Download, Plus, RefreshCw } from "lucide-react";

export function ActionHierarchy() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button>Run screen</Button>
      <Button variant="secondary">Save view</Button>
      <Button variant="ghost">Cancel</Button>
      <Button variant="danger">Delete holding</Button>
    </div>
  );
}

export function Sizes() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Large</Button>
    </div>
  );
}

export function States() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button loading>Fetching filings</Button>
      <Button disabled>Unavailable</Button>
      <Button disabled variant="secondary">
        Locked view
      </Button>
    </div>
  );
}

export function WithIcons() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button>
        <Plus aria-hidden="true" />
        Add to watchlist
      </Button>
      <Button variant="secondary">
        <Download aria-hidden="true" />
        Export CSV
      </Button>
      <Button variant="ghost">
        <RefreshCw aria-hidden="true" />
        Refresh
      </Button>
    </div>
  );
}
