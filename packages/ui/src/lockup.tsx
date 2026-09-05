export type PythiaLockupVariant = "full" | "compact";

interface PythiaLockupBaseProps {
  /** Consumer styling hook; size the lockup with font-size. */
  className?: string;
  /** Full uses the primary gap geometry; compact reduces the identity gap. */
  variant?: PythiaLockupVariant;
}

export type PythiaLockupProps = PythiaLockupBaseProps &
  (
    | {
        /** Removes the identity from the accessibility tree. */
        decorative: true;
        label?: never;
      }
    | {
        /** Meaningful lockups require context-appropriate accessible text. */
        decorative?: false;
        label: string;
      }
  );

/**
 * Pythia identity lockup for approved Public and Product surfaces.
 *
 * Use `full` for the primary identity and `compact` where horizontal space is
 * constrained. Each variant uses a density-bounded raster export of the
 * approved complete lockup, so consumers never reconstruct its wordmark or
 * ship the 2048px pictogram master. It has no interactive states and follows
 * the root light/dark theme without changing meaning between profiles. Size it
 * with `font-size`. Meaningful use requires `label`; use `decorative` only when
 * adjacent content already names Pythia. It is not keyboard interactive. Do
 * not copy, recolor, redraw, or compose the identity inside a consumer.
 */
export function PythiaLockup({
  className,
  decorative = false,
  label,
  variant = "full",
}: PythiaLockupProps) {
  const classes = ["pythia-lockup", `pythia-lockup--${variant}`, className]
    .filter(Boolean)
    .join(" ");

  if (decorative) {
    return <span aria-hidden="true" className={classes} />;
  }

  return <span aria-label={label} className={classes} role="img" />;
}
