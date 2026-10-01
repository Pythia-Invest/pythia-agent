/** Route of one instrument's page; subject ids contain ":" and "/". The
 * listing whose price the page shows rides in `?listing=` so the URL keeps it;
 * it is omitted when the subject already is that listing. */
export function instrumentHref(subjectId: string, listingId?: string | null) {
  const path = `/instrument/${encodeURIComponent(subjectId)}`;
  return listingId && listingId !== subjectId
    ? `${path}?listing=${encodeURIComponent(listingId)}`
    : path;
}
