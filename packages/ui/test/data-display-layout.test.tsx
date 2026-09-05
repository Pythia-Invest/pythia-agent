import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Avatar } from "../src/data-display/avatar";
import { Card } from "../src/data-display/card";
import { EmptyState } from "../src/data-display/empty-state";
import { ScrollArea } from "../src/data-display/scroll-area";
import { Separator } from "../src/data-display/separator";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../src/data-display/table";
import { Container, Inline, Stack } from "../src/layout/layout";
import {
  ResizableGroup,
  ResizablePanel,
  ResizableSeparator,
} from "../src/layout/resizable-panels";

describe("data display", () => {
  it("renders card and empty-state regions without adding workflow behavior", () => {
    const card = renderToStaticMarkup(
      <Card
        description="Synthetic evidence only"
        footer="Updated manually"
        title="Research"
        variant="outlined"
      >
        Two sources
      </Card>,
    );
    const empty = renderToStaticMarkup(
      <EmptyState description="Add a source to begin." title="No sources" />,
    );

    expect(card).toContain('data-variant="outlined"');
    expect(card).toContain("Synthetic evidence only");
    expect(empty).toContain("No sources");
    expect(empty).not.toContain('role="alert"');
  });

  it("keeps the basic table native and free of grid behavior", () => {
    const table = renderToStaticMarkup(
      <Table>
        <TableCaption>Synthetic holdings</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Company</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Example SA</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    expect(table).toContain("<table");
    expect(table).toContain("<caption");
    expect(table).toContain('scope="col"');
    expect(table).not.toContain('role="grid"');
  });

  it("composes native Base UI avatar, scroll area, and separator paths", () => {
    const avatar = renderToStaticMarkup(
      <Avatar fallback="PI" label="Pythia Invest" size="large" />,
    );
    const scroll = renderToStaticMarkup(
      <ScrollArea orientation="both">
        <p>Scrollable evidence</p>
      </ScrollArea>,
    );
    const separator = renderToStaticMarkup(
      <Separator orientation="vertical" />,
    );

    expect(avatar).toContain('data-size="large"');
    expect(avatar).toContain("PI");
    expect(scroll).toContain("py-scroll-area__viewport");
    expect(scroll).toContain("Scrollable evidence");
    expect(separator).toContain('role="separator"');
    expect(separator).toContain('aria-orientation="vertical"');
  });
});

describe("layout", () => {
  it("exposes bounded container and repeated stack/inline composition", () => {
    const markup = renderToStaticMarkup(
      <Container size="reading">
        <Stack align="start" gap="6">
          <Inline gap="2" wrap={false}>
            <span>One</span>
            <span>Two</span>
          </Inline>
        </Stack>
      </Container>,
    );

    expect(markup).toContain('data-size="reading"');
    expect(markup).toContain('data-align="start"');
    expect(markup).toContain('data-gap="6"');
    expect(markup).toContain('data-wrap="false"');
  });

  it("renders v4 Group, Panel, and Separator as direct native children", () => {
    const markup = renderToStaticMarkup(
      <ResizableGroup id="research-layout" orientation="horizontal">
        <ResizablePanel defaultSize="40" id="sources">
          Sources
        </ResizablePanel>
        <ResizableSeparator id="divider" withHandle />
        <ResizablePanel id="report">Report</ResizablePanel>
      </ResizableGroup>,
    );

    expect(markup).toContain('data-group="true"');
    expect(markup).toContain('data-testid="research-layout"');
    expect(markup).toContain('data-testid="sources"');
    expect(markup).toContain('data-separator="inactive"');
    expect(markup).toContain('role="separator"');
    expect(markup).toContain('aria-orientation="vertical"');
    expect(markup).toMatch(
      /data-testid="sources"[\s\S]*data-separator="inactive"[\s\S]*data-testid="report"/,
    );
  });

  it("keeps transient resize feedback on the neutral strong border", async () => {
    const css = await readFile(
      new URL("../src/layout/layout.css", import.meta.url),
      "utf8",
    );

    expect(css).toMatch(
      /\.py-resizable-separator:hover,[^}]*\[data-separator="active"\]\s*\{[^}]*background:\s*var\(--py-border-strong\)/,
    );
    expect(css).not.toContain("--py-action-primary-background");
  });
});
