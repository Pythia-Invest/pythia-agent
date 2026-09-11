"use client";

import { Tab, TabPanel, Tabs, TabsList } from "@pythia/ui";

export function IssuerViews() {
  return (
    <Tabs defaultValue="summary">
      <TabsList aria-label="Northwind Grid Utilities views">
        <Tab value="summary">Summary</Tab>
        <Tab value="evidence">Evidence</Tab>
        <Tab value="filings">Filings</Tab>
        <Tab value="notes">Notes</Tab>
        <Tab disabled value="history">
          Price history
        </Tab>
      </TabsList>
      <TabPanel value="summary">
        <div className="flex flex-col gap-2">
          <span className="font-semibold text-foreground">
            Northwind Grid Utilities
          </span>
          <span className="text-foreground-secondary leading-relaxed">
            Regulated transmission operator, fictional issuer. FY 2028 revenue
            of €2,310m at a 19.3% operating margin, with net debt at 4.0×
            EBITDA after the Hallam interconnector build.
          </span>
        </div>
      </TabPanel>
      <TabPanel value="evidence">
        <span className="text-foreground-secondary">
          Nine archived documents support this summary.
        </span>
      </TabPanel>
      <TabPanel value="filings">
        <span className="text-foreground-secondary">
          Four annual reports and six interim statements.
        </span>
      </TabPanel>
      <TabPanel value="notes">
        <span className="text-foreground-secondary">
          Two research notes, last edited 14 Feb 2029.
        </span>
      </TabPanel>
      <TabPanel value="history">
        <span className="text-foreground-secondary">
          Price history is not archived for this issuer.
        </span>
      </TabPanel>
    </Tabs>
  );
}

export function EvidenceSelected() {
  return (
    <Tabs defaultValue="evidence">
      <TabsList aria-label="Northwind Grid Utilities views">
        <Tab value="summary">Summary</Tab>
        <Tab value="evidence">Evidence</Tab>
        <Tab value="filings">Filings</Tab>
        <Tab value="notes">Notes</Tab>
      </TabsList>
      <TabPanel value="summary">
        <span className="text-foreground-secondary">
          Regulated transmission operator, fictional issuer.
        </span>
      </TabPanel>
      <TabPanel value="evidence">
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          <li className="flex flex-col gap-1">
            <span className="font-medium text-foreground">
              FY 2028 annual report · pages 42–47
            </span>
            <span className="text-foreground-secondary text-sm">
              Segment note on regulated asset base. Retrieved 14 Feb 2029.
            </span>
          </li>
          <li className="flex flex-col gap-1">
            <span className="font-medium text-foreground">
              Capital markets update · 22 Sep 2028
            </span>
            <span className="text-foreground-secondary text-sm">
              Interconnector capex guidance. Retrieved 23 Sep 2028.
            </span>
          </li>
          <li className="flex flex-col gap-1">
            <span className="font-medium text-foreground">
              Q2 2028 interim statement
            </span>
            <span className="text-foreground-secondary text-sm">
              Not archived — the covenant disclosure is missing.
            </span>
          </li>
        </ul>
      </TabPanel>
      <TabPanel value="filings">
        <span className="text-foreground-secondary">
          Four annual reports and six interim statements.
        </span>
      </TabPanel>
      <TabPanel value="notes">
        <span className="text-foreground-secondary">
          Two research notes, last edited 14 Feb 2029.
        </span>
      </TabPanel>
    </Tabs>
  );
}

export function VerticalOrientation() {
  return (
    <Tabs className="flex gap-4" defaultValue="valuation" orientation="vertical">
      <TabsList aria-label="Screen sections">
        <Tab value="universe">Universe</Tab>
        <Tab value="quality">Quality</Tab>
        <Tab value="valuation">Valuation</Tab>
        <Tab value="output">Output</Tab>
      </TabsList>
      <TabPanel className="flex-1" value="universe">
        <span className="text-foreground-secondary">
          412 fictional issuers across six sectors.
        </span>
      </TabPanel>
      <TabPanel className="flex-1" value="quality">
        <span className="text-foreground-secondary">
          Return on capital above 12% for three consecutive years.
        </span>
      </TabPanel>
      <TabPanel className="flex-1" value="valuation">
        <div className="flex flex-col gap-2">
          <span className="font-semibold text-foreground">
            Valuation criteria
          </span>
          <span className="text-foreground-secondary leading-relaxed">
            EV / EBIT below 12× on FY 2028 reported figures, and free cash flow
            yield above 5%. 42 of 412 issuers pass.
          </span>
        </div>
      </TabPanel>
      <TabPanel className="flex-1" value="output">
        <span className="text-foreground-secondary">
          Ranked table, exported as CSV.
        </span>
      </TabPanel>
    </Tabs>
  );
}

export function InPanelHeader() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-canvas p-4">
      <Tabs defaultValue="positions">
        <TabsList aria-label="Portfolio views">
          <Tab value="positions">Positions</Tab>
          <Tab value="exposure">Exposure</Tab>
          <Tab value="activity">Activity</Tab>
        </TabsList>
        <TabPanel value="positions">
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-foreground">Northstar Materials</span>
              <span className="tabular-nums text-foreground-secondary">
                4.2%
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-foreground">Kestrel Logistics</span>
              <span className="tabular-nums text-foreground-secondary">
                3.6%
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-foreground">Aldergrove Utilities</span>
              <span className="tabular-nums text-foreground-secondary">
                2.9%
              </span>
            </div>
          </div>
        </TabPanel>
        <TabPanel value="exposure">
          <span className="text-foreground-secondary">
            Industrials 31%, Transport 22%, Utilities 18%.
          </span>
        </TabPanel>
        <TabPanel value="activity">
          <span className="text-foreground-secondary">
            No trades recorded since 31 March 2029.
          </span>
        </TabPanel>
      </Tabs>
    </div>
  );
}
