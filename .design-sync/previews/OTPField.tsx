import { OTPField } from "@pythia/ui";

export function Empty() {
  return (
    <OTPField
      description="Enter the 6-digit code from your authenticator app."
      label="Verification code"
      length={6}
      name="verification-code"
      validationType="numeric"
    />
  );
}

export function PartiallyFilled() {
  return (
    <OTPField
      defaultValue="4207"
      description="Enter the 6-digit code from your authenticator app."
      label="Verification code"
      length={6}
      name="verification-code"
      validationType="numeric"
    />
  );
}

export function Invalid() {
  return (
    <OTPField
      defaultValue="420719"
      error="That code has expired. Request a new one."
      invalid
      label="Verification code"
      length={6}
      name="verification-code"
      validationType="numeric"
    />
  );
}

export function Masked() {
  return (
    <OTPField
      defaultValue="8134"
      description="Masked while you unlock the local research vault."
      label="Vault passcode"
      length={4}
      mask
      name="vault-passcode"
      validationType="numeric"
    />
  );
}

export function Disabled() {
  return (
    <OTPField
      defaultValue="610942"
      description="Submitted. Entry is locked while the code is verified."
      disabled
      label="Verification code"
      length={6}
      name="verification-code"
      validationType="numeric"
    />
  );
}
