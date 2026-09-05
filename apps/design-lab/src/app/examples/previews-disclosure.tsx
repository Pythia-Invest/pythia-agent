"use client";

import { Accordion, Collapsible, Details } from "@pythia/ui";
import type { CatalogRoute } from "../../catalog";
import { Specimen, SpecimenGrid } from "./specimen";

export function DisclosurePreview({ route }: { route: CatalogRoute }) {
  switch (route) {
    case "/components/accordion":
      return (
        <SpecimenGrid>
          <Specimen label="Related expandable sections">
            <Accordion.Root defaultValue={["summary"]} multiple>
              <Accordion.Item value="summary">
                <Accordion.Header>
                  <Accordion.Trigger>Synthetic summary</Accordion.Trigger>
                </Accordion.Header>
                <Accordion.Panel>
                  A stable fictional summary used only to inspect disclosure
                  behavior.
                </Accordion.Panel>
              </Accordion.Item>
              <Accordion.Item value="method">
                <Accordion.Header>
                  <Accordion.Trigger>Synthetic method</Accordion.Trigger>
                </Accordion.Header>
                <Accordion.Panel>
                  No research method or product workflow is asserted here.
                </Accordion.Panel>
              </Accordion.Item>
              <Accordion.Item disabled value="history">
                <Accordion.Header>
                  <Accordion.Trigger>Unavailable history</Accordion.Trigger>
                </Accordion.Header>
                <Accordion.Panel>Unavailable.</Accordion.Panel>
              </Accordion.Item>
            </Accordion.Root>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/collapsible":
      return (
        <SpecimenGrid>
          <Specimen label="One optional region">
            <Collapsible.Root defaultOpen>
              <Collapsible.Trigger>Synthetic assumptions</Collapsible.Trigger>
              <Collapsible.Panel>
                All values and names in this specimen are deliberately
                fictional.
              </Collapsible.Panel>
            </Collapsible.Root>
          </Specimen>
          <Specimen label="Disabled open state">
            <Collapsible.Root disabled open>
              <Collapsible.Trigger>
                Locked synthetic context
              </Collapsible.Trigger>
              <Collapsible.Panel>
                This region is visible but cannot be toggled.
              </Collapsible.Panel>
            </Collapsible.Root>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/details":
      return (
        <SpecimenGrid>
          <Specimen label="Platform disclosure">
            <Details.Root open>
              <Details.Summary>Synthetic source assumptions</Details.Summary>
              <Details.Content>
                Native details and summary own this document-like disclosure.
              </Details.Content>
            </Details.Root>
            <Details.Root>
              <Details.Summary>Additional synthetic context</Details.Summary>
              <Details.Content>
                Hidden until the native summary is activated.
              </Details.Content>
            </Details.Root>
          </Specimen>
        </SpecimenGrid>
      );
    default:
      throw new Error(`Missing curated disclosure preview: ${route}`);
  }
}
