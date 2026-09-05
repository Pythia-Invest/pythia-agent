"use client";

import {
  Field,
  Input,
  InputGroup,
  Label,
  OTPField,
  Textarea,
} from "@pythia/ui";
import { useState } from "react";
import type { CatalogRoute } from "../../catalog";
import { DemoNote, Specimen, SpecimenGrid } from "./specimen";

export function FormsPreview({ route }: { route: CatalogRoute }) {
  const [otp, setOtp] = useState("");

  switch (route) {
    case "/components/input":
      return (
        <SpecimenGrid>
          <Specimen label="Editable input states">
            <div className="catalog-field-list">
              <Label htmlFor="demo-input">Synthetic company label</Label>
              <Input
                defaultValue="Northstar Materials (synthetic)"
                id="demo-input"
              />
              <Input
                aria-label="Empty synthetic input"
                placeholder="Enter a synthetic label"
              />
              <Input
                aria-label="Invalid synthetic input"
                defaultValue="Needs review"
                invalid
              />
              <Input
                aria-label="Disabled synthetic input"
                disabled
                value="Unavailable"
                readOnly
              />
            </div>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/textarea":
      return (
        <SpecimenGrid>
          <Specimen label="Multiline editing">
            <div className="catalog-field-list">
              <Label htmlFor="demo-textarea">Synthetic analyst note</Label>
              <Textarea
                defaultValue="A deliberately fictional note for component evaluation. Resize this field vertically."
                id="demo-textarea"
              />
              <Textarea
                aria-label="Invalid synthetic note"
                defaultValue="Incomplete synthetic note"
                invalid
                rows={3}
              />
            </div>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/label":
      return (
        <SpecimenGrid>
          <Specimen label="Persistent association">
            <div className="catalog-field-list">
              <Label htmlFor="label-demo">Visible synthetic label</Label>
              <Input id="label-demo" placeholder="Click the label to focus" />
              <DemoNote>
                Placeholders supplement a label; they do not replace it.
              </DemoNote>
            </div>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/field":
      return (
        <SpecimenGrid>
          <Specimen label="Description and application-owned error">
            <div className="catalog-field-list">
              <Field
                description="Stable synthetic identifier."
                label="Reference name"
              >
                <Input defaultValue="SYNTH-042" />
              </Field>
              <Field
                error="Use a labelled synthetic value."
                invalid
                label="Research label"
              >
                <Input defaultValue="" invalid />
              </Field>
            </div>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/input-group":
      return (
        <SpecimenGrid>
          <Specimen label="Prefix and suffix">
            <div className="catalog-field-list">
              <Label htmlFor="value-group">Synthetic value</Label>
              <InputGroup end="EUR" start="≈">
                <Input defaultValue="1,240" id="value-group" />
              </InputGroup>
              <Label htmlFor="ratio-group">Synthetic ratio</Label>
              <InputGroup end="×" invalid>
                <Input defaultValue="—" id="ratio-group" invalid />
              </InputGroup>
            </div>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/otp-field":
      return (
        <SpecimenGrid>
          <Specimen label="Native one-time code entry">
            <OTPField
              description="Enter or paste 6 synthetic digits. Nothing is submitted."
              length={6}
              onValueChange={(value) => setOtp(value)}
              label="Synthetic verification code"
              validationType="numeric"
              value={otp}
            />
            <DemoNote>
              {otp.length === 6
                ? "Synthetic code complete."
                : `${otp.length} of 6 characters entered.`}
            </DemoNote>
          </Specimen>
        </SpecimenGrid>
      );
    default:
      throw new Error(`Missing curated forms preview: ${route}`);
  }
}
