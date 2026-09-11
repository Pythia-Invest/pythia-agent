import { ResizableGroup, ResizablePanel, ResizableSeparator } from "@pythia/ui";

export function EvidenceSplit() {
  return (
    <ResizableGroup
      id="evidence-split"
      orientation="horizontal"
      style={{ height: "15rem" }}
    >
      <ResizablePanel defaultSize="38" id="evidence-sources" minSize="20">
        <div className="flex flex-col gap-2 p-4">
          <span className="font-semibold text-foreground text-sm">Sources</span>
          <span className="text-foreground-secondary text-xs">
            Northwind Grid Utilities FY2028 annual report
          </span>
          <span className="text-foreground-secondary text-xs">
            Calder Metals Q3 2028 interim statement
          </span>
          <span className="text-foreground-secondary text-xs">
            Sector note — regulated utilities, Mar 2028
          </span>
        </div>
      </ResizablePanel>
      <ResizableSeparator id="evidence-divider" withHandle />
      <ResizablePanel id="evidence-summary" minSize="25">
        <div className="flex flex-col gap-2 p-4">
          <span className="font-semibold text-foreground text-sm">
            Working summary
          </span>
          <p className="text-foreground-secondary text-sm leading-relaxed">
            Regulated revenue covered the dividend in each of the last four
            reported periods. Figures are synthetic and carry their own
            freshness labels in the evidence pane.
          </p>
        </div>
      </ResizablePanel>
    </ResizableGroup>
  );
}

export function VerticalSplit() {
  return (
    <ResizableGroup
      id="vertical-split"
      orientation="vertical"
      style={{ height: "17rem" }}
    >
      <ResizablePanel defaultSize="45" id="vertical-filing" minSize="20">
        <div className="flex flex-col gap-2 p-4">
          <span className="font-semibold text-foreground text-sm">
            Filing excerpt
          </span>
          <p className="text-foreground-secondary text-sm leading-relaxed">
            "Distribution network revenue rose to 4.1bn in FY2028, with the
            regulated allowance unchanged." — synthetic issuer text.
          </p>
        </div>
      </ResizablePanel>
      <ResizableSeparator id="vertical-divider" withHandle />
      <ResizablePanel id="vertical-notes" minSize="20">
        <div className="flex flex-col gap-2 p-4">
          <span className="font-semibold text-foreground text-sm">
            Analyst notes
          </span>
          <p className="text-foreground-secondary text-sm leading-relaxed">
            Check the allowance reset date before carrying this figure into the
            FY2029 view.
          </p>
        </div>
      </ResizablePanel>
    </ResizableGroup>
  );
}

export function ThreePanelWorkspace() {
  return (
    <ResizableGroup
      id="workspace-split"
      orientation="horizontal"
      style={{ height: "14rem" }}
    >
      <ResizablePanel defaultSize="25" id="workspace-nav" minSize="15">
        <div className="flex flex-col gap-2 p-3">
          <span className="font-semibold text-foreground text-sm">
            Watchlists
          </span>
          <span className="text-foreground-secondary text-xs">
            Regulated utilities
          </span>
          <span className="text-foreground-secondary text-xs">
            Industrial metals
          </span>
        </div>
      </ResizablePanel>
      <ResizableSeparator id="workspace-divider-a" withHandle />
      <ResizablePanel defaultSize="45" id="workspace-detail" minSize="25">
        <div className="flex flex-col gap-2 p-3">
          <span className="font-semibold text-foreground text-sm">
            Northwind Grid Utilities
          </span>
          <span className="text-foreground-secondary text-xs tabular-nums">
            FY2028 · revenue 4.1bn · payout 62%
          </span>
        </div>
      </ResizablePanel>
      <ResizableSeparator id="workspace-divider-b" withHandle />
      <ResizablePanel id="workspace-evidence" minSize="20">
        <div className="flex flex-col gap-2 p-3">
          <span className="font-semibold text-foreground text-sm">
            Evidence
          </span>
          <span className="text-foreground-secondary text-xs">
            3 filings · 1 sector note
          </span>
        </div>
      </ResizablePanel>
    </ResizableGroup>
  );
}
