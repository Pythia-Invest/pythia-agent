"use client";

import {
  Container,
  Inline,
  ResizableGroup,
  ResizablePanel,
  ResizableSeparator,
  Stack,
} from "@pythia/ui";
import type { CatalogRoute } from "../../catalog";
import { DemoNote, Specimen, SpecimenGrid } from "./specimen";

function LayoutBlock({ children }: { children: string }) {
  return <div className="catalog-layout-block">{children}</div>;
}

export function LayoutPreview({ route }: { route: CatalogRoute }) {
  switch (route) {
    case "/components/container":
      return (
        <SpecimenGrid>
          <Specimen label="Profile-aware measures">
            <div className="catalog-container-demo">
              <Container size="reading">
                <LayoutBlock>Reading measure</LayoutBlock>
              </Container>
              <Container size="content">
                <LayoutBlock>Content measure</LayoutBlock>
              </Container>
              <Container size="wide">
                <LayoutBlock>Wide measure</LayoutBlock>
              </Container>
              <Container size="full">
                <LayoutBlock>Full measure</LayoutBlock>
              </Container>
            </div>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/stack":
      return (
        <SpecimenGrid>
          <Specimen label="Vertical token rhythm">
            <Stack gap="4">
              <LayoutBlock>Synthetic heading</LayoutBlock>
              <LayoutBlock>Synthetic evidence group</LayoutBlock>
              <LayoutBlock>Synthetic footer</LayoutBlock>
            </Stack>
          </Specimen>
          <Specimen label="Compact centered stack">
            <Stack align="center" gap="2">
              <LayoutBlock>Alpha</LayoutBlock>
              <LayoutBlock>Beta</LayoutBlock>
              <LayoutBlock>Gamma</LayoutBlock>
            </Stack>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/inline":
      return (
        <SpecimenGrid>
          <Specimen label="Wrapping peer items">
            <Inline gap="3" wrap>
              <LayoutBlock>Synthetic fact</LayoutBlock>
              <LayoutBlock>Machine assessment</LayoutBlock>
              <LayoutBlock>Freshness unknown</LayoutBlock>
              <LayoutBlock>FY 2028</LayoutBlock>
            </Inline>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/resizable-panels":
      return (
        <SpecimenGrid>
          <Specimen label="Native pointer and keyboard resizing">
            <div className="catalog-resizable-stage">
              <ResizableGroup
                className="catalog-resizable"
                id="synthetic-resizable-demo"
                orientation="horizontal"
              >
                <ResizablePanel
                  defaultSize="38"
                  id="synthetic-sources"
                  minSize="20"
                >
                  <div className="catalog-resizable-panel">
                    Synthetic sources
                  </div>
                </ResizablePanel>
                <ResizableSeparator id="synthetic-divider" withHandle />
                <ResizablePanel id="synthetic-summary" minSize="25">
                  <div className="catalog-resizable-panel">
                    Synthetic summary
                  </div>
                </ResizablePanel>
              </ResizableGroup>
            </div>
            <DemoNote>
              Drag the separator or focus it and use arrow keys. The specialist
              library owns the resize state.
            </DemoNote>
          </Specimen>
        </SpecimenGrid>
      );
    default:
      throw new Error(`Missing curated layout preview: ${route}`);
  }
}
