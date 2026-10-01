import { RepairsView } from "@/components/repairs/repairs-view";

/** Settings → Data → Repairs: issues Pythia could not settle on its own.
 * `?question=` opens one issue, where an instrument page links to it. */
export default async function RepairsPage({
  searchParams,
}: {
  searchParams: Promise<{ question?: string }>;
}) {
  const { question } = await searchParams;
  return <RepairsView question={question} />;
}
