import { Progress } from "@pythia/ui";

export function Default() {
  return (
    <div className="w-full max-w-md">
      <Progress label="Indexing filings" value={42} />
    </div>
  );
}

export function ValueSweep() {
  return (
    <div className="flex w-full max-w-md flex-col gap-5">
      <Progress label="Not started" value={0} />
      <Progress label="Parsing annual reports" value={34} />
      <Progress label="Extracting segment tables" value={78} />
      <Progress label="Watchlist rebuilt" value={100} />
    </div>
  );
}

export function FractionalScale() {
  return (
    <div className="flex w-full max-w-md flex-col gap-5">
      <Progress label="Filings reviewed" max={12} value={7} />
      <Progress label="Holdings priced" max={38} value={38} />
      <Progress label="Screens re-run" max={6} value={2} />
    </div>
  );
}

export function WithoutValueText() {
  return (
    <div className="flex w-full max-w-md flex-col gap-5">
      <Progress label="Importing positions" showValue={false} value={68} />
      <Progress
        label="Reconciling Synthetic FY 2031 period"
        showValue={false}
        value={23}
      />
    </div>
  );
}
