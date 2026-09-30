"use client";

import {
  AlertDialog,
  Button,
  IconButton,
  Select,
  SelectItem,
  SelectList,
  SelectPopup,
  SelectPortal,
  SelectPositioner,
  SelectTrigger,
  SelectValue,
} from "@pythia/ui";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useSetMainModel } from "@/client/hermes-settings-queries";
import { useModelOptions } from "@/client/queries";
import type { ModelProvider } from "@/server/model-catalog";
import { HermesFieldsPage } from "./config-page";
import type { FieldSource } from "./fields";
import { ListRow } from "./primitives";

function Picker({
  label,
  value,
  options,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string; disabled?: boolean }[];
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const current = options.find((option) => option.value === value);
  return (
    <Select
      value={value || null}
      onValueChange={(next) => typeof next === "string" && onChange(next)}
    >
      <SelectTrigger aria-label={label} className="w-full min-w-0">
        <SelectValue>
          {() => current?.label ?? (value || placeholder)}
        </SelectValue>
      </SelectTrigger>
      <SelectPortal>
        <SelectPositioner align="start" className="z-70">
          <SelectPopup>
            <SelectList>
              {options.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectList>
          </SelectPopup>
        </SelectPositioner>
      </SelectPortal>
    </Select>
  );
}

/** Providers Hermes can use first; the rest are listed but need setting up. */
function providerOptions(providers: readonly ModelProvider[]) {
  return [...providers]
    .sort(
      (a, b) =>
        Number(b.authenticated) - Number(a.authenticated) ||
        a.name.localeCompare(b.name),
    )
    .map((provider) => ({
      value: provider.slug,
      label: provider.authenticated
        ? provider.name
        : `${provider.name} (not set up)`,
    }));
}

function modelOptions(provider: ModelProvider | undefined) {
  return (provider?.models ?? []).map((model) => ({
    value: model.id,
    label: model.id,
    disabled: model.unavailable,
  }));
}

/** Provider, then model, then Apply: the default for new chats. */
function DefaultModel({
  current,
}: {
  current: { provider: string; model: string };
}) {
  const catalog = useModelOptions();
  const set = useSetMainModel();
  const providers = catalog.data?.providers ?? [];
  const [choice, setChoice] = useState<{
    provider: string;
    model: string;
  } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const selected = choice ?? {
    provider: current.provider || catalog.data?.provider || "",
    model: current.model || catalog.data?.model || "",
  };
  const provider = providers.find((item) => item.slug === selected.provider);
  const changed =
    choice !== null &&
    Boolean(choice.model) &&
    (choice.provider !== current.provider || choice.model !== current.model);
  const apply = (confirmed = false) =>
    set.mutate(
      { ...selected, confirm: confirmed },
      {
        onSuccess: (result) => {
          if (result.confirm) setConfirm(result.confirm);
          else if (result.ok) setChoice(null);
        },
      },
    );
  return (
    <>
      <ListRow
        wide
        title="Default model"
        description="Used for new chats. Pick a different model for one chat in the composer."
        action={
          <div className="grid @xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] gap-2">
            <Picker
              label="Provider"
              placeholder={
                catalog.isPending ? "Loading providers…" : "Provider"
              }
              value={selected.provider}
              options={providerOptions(providers)}
              onChange={(slug) => setChoice({ provider: slug, model: "" })}
            />
            <Picker
              label="Model"
              placeholder="Model"
              value={selected.model}
              options={modelOptions(provider)}
              onChange={(model) => setChoice({ ...selected, model })}
            />
            <Button
              size="sm"
              className="h-control"
              disabled={!changed}
              loading={set.isPending}
              onClick={() => apply()}
            >
              Apply
            </Button>
          </div>
        }
        below={
          set.error ? (
            <p className="m-0 mt-1 text-error text-xs">{set.error.message}</p>
          ) : provider && !provider.authenticated ? (
            <p className="m-0 mt-1 text-foreground-secondary text-xs">
              Set up {provider.name} under Providers before using it.
            </p>
          ) : null
        }
      />
      <AlertDialog.Root
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
      >
        <AlertDialog.Portal>
          <AlertDialog.Backdrop forceRender />
          <AlertDialog.Viewport>
            <AlertDialog.Popup className="grid w-[min(26rem,100%)] gap-4">
              <div className="grid gap-1">
                <AlertDialog.Title>Use this model?</AlertDialog.Title>
                <AlertDialog.Description>{confirm}</AlertDialog.Description>
              </div>
              <div className="flex justify-end gap-2">
                <AlertDialog.Close
                  render={
                    <Button variant="ghost" size="sm" type="button">
                      Cancel
                    </Button>
                  }
                />
                <Button
                  size="sm"
                  onClick={() => {
                    setConfirm(null);
                    apply(true);
                  }}
                >
                  Use it
                </Button>
              </div>
            </AlertDialog.Popup>
          </AlertDialog.Viewport>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}

export function MainModelPage({
  source,
  current,
}: {
  source: FieldSource;
  current: { provider: string; model: string };
}) {
  return (
    <>
      <DefaultModel current={current} />
      <HermesFieldsPage pageId="model/main" source={source} />
    </>
  );
}

/** An entry keeps every field Hermes stored (endpoint, key reference, mode),
 * so saving the list never strips the others; the server restores secrets. */
type Fallback = { provider: string; model: string } & Record<string, unknown>;

const fallbacks = (value: unknown): Fallback[] =>
  Array.isArray(value)
    ? value.flatMap((item) =>
        item &&
        typeof item === "object" &&
        "provider" in item &&
        "model" in item
          ? [
              {
                ...(item as Record<string, unknown>),
                provider: String(item.provider),
                model: String(item.model),
              },
            ]
          : [],
      )
    : [];

/** Backup provider and model pairs, tried in order when the default fails. */
export function FallbackModels({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: Fallback[]) => void;
}) {
  const catalog = useModelOptions();
  const providers = catalog.data?.providers ?? [];
  const list = fallbacks(value);
  const [adding, setAdding] = useState<Fallback | null>(null);
  const provider = providers.find((item) => item.slug === adding?.provider);
  return (
    <div className="grid gap-2" data-slot="fallback-models">
      {list.length ? (
        <ol className="m-0 grid list-none gap-1 p-0">
          {list.map((item, index) => (
            <li
              key={`${item.provider}/${item.model}`}
              className="flex items-center gap-2 rounded-control border border-border px-3 py-1.5 text-body"
            >
              <span className="w-5 flex-none text-foreground-disabled text-xs tabular-nums">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate">
                <span className="text-foreground-secondary">
                  {item.provider}
                </span>{" "}
                {item.model}
              </span>
              <IconButton
                size="sm"
                label={`Remove ${item.model}`}
                onClick={() => onChange(list.filter((_, at) => at !== index))}
              >
                <Trash2 className="stroke-[1.6]" />
              </IconButton>
            </li>
          ))}
        </ol>
      ) : (
        <p className="m-0 text-foreground-secondary text-xs">
          No fallbacks. If the default model fails, the chat stops.
        </p>
      )}
      {adding ? (
        <div className="grid @xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto_auto] gap-2">
          <Picker
            label="Fallback provider"
            placeholder="Provider"
            value={adding.provider}
            options={providerOptions(providers)}
            onChange={(slug) => setAdding({ provider: slug, model: "" })}
          />
          <Picker
            label="Fallback model"
            placeholder="Model"
            value={adding.model}
            options={modelOptions(provider)}
            onChange={(model) => setAdding({ ...adding, model })}
          />
          <Button
            size="sm"
            className="h-control"
            disabled={!adding.model}
            onClick={() => {
              onChange([...list, adding]);
              setAdding(null);
            }}
          >
            Add
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-control"
            onClick={() => setAdding(null)}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          className="justify-self-start"
          onClick={() => setAdding({ provider: "", model: "" })}
        >
          <Plus aria-hidden="true" className="size-3.5" /> Add fallback
        </Button>
      )}
    </div>
  );
}
