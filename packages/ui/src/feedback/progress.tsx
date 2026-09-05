import { Progress as BaseProgress } from "@base-ui/react/progress";

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
      className={["py-progress", className].filter(Boolean).join(" ")}
      max={max}
      min={min}
      value={value}
    >
      <BaseProgress.Label className="py-progress__label">
        {label}
      </BaseProgress.Label>
      {showValue ? <BaseProgress.Value className="py-progress__value" /> : null}
      <BaseProgress.Track className="py-progress__track">
        <BaseProgress.Indicator className="py-progress__indicator" />
      </BaseProgress.Track>
    </BaseProgress.Root>
  );
}
