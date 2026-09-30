/**
 * A search result's description as plain words. Search backends pass page
 * Markdown through, and many pages open by repeating the title shown above.
 */
export function searchSnippet(description: string, title: string) {
  const words = description
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/https?:\/\/\S+/gu, "")
    .replace(/(^|\s)[-•]\s/gu, " ")
    .replace(/[*_`]+/gu, "")
    .replace(/[#>|]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const heading = title.split(/\s[-|–—]\s/u)[0] ?? "";
  const body =
    heading && words.startsWith(heading)
      ? words.slice(heading.length).trim()
      : words;
  return body.length > 240 ? `${body.slice(0, 239).trimEnd()}…` : body;
}
