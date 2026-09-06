import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Field, Input, Label, Textarea } from "../src/forms/field";
import { OTPField } from "../src/forms/otp-field";

describe("form semantics", () => {
  it("associates a visible label, help, and app-owned error", () => {
    const html = renderToStaticMarkup(
      <Field
        description="Used for research alerts."
        error="Enter a valid address."
        invalid
        label="Email address"
      >
        <Input defaultValue="analyst@example.com" type="email" />
      </Field>,
    );
    expect(html).toContain("Email address");
    expect(html).toContain("Used for research alerts.");
    expect(html).toContain("Enter a valid address.");
    expect(html).toContain('aria-invalid="true"');
  });

  it("preserves native label, textarea, and disabled-input behavior", () => {
    const html = renderToStaticMarkup(
      <>
        <Label htmlFor="investment-note">Investment note</Label>
        <Textarea id="investment-note" readOnly value="Durable margin thesis" />
        <Input disabled name="ticker" value="PYTH" />
      </>,
    );
    expect(html).toContain('for="investment-note"');
    expect(html).toContain("<textarea");
    expect(html).toContain("readOnly");
    expect(html).toContain('name="ticker"');
    expect(html).toContain("disabled");
  });

  it("labels OTP input slots and rejects impossible lengths", () => {
    const html = renderToStaticMarkup(
      <OTPField
        defaultValue="12"
        label="Verification code"
        length={6}
        name="code"
      />,
    );
    expect(html).toContain("Verification code");
    expect(html).toContain('name="code"');
    expect(html).toContain('aria-label="Character 6 of 6"');
    expect(() =>
      renderToStaticMarkup(<OTPField label="Code" length={0} />),
    ).toThrow("OTPField length must be a positive integer");
  });
});
