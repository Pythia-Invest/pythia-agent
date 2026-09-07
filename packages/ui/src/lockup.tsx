import { brandAssetUrls } from "./assets";
import { cn } from "./class-name";

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

const variants = {
  full: {
    light: brandAssetUrls.lockupFullLight,
    dark: brandAssetUrls.lockupFullDark,
    width: 640,
    height: 232,
    className: "w-[4.8em]",
  },
  compact: {
    light: brandAssetUrls.lockupCompactLight,
    dark: brandAssetUrls.lockupCompactDark,
    width: 480,
    height: 169,
    className: "w-[4.6em]",
  },
} as const;

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
  const asset = variants[variant];
  const image = (theme: "light" | "dark") => (
    <img
      alt={decorative ? "" : label}
      className={cn(
        "h-auto",
        asset.className,
        theme === "light" ? "dark:hidden" : "hidden dark:block",
      )}
      height={asset.height}
      src={asset[theme]}
      width={asset.width}
    />
  );

  return (
    <span
      aria-hidden={decorative || undefined}
      className={cn("inline-block align-middle leading-none", className)}
      data-slot="pythia-lockup"
      data-variant={variant}
    >
      {image("light")}
      {image("dark")}
    </span>
  );
}
