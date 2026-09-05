"use client";

import {
  Button,
  Select,
  SelectItem,
  SelectList,
  SelectPopup,
  SelectPortal,
  SelectPositioner,
  SelectTrigger,
  SelectValue,
} from "@pythia/ui";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { DeskApi } from "@/client/api";
import {
  reasoningEfforts,
  type ModelCatalog,
  type ModelSelection,
} from "@/server/model-catalog";

type PickerState = {
  catalog: ModelCatalog | null;
  choice: ModelSelection | undefined;
  change: (choice: ModelSelection | undefined) => void;
  error: string;
  retry: () => void;
};
const Context = createContext<PickerState>({
  catalog: null,
  choice: undefined,
  change: () => {},
  error: "",
  retry: () => {},
});

// A draft choice for this open Desk, not another Hermes configuration store.
export function ModelPickerProvider({
  api,
  ready,
  children,
}: {
  api: DeskApi;
  ready: boolean;
  children: ReactNode;
}) {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [choice, change] = useState<ModelSelection>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!ready) return;
    let live = true;
    setError("");
    void api
      .modelOptions()
      .then((value) => {
        if (live) setCatalog(value);
      })
      .catch(() => {
        if (live)
          setError(
            "Model list unavailable. You can still use the Hermes default.",
          );
      });
    return () => {
      live = false;
    };
  }, [api, ready, attempt]);
  return (
    <Context.Provider
      value={{
        catalog,
        choice,
        change,
        error,
        retry: () => setAttempt((value) => value + 1),
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useModelSelection() {
  const { choice } = useContext(Context);
  return { selection: choice, incomplete: Boolean(choice && !choice.model) };
}

function PickerField({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      items={options}
      value={value}
      disabled={disabled}
      onValueChange={(value) => {
        if (value !== null) onChange(value);
      }}
    >
      <SelectTrigger aria-label={label} className="model-picker-trigger">
        <SelectValue />
      </SelectTrigger>
      <SelectPortal>
        <SelectPositioner side="top" align="start">
          <SelectPopup>
            <SelectList>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
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

export function ModelPicker({ disabled = false }: { disabled?: boolean }) {
  const { catalog, choice, change, error, retry } = useContext(Context);
  const provider = catalog?.providers.find(
    (row) => row.slug === choice?.provider,
  );
  const model = provider?.models.find((row) => row.id === choice?.model);
  return (
    <section className="model-picker" aria-label="Model selection">
      <div className="model-picker-controls">
        <PickerField
          label="Model provider"
          value={choice?.provider ?? ""}
          disabled={disabled || !catalog}
          options={[
            {
              value: "",
              label: catalog?.model
                ? `Default · ${catalog.model}`
                : "Hermes default",
            },
            ...(catalog?.providers ?? []).map((row) => ({
              value: row.slug,
              label: row.name,
            })),
          ]}
          onChange={(provider) =>
            change(
              provider
                ? {
                    provider,
                    model: provider === catalog?.provider ? catalog.model : "",
                  }
                : undefined,
            )
          }
        />
        {choice ? (
          <>
            <PickerField
              label="Model"
              value={choice.model}
              disabled={disabled || !provider?.models.length}
              options={[
                { value: "", label: "Choose model" },
                ...(provider?.models ?? []).map((row) => ({
                  value: row.id,
                  label: row.id,
                })),
              ]}
              onChange={(model) => change({ provider: choice.provider, model })}
            />
            <PickerField
              label="Reasoning effort"
              value={choice.effort ?? ""}
              disabled={disabled || !model?.reasoning}
              options={[
                { value: "", label: "Default reasoning" },
                ...reasoningEfforts
                  .filter(
                    (effort) => effort !== "none" || model?.canDisableReasoning,
                  )
                  .map((value) => ({
                    value,
                    label: value.charAt(0).toUpperCase() + value.slice(1),
                  })),
              ]}
              onChange={(effort) =>
                change({
                  provider: choice.provider,
                  model: choice.model,
                  ...(effort
                    ? { effort: effort as ModelSelection["effort"] }
                    : {}),
                })
              }
            />
          </>
        ) : null}
      </div>
      {error ? (
        <p role="status">
          {error}{" "}
          <Button size="sm" variant="ghost" onClick={retry}>
            Retry
          </Button>
        </p>
      ) : !catalog ? (
        <p role="status">Loading models…</p>
      ) : choice && !provider?.authenticated ? (
        <p>
          Provider may need setup. Connect its account through native Hermes
          authentication.
        </p>
      ) : choice ? (
        <p>Applies to your next message. Shared defaults stay unchanged.</p>
      ) : null}
    </section>
  );
}
