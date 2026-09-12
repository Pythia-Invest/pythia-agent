import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
import { themeScale, themeUtilities } from "./theme-scale";

/**
 * A tailwind-merge instance that understands Pythia's theme. Default
 * tailwind-merge files unknown `text-*` values under text colors, so without
 * this `cn("text-body", "text-foreground")` would drop `text-body`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      animate: [...themeScale.animate],
      container: [...themeScale.container],
      ease: [...themeScale.ease],
      font: [...themeScale.font],
      leading: [...themeScale.leading],
      radius: [...themeScale.radius],
      shadow: [...themeScale.shadow],
      spacing: [...themeScale.spacing],
      text: [...themeScale.text],
    },
    classGroups: {
      opacity: [{ opacity: [...themeUtilities.opacity] }],
    },
  },
});

/**
 * Joins class names and resolves conflicting Tailwind utilities so a consumer
 * `className` can override a component default (`bg-raised` beats `bg-canvas`
 * when it comes last). Use it for every `className` prop in this package and
 * in applications that compose these components.
 *
 * Third-party components that merge classes with their own tailwind-merge do
 * not know these names. Put theme typography on a wrapper element instead of
 * passing it through such a component's `className`.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Base UI and DayPicker accept a class name or a function of component state. */
export type StatefulClassName<State> =
  | string
  | ((state: State) => string | undefined)
  | undefined;

/** `cn` for props that may be a state-aware class-name function. */
export function cnState<State>(
  base: string,
  className: StatefulClassName<State>,
): StatefulClassName<State> {
  if (typeof className === "function") {
    return (state) => cn(base, className(state));
  }
  return cn(base, className);
}
