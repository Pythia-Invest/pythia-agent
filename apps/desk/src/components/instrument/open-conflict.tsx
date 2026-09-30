import type { WithheldFact } from "@pythia/market-data/subject";
import Link from "next/link";
import { repairHref } from "@/components/repairs/repair-href";

/** The link to the repair that settles an open data conflict. */
export function ReviewLink({ question }: { question: string }) {
  return (
    <Link
      href={repairHref(question)}
      data-slot="instrument-review-link"
      className="underline underline-offset-2 outline-ring hover:text-foreground focus-visible:outline-2"
    >
      Review
    </Link>
  );
}

/** "how many answers" as a parenthesis, when there is more than one. */
export function optionsNote({ options }: Pick<WithheldFact, "options">) {
  return options > 1 ? ` (${options} options)` : "";
}

/** What the page says where an open question holds a fact back, in place of
 * showing nothing: `Company: open data conflict (2 options) · Review`. */
export function OpenConflict({
  label,
  held,
}: {
  label: string;
  held: WithheldFact;
}) {
  return (
    <p
      data-slot="instrument-withheld"
      data-fact={held.fact}
      className="text-foreground-secondary text-xs"
    >
      {label}: open data conflict{optionsNote(held)} ·{" "}
      <ReviewLink question={held.question} />
    </p>
  );
}
