"use client";

import { Accordion } from "@pythia/ui";

export function EvidenceSections() {
  return (
    <Accordion.Root defaultValue={["thesis"]} multiple>
      <Accordion.Item value="thesis">
        <Accordion.Header>
          <Accordion.Trigger>Thesis</Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Panel>
          Northstar Materials trades below the replacement cost of its smelter
          fleet while the restart of the Hallam line remains unfinanced.
        </Accordion.Panel>
      </Accordion.Item>
      <Accordion.Item value="evidence">
        <Accordion.Header>
          <Accordion.Trigger>Evidence</Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Panel>
          FY 2028 annual report, pages 42 to 47, and the capital markets update
          of 22 September 2028.
        </Accordion.Panel>
      </Accordion.Item>
      <Accordion.Item value="risks">
        <Accordion.Header>
          <Accordion.Trigger>Open questions</Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Panel>
          The refinancing covenant is not disclosed in any archived filing.
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion.Root>
  );
}

export function SingleExpansion() {
  return (
    <Accordion.Root defaultValue={["coverage"]}>
      <Accordion.Item value="coverage">
        <Accordion.Header>
          <Accordion.Trigger>Filing coverage</Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Panel>
          Four annual reports and six interim statements are archived locally
          for this issuer.
        </Accordion.Panel>
      </Accordion.Item>
      <Accordion.Item value="method">
        <Accordion.Header>
          <Accordion.Trigger>How this screen was built</Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Panel>
          Opening one section closes the other when the root is left in its
          single-expansion default.
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion.Root>
  );
}

export function AllCollapsed() {
  return (
    <Accordion.Root>
      <Accordion.Item value="thesis">
        <Accordion.Header>
          <Accordion.Trigger>Thesis</Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Panel>
          Kestrel Logistics has renewed two thirds of its fleet since FY 2026.
        </Accordion.Panel>
      </Accordion.Item>
      <Accordion.Item value="evidence">
        <Accordion.Header>
          <Accordion.Trigger>Evidence</Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Panel>
          Fleet impairment note of 12 December 2028.
        </Accordion.Panel>
      </Accordion.Item>
      <Accordion.Item value="valuation">
        <Accordion.Header>
          <Accordion.Trigger>Valuation</Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Panel>
          9.1× EV / EBIT on FY 2028 reported figures.
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion.Root>
  );
}

export function DisabledSection() {
  return (
    <Accordion.Root defaultValue={["current"]} multiple>
      <Accordion.Item value="current">
        <Accordion.Header>
          <Accordion.Trigger>FY 2028 coverage</Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Panel>
          The annual report and all three interim statements are archived.
        </Accordion.Panel>
      </Accordion.Item>
      <Accordion.Item disabled value="history">
        <Accordion.Header>
          <Accordion.Trigger>Pre-2028 history (not archived)</Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Panel>
          Nothing to show.
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion.Root>
  );
}
