import { InstrumentSurface } from "@/components/instrument/instrument-surface";

/** Route segments may arrive still percent-encoded; subject ids never
 * contain "%" themselves, so decoding once is unambiguous. */
function subjectFrom(segment: string) {
  try {
    return segment.includes("%") ? decodeURIComponent(segment) : segment;
  } catch {
    return segment;
  }
}

/** One subject's instrument page, addressed by its (URL-encoded) subject id. */
export default async function InstrumentRoute({
  params,
}: {
  params: Promise<{ subject: string }>;
}) {
  const { subject } = await params;
  return <InstrumentSurface subjectId={subjectFrom(subject)} />;
}
