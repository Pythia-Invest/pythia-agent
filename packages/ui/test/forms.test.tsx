import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Field, Input } from "../src/forms/field";
import { OTPField } from "../src/forms/otp-field";

describe("form semantics", () => {
  it("associates the visible label and shows help and the app-owned error", () => {
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
    const labelFor = html.match(/<label[^>]* for="([^"]+)"/u)?.[1];
    expect(labelFor).toBeTruthy();
    expect(html).toMatch(new RegExp(`<input[^>]* id="${labelFor}"`, "u"));
    expect(html).toContain("Email address");
    expect(html).toContain("Used for research alerts.");
    expect(html).toContain("Enter a valid address.");
    expect(html).toContain('aria-invalid="true"');
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
