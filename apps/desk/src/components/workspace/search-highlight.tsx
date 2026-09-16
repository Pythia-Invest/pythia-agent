import type { MatchRange } from "@/workspace/search";
export const searchHighlightClass =
  "rounded-sm bg-info-surface font-medium text-foreground";
export function SearchHighlight({
  text,
  ranges = [],
}: {
  text: string;
  ranges?: MatchRange[] | undefined;
}) {
  let offset = 0;
  const parts = [];
  for (const [start, end] of ranges) {
    parts.push(text.slice(offset, start));
    parts.push(
      <mark
        key={`${start}-${end}`}
        data-slot="search-hit"
        className={searchHighlightClass}
      >
        {text.slice(start, end)}
      </mark>,
    );
    offset = end;
  }
  parts.push(text.slice(offset));
  return <>{parts}</>;
}
