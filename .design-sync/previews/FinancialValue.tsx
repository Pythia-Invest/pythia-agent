import { FinancialValue } from "@pythia/ui";

function Measure({
  children,
  name,
}: {
  children: React.ReactNode;
  name: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-foreground-secondary text-xs">{name}</span>
      {children}
    </div>
  );
}

export function ReportedValue() {
  return (
    <div className="flex flex-col gap-3 max-w-lg">
      <Measure name="Northstar Materials · revenue">
        <FinancialValue
          basis="Reported, as filed"
          currencyOrUnit="EUR million"
          freshness="current"
          label="Northstar Materials revenue"
          period="FY 2028"
          value="1,842"
        />
      </Measure>
      <span className="text-foreground-secondary text-xs leading-relaxed">
        Value, unit, period, basis and freshness travel together — a bare number
        cannot be read without them. Every field is required; absent data
        belongs in KnowledgeState instead. The accessible group label is
        screen-reader only, so a visible caption sits above the figure here.
      </span>
    </div>
  );
}

export function UnitsAndBases() {
  return (
    <div className="flex flex-col gap-3 max-w-lg">
      <Measure name="Revenue">
        <FinancialValue
          basis="Reported, as filed"
          currencyOrUnit="EUR million"
          freshness="current"
          label="Revenue"
          period="FY 2028"
          value="1,842"
        />
      </Measure>
      <Measure name="Operating margin">
        <FinancialValue
          basis="Adjusted for the Frankfurt disposal"
          currencyOrUnit="percent"
          freshness="current"
          label="Operating margin"
          period="FY 2028"
          value="11.6%"
        />
      </Measure>
      <Measure name="Valuation multiple">
        <FinancialValue
          basis="Consensus of three invented estimates"
          currencyOrUnit="× EV / EBIT"
          freshness="delayed"
          label="Valuation multiple"
          period="FY 2029E"
          value="11.4"
        />
      </Measure>
      <Measure name="Earnings per share">
        <FinancialValue
          basis="Reported, diluted"
          currencyOrUnit="EUR per share"
          freshness="current"
          label="Earnings per share"
          period="FY 2028"
          value="2.94"
        />
      </Measure>
    </div>
  );
}

export function FreshnessAcrossValues() {
  return (
    <div className="flex flex-col gap-3 max-w-lg">
      <Measure name="Northstar Materials · free cash flow">
        <FinancialValue
          basis="Reported, as filed"
          currencyOrUnit="EUR million"
          freshness="current"
          label="Northstar Materials free cash flow"
          period="FY 2028"
          value="148"
        />
      </Measure>
      <Measure name="Kestrel Logistics · last traded price">
        <FinancialValue
          basis="Last traded, synthetic venue"
          currencyOrUnit="EUR per share"
          freshness="delayed"
          label="Kestrel Logistics price"
          period="12 April 2028"
          value="12.85"
        />
      </Measure>
      <Measure name="Aldergrove Utilities · leverage">
        <FinancialValue
          basis="Reported, prior year"
          currencyOrUnit="× net debt / EBITDA"
          freshness="stale"
          label="Aldergrove Utilities leverage"
          period="FY 2027"
          value="4.0"
        />
      </Measure>
      <Measure name="Vantage Bioscience · research spend">
        <FinancialValue
          basis="Carried over from an undated investor note"
          currencyOrUnit="EUR million"
          freshness="unknown"
          label="Vantage Bioscience research spend"
          period="Q3 2028"
          value="64"
        />
      </Measure>
    </div>
  );
}
