"use client";

import { Field as BaseField } from "@base-ui/react/field";
import { Input as BaseInput } from "@base-ui/react/input";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithRef, ReactNode, Ref } from "react";

const controlClasses = cva(
  "py-field-control w-full rounded-[var(--py-radius-interactive)] border border-[var(--py-border-default)] bg-[var(--py-surface-raised)] px-3 text-[var(--py-text-primary)] placeholder:text-[var(--py-text-disabled)] transition-colors duration-[var(--py-motion-fast)] hover:border-[var(--py-border-strong)] focus-visible:border-[var(--py-border-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--py-focus-ring)] aria-invalid:border-[var(--py-status-error-border)] aria-invalid:bg-[var(--py-status-error-surface)]",
  {
    variants: {
      size: {
        sm: "min-h-8 text-xs",
        md: "min-h-[var(--py-profile-control-height)] text-sm",
        lg: "min-h-12 text-base",
      },
    },
    defaultVariants: { size: "md" },
  },
);

/** Density choices for text-entry controls. */
export type FieldControlSize = NonNullable<
  VariantProps<typeof controlClasses>["size"]
>;

/** Props for a one-line Base UI text input. */
export interface InputProps
  extends Omit<BaseInput.Props, "className" | "size"> {
  className?: string;
  /** Application-owned invalid presentation; no validation is performed. */
  invalid?: boolean;
  ref?: Ref<HTMLInputElement>;
  size?: FieldControlSize;
}

/**
 * One-line text input for labelled fields and input groups.
 *
 * It supports three sizes plus native value, placeholder, required, readonly,
 * disabled, and application-owned invalid presentation. Semantic surfaces and
 * focus/error tokens adapt across Public/Product and light/dark; Base UI keeps
 * native text-entry and Field association behavior. Do pair it with a visible
 * Label/Field; don't place validation or submission logic in this component.
 */
export function Input({
  className,
  invalid = false,
  size,
  ...props
}: InputProps) {
  return (
    <BaseInput
      {...props}
      aria-invalid={invalid || undefined}
      className={controlClasses({ className, size })}
    />
  );
}

/** Props for a native multiline text-entry control. */
export interface TextareaProps
  extends Omit<ComponentPropsWithRef<"textarea">, "className"> {
  className?: string;
  /** Application-owned invalid presentation; no validation is performed. */
  invalid?: boolean;
  size?: FieldControlSize;
}

/**
 * Native multiline input for persistent-label fields.
 *
 * It supports three density sizes, resize, disabled/readonly/required, and
 * application-owned invalid state. Semantic tokens cover both profiles and
 * themes; the browser retains native selection, editing, and keyboard
 * behavior. Do provide a visible label; don't use it as a rich-text editor.
 */
export function Textarea({
  className,
  invalid = false,
  rows = 4,
  size,
  ...props
}: TextareaProps) {
  return (
    <textarea
      {...props}
      aria-invalid={invalid || undefined}
      className={controlClasses({
        className: `resize-y py-2 leading-[var(--py-line-height-ui)] ${className ?? ""}`,
        size,
      })}
      rows={rows}
    />
  );
}

/** Props for a persistent native form label. */
export interface LabelProps
  extends Omit<ComponentPropsWithRef<"label">, "children" | "htmlFor"> {
  children: ReactNode;
  /** Native id of the labelled form control. */
  htmlFor: string;
}

/**
 * Persistent visible label for an explicitly associated native form control.
 *
 * It uses shared type and disabled-compatible color tokens in every profile and
 * theme; native label clicking transfers focus to the `htmlFor` control. Do
 * associate it with a stable application/control id; don't replace it with a
 * placeholder.
 */
export function Label({ children, className, htmlFor, ...props }: LabelProps) {
  return (
    <label
      {...props}
      className={`text-sm font-semibold leading-[var(--py-line-height-ui)] text-[var(--py-text-primary)] ${className ?? ""}`}
      htmlFor={htmlFor}
    >
      {children}
    </label>
  );
}

/** Props for a Base UI field presentation wrapper. */
export interface FieldProps
  extends Omit<
    BaseField.Root.Props,
    | "actionsRef"
    | "children"
    | "className"
    | "validate"
    | "validationDebounceTime"
    | "validationMode"
  > {
  children: ReactNode;
  className?: string;
  description?: ReactNode;
  /** Application-owned error content; Field never decides validity. */
  error?: ReactNode;
  /** Persistent visible label associated by Base UI with the child control. */
  label: ReactNode;
  ref?: Ref<HTMLDivElement>;
}

/**
 * Label, description, control, and error presentation for one form field.
 *
 * `invalid`, disabled, dirty, and touched presentation may be supplied by the
 * application; `label` always remains visible. Semantic tokens cover both
 * profiles/themes, while Base UI associates descriptions/errors and native
 * focus behavior. Do let the application own validation and form state; don't
 * pass workflow, submission, or asynchronous validation logic into Field.
 */
export function Field({
  children,
  className,
  description,
  error,
  label,
  ...props
}: FieldProps) {
  return (
    <BaseField.Root
      {...props}
      className={`py-field grid gap-1.5 text-[var(--py-text-primary)] ${className ?? ""}`}
    >
      <BaseField.Label className="text-sm font-semibold leading-[var(--py-line-height-ui)]">
        {label}
      </BaseField.Label>
      {description ? (
        <BaseField.Description className="m-0 text-xs leading-[var(--py-line-height-ui)] text-[var(--py-text-secondary)]">
          {description}
        </BaseField.Description>
      ) : null}
      {children}
      {error ? (
        <BaseField.Error
          className="text-xs font-medium leading-[var(--py-line-height-ui)] text-[var(--py-status-error-foreground)]"
          match
        >
          {error}
        </BaseField.Error>
      ) : null}
    </BaseField.Root>
  );
}

/** Props for a text control with leading or trailing presentational content. */
export interface InputGroupProps extends ComponentPropsWithRef<"div"> {
  /** Application-owned invalid presentation shared by the group border. */
  invalid?: boolean;
  /** Prefix text or decorative icon; keep the field's visible Label external. */
  start?: ReactNode;
  /** Suffix text, unit, or decorative icon. */
  end?: ReactNode;
}

/**
 * Shared border and focus treatment for an input with a prefix or suffix.
 *
 * It supports start/end content plus application-owned invalid and child
 * disabled states. Semantic tokens adapt the group across profiles/themes;
 * the nested native/Base UI input keeps focus and editing behavior. Do keep a
 * persistent Label outside the group; don't turn adornments into hidden state.
 */
export function InputGroup({
  children,
  className,
  end,
  invalid = false,
  start,
  ...props
}: InputGroupProps) {
  return (
    <div
      {...props}
      className={`flex min-h-[var(--py-profile-control-height)] items-stretch overflow-hidden rounded-[var(--py-radius-interactive)] border border-[var(--py-border-default)] bg-[var(--py-surface-raised)] text-[var(--py-text-secondary)] focus-within:border-[var(--py-border-strong)] focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--py-focus-ring)] data-[invalid]:border-[var(--py-status-error-border)] [&_input]:min-h-full [&_input]:rounded-none [&_input]:border-0 [&_input]:outline-none ${className ?? ""}`}
      data-invalid={invalid ? "" : undefined}
    >
      {start ? (
        <span className="inline-flex items-center border-r border-[var(--py-border-default)] px-3 text-sm">
          {start}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 items-stretch">{children}</span>
      {end ? (
        <span className="inline-flex items-center border-l border-[var(--py-border-default)] px-3 text-sm">
          {end}
        </span>
      ) : null}
    </div>
  );
}
