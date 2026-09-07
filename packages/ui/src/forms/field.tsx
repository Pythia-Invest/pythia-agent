"use client";

import { Field as BaseField } from "@base-ui/react/field";
import { Input as BaseInput } from "@base-ui/react/input";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithRef, ReactNode, Ref } from "react";
import { cn } from "../class-name";

/**
 * Shared text-entry surface. `group-data-disabled:opacity-100` keeps a disabled
 * control at full opacity inside a disabled Field, so the field fades once.
 */
export const controlClasses = cva(
  "motion-fast w-full rounded-control border border-border bg-raised px-3 text-foreground transition-colors placeholder:text-foreground-disabled hover:border-border-strong focus-visible:border-border-strong disabled:cursor-not-allowed disabled:opacity-disabled aria-invalid:border-error-border aria-invalid:bg-error-surface group-data-disabled:disabled:opacity-100",
  {
    variants: {
      size: {
        sm: "min-h-8 text-xs",
        md: "min-h-control text-sm",
        lg: "min-h-12 text-base",
      },
    },
    defaultVariants: { size: "md" },
  },
);

/** Layout and typography shared by Field, OTPField and DatePicker. */
export const fieldClasses = {
  root: "group grid gap-1.5 text-foreground data-disabled:opacity-disabled",
  label: "text-sm font-semibold leading-ui",
  description: "m-0 text-xs leading-ui text-foreground-secondary",
  error: "m-0 text-xs font-medium leading-ui text-error",
} as const;

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
      className={cn(controlClasses({ size }), className)}
      data-slot="input"
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
      className={cn(
        controlClasses({ size }),
        "resize-y py-2 leading-ui",
        className,
      )}
      data-slot="textarea"
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
      className={cn(fieldClasses.label, "text-foreground", className)}
      data-slot="label"
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
      className={cn(fieldClasses.root, className)}
      data-slot="field"
    >
      <BaseField.Label className={fieldClasses.label}>{label}</BaseField.Label>
      {description ? (
        <BaseField.Description className={fieldClasses.description}>
          {description}
        </BaseField.Description>
      ) : null}
      {children}
      {error ? (
        <BaseField.Error className={fieldClasses.error} match>
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
      className={cn(
        "flex min-h-control items-stretch overflow-hidden rounded-control border border-border bg-raised text-foreground-secondary focus-within:border-border-strong focus-within:outline-2 focus-within:outline-ring focus-within:outline-offset-2 data-invalid:border-error-border [&_input]:min-h-full [&_input]:rounded-none [&_input]:border-0 [&_input]:outline-none",
        className,
      )}
      data-invalid={invalid ? "" : undefined}
      data-slot="input-group"
    >
      {start ? (
        <span className="inline-flex items-center border-border border-r px-3 text-sm">
          {start}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 items-stretch">{children}</span>
      {end ? (
        <span className="inline-flex items-center border-border border-l px-3 text-sm">
          {end}
        </span>
      ) : null}
    </div>
  );
}
