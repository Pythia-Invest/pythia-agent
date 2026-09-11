import { Skeleton } from "@pythia/ui";

export function FilingSummary() {
  return (
    <div
      aria-label="Loading filing summary"
      className="flex w-full max-w-md items-start gap-4 rounded-lg border border-border bg-raised p-4"
      role="status"
    >
      <Skeleton shape="circle" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton style={{ width: "60%" }} />
        <Skeleton />
        <Skeleton />
        <Skeleton style={{ width: "40%" }} />
      </div>
    </div>
  );
}

export function Shapes() {
  return (
    <div className="flex w-full max-w-md flex-col gap-5">
      <div className="flex flex-col gap-2">
        <span className="font-medium text-foreground-secondary text-xs">
          text
        </span>
        <Skeleton shape="text" />
      </div>
      <div className="flex flex-col gap-2">
        <span className="font-medium text-foreground-secondary text-xs">
          block
        </span>
        <Skeleton shape="block" style={{ height: "5rem" }} />
      </div>
      <div className="flex flex-col gap-2">
        <span className="font-medium text-foreground-secondary text-xs">
          circle
        </span>
        <Skeleton shape="circle" />
      </div>
    </div>
  );
}

export function HoldingsTable() {
  return (
    <div
      aria-label="Loading holdings"
      className="flex w-full max-w-lg flex-col gap-3 rounded-lg border border-border bg-raised p-4"
      role="status"
    >
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-semibold text-foreground text-sm">Holdings</span>
        <Skeleton style={{ width: "6rem" }} />
      </div>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-4">
          <Skeleton style={{ width: "9rem" }} />
          <Skeleton style={{ width: "4rem" }} />
          <Skeleton className="flex-1" />
        </div>
        <div className="flex items-center gap-4">
          <Skeleton style={{ width: "7rem" }} />
          <Skeleton style={{ width: "4rem" }} />
          <Skeleton className="flex-1" />
        </div>
        <div className="flex items-center gap-4">
          <Skeleton style={{ width: "11rem" }} />
          <Skeleton style={{ width: "4rem" }} />
          <Skeleton className="flex-1" />
        </div>
      </div>
      <Skeleton shape="block" style={{ height: "3rem" }} />
    </div>
  );
}
