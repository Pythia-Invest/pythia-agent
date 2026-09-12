import { HoverCard } from "@pythia/ui";

/**
 * HoverCard is the familiar alias for the same Base UI preview-card anatomy.
 * Open stories use `defaultOpen`; hover intent, the open delay and the
 * pointer-travel grace area are behavioural and are not captured.
 *
 * `HoverCard.Arrow` is deliberately unused — it ships fill and stroke colours
 * but no shape, so it needs an author-supplied SVG (and per-side rotation)
 * that is out of scope for a story.
 */

const citationClass =
  "font-medium text-foreground border-b border-border-strong";

export function FilingPreview() {
  return (
    <div className="bg-canvas p-6 rounded-lg" style={{ paddingBottom: 260 }}>
      <p className="m-0 max-w-md text-foreground leading-relaxed">
        Management guided the regulated asset base to grow by roughly 6% a year
        through 2031{" "}
        <HoverCard.Root defaultOpen>
          <HoverCard.Trigger className={citationClass} href="#source-1">
            [1]
          </HoverCard.Trigger>
          <HoverCard.Portal>
            <HoverCard.Positioner align="start" side="bottom">
              <HoverCard.Popup>
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="font-semibold text-foreground text-sm">
                      Annual report 2028 — page 41
                    </span>
                    <span className="text-foreground-secondary text-xs">
                      Northwind Grid Utilities · filed 26 Feb 2029 · retrieved 3
                      Mar 2029
                    </span>
                  </div>
                  <p className="m-0 text-foreground-secondary text-sm leading-relaxed">
                    &ldquo;We expect the regulated asset base to compound in the
                    mid single digits over the current tariff period, funded
                    from operating cash flow.&rdquo;
                  </p>
                  <span className="text-foreground-secondary text-xs">
                    Synthetic source record
                  </span>
                </div>
              </HoverCard.Popup>
            </HoverCard.Positioner>
          </HoverCard.Portal>
        </HoverCard.Root>
        .
      </p>
    </div>
  );
}

export function AnalystPreview() {
  return (
    <div className="bg-canvas p-6 rounded-lg" style={{ paddingTop: 300 }}>
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-raised px-4 py-3 max-w-xs">
        <div className="flex items-center gap-3">
          <HoverCard.Root defaultOpen>
            <HoverCard.Trigger className={citationClass} href="#owner">
              M. Ferreira
            </HoverCard.Trigger>
            <HoverCard.Portal>
              <HoverCard.Positioner align="start" side="top">
                <HoverCard.Popup>
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                      <span className="font-semibold text-foreground text-sm">
                        M. Ferreira
                      </span>
                      <span className="text-foreground-secondary text-xs">
                        Utilities and regulated infrastructure
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1 min-w-0">
                        <span className="text-foreground-secondary text-xs">
                          Issuers covered
                        </span>
                        <span className="font-semibold tabular-nums text-sm">
                          14
                        </span>
                      </div>
                      <div className="flex flex-col gap-1 min-w-0">
                        <span className="text-foreground-secondary text-xs">
                          Last review
                        </span>
                        <span className="font-semibold tabular-nums text-sm">
                          4 Feb 2029
                        </span>
                      </div>
                    </div>
                    <span className="text-foreground-secondary text-xs">
                      Fictional workspace member
                    </span>
                  </div>
                </HoverCard.Popup>
              </HoverCard.Positioner>
            </HoverCard.Portal>
          </HoverCard.Root>
          <span className="ml-auto text-foreground-secondary text-xs">
            4 Feb 2029
          </span>
        </div>
        <span className="text-foreground-secondary text-xs">
          Coverage owner · utilities and regulated infrastructure
        </span>
      </div>
    </div>
  );
}

export function ClosedCitations() {
  return (
    <div className="bg-canvas p-6 rounded-lg">
      <div className="flex flex-col gap-2 max-w-md">
        <p className="m-0 text-foreground leading-relaxed">
          Tariff resets in 2031{" "}
          <HoverCard.Root>
            <HoverCard.Trigger className={citationClass} href="#source-1">
              [1]
            </HoverCard.Trigger>
            <HoverCard.Portal>
              <HoverCard.Positioner>
                <HoverCard.Popup>Annual report 2028 — page 41</HoverCard.Popup>
              </HoverCard.Positioner>
            </HoverCard.Portal>
          </HoverCard.Root>{" "}
          and the capital plan is fully funded from operating cash flow{" "}
          <HoverCard.Root>
            <HoverCard.Trigger className={citationClass} href="#source-2">
              [2]
            </HoverCard.Trigger>
            <HoverCard.Portal>
              <HoverCard.Positioner>
                <HoverCard.Popup>
                  Half-year statement 2028 — page 12
                </HoverCard.Popup>
              </HoverCard.Positioner>
            </HoverCard.Portal>
          </HoverCard.Root>
          .
        </p>
        <span className="text-foreground-secondary text-xs">
          Closed state: the sentence still reads without ever opening a card.
        </span>
      </div>
    </div>
  );
}
