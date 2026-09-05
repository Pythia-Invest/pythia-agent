import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ScrollArea,
  Separator,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pythia/ui";
import { Inbox } from "lucide-react";
import type { CatalogRoute } from "../../catalog";
import { DemoNote, Specimen, SpecimenGrid } from "./specimen";

const scrollRows = [
  "Synthetic evidence row 1",
  "Synthetic evidence row 2",
  "Synthetic evidence row 3",
  "Synthetic evidence row 4",
  "Synthetic evidence row 5",
  "Synthetic evidence row 6",
  "Synthetic evidence row 7",
  "Synthetic evidence row 8",
  "Synthetic evidence row 9",
  "Synthetic evidence row 10",
  "Synthetic evidence row 11",
  "Synthetic evidence row 12",
] as const;

export function DataDisplayPreview({ route }: { route: CatalogRoute }) {
  switch (route) {
    case "/components/card":
      return (
        <SpecimenGrid>
          <Specimen label="Surface hierarchy">
            <div className="catalog-card-grid">
              <Card
                description="Stable fictional display content."
                footer="Synthetic footer"
                title="Raised card"
              >
                Neutral grouped content.
              </Card>
              <Card
                description="A bounded group without elevation."
                title="Outlined card"
                variant="outlined"
              >
                No workflow behavior.
              </Card>
              <Card title="Subtle card" variant="subtle">
                Quiet supporting content.
              </Card>
            </div>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/table":
      return (
        <SpecimenGrid>
          <Specimen label="Basic responsive table">
            <Table>
              <TableCaption>Labelled synthetic observations</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Synthetic item</TableHead>
                  <TableHead scope="col">Period</TableHead>
                  <TableHead scope="col">Value</TableHead>
                  <TableHead scope="col">State</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>Northstar alpha</TableCell>
                  <TableCell>FY 2028</TableCell>
                  <TableCell>€ 1,240</TableCell>
                  <TableCell>Complete</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Northstar beta</TableCell>
                  <TableCell>Q2 2028</TableCell>
                  <TableCell>—</TableCell>
                  <TableCell>Unknown</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Northstar gamma</TableCell>
                  <TableCell>FY 2027</TableCell>
                  <TableCell>3.2×</TableCell>
                  <TableCell>Stale</TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <DemoNote>
              These values are fictional and demonstrate table structure only.
            </DemoNote>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/avatar":
      return (
        <SpecimenGrid>
          <Specimen label="Explicit fallback identity">
            <div className="catalog-row">
              <Avatar
                fallback="NM"
                label="Northstar Materials synthetic avatar"
                size="small"
              />
              <Avatar
                fallback="PI"
                label="Pythia Invest synthetic analyst avatar"
              />
              <Avatar
                fallback="EX"
                label="Example synthetic avatar"
                size="large"
              />
            </div>
            <DemoNote>No person or customer identity is represented.</DemoNote>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/scroll-area":
      return (
        <SpecimenGrid>
          <Specimen label="Measured overflow">
            <ScrollArea className="catalog-scroll-area" orientation="both">
              <div className="catalog-scroll-content">
                {scrollRows.map((row) => (
                  <div key={row}>
                    {row} · fictional content extending the horizontal measure
                  </div>
                ))}
              </div>
            </ScrollArea>
            <DemoNote>
              Drag or keyboard-scroll the native overflow viewport.
            </DemoNote>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/separator":
      return (
        <SpecimenGrid>
          <Specimen label="Structural divisions">
            <div className="catalog-separator-stack">
              <span>Synthetic summary</span>
              <Separator />
              <span>Synthetic evidence</span>
            </div>
            <div className="catalog-separator-inline">
              <span>Facts</span>
              <Separator orientation="vertical" />
              <span>Judgment</span>
              <Separator orientation="vertical" />
              <span>Unknown</span>
            </div>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/empty-state":
      return (
        <SpecimenGrid>
          <Specimen label="Valid empty result">
            <EmptyState
              action={<Button variant="secondary">Add synthetic item</Button>}
              description="This deliberately empty specimen is not loading, failed, or incomplete."
              icon={<Inbox aria-hidden="true" />}
              title="No synthetic items yet"
            />
          </Specimen>
        </SpecimenGrid>
      );
    default:
      throw new Error(`Missing curated data-display preview: ${route}`);
  }
}
