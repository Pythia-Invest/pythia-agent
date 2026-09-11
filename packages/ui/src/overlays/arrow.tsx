/**
 * Base UI renders the arrow slot as an empty element and expects the author to
 * supply the shape, so every overlay arrow needs a default child.
 *
 * The container carries the size and the per-side rotation; `fill` and `stroke`
 * are inherited SVG properties, so the colour lives on the container too and a
 * caller can retint the whole arrow with `fill-*`/`stroke-*` in `className`.
 */
export const overlayArrowClasses =
  "size-3 data-[side=bottom]:rotate-0 data-[side=left]:rotate-90 data-[side=right]:-rotate-90 data-[side=top]:rotate-180";

/**
 * Default overlay arrow: a triangle whose base is left open so it reads as
 * continuous with the popup surface, with the two visible edges stroked.
 */
export function OverlayArrowShape() {
  return (
    <svg
      aria-hidden="true"
      data-slot="overlay-arrow-shape"
      height="100%"
      viewBox="0 0 16 10"
      width="100%"
    >
      <path d="M0 10 L8 1 L16 10 Z" stroke="none" />
      <path d="M0 10 L8 1 L16 10" fill="none" />
    </svg>
  );
}
