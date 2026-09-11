import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pythia/ui";

const holdings = [
  ["Northstar Materials", "Industrials", "4.2%", "€ 38.10", "11.4×", "FY 2028"],
  ["Kestrel Logistics", "Transport", "3.6%", "€ 12.85", "9.1×", "FY 2028"],
  ["Aldergrove Utilities", "Utilities", "2.9%", "€ 21.40", "14.7×", "FY 2028"],
  ["Vantage Bioscience", "Healthcare", "1.4%", "€ 64.20", "—", "Q3 2028"],
  ["Meridian Foods", "Consumer", "1.1%", "€ 7.95", "16.2×", "FY 2028"],
];

const coverage = [
  ["FY 2028 annual report", "14 Feb 2029", "Complete"],
  ["Q3 2028 interim", "07 Nov 2028", "Complete"],
  ["Q2 2028 interim", "—", "Missing"],
  ["FY 2027 annual report", "09 Feb 2028", "Stale"],
];

export function HoldingsTable() {
  return (
    <Table>
      <TableCaption>
        Synthetic portfolio positions as at 31 March 2029.
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Issuer</TableHead>
          <TableHead scope="col">Sector</TableHead>
          <TableHead className="text-right" scope="col">
            Weight
          </TableHead>
          <TableHead className="text-right" scope="col">
            Cost basis
          </TableHead>
          <TableHead className="text-right" scope="col">
            EV / EBIT
          </TableHead>
          <TableHead scope="col">Period</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {holdings.map(([issuer, sector, weight, cost, multiple, period]) => (
          <TableRow key={issuer}>
            <TableCell className="font-medium whitespace-nowrap">
              {issuer}
            </TableCell>
            <TableCell className="text-foreground-secondary">{sector}</TableCell>
            <TableCell className="text-right tabular-nums">{weight}</TableCell>
            <TableCell className="text-right tabular-nums">{cost}</TableCell>
            <TableCell className="text-right tabular-nums">{multiple}</TableCell>
            <TableCell className="text-foreground-secondary whitespace-nowrap">
              {period}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function CoverageTable() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Document</TableHead>
          <TableHead className="text-right" scope="col">
            Retrieved
          </TableHead>
          <TableHead className="text-right" scope="col">
            State
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {coverage.map(([document, retrieved, state]) => (
          <TableRow key={document}>
            <TableCell>{document}</TableCell>
            <TableCell className="text-right tabular-nums whitespace-nowrap">
              {retrieved}
            </TableCell>
            <TableCell className="text-right text-foreground-secondary">
              {state}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function RowHeaders() {
  return (
    <Table>
      <TableCaption>
        Northstar Materials against two synthetic peers, FY 2028 reported.
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Measure</TableHead>
          <TableHead className="text-right" scope="col">
            Northstar
          </TableHead>
          <TableHead className="text-right" scope="col">
            Kestrel
          </TableHead>
          <TableHead className="text-right" scope="col">
            Aldergrove
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableHead scope="row">Revenue (€m)</TableHead>
          <TableCell className="text-right tabular-nums">1,842</TableCell>
          <TableCell className="text-right tabular-nums">964</TableCell>
          <TableCell className="text-right tabular-nums">2,310</TableCell>
        </TableRow>
        <TableRow>
          <TableHead scope="row">Operating margin</TableHead>
          <TableCell className="text-right tabular-nums">11.6%</TableCell>
          <TableCell className="text-right tabular-nums">7.8%</TableCell>
          <TableCell className="text-right tabular-nums">19.3%</TableCell>
        </TableRow>
        <TableRow>
          <TableHead scope="row">Net debt / EBITDA</TableHead>
          <TableCell className="text-right tabular-nums">2.1×</TableCell>
          <TableCell className="text-right tabular-nums">3.4×</TableCell>
          <TableCell className="text-right tabular-nums">4.0×</TableCell>
        </TableRow>
        <TableRow>
          <TableHead scope="row">Free cash flow (€m)</TableHead>
          <TableCell className="text-right tabular-nums">148</TableCell>
          <TableCell className="text-right tabular-nums">—</TableCell>
          <TableCell className="text-right tabular-nums">302</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}
