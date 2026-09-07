import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Field, Input, InputGroup, Label, Textarea } from "../src/forms/field";
import { OTPField } from "../src/forms/otp-field";

describe("forms", () => {
  it.each([
    ["sm", "min-h-8"],
    ["md", "min-h-control"],
    ["lg", "min-h-12"],
  ] as const)("renders the %s text-control size", (size, className) => {
    const html = renderToStaticMarkup(
      <Input aria-label={`${size} input`} size={size} />,
    );
    expect(html).toContain(className);
  });

  it("keeps a visible Base UI field label, help, and app-owned error", () => {
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
    expect(html).toContain('type="email"');
    expect(html).toContain("text-error");
  });

  it("preserves native label, textarea, and disabled input behavior", () => {
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

  it("presents one semantic focus/error boundary around input adornments", () => {
    const html = renderToStaticMarkup(
      <InputGroup end="EUR" invalid start="€">
        <Input aria-label="Position value" inputMode="decimal" />
      </InputGroup>,
    );

    expect(html).toContain('data-invalid=""');
    expect(html).toContain("Position value");
    expect(html).toContain("EUR");
    expect(html).toContain("focus-within:outline");
    expect(html).toContain("focus-within:border-border-strong");
    expect(html).not.toContain("signal");
  });

  it("assembles Base UI OTP slots with persistent labelling and native states", () => {
    const html = renderToStaticMarkup(
      <OTPField
        defaultValue="12"
        description="Enter the six-digit sign-in code."
        label="Verification code"
        length={6}
        name="code"
        required
      />,
    );

    expect(html).toContain("Verification code");
    expect(html).toContain("Enter the six-digit sign-in code.");
    expect(html).toContain('name="code"');
    expect(html).toContain('aria-label="Character 2 of 6"');
    expect(html).toContain('aria-label="Character 6 of 6"');
    expect(html).not.toContain('aria-label="Character 1 of 6"');
    expect(html.match(/aria-label="Character [2-6] of 6"/g)).toHaveLength(5);
    expect(html.match(/size-11 rounded-control/g)).toHaveLength(6);
    const firstSlotId = html.match(/<label[^>]*for="([^"]+)"/)?.[1];
    expect(firstSlotId).toBeTruthy();
    expect(html).toContain(`id="${firstSlotId}" type="text"`);
    expect(html.match(/<input/g)).toHaveLength(7);
    expect(html).toContain('autoComplete="one-time-code"');
    expect(html).toContain("focus-visible:border-border-strong");
    expect(html).not.toContain("signal");
  });

  it("rejects invalid OTP shape configuration without owning code validation", () => {
    expect(() =>
      renderToStaticMarkup(<OTPField label="Code" length={0} />),
    ).toThrow("OTPField length must be a positive integer");
  });
});
