import { InstrumentSurface } from "@/components/instrument/instrument-surface";

/** Next passes this segment still percent-encoded, so it is decoded exactly
 * once; ids may contain "/" and "%" (e2e/instrument.spec.ts proves both). */
function subjectFrom(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** One subject's instrument page, addressed by its URL-encoded subject id. */
export default async function InstrumentRoute({
  params,
}: {
  params: Promise<{ subject: string }>;
}) {
  const { subject } = await params;
  return <InstrumentSurface subjectId={subjectFrom(subject)} />;
}
