"use client";

import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxPortal,
  ComboboxPositioner,
  ComboboxTrigger,
  Input,
  Select,
  SelectItem,
  SelectList,
  SelectPopup,
  SelectPortal,
  SelectPositioner,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  Toggle,
  ToggleGroup,
} from "@pythia/ui";
import { type ReactNode, useState } from "react";
import { CredentialField } from "./credential-field";
import { optionLabel } from "./field-copy";
import type { FieldSchema, FieldSource } from "./fields";
import { ListRow } from "./primitives";

const EMPTY = "__default__";

/** A path or identifier to read, not edit. */
export function Code({ value }: { value: string }) {
  return (
    <code
      title={value}
      className="wrap-anywhere block rounded-control bg-subtle px-2 py-1 text-foreground text-xs leading-ui"
    >
      {value}
    </code>
  );
}

function Choice({
  label,
  field,
  value,
  onChange,
}: {
  label: string;
  field: FieldSchema;
  value: string;
  onChange: (value: string) => void;
}) {
  const options = [...(field.options ?? [])];
  if (value && !options.includes(value)) options.push(value);
  const name = (option: string) =>
    field.optionLabels?.[option] ?? optionLabel(option);
  if (field.searchable) {
    const items = options.filter(Boolean);
    return (
      <Combobox
        items={items}
        value={value || null}
        onValueChange={(next) => onChange(typeof next === "string" ? next : "")}
      >
        <ComboboxInputGroup className="w-full">
          <ComboboxInput
            aria-label={label}
            placeholder={field.clearable ? "Default" : "Search…"}
          />
          <ComboboxTrigger />
        </ComboboxInputGroup>
        <ComboboxPortal>
          <ComboboxPositioner className="z-70">
            <ComboboxPopup>
              <ComboboxEmpty>No matches.</ComboboxEmpty>
              <ComboboxList>
                {(item: string) => (
                  <ComboboxItem key={item} value={item}>
                    {item}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxPopup>
          </ComboboxPositioner>
        </ComboboxPortal>
      </Combobox>
    );
  }
  return (
    <Select
      value={value || EMPTY}
      onValueChange={(next) =>
        onChange(typeof next === "string" && next !== EMPTY ? next : "")
      }
    >
      <SelectTrigger aria-label={label} className="w-full">
        <SelectValue>
          {(current: string) => name(current === EMPTY ? "" : current)}
        </SelectValue>
      </SelectTrigger>
      <SelectPortal>
        <SelectPositioner align="end" className="z-70">
          <SelectPopup>
            <SelectList>
              {options.map((option) => (
                <SelectItem key={option || EMPTY} value={option || EMPTY}>
                  {name(option)}
                </SelectItem>
              ))}
            </SelectList>
          </SelectPopup>
        </SelectPositioner>
      </SelectPortal>
    </Select>
  );
}

/** A comma-separated list that keeps what is being typed until it settles. */
function ListInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange: (value: string[]) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Input
      aria-label={label}
      size="sm"
      placeholder="Comma-separated"
      value={
        draft ?? (Array.isArray(value) ? value.join(", ") : String(value ?? ""))
      }
      onChange={(event) => {
        setDraft(event.target.value);
        onChange(
          event.target.value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
        );
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

/**
 * The control a setting's type calls for, and whether it needs the full
 * width under its label.
 */
export function fieldControl(
  id: string,
  field: FieldSchema,
  source: FieldSource,
): [ReactNode, boolean] {
  const value = source.values[id];
  const change = (next: unknown) => source.change(id, next);
  switch (field.type) {
    case "boolean":
      return [
        <Switch
          key={id}
          aria-label={field.label}
          checked={Boolean(value)}
          onCheckedChange={change}
        />,
        false,
      ];
    case "path":
      return [
        typeof value === "string" && value ? <Code value={value} /> : null,
        false,
      ];
    case "credential": {
      const credential = source.credential;
      return [
        credential ? (
          <CredentialField
            label={field.label}
            state={credential.state(id)}
            secret={field.secret === true}
            placeholder={field.placeholder}
            pending={credential.pending}
            onSave={(next) => credential.save(id, next)}
          />
        ) : null,
        false,
      ];
    }
    case "number":
      return [
        <Input
          key={id}
          aria-label={field.label}
          size="sm"
          type="number"
          placeholder="Not set"
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(event) => {
            const raw = event.target.value;
            const number = raw === "" ? 0 : Number(raw);
            if (!Number.isNaN(number)) change(number);
          }}
        />,
        false,
      ];
    case "list":
      return [
        <ListInput
          key={id}
          label={field.label}
          value={value}
          onChange={change}
        />,
        false,
      ];
    default:
      break;
  }
  if (field.segmented && field.options?.length)
    return [
      <ToggleGroup<string>
        key={id}
        label={field.label}
        className="gap-0.5 rounded-control p-0.5"
        value={[String(value ?? "")]}
        onValueChange={(next) => next[0] !== undefined && change(next[0])}
      >
        {field.options.map((option) => (
          <Toggle<string>
            key={option}
            value={option}
            appearance="ghost"
            size="sm"
            className="h-7 px-2.5 font-normal text-body data-pressed:border-border data-pressed:bg-raised"
            label={field.optionLabels?.[option] ?? optionLabel(option)}
          />
        ))}
      </ToggleGroup>,
      false,
    ];
  if (field.options?.length)
    return [
      <Choice
        key={id}
        label={field.label}
        field={field}
        value={String(value ?? "")}
        onChange={change}
      />,
      false,
    ];
  const long = field.type === "text" || String(value ?? "").length > 100;
  return [
    long ? (
      <Textarea
        aria-label={field.label}
        size="sm"
        className="min-h-24 resize-y"
        value={String(value ?? "")}
        onChange={(event) => change(event.target.value)}
      />
    ) : (
      <Input
        aria-label={field.label}
        size="sm"
        placeholder={field.placeholder ?? "Not set"}
        value={String(value ?? "")}
        onChange={(event) => change(event.target.value)}
      />
    ),
    long,
  ];
}

/**
 * One setting as a row: its label and description, and the control its type
 * calls for. Hermes and Pythia settings both render here, after Hermes
 * Desktop's ConfigField (apps/desktop/src/app/settings/config-field.tsx,
 * MIT).
 */
export function ConfigField({
  id,
  field,
  source,
  control,
}: {
  id: string;
  field: FieldSchema;
  source: FieldSource;
  /** A control of the page's own, for a value no generic control fits. */
  control?: ReactNode;
}) {
  const [action, wide] = control
    ? [control, true]
    : fieldControl(id, field, source);
  if (action === null && field.type === "credential") return null;
  return (
    <ListRow
      id={`setting-${id}`}
      title={field.label}
      description={field.description}
      action={action}
      wide={wide}
      inline={field.type === "boolean" && !control}
      below={
        source.errors?.[id] ? (
          <p role="alert" className="m-0 mt-1 text-error text-xs">
            {source.errors[id]}
          </p>
        ) : null
      }
    />
  );
}
