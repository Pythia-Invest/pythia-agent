import type { ReactNode } from "react";
import type { CompositionDemoEntry } from "../../composition-demos";
import { SYNTHETIC_COMPOSITION_FIXTURE_NOTICE } from "../../composition-fixture";

export const COMPOSITION_DEMO_DISCLAIMER =
  "Component composition demonstration — not a product screen.";

export function CompositionDemoFrame({
  children,
  demo,
}: {
  children: ReactNode;
  demo: CompositionDemoEntry;
}) {
  return (
    <article className="composition-demo" data-composition-demo={demo.key}>
      <header className="composition-demo-header">
        <p className="composition-demo-kind">{COMPOSITION_DEMO_DISCLAIMER}</p>
        <h2>{demo.name}</h2>
        <p>{demo.scope}</p>
        <p className="composition-demo-fixture-notice" role="note">
          {SYNTHETIC_COMPOSITION_FIXTURE_NOTICE}
        </p>
      </header>
      <div className="composition-demo-body">{children}</div>
    </article>
  );
}
