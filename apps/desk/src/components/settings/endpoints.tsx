"use client";

import { Alert, Badge, Button, Input, Label, Switch } from "@pythia/ui";
import { Check, Plus } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import {
  useCustomEndpointAction,
  useCustomEndpoints,
  useSaveCustomEndpoint,
} from "@/client/hermes-settings-queries";
import type { CustomEndpointInput } from "@/server/hermes-settings-contract";
import { SourceState } from "./config-page";
import { ListRow } from "./primitives";

const EMPTY: CustomEndpointInput = {
  name: "",
  baseUrl: "",
  model: "",
  apiKey: "",
  makeDefault: false,
};

function EndpointForm({ onDone }: { onDone: () => void }) {
  const save = useSaveCustomEndpoint();
  const [input, setInput] = useState(EMPTY);
  const id = useId();
  const field = (
    key: "name" | "baseUrl" | "model" | "apiKey",
    label: string,
    placeholder: string,
    type = "text",
  ) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`${id}-${key}`}>{label}</Label>
      <Input
        id={`${id}-${key}`}
        size="sm"
        type={type}
        autoComplete="off"
        placeholder={placeholder}
        value={input[key] ?? ""}
        onChange={(event) => setInput({ ...input, [key]: event.target.value })}
      />
    </div>
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate(input, { onSuccess: onDone });
  };
  return (
    <form
      aria-label="Add custom endpoint"
      onSubmit={submit}
      className="grid gap-3 rounded-control border border-border p-4"
    >
      <div className="grid @xl:grid-cols-2 gap-3">
        {field("name", "Name", "My local model")}
        {field("baseUrl", "Endpoint URL", "http://localhost:11434/v1")}
        {field("model", "Default model", "llama3.1:8b")}
        {field(
          "apiKey",
          "API key (optional)",
          "Leave blank if none",
          "password",
        )}
      </div>
      <div className="flex items-center gap-2 text-body">
        <Switch
          id={`${id}-default`}
          checked={input.makeDefault === true}
          onCheckedChange={(makeDefault) => setInput({ ...input, makeDefault })}
        />
        <Label htmlFor={`${id}-default`}>Use for new chats</Label>
      </div>
      {save.error ? <Alert tone="error" title={save.error.message} /> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          loading={save.isPending}
          disabled={
            !input.name.trim() || !input.baseUrl.trim() || !input.model.trim()
          }
        >
          Save endpoint
        </Button>
      </div>
    </form>
  );
}

/** OpenAI-compatible endpoints Hermes can use, such as a local model server. */
export function EndpointsPage() {
  const endpoints = useCustomEndpoints();
  const action = useCustomEndpointAction();
  const [adding, setAdding] = useState(false);
  const list = endpoints.data ?? [];
  return (
    <SourceState
      source={{
        status: endpoints.isPending
          ? "pending"
          : endpoints.isError
            ? "error"
            : "ready",
        error: endpoints.error,
        retry: () => void endpoints.refetch(),
      }}
    >
      <p className="m-0 mb-4 text-body text-foreground-secondary">
        Point Hermes at any OpenAI-compatible server: a local model, a gateway
        or a hosted endpoint. A key you add is kept in Hermes's key store, not
        in its config.
      </p>
      {list.length ? (
        <div className="mb-4 grid gap-1">
          {list.map((endpoint) => (
            <ListRow
              key={endpoint.id}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {endpoint.name}
                  {endpoint.current ? (
                    <Badge tone="success">
                      <Check aria-hidden="true" className="size-3" /> In use
                    </Badge>
                  ) : null}
                </span>
              }
              description={`${endpoint.baseUrl}${endpoint.model ? ` · ${endpoint.model}` : ""}`}
              hint={endpoint.hasKey ? "Key set" : undefined}
              action={
                <div className="flex justify-end gap-2">
                  {endpoint.current ? null : (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={action.isPending}
                      onClick={() =>
                        action.mutate({ id: endpoint.id, action: "activate" })
                      }
                    >
                      Use for new chats
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={action.isPending}
                    onClick={() =>
                      action.mutate({ id: endpoint.id, action: "remove" })
                    }
                  >
                    Remove
                  </Button>
                </div>
              }
            />
          ))}
        </div>
      ) : adding ? null : (
        <p className="m-0 mb-4 rounded-control border border-border border-dashed py-6 text-center text-body text-foreground-secondary">
          No custom endpoints.
        </p>
      )}
      {action.error ? (
        <Alert tone="error" title={action.error.message} className="mb-4" />
      ) : null}
      {adding ? (
        <EndpointForm onDone={() => setAdding(false)} />
      ) : (
        <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
          <Plus aria-hidden="true" className="size-3.5" /> Add endpoint
        </Button>
      )}
    </SourceState>
  );
}
