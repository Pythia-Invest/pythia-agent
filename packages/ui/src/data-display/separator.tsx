import { Separator as BaseSeparator } from "@base-ui/react/separator";
import { cn } from "../class-name";

/** Props for an accessible horizontal or vertical content separator. */
export interface SeparatorProps {
  orientation?: "horizontal" | "vertical";
  className?: string;
}

/**
 * Separates adjacent content groups horizontally or vertically with Base UI's
 * native separator semantics. Border tokens adapt across Public/Product and
 * light/dark; the element is non-focusable and has no keyboard behavior. Do use
 * where the division carries structure; don't use repeated separators as a
 * spacing tool.
 */
export function Separator({
  orientation = "horizontal",
  className,
}: SeparatorProps) {
  return (
    <BaseSeparator
      className={cn(
        "flex-none bg-border",
        orientation === "vertical" ? "h-full w-px" : "h-px w-full",
        className,
      )}
      data-slot="separator"
      orientation={orientation}
    />
  );
}
