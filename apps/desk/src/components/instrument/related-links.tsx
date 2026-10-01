import type { SubjectPage } from "@pythia/market-data/subject";
import { cn } from "@pythia/ui";
import Link from "next/link";
import { instrumentHref } from "./instrument-href";

type Related = SubjectPage["related"][number];

/** How each `related` relation reads from the page's side, in display order.
 * `to`: the page is the relation's source (a pool's protocol and tokens, a
 * perp's underlying); `from`: it is the target (a protocol's pools, the pools
 * holding a token). Other relation types are not shown here. */
const GROUPS = [
  { type: "derivative_on", direction: "to", label: "Underlying" },
  { type: "derivative_on", direction: "from", label: "Derivative" },
  { type: "part_of", direction: "to", label: "Protocol" },
  { type: "part_of", direction: "from", label: "Pools" },
  { type: "market_asset", direction: "to", label: "Holds" },
  { type: "market_asset", direction: "from", label: "Held in" },
] as const;
/** A protocol or a widely held token has dozens of pools: the rest wait
 * behind one disclosure. */
const SHOWN = 6;

const byName = (a: Related, b: Related) =>
  (a.name ?? a.id).localeCompare(b.name ?? b.id) || a.id.localeCompare(b.id);

/** The subjects this page's subject is linked to: a derivative market's
 * underlying and an underlying's derivatives, a pool's protocol and tokens, a
 * protocol's pools, a token's pools. Each is its own subject and page, linked
 * and never folded into this one. */
export function RelatedLinks({ related }: { related: Related[] }) {
  const groups = GROUPS.map(({ type, direction, label }) => ({
    label,
    items: related
      .filter(
        (item) =>
          item.type === type &&
          (item.direction === "to") === (direction === "to"),
      )
      .sort(byName),
  })).filter((group) => group.items.length);
  if (!groups.length) return null;
  return (
    <ul
      aria-label="Related"
      data-slot="instrument-related"
      className="flex flex-col gap-y-1 text-xs"
    >
      {groups.map((group) => (
        <RelatedGroup key={group.label} {...group} />
      ))}
    </ul>
  );
}

function RelatedGroup({ label, items }: { label: string; items: Related[] }) {
  const rest = items.slice(SHOWN);
  return (
    <li className="flex min-w-0 flex-wrap gap-x-1.5 gap-y-0.5">
      <span className="text-foreground-secondary">{label}</span>
      <RelatedList items={items.slice(0, SHOWN)} />
      {rest.length ? (
        <details data-slot="instrument-related-more" className="min-w-0">
          <summary className="cursor-pointer list-none text-foreground-secondary outline-ring hover:underline focus-visible:outline-2 [&::-webkit-details-marker]:hidden">
            and {rest.length} more
          </summary>
          <RelatedList items={rest} className="mt-1" />
        </details>
      ) : null}
    </li>
  );
}

function RelatedList({
  items,
  className,
}: {
  items: Related[];
  className?: string;
}) {
  return (
    <ul className={cn("flex min-w-0 flex-wrap gap-x-3 gap-y-0.5", className)}>
      {items.map((item) => (
        <li key={item.id} className="flex min-w-0 max-w-full">
          <Link
            href={instrumentHref(item.id)}
            className="truncate text-foreground underline-offset-2 outline-ring hover:underline focus-visible:outline-2"
          >
            {item.name ?? item.id}
          </Link>
        </li>
      ))}
    </ul>
  );
}
