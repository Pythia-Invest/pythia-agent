"use client";

import { useModelOptions } from "@/client/queries";
import { hermesPages, pageFields } from "@/settings/hermes-pages";
import { fieldControl } from "./config-field";
import { SourceState } from "./config-page";
import { words } from "./field-copy";
import { ListRow } from "./primitives";
import { useHermesFields } from "./use-hermes-fields";

const TASK = /^auxiliary\.([a-z_]+)\.(provider|model)$/u;

/**
 * The model for each background task Hermes runs, grouped by task as in
 * Hermes Desktop's Auxiliary models page. `auto` uses the main model or a
 * suitable default.
 */
export function AuxiliaryModels() {
  const source = useHermesFields();
  const catalog = useModelOptions();
  const page = hermesPages.find((item) => item.id === "model/auxiliary");
  const keys = page ? pageFields(page, Object.keys(source.schema)) : [];
  const tasks = new Map<string, string[]>();
  for (const key of keys) {
    const task = TASK.exec(key)?.[1];
    if (task) tasks.set(task, [...(tasks.get(task) ?? []), key]);
  }
  const providers = catalog.data?.providers ?? [];
  const names = Object.fromEntries(
    providers.map((provider) => [provider.slug, provider.name]),
  );
  const field = (key: string) => {
    const base = source.schema[key];
    if (!base) return undefined;
    const provider = key.endsWith(".provider");
    return {
      ...base,
      label: `${words(TASK.exec(key)?.[1] ?? "")} ${provider ? "provider" : "model"}`,
      description: undefined,
      ...(provider
        ? {
            options: ["auto", ...providers.map((item) => item.slug)],
            optionLabels: { auto: "Auto", ...names },
          }
        : { placeholder: "Provider's default" }),
    };
  };
  return (
    <SourceState source={source}>
      <p className="m-0 mb-4 text-body text-foreground-secondary">
        Hermes runs some jobs with their own model, such as reading images or
        summarizing long chats. Auto uses the main model or a suitable default.
      </p>
      <div className="grid gap-1">
        {[...tasks].map(([task, fields]) => (
          <ListRow
            key={task}
            id={`setting-auxiliary.${task}`}
            title={words(task)}
            action={
              <div className="grid w-full grid-cols-2 gap-2">
                {fields.map((key) => {
                  const described = field(key);
                  return described ? (
                    <span key={key} id={`setting-${key}`} className="min-w-0">
                      {fieldControl(key, described, source)[0]}
                    </span>
                  ) : null;
                })}
              </div>
            }
          />
        ))}
      </div>
    </SourceState>
  );
}
