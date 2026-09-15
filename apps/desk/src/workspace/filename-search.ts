import { type MatchRange, originalMatchRanges } from "./search";

type Term = { text: string; typo: string[] | null };

// A final sigma and a sigma before an extension are the same letter for search.
const foldName = (text: string) => text.toLowerCase().replaceAll("ς", "σ");

function equalSuffix(a: string[], b: string[], i: number, j: number) {
  while (i < a.length && j < b.length) {
    if (a[i++] !== b[j++]) return false;
  }
  return i === a.length && j === b.length;
}

// Damerau–Levenshtein distance <= 1 needs only the first mismatch and suffix,
// not a distance matrix. Compare Unicode code points, including adjacent swaps.
function withinOneEdit(a: string[], b: string[]) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (a.length < b.length) return equalSuffix(a, b, i, i + 1);
  if (a.length > b.length) return equalSuffix(a, b, i + 1, i);
  return (
    i === a.length ||
    equalSuffix(a, b, i + 1, i + 1) ||
    (i + 1 < a.length &&
      a[i] === b[i + 1] &&
      a[i + 1] === b[i] &&
      equalSuffix(a, b, i + 2, i + 2))
  );
}

// Literal runs rank above a one-edit match of a complete filename word.
// Never join scattered letters or apply typo correction across word boundaries.
function tokenMatch(text: string, term: Term, ranges?: MatchRange[]) {
  const literal = text.indexOf(term.text);
  if (literal >= 0) {
    ranges?.push([literal, literal + term.text.length]);
    return 200 - Math.min(literal, 99);
  }
  if (!term.typo) return 0;
  for (const word of text.matchAll(/[\p{L}\p{M}\p{N}]+/gu)) {
    if (/\p{N}/u.test(word[0])) continue;
    if (withinOneEdit(term.typo, Array.from(word[0]))) {
      ranges?.push([word.index, word.index + word[0].length]);
      return 50;
    }
  }
  return 0;
}

function groupMatch(text: string, terms: Term[]): number {
  let literal = true;
  for (const term of terms) {
    const score = tokenMatch(text, term);
    if (!score) return 0;
    literal &&= score > 100;
  }
  return literal ? 200 : 50;
}

/** Compile once per query; search only names, never bodies or file formats. */
export function filenameSearch(query: string) {
  const parsed = Array.from(query.matchAll(/"([^"]+)"|(\S+)/gu), (match) => ({
    text: foldName((match[1] ?? match[2] ?? "").trim()),
    literal: match[1] !== undefined,
  })).filter((term) => term.text.length > 0);
  const phrase = parsed.map((term) => term.text).join(" ");
  const groups: Term[][] = parsed
    .map(({ text, literal }) =>
      (literal ? [text] : text.split(/[-_]+/u)).filter(Boolean).map((text) => {
        const characters = Array.from(text);
        return {
          text,
          typo:
            !literal && characters.length >= 5 && /^[\p{L}\p{M}]+$/u.test(text)
              ? characters
              : null,
        };
      }),
    )
    .filter((group) => group.length > 0);
  const terms = groups.flat();
  return {
    empty: !terms.length,
    score(path: string, name: string) {
      if (!terms.length) return 0;
      const lower = foldName(name);
      // Keep a compound query such as company-0001 together: its fragments
      // cannot independently qualify an unrelated notes-0001.md descendant.
      const scores = groups.map((group) => groupMatch(lower, group));
      if (scores.every(Boolean)) {
        if (lower === phrase || lower.replace(/\.[^.]+$/u, "") === phrase)
          return 1000;
        if (scores.every((score) => score > 100))
          return lower.startsWith(phrase) ? 900 : 800;
        return (
          500 +
          scores.reduce((sum, score) => sum + score, 0) / (4 * scores.length)
        );
      }
      // An ancestor match alone must not flood the list with all descendants.
      if (!scores.some(Boolean)) return 0;
      const parent = foldName(
        path.slice(0, Math.max(0, path.lastIndexOf("/"))),
      );
      return groups.every(
        (group, index) => scores[index] || groupMatch(parent, group),
      )
        ? 200
        : 0;
    },
    ranges(text: string) {
      const lower = foldName(text);
      const ranges: MatchRange[] = [];
      for (const term of terms) tokenMatch(lower, term, ranges);
      return originalMatchRanges(text, ranges, lower.length);
    },
  };
}
