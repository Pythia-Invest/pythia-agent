export type StatefulClassName<State> =
  | string
  | ((state: State) => string | undefined)
  | undefined;

export function joinClassNames(
  baseClassName: string,
  className?: string,
): string {
  return [baseClassName, className].filter(Boolean).join(" ");
}

export function mergeStatefulClassName<State>(
  baseClassName: string,
  className: StatefulClassName<State>,
): StatefulClassName<State> {
  if (typeof className === "function") {
    return (state) => joinClassNames(baseClassName, className(state));
  }

  return joinClassNames(baseClassName, className);
}
