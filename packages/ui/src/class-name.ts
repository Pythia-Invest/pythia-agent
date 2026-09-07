import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Joins class names and resolves conflicting Tailwind utilities so a consumer
 * `className` can override a component default (`bg-raised` beats `bg-canvas`
 * when it comes last). Use it for every `className` prop in this package and
 * in applications that compose these components.
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
