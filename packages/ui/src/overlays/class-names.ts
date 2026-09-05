import { clsx } from "clsx";

type StatefulClassName<State> =
  | string
  | ((state: State) => string | undefined)
  | undefined;

export function mergeClassName<State>(
  baseClassName: string,
  className: StatefulClassName<State>,
): StatefulClassName<State> {
  if (typeof className === "function") {
    return (state) => clsx(baseClassName, className(state));
  }

  return clsx(baseClassName, className);
}
