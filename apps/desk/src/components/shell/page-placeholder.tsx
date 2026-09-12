import { EmptyState } from "@pythia/ui";
import type { ReactNode } from "react";

/**
 * A destination the design reserves but no capability backs yet.
 *
 * It says so plainly rather than rendering an empty frame that looks broken,
 * and it keeps the route real so the rail's navigation is honest.
 */
export function PagePlaceholder({
  description,
  title,
}: {
  description: string;
  title: string;
}): ReactNode {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-gutter">
      <EmptyState description={description} title={title} />
    </div>
  );
}
