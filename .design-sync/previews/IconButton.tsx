import { IconButton } from "@pythia/ui";
import { Download, Pin, RefreshCw, Share2, Star, Trash2 } from "lucide-react";

export function Variants() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <IconButton label="Add to watchlist" variant="primary">
        <Star aria-hidden="true" />
      </IconButton>
      <IconButton label="Export positions" variant="secondary">
        <Download aria-hidden="true" />
      </IconButton>
      <IconButton label="Share research note" variant="ghost">
        <Share2 aria-hidden="true" />
      </IconButton>
      <IconButton label="Remove holding" variant="danger">
        <Trash2 aria-hidden="true" />
      </IconButton>
    </div>
  );
}

export function Sizes() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <IconButton label="Refresh prices" size="sm" variant="secondary">
        <RefreshCw aria-hidden="true" />
      </IconButton>
      <IconButton label="Refresh prices" size="md" variant="secondary">
        <RefreshCw aria-hidden="true" />
      </IconButton>
      <IconButton label="Refresh prices" size="lg" variant="secondary">
        <RefreshCw aria-hidden="true" />
      </IconButton>
    </div>
  );
}

export function States() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <IconButton label="Refreshing filings" loading variant="secondary">
        <RefreshCw aria-hidden="true" />
      </IconButton>
      <IconButton disabled label="Export unavailable" variant="secondary">
        <Download aria-hidden="true" />
      </IconButton>
      <IconButton disabled label="Remove locked holding" variant="danger">
        <Trash2 aria-hidden="true" />
      </IconButton>
    </div>
  );
}

export function RowActions() {
  return (
    <div className="flex max-w-lg flex-col gap-0 rounded-lg border border-border bg-raised">
      <div className="flex items-center gap-3 border-border border-b px-4 py-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium text-foreground text-sm">
            Northwind Grid Utilities
          </span>
          <span className="text-foreground-secondary text-xs tabular-nums">
            4.2% of portfolio · FY2028
          </span>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <IconButton label="Pin Northwind Grid Utilities" size="sm">
            <Pin aria-hidden="true" />
          </IconButton>
          <IconButton label="Watch Northwind Grid Utilities" size="sm">
            <Star aria-hidden="true" />
          </IconButton>
          <IconButton
            label="Remove Northwind Grid Utilities"
            size="sm"
            variant="danger"
          >
            <Trash2 aria-hidden="true" />
          </IconButton>
        </div>
      </div>
      <div className="flex items-center gap-3 px-4 py-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium text-foreground text-sm">
            Calder Metals
          </span>
          <span className="text-foreground-secondary text-xs tabular-nums">
            2.8% of portfolio · FY2028
          </span>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <IconButton label="Pin Calder Metals" size="sm">
            <Pin aria-hidden="true" />
          </IconButton>
          <IconButton label="Watch Calder Metals" size="sm">
            <Star aria-hidden="true" />
          </IconButton>
          <IconButton label="Remove Calder Metals" size="sm" variant="danger">
            <Trash2 aria-hidden="true" />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
