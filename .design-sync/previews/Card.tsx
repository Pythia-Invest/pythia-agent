import { Button, Card } from "@pythia/ui";

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="text-foreground-secondary text-xs">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

export function HoldingSummary() {
  return (
    <div className="bg-canvas p-4 rounded-lg">
      <Card
        description="Industrials · Frankfurt · reviewed 12 March 2029"
        footer={
          <div className="flex items-center justify-between gap-3">
            <span className="text-foreground-secondary text-xs">
              Latest filing 14 February 2029
            </span>
            <Button size="sm" variant="secondary">
              Open thesis
            </Button>
          </div>
        }
        title="Northstar Materials"
      >
        <div className="grid grid-cols-3 gap-4">
          <Metric label="Portfolio weight" value="4.2%" />
          <Metric label="Cost basis" value="€ 38.10" />
          <Metric label="EV / EBIT" value="11.4×" />
        </div>
      </Card>
    </div>
  );
}

export function SurfaceVariants() {
  return (
    <div className="bg-canvas p-4 rounded-lg">
      <div className="grid grid-cols-3 gap-4">
        <Card
          description="The default surface for a primary group."
          title="Raised"
        >
          Kestrel Logistics moved to the review queue.
        </Card>
        <Card
          description="A bounded group with no elevation."
          title="Outlined"
          variant="outlined"
        >
          Three filings await a coverage check.
        </Card>
        <Card
          description="Quiet supporting context."
          title="Subtle"
          variant="subtle"
        >
          Screen last refreshed nine days ago.
        </Card>
      </div>
    </div>
  );
}

export function ContentOnly() {
  return (
    <div className="bg-canvas p-4 rounded-lg">
      <Card variant="outlined">
        <div className="flex flex-col gap-2">
          <p className="m-0 leading-relaxed">
            Aldergrove Utilities reports on a September year end, so the FY 2028
            comparison in this screen spans two calendar years.
          </p>
          <p className="m-0 text-foreground-secondary text-sm leading-relaxed">
            All issuers and figures on this card are synthetic.
          </p>
        </div>
      </Card>
    </div>
  );
}
