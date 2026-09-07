import { Progress as BaseProgress } from "@base-ui/react/progress";
import { cn } from "../class-name";

/** Props for a determinate progress bar with a real supplied value and label. */
export interface ProgressProps {
  value: number;
  label: string;
  min?: number;
  max?: number;
  showValue?: boolean;
  className?: string;
}

/**
 * Shows determinate progress from a mechanically supplied value, with optional
 * native formatted value text. Base UI owns range clamping and ARIA state;
 * semantic tokens adapt across Public/Product and light/dark. The bar is read-only and
 * has no keyboard interaction. Do use when a real measure exists; don't guess a
 * percentage for generic activity—use ActivityIndicator instead.
 */
export function Progress({
  value,
  label,
  min = 0,
  max = 100,
  showValue = true,
  className,
}: ProgressProps) {
  return (
    <BaseProgress.Root
      className={cn(
        "grid w-full grid-cols-[minmax(0,1fr)_auto] gap-2 text-body text-foreground leading-ui",
        className,
      )}
      data-slot="progress"
      max={max}
      min={min}
      value={value}
    >
      <BaseProgress.Label className="font-medium">{label}</BaseProgress.Label>
      {showValue ? (
        <BaseProgress.Value className="text-foreground-secondary tabular-nums" />
      ) : null}
      <BaseProgress.Track className="col-span-full h-2 overflow-hidden rounded-pill bg-subtle">
        <BaseProgress.Indicator className="motion-standard h-full rounded-[inherit] bg-foreground transition-[width]" />
      </BaseProgress.Track>
    </BaseProgress.Root>
  );
}
