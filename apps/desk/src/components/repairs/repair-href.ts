/** Settings → Repairs opened on one question: the row expands and scrolls
 * into view. Open data conflicts on an instrument page link here. */
export function repairHref(questionId: string) {
  return `/settings/repairs?question=${encodeURIComponent(questionId)}`;
}
