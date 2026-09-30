export type MatchRange = [number, number];
/** Map lowercase match offsets to the original text and merge overlaps. */
export function originalMatchRanges(
  text: string,
  ranges: MatchRange[],
  foldedLength: number,
): MatchRange[] {
  const merged: MatchRange[] = [];
  for (const range of ranges.sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  if (foldedLength === text.length) return merged;
  // Sorted boundaries can share one forward scan, including expansion inside a
  // match. Never rescan a large document from its start for every highlighted hit.
  let offset = 0,
    foldedOffset = 0;
  const originalOffset = (index: number, end = false) => {
    while (offset < text.length) {
      if (index === foldedOffset) return offset;
      const character = String.fromCodePoint(text.codePointAt(offset) ?? 0);
      const next = foldedOffset + character.toLowerCase().length;
      if (index < next) return offset + (end ? character.length : 0);
      offset += character.length;
      foldedOffset = next;
    }
    return text.length;
  };
  return merged.map(([start, end]) => [
    originalOffset(start),
    originalOffset(end, true),
  ]);
}
