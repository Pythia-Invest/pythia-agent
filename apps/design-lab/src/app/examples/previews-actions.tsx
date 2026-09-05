"use client";

import {
  Button,
  ButtonGroup,
  IconButton,
  LinkButton,
  Toggle,
  ToggleGroup,
} from "@pythia/ui";
import { Bookmark, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { CatalogRoute } from "../../catalog";
import { DemoNote, Specimen, SpecimenGrid } from "./specimen";

export function ActionsPreview({ route }: { route: CatalogRoute }) {
  const [message, setMessage] = useState("No synthetic action yet.");

  switch (route) {
    case "/components/button":
      return (
        <SpecimenGrid>
          <Specimen label="Action hierarchy">
            <div className="catalog-row">
              <Button
                onClick={() =>
                  setMessage("Primary synthetic action activated.")
                }
              >
                Primary
              </Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Danger</Button>
            </div>
            <DemoNote>{message}</DemoNote>
          </Specimen>
          <Specimen label="Sizes and states">
            <div className="catalog-row">
              <Button size="sm">Small</Button>
              <Button size="md">Medium</Button>
              <Button size="lg">Large</Button>
              <Button disabled>Disabled</Button>
              <Button loading>Loading report</Button>
            </div>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/icon-button":
      return (
        <SpecimenGrid>
          <Specimen label="Familiar compact actions">
            <div className="catalog-row">
              <IconButton
                label="Add synthetic item"
                onClick={() => setMessage("Synthetic item added.")}
              >
                <Plus aria-hidden="true" />
              </IconButton>
              <IconButton label="Bookmark synthetic item" variant="secondary">
                <Bookmark aria-hidden="true" />
              </IconButton>
              <IconButton disabled label="Remove unavailable synthetic item">
                <Trash2 aria-hidden="true" />
              </IconButton>
            </div>
            <DemoNote>{message}</DemoNote>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/button-group":
      return (
        <SpecimenGrid>
          <Specimen label="Related actions">
            <ButtonGroup label="Synthetic export actions">
              <Button size="sm" variant="secondary">
                Preview
              </Button>
              <Button size="sm" variant="secondary">
                Duplicate
              </Button>
              <Button size="sm" variant="secondary">
                Archive
              </Button>
            </ButtonGroup>
          </Specimen>
          <Specimen label="Vertical group">
            <ButtonGroup label="Synthetic view actions" orientation="vertical">
              <Button variant="secondary">Summary</Button>
              <Button variant="secondary">Evidence</Button>
              <Button variant="secondary">Notes</Button>
            </ButtonGroup>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/link-button":
      return (
        <SpecimenGrid>
          <Specimen label="Navigation emphasis">
            <div className="catalog-row" id="synthetic-link-target">
              <LinkButton href="#synthetic-link-target">
                Jump to specimen
              </LinkButton>
              <LinkButton href="/foundation" variant="secondary">
                Foundation surface
              </LinkButton>
            </div>
            <DemoNote>
              These are native anchors with safe, local destinations.
            </DemoNote>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/toggle":
      return (
        <SpecimenGrid>
          <Specimen label="Independent pressed states">
            <div className="catalog-row">
              <Toggle defaultPressed label="Show synthetic notes" />
              <Toggle appearance="ghost" label="Compact labels" />
              <Toggle disabled label="Unavailable view" />
            </div>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/toggle-group":
      return (
        <SpecimenGrid>
          <Specimen label="Native grouped selection">
            <ToggleGroup
              defaultValue={["summary"]}
              label="Synthetic reading mode"
            >
              <Toggle label="Summary" value="summary" />
              <Toggle label="Evidence" value="evidence" />
              <Toggle label="Notes" value="notes" />
            </ToggleGroup>
          </Specimen>
          <Specimen label="Multiple choices">
            <ToggleGroup
              defaultValue={["labels"]}
              label="Visible synthetic layers"
              multiple
            >
              <Toggle label="Labels" value="labels" />
              <Toggle label="Dates" value="dates" />
              <Toggle label="Sources" value="sources" />
            </ToggleGroup>
          </Specimen>
        </SpecimenGrid>
      );
    default:
      throw new Error(`Missing curated actions preview: ${route}`);
  }
}
