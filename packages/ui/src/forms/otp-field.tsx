"use client";

import { Field as BaseField } from "@base-ui/react/field";
import { OTPField as BaseOTPField } from "@base-ui/react/otp-field";
import type { ReactNode, Ref } from "react";
import { cn } from "../class-name";
import { fieldClasses } from "./field";

/** Props for the complete Base UI one-time-password field pattern. */
export interface OTPFieldProps
  extends Omit<
    BaseOTPField.Root.Props,
    "autoSubmit" | "children" | "className" | "length"
  > {
  className?: string;
  description?: ReactNode;
  /** Application-owned error content; OTPField never decides validity. */
  error?: ReactNode;
  /** Application-owned invalid presentation; no verification is performed. */
  invalid?: boolean;
  /** Number of native character slots. Must be a positive integer. */
  length: number;
  /** Persistent visible label for the whole code. */
  label: ReactNode;
  ref?: Ref<HTMLDivElement>;
}

/**
 * Persistent-label one-time-password entry assembled from Base UI OTP parts.
 *
 * It supports controlled/uncontrolled value, numeric/alphanumeric validation
 * mode, masking, required, readonly, disabled, complete, and invalid
 * presentation. Semantic tokens adapt slots across profiles/themes; Base UI
 * associates the persistent label with the first slot while later slots have
 * positional names. It owns paste, autofill, slot focus, arrow/Home/End,
 * deletion, and form-native value behavior. Do let the application own
 * verification and submission; don't add custom slot or keyboard state.
 */
export function OTPField({
  className,
  description,
  error,
  invalid = false,
  label,
  length,
  ...props
}: OTPFieldProps) {
  if (!Number.isInteger(length) || length < 1) {
    throw new RangeError("OTPField length must be a positive integer");
  }

  return (
    <BaseField.Root
      className={cn(fieldClasses.root, className)}
      data-slot="otp-field"
      disabled={props.disabled}
      invalid={invalid}
      name={props.name}
    >
      <BaseField.Label className={fieldClasses.label}>{label}</BaseField.Label>
      {description ? (
        <BaseField.Description className={fieldClasses.description}>
          {description}
        </BaseField.Description>
      ) : null}
      <BaseOTPField.Root
        {...props}
        className="flex flex-wrap gap-2"
        length={length}
      >
        {Array.from({ length }, (_, index) => (
          <BaseOTPField.Input
            // Base UI associates the first slot with Field.Label; later slots need positional names.
            aria-label={
              index === 0 ? undefined : `Character ${index + 1} of ${length}`
            }
            className="numeric size-11 rounded-control border border-border bg-raised text-center font-semibold text-foreground text-lg caret-ring focus-visible:border-border-strong disabled:cursor-not-allowed disabled:opacity-disabled aria-invalid:border-error-border aria-invalid:bg-error-surface group-data-disabled:disabled:opacity-100"
            // biome-ignore lint/suspicious/noArrayIndexKey: each fixed OTP slot's position is its identity.
            key={index}
          />
        ))}
      </BaseOTPField.Root>
      {error ? (
        <BaseField.Error className={fieldClasses.error} match>
          {error}
        </BaseField.Error>
      ) : null}
    </BaseField.Root>
  );
}
