/** Route of one subject's instrument page; subject ids contain ":" and "/". */
export function instrumentHref(subjectId: string) {
  return `/instrument/${encodeURIComponent(subjectId)}`;
}
