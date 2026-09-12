/**
 * Custom names Pythia adds to Tailwind's theme namespaces in `styles.css`.
 *
 * Tailwind generates utilities from the `@theme` block, but tailwind-merge
 * only knows Tailwind's default scale names. Anything listed here is taught to
 * `cn` so `text-body text-foreground` keeps both classes instead of treating
 * `text-body` as an unknown text color. A contract test keeps this object and
 * the `@theme` block in step; add the name in both places when adding a token.
 */
export const themeScale = {
  animate: ["spin-slow", "shimmer"],
  container: ["measure"],
  ease: ["standard"],
  font: ["reading"],
  leading: ["ui", "reading"],
  radius: ["control", "container", "pill"],
  shadow: ["popup", "overlay"],
  spacing: ["control", "gutter", "section", "group"],
  text: ["body", "reading", "display"],
} as const satisfies Record<string, readonly string[]>;

/** `@utility` names that shadow a Tailwind utility group with a token value. */
export const themeUtilities = {
  opacity: ["disabled"],
} as const satisfies Record<string, readonly string[]>;
