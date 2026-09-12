import { PreviewCard } from "@pythia/ui";

/**
 * Preview cards open on hover or trigger focus. The open stories use
 * `defaultOpen` so the popup renders statically; the hover-intent delay and
 * the safe pointer travel between trigger and card cannot be captured.
 *
 * `PreviewCard.Arrow` is deliberately unused — it ships fill and stroke
 * colours but no shape, so it needs an author-supplied SVG (and per-side
 * rotation) that is out of scope for a story.
 */

const triggerClass =
  "font-medium text-foreground border-b border-border-strong";

function IssuerSummary() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="font-semibold text-foreground text-sm">
          Northwind Grid Utilities
        </span>
        <span className="text-foreground-secondary text-xs">
          Regulated electricity networks · Rotterdam · NWG
        </span>
      </div>
      <p className="m-0 text-foreground-secondary text-sm leading-relaxed">
        Two thirds of revenue sits inside a regulated tariff that resets in
        2031. Coverage opened after the FY 2028 annual filing.
      </p>
      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-foreground-secondary text-xs">Weight</span>
          <span className="font-semibold tabular-nums text-sm">3.8%</span>
        </div>
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-foreground-secondary text-xs">EV / EBIT</span>
          <span className="font-semibold tabular-nums text-sm">13.1×</span>
        </div>
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-foreground-secondary text-xs">Net debt</span>
          <span className="font-semibold tabular-nums text-sm">2.4×</span>
        </div>
      </div>
      <span className="text-foreground-secondary text-xs">
        Synthetic issuer · figures as reported 26 Feb 2029
      </span>
    </div>
  );
}

export function IssuerPreview() {
  return (
    <div className="bg-canvas p-6 rounded-lg" style={{ paddingBottom: 320 }}>
      <p className="m-0 max-w-md text-foreground leading-relaxed">
        The single largest swing factor in the 2031 estimate is the tariff
        reset at{" "}
        <PreviewCard.Root defaultOpen>
          <PreviewCard.Trigger className={triggerClass} href="#nwg">
            Northwind Grid Utilities
          </PreviewCard.Trigger>
          <PreviewCard.Portal>
            <PreviewCard.Positioner align="start" side="bottom">
              <PreviewCard.Popup>
                <IssuerSummary />
              </PreviewCard.Popup>
            </PreviewCard.Positioner>
          </PreviewCard.Portal>
        </PreviewCard.Root>
        .
      </p>
    </div>
  );
}

export function AnchoredRight() {
  return (
    <div className="bg-canvas p-6 rounded-lg">
      <div className="flex flex-col items-end gap-1 rounded-lg border border-border bg-raised p-4 w-fit">
        <span className="text-foreground-secondary text-xs">
          Top holding · 3.8% weight
        </span>
        <PreviewCard.Root defaultOpen>
          <PreviewCard.Trigger className={triggerClass} href="#nwg">
            Northwind Grid Utilities
          </PreviewCard.Trigger>
          <PreviewCard.Portal>
            <PreviewCard.Positioner align="start" side="right">
              <PreviewCard.Popup>
                <IssuerSummary />
              </PreviewCard.Popup>
            </PreviewCard.Positioner>
          </PreviewCard.Portal>
        </PreviewCard.Root>
      </div>
    </div>
  );
}

export function TriggersInProse() {
  return (
    <div className="bg-canvas p-6 rounded-lg">
      <div className="flex flex-col gap-2 max-w-md">
        <p className="m-0 text-foreground leading-relaxed">
          Cyclical exposure runs through{" "}
          <PreviewCard.Root>
            <PreviewCard.Trigger className={triggerClass} href="#calder">
              Calder Metals
            </PreviewCard.Trigger>
            <PreviewCard.Portal>
              <PreviewCard.Positioner>
                <PreviewCard.Popup>
                  <IssuerSummary />
                </PreviewCard.Popup>
              </PreviewCard.Positioner>
            </PreviewCard.Portal>
          </PreviewCard.Root>{" "}
          and{" "}
          <PreviewCard.Root>
            <PreviewCard.Trigger className={triggerClass} href="#kestrel">
              Kestrel Logistics
            </PreviewCard.Trigger>
            <PreviewCard.Portal>
              <PreviewCard.Positioner>
                <PreviewCard.Popup>
                  <IssuerSummary />
                </PreviewCard.Popup>
              </PreviewCard.Positioner>
            </PreviewCard.Portal>
          </PreviewCard.Root>
          , both of which are reviewed on a shorter cycle.
        </p>
        <span className="text-foreground-secondary text-xs">
          Closed state: the trigger stays a readable link and the preview is
          never required to follow the sentence.
        </span>
      </div>
    </div>
  );
}
